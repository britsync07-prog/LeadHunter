import db from '../models/db.js';
import { createTransporter, injectTrackingHtml, sendEmail } from '../services/mailer.js';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getCampaignDetail, normalizeCampaignConfigInput } from '../services/campaignInspector.js';
import { normalizeRecipientEmail } from '../services/emailSanitizer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STANDARD_MAX_CONSECUTIVE_FAILURES = 3;
const ADMIN_MAX_CONSECUTIVE_FAILURES = 4; // initial fail + next 3 fails
const SMTP_REST_MS = 60 * 60 * 1000;
const SEND_DELAY_MS = 30000;
const SMTP_RETRY_DELAY_MS = 15 * 60 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const logSender = (message, meta = null) => {
  const suffix = meta ? ` ${JSON.stringify(meta)}` : '';
  console.log(`[Sender] ${message}${suffix}`);
};

const isWithinWindow = (timezone, startStr, endStr) => {
  if (!timezone || !startStr || !endStr) return true;

  try {
    const now = new Date();
    // Use Intl to get the current hour/minute in the specific timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false
    });
    
    const parts = formatter.formatToParts(now);
    const hour = parseInt(parts.find(p => p.type === 'hour').value, 10);
    const minute = parseInt(parts.find(p => p.type === 'minute').value, 10);
    const currentMinutes = hour * 60 + minute;

    const [startH, startM] = startStr.split(':').map(Number);
    const startMinutes = startH * 60 + startM;

    const [endH, endM] = endStr.split(':').map(Number);
    const endMinutes = endH * 60 + endM;

    if (startMinutes <= endMinutes) {
      // Normal window (e.g., 09:00 to 17:00)
      return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
    } else {
      // Cross-midnight window (e.g., 14:00 to 09:00)
      return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
    }
  } catch (err) {
    console.error(`[Time Window Check] Error for ${timezone}:`, err.message);
    return true; // Fallback to sending if timezone logic fails
  }
};

const verifySmtpConnection = async (smtpConfig) => {
  const transporter = createTransporter(smtpConfig);
  try {
    await transporter.verify();
    return transporter;
  } catch (error) {
    throw new Error(`SMTP Connection Failed: ${error.message}`);
  }
};

const loadActiveSmtpPool = async (smtpAccountIds, userId) => {
  if (!smtpAccountIds || smtpAccountIds.length === 0) {
    return { pool: [], failures: [], requestedCount: 0, activeCount: 0, earliestRestingUntil: null };
  }

  const placeholders = smtpAccountIds.map(() => '?').join(',');
  const accounts = db
    .prepare(`SELECT * FROM smtp_accounts WHERE id IN (${placeholders}) AND userId = ?`)
    .all(...smtpAccountIds, userId);

  const now = new Date();
  const active = accounts.filter((acc) => !acc.restingUntil || new Date(acc.restingUntil) <= now);
  const resting = accounts
    .filter((acc) => acc.restingUntil && new Date(acc.restingUntil) > now)
    .map((acc) => new Date(acc.restingUntil).getTime())
    .filter((ts) => Number.isFinite(ts));
  const earliestRestingUntil = resting.length > 0 ? new Date(Math.min(...resting)).toISOString() : null;

  const pool = [];
  const failures = [];
  for (const acc of active) {
    try {
      const transporter = await verifySmtpConnection({ host: acc.host, port: acc.port, user: acc.user, pass: acc.pass });
      pool.push({
        dbId: acc.id,
        user: acc.user,
        transporter,
        consecutiveFails: acc.consecutiveFails || 0
      });
    } catch (err) {
      failures.push(`${acc.user}: ${err.message}`);
      console.warn(`[SMTP Pool] Skipping ${acc.user} - verification failed: ${err.message}`);
    }
  }

  return { pool, failures, requestedCount: accounts.length, activeCount: active.length, earliestRestingUntil };
};

const restSmtpAccount = (dbId) => {
  const restUntil = new Date(Date.now() + SMTP_REST_MS).toISOString();
  // Reset consecutiveFails to 0 after putting to rest so it has a clean slate when it wakes up
  db.prepare(`UPDATE smtp_accounts SET consecutiveFails = ?, restingUntil = ? WHERE id = ?`).run(0, restUntil, dbId);
  console.warn(`[SMTP Manager] Account ${dbId} rests until ${restUntil}`);
};

const scheduleCampaignRetry = (campaignId, reason, delayMs = SMTP_RETRY_DELAY_MS) => {
  const retryAt = new Date(Date.now() + delayMs).toISOString();
  db.prepare(`UPDATE campaigns SET status = 'sending', abortReason = ? WHERE id = ?`).run(reason, campaignId);
  db.prepare(`
    UPDATE recipients
    SET nextSendAt = ?, error = ?
    WHERE campaignId = ? AND status = 'pending'
  `).run(retryAt, reason, campaignId);
  logSender('Campaign retry scheduled', { campaignId, retryAt, reason });
  return retryAt;
};

const scheduleCampaignRetryAt = (campaignId, reason, retryAt) => {
  db.prepare(`UPDATE campaigns SET status = 'sending', abortReason = ? WHERE id = ?`).run(reason, campaignId);
  db.prepare(`
    UPDATE recipients
    SET nextSendAt = ?, error = ?
    WHERE campaignId = ? AND status = 'pending'
  `).run(retryAt, reason, campaignId);
  logSender('Campaign retry scheduled', { campaignId, retryAt, reason });
  return retryAt;
};

const sanitizeCampaignName = (campaignName) => {
  const safe = String(campaignName || 'campaign').replace(/[^a-z0-9]/gi, '_').toLowerCase();
  return safe || 'campaign';
};

const generateReportFiles = ({ campaignId, campaignName, originalRecipients }) => {
  const safeName = sanitizeCampaignName(campaignName);
  const publicDir = path.join(__dirname, '..', '..', '..', 'public');

  const sentFile = `Sent_Emails_${safeName}_${campaignId}.txt`;
  const failedFile = `Failed_Emails_${safeName}_${campaignId}.txt`;

  const sentPath = path.join(publicDir, sentFile);
  const failedPath = path.join(publicDir, failedFile);

  try {
    const rows = db
      .prepare(`SELECT email, status, error FROM recipients WHERE campaignId = ?`)
      .all(campaignId);

    const delivered = rows.filter((r) => r.status === 'delivered').map((r) => r.email);
    const failed = rows
      .filter((r) => r.status !== 'delivered')
      .map((r) => `${r.email} - ${r.error || 'Not sent or failed'}`);

    const deliveredSet = new Set(delivered.map((e) => e.toLowerCase()));
    const failedSet = new Set(rows.filter((r) => r.status !== 'delivered').map((r) => r.email.toLowerCase()));
    if (originalRecipients) {
        for (const email of originalRecipients) {
        const key = String(email).toLowerCase();
        if (!deliveredSet.has(key) && !failedSet.has(key)) {
            failed.push(`${email} - Not attempted due to interruption`);
        }
        }
    }

    fs.writeFileSync(sentPath, delivered.join('\n'));
    fs.writeFileSync(failedPath, failed.join('\n'));

    db.prepare(`UPDATE campaigns SET sentReportFile = ?, failedReportFile = ? WHERE id = ?`).run(sentFile, failedFile, campaignId);
    return { sentFile, failedFile };
  } catch (err) {
    console.error(`[Campaign ${campaignId}] Error generating text reports:`, err);
    try {
      fs.writeFileSync(sentPath, '');
      fs.writeFileSync(
        failedPath,
        (originalRecipients || []).map((e) => `${e} - Report fallback after worker error`).join('\n')
      );
      db.prepare(`UPDATE campaigns SET sentReportFile = ?, failedReportFile = ? WHERE id = ?`).run(sentFile, failedFile, campaignId);
      return { sentFile, failedFile };
    } catch (fallbackErr) {
      console.error(`[Campaign ${campaignId}] Fallback report generation failed:`, fallbackErr);
      return { sentFile: null, failedFile: null };
    }
  }
};

const markCampaignIfFinished = (campaignId) => {
  const row = db.prepare(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN status IN ('delivered', 'bounced') THEN 1 ELSE 0 END) as doneCount,
      SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as deliveredCount,
      SUM(CASE WHEN status = 'bounced' THEN 1 ELSE 0 END) as bouncedCount
    FROM recipients WHERE campaignId = ?
  `).get(campaignId);

  if (!row) return;

  db.prepare(`UPDATE campaigns SET deliveredCount = ?, bouncedCount = ? WHERE id = ?`).run(row.deliveredCount || 0, row.bouncedCount || 0, campaignId);

  if (row.total > 0 && row.doneCount === row.total) {
    db.prepare(`UPDATE campaigns SET status = 'completed', abortReason = NULL WHERE id = ?`).run(campaignId);
    
    const camp = db.prepare(`SELECT name, config FROM campaigns WHERE id = ?`).get(campaignId);
    let originalRecipients = [];
    try {
      const config = JSON.parse(camp?.config || '{}');
      originalRecipients = config.normalizedRecipients || [];
    } catch (e) {}
    
    generateReportFiles({ campaignId, campaignName: camp ? camp.name : 'Unknown', originalRecipients });
  }
};

export const processPendingEmails = async (hostUrlFallback, specificCampaignId = null) => {
  let query = `
    SELECT r.*, c.userId, c.name as campaignName 
    FROM recipients r 
    JOIN campaigns c ON r.campaignId = c.id
    WHERE r.status = 'pending' AND (r.nextSendAt IS NULL OR r.nextSendAt <= CURRENT_TIMESTAMP) AND c.status = 'sending'
  `;
  const params = [];
  if (specificCampaignId) {
    query += ` AND c.id = ?`;
    params.push(specificCampaignId);
  }
  query += ` ORDER BY r.nextSendAt ASC LIMIT 500`;
  
  const pendings = db.prepare(query).all(...params);

  if (pendings.length === 0) return;

  // Immediately "lock" these recipients by pushing their nextSendAt forward.
  // This prevents concurrent scheduler ticks from picking up the same emails while we work.
  const lockTime = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minute lock
  const updateLockStmt = db.prepare(`UPDATE recipients SET nextSendAt = ? WHERE id = ?`);
  db.transaction(() => {
    for (const rec of pendings) {
      updateLockStmt.run(lockTime, rec.id);
    }
  })();

  logSender(specificCampaignId ? `Direct trigger started for campaign ${specificCampaignId}` : 'Scheduler picked and locked pending recipients', { count: pendings.length });

  // Group recipients by campaign to avoid redundant SMTP pool loading and verification
  const campaigns = {};
  for (const rec of pendings) {
    if (!campaigns[rec.campaignId]) {
      const campData = db.prepare(`SELECT config FROM campaigns WHERE id = ?`).get(rec.campaignId);
      campaigns[rec.campaignId] = {
        userId: rec.userId,
        campaignName: rec.campaignName,
        config: JSON.parse(campData?.config || '{}'),
        recipients: []
      };
    }
    campaigns[rec.campaignId].recipients.push(rec);
  }

  const campaignPromises = Object.keys(campaigns).map(async (campaignId) => {
    const camp = campaigns[campaignId];
    const config = camp.config;
    const trackingBaseUrl = config.publicBaseUrl || hostUrlFallback;
    
    const user = db.prepare("SELECT subscriptionPlan, isAdmin FROM users WHERE id = ?").get(camp.userId);
    const isPremiumOrAdvance = user && (user.subscriptionPlan === 'premium' || user.subscriptionPlan === 'advance' || user.isAdmin);
    const isAdmin = !!user?.isAdmin;

    let smtpPool = [];
    if (isPremiumOrAdvance && config.smtpAccountIds && config.smtpAccountIds.length > 0) {
      const smtpState = await loadActiveSmtpPool(config.smtpAccountIds, camp.userId);
      smtpPool = smtpState.pool;
      if (smtpPool.length === 0) {
        const reason = smtpState.failures.length > 0
          ? `SMTP pool verification failed: ${smtpState.failures.join(' | ')}`
          : smtpState.requestedCount === 0
            ? 'SMTP pool is empty.'
            : smtpState.activeCount === 0
              ? 'All selected SMTP accounts are currently resting.'
              : 'No usable SMTP accounts were available.';
        
        // Only reschedule if ALL are resting. If it's a verification failure, we'll try again next tick.
        if (smtpState.activeCount === 0 && smtpState.earliestRestingUntil) {
          scheduleCampaignRetryAt(campaignId, reason, smtpState.earliestRestingUntil);
        } else {
          // If verification failed but they aren't marked 'resting', just push back slightly (1 minute) 
          // instead of 15 minutes to avoid global pause.
          scheduleCampaignRetry(campaignId, reason, 60000); 
        }
        return;
      }
    } else if (config.smtpHost) {
      try {
        const transporter = await verifySmtpConnection({ host: config.smtpHost, port: parseInt(config.smtpPort, 10), user: config.smtpUser, pass: config.smtpPass });
        smtpPool = [{ dbId: 'adhoc', user: config.smtpUser, transporter, consecutiveFails: 0 }];
      } catch (e) {
        logSender('Direct SMTP verification failed', { campaignId, smtpUser: config.smtpUser, error: e.message });
        scheduleCampaignRetry(campaignId, 'SMTP verification failed: ' + e.message, 60000);
        return;
      }
    }

    if (smtpPool.length === 0) {
      scheduleCampaignRetry(campaignId, 'No usable SMTP configuration found.', 60000);
      return;
    }

    const sequences = config.sequences || [{
       senderName: config.senderName,
       subject: config.subject,
       htmlContent: config.htmlContent,
       delayDays: 0
    }];

    for (const rec of camp.recipients) {
      const normalizedEmail = normalizeRecipientEmail(rec.email);
      if (!normalizedEmail) {
        logSender('Recipient email invalid', { campaignId: rec.campaignId, recipientId: rec.id, email: rec.email });
        db.prepare(`UPDATE recipients SET status = 'bounced', error = ? WHERE id = ?`).run('Invalid email format', rec.id);
        markCampaignIfFinished(rec.campaignId);
        continue;
      }
      
      if (rec.currentStep >= sequences.length) {
        db.prepare(`UPDATE recipients SET status = 'delivered' WHERE id = ?`).run(rec.id);
        markCampaignIfFinished(rec.campaignId);
        continue;
      }

      const currentSeq = sequences[rec.currentStep];

      if (isPremiumOrAdvance && config.timezone && config.startTime && config.endTime) {
        if (!isWithinWindow(config.timezone, config.startTime, config.endTime)) {
          // Push back by 30 minutes if outside window
          const retryAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
          db.prepare(`UPDATE recipients SET nextSendAt = ? WHERE id = ?`).run(retryAt, rec.id);
          continue;
        }
      }

      const activeSmtp = smtpPool[Math.floor(Math.random() * smtpPool.length)];
      const trackedHtml = injectTrackingHtml(currentSeq.htmlContent, rec.id, trackingBaseUrl);
      
      logSender('Attempting send', {
        campaignId: rec.campaignId,
        recipientId: rec.id,
        email: rec.email,
        smtpUser: activeSmtp.user
      });
      
      const result = await sendEmail(
        activeSmtp.transporter,
        { name: currentSeq.senderName, email: activeSmtp.user },
        rec.email,
        currentSeq.subject,
        trackedHtml
      );

      if (result.ok) {
        if (activeSmtp && activeSmtp.dbId !== 'adhoc') {
          db.prepare(`UPDATE smtp_accounts SET consecutiveFails = 0 WHERE id = ?`).run(activeSmtp.dbId);
        }
        db.prepare(`INSERT INTO event_logs (id, eventId, campaignId, recipientId, eventType, ipAddress, userAgent) VALUES (?, ?, ?, ?, 'DELIVERED', '127.0.0.1', 'Scheduled SMTP Queue')`).run(uuidv4(), rec.id, rec.campaignId, rec.id);

        const nextStep = rec.currentStep + 1;
        if (nextStep < sequences.length) {
          const nextStepConfig = sequences[nextStep];
          const nextDelayDays = nextStepConfig.delayDays || 0;
          let nextDate = new Date();
          nextDate.setHours(nextDate.getHours() + (nextDelayDays * 24));
          db.prepare(`UPDATE recipients SET currentStep = ?, nextSendAt = ?, sentAt = CURRENT_TIMESTAMP WHERE id = ?`).run(nextStep, nextDate.toISOString(), rec.id);
        } else {
          db.prepare(`UPDATE recipients SET status = 'delivered', currentStep = ?, sentAt = CURRENT_TIMESTAMP WHERE id = ?`).run(nextStep, rec.id);
        }
      } else {
        const errorMsg = result.error || 'Unknown error';
        logSender('Send failed', { campaignId: rec.campaignId, email: rec.email, error: errorMsg });
        
        if (activeSmtp && activeSmtp.dbId !== 'adhoc') {
            activeSmtp.consecutiveFails += 1;
            db.prepare(`UPDATE smtp_accounts SET consecutiveFails = ? WHERE id = ?`).run(activeSmtp.consecutiveFails, activeSmtp.dbId);
            const maxFails = isPremiumOrAdvance ? ADMIN_MAX_CONSECUTIVE_FAILURES : STANDARD_MAX_CONSECUTIVE_FAILURES;
            if (activeSmtp.consecutiveFails >= maxFails) {
              restSmtpAccount(activeSmtp.dbId);
              // Remove from current in-memory pool so it's not used again this sweep
              const idx = smtpPool.findIndex(s => s.dbId === activeSmtp.dbId);
              if (idx > -1) smtpPool.splice(idx, 1);
            }
        }
        db.prepare(`UPDATE recipients SET status = 'bounced', error = ?, sentAt = CURRENT_TIMESTAMP WHERE id = ?`).run(errorMsg, rec.id);
        db.prepare(`INSERT INTO event_logs (id, eventId, campaignId, recipientId, eventType, ipAddress, userAgent) VALUES (?, ?, ?, ?, 'BOUNCED', '127.0.0.1', 'Scheduled SMTP Queue')`).run(uuidv4(), rec.id, rec.campaignId, rec.id);
      }
      
      if (camp.recipients.length > 1) await sleep(SEND_DELAY_MS);
    }
    // Finalize campaign state once after the recipient batch
    markCampaignIfFinished(campaignId);
  });
  await Promise.all(campaignPromises);
};

const launchCampaign = async (req, res) => {
  try {
    const { 
      campaignName, sequences, recipients, 
      smtpHost, smtpPort, smtpUser, smtpPass, smtpAccountIds,
      timezone, startTime, endTime
    } = req.body;
    
    if (!campaignName || !recipients || recipients.length === 0) {
      return res.status(400).json({ error: 'Missing data.' });
    }
      
    const normalizedRecipients = Array.from(new Set(recipients.map((e) => normalizeRecipientEmail(e)).filter(Boolean)));
    if (normalizedRecipients.length === 0) return res.status(400).json({ error: 'No recipients.' });

    const user = db.prepare("SELECT subscriptionPlan, isAdmin FROM users WHERE id = ?").get(req.session.user.id);
    const userId = req.session?.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized.' });
    
    let finalSequences = sequences;
    if (!finalSequences || finalSequences.length === 0) {
      finalSequences = [{
        senderName: req.body.senderName,
        subject: req.body.subject,
        htmlContent: req.body.htmlContent,
        delayDays: 0
      }];
    }

    const forwardedProto = req.get('x-forwarded-proto');
    const publicBaseUrl = `${forwardedProto || req.protocol}://${req.get('host')}`;

    const campaignId = uuidv4();
    logSender('Campaign started immediately', { campaignId, campaignName, recipientCount: normalizedRecipients.length, immediate: true });

    const configJson = JSON.stringify({
      sequences: finalSequences, normalizedRecipients,
      smtpAccountIds, smtpHost, smtpPort, smtpUser, smtpPass,
      timezone, startTime, endTime, publicBaseUrl
    });

    db.transaction(() => {
      db.prepare(`INSERT INTO campaigns (id, userId, name, status, config) VALUES (?, ?, ?, 'sending', ?)`).run(
        campaignId, userId, campaignName, configJson
      );

      const insertStmt = db.prepare(`INSERT OR IGNORE INTO recipients (id, campaignId, email, status, currentStep, nextSendAt) VALUES (?, ?, ?, 'pending', 0, CURRENT_TIMESTAMP)`);
      for (const email of normalizedRecipients) {
          insertStmt.run(uuidv4(), campaignId, email);
      }
    })();

    // For direct/immediate sends, kick the worker once right away instead of waiting
    // for the next scheduler tick. We pass campaignId to ensure THIS campaign is prioritized.
    process.nextTick(() => {
      processPendingEmails(publicBaseUrl, campaignId).catch((err) => {
        console.error('[Campaign Immediate Send Error]', err);
      });
    });

    res.status(202).json({ message: 'Campaign started successfully.', campaignId, totalRecipients: normalizedRecipients.length });

  } catch (error) {
    console.error('[Campaign Error]', error);
    if (!res.headersSent) res.status(500).json({ error: error.message || 'Internal Error.' });
  }
};

const getCampaignDetails = (req, res) => {
  const { id } = req.params;
  const userId = req.session?.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized.' });

  try {
    const detail = getCampaignDetail(id);
    if (!detail || detail.userId !== userId) {
      return res.status(404).json({ error: 'Campaign not found.' });
    }

    res.json({ campaign: detail });
  } catch (error) {
    console.error('[Campaign Detail Error]', error);
    res.status(500).json({ error: 'Failed to load campaign details.' });
  }
};

const updateCampaign = (req, res) => {
  const { id } = req.params;
  const userId = req.session?.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized.' });

  try {
    const existing = db.prepare(`SELECT id, userId, config FROM campaigns WHERE id = ?`).get(id);
    if (!existing || existing.userId !== userId) {
      return res.status(404).json({ error: 'Campaign not found.' });
    }

    let existingConfig = {};
    try {
      existingConfig = JSON.parse(existing.config || '{}');
    } catch {
      existingConfig = {};
    }

    const nextName = typeof req.body.campaignName === 'string' ? req.body.campaignName.trim() : '';
    const config = normalizeCampaignConfigInput({
      ...req.body,
      publicBaseUrl: existingConfig.publicBaseUrl || req.body.publicBaseUrl
    }, existingConfig);

    if (!nextName) {
      return res.status(400).json({ error: 'Campaign name is required.' });
    }

    db.prepare(`UPDATE campaigns SET name = ?, config = ? WHERE id = ? AND userId = ?`)
      .run(nextName, JSON.stringify(config), id, userId);

    res.json({ success: true, campaign: getCampaignDetail(id) });
  } catch (error) {
    console.error('[Campaign Update Error]', error);
    res.status(400).json({ error: error.message || 'Failed to update campaign.' });
  }
};

const resumeCampaign = async (campaignId, hostUrl) => {
  db.prepare(`UPDATE campaigns SET status = 'sending', abortReason = NULL WHERE id = ?`).run(campaignId);
};

const pauseCampaign = (req, res) => {
  const { id } = req.params;
  const userId = req.session?.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized.' });

  try {
    const existing = db.prepare(`SELECT id, userId, status FROM campaigns WHERE id = ?`).get(id);
    if (!existing || existing.userId !== userId) {
      return res.status(404).json({ error: 'Campaign not found.' });
    }

    db.prepare(`UPDATE campaigns SET status = 'paused', abortReason = ? WHERE id = ? AND userId = ?`)
      .run('Paused by user', id, userId);
    res.json({ success: true, campaign: getCampaignDetail(id) });
  } catch (err) {
    console.error('[Campaign Pause Error]', err);
    res.status(500).json({ error: 'Failed to pause campaign.' });
  }
};

const resumeCampaignRoute = async (req, res) => {
  const { id } = req.params;
  const userId = req.session?.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized.' });

  try {
    const existing = db.prepare(`SELECT id, userId, config FROM campaigns WHERE id = ?`).get(id);
    if (!existing || existing.userId !== userId) {
      return res.status(404).json({ error: 'Campaign not found.' });
    }

    let config = {};
    try {
      config = JSON.parse(existing.config || '{}');
    } catch {}

    db.prepare(`UPDATE campaigns SET status = 'sending', abortReason = NULL WHERE id = ? AND userId = ?`)
      .run(id, userId);

    const hostUrl = config.publicBaseUrl || process.env.PUBLIC_URL || 'http://localhost:3000';
    process.nextTick(() => {
      processPendingEmails(hostUrl).catch((err) => {
        console.error('[Campaign Resume Error]', err);
      });
    });

    res.json({ success: true, campaign: getCampaignDetail(id) });
  } catch (err) {
    console.error('[Campaign Resume Route Error]', err);
    res.status(500).json({ error: 'Failed to resume campaign.' });
  }
};

const deleteCampaign = (req, res) => {
  const { id } = req.params;
  const userId = req.session?.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized.' });

  try {
    db.transaction(() => {
      db.prepare("DELETE FROM recipients WHERE campaignId = ?").run(id);
      db.prepare("DELETE FROM event_logs WHERE campaignId = ?").run(id);
      db.prepare("DELETE FROM campaigns WHERE id = ? AND userId = ?").run(id, userId);
    })();
    res.json({ success: true });
  } catch (err) {
    console.error('[Campaign Delete Error]', err);
    res.status(500).json({ error: 'Failed to delete campaign.' });
  }
};

export { launchCampaign, getCampaignDetails, updateCampaign, resumeCampaign, pauseCampaign, resumeCampaignRoute, deleteCampaign };
