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
const SEND_DELAY_MS = 5000;
const SMTP_RETRY_DELAY_MS = 15 * 60 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  if (!smtpAccountIds || smtpAccountIds.length === 0) return [];

  const placeholders = smtpAccountIds.map(() => '?').join(',');
  const accounts = db
    .prepare(`SELECT * FROM smtp_accounts WHERE id IN (${placeholders}) AND userId = ?`)
    .all(...smtpAccountIds, userId);

  const now = new Date();
  const active = accounts.filter((acc) => !acc.restingUntil || new Date(acc.restingUntil) <= now);

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

  return { pool, failures, requestedCount: accounts.length, activeCount: active.length };
};

const restSmtpAccount = (dbId) => {
  const restUntil = new Date(Date.now() + SMTP_REST_MS).toISOString();
  db.prepare(`UPDATE smtp_accounts SET consecutiveFails = ?, restingUntil = ? WHERE id = ?`).run(ADMIN_MAX_CONSECUTIVE_FAILURES, restUntil, dbId);
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

  db.prepare(`UPDATE campaigns SET deliveredCount = ?, bouncedCount = ? WHERE id = ?`).run(row.deliveredCount || 0, row.bouncedCount || 0, campaignId);

  if (row.total > 0 && row.doneCount === row.total) {
    db.prepare(`UPDATE campaigns SET status = 'completed', abortReason = NULL WHERE id = ?`).run(campaignId);
    
    const camp = db.prepare(`SELECT name FROM campaigns WHERE id = ?`).get(campaignId);
    generateReportFiles({ campaignId, campaignName: camp ? camp.name : 'Unknown', originalRecipients: [] });
  }
};

export const processPendingEmails = async (hostUrlFallback) => {
  const pendings = db.prepare(`
    SELECT r.*, c.config, c.userId, c.name as campaignName 
    FROM recipients r 
    JOIN campaigns c ON r.campaignId = c.id
    WHERE r.status = 'pending' AND (r.nextSendAt IS NULL OR r.nextSendAt <= CURRENT_TIMESTAMP) AND c.status = 'sending'
    ORDER BY r.nextSendAt ASC LIMIT 50
  `).all();

  for (const rec of pendings) {
    const config = JSON.parse(rec.config || '{}');
    const trackingBaseUrl = config.publicBaseUrl || hostUrlFallback;
    const normalizedEmail = normalizeRecipientEmail(rec.email);
    if (!normalizedEmail) {
      db.prepare(`UPDATE recipients SET status = 'bounced', error = ? WHERE id = ?`)
        .run('Invalid email format', rec.id);
      markCampaignIfFinished(rec.campaignId);
      continue;
    }
    if (normalizedEmail !== rec.email) {
      db.prepare(`UPDATE recipients SET email = ? WHERE id = ?`).run(normalizedEmail, rec.id);
      rec.email = normalizedEmail;
    }
    const user = db.prepare("SELECT subscriptionPlan, isAdmin FROM users WHERE id = ?").get(rec.userId);
    const isPremiumOrAdvance = user && (user.subscriptionPlan === 'premium' || user.subscriptionPlan === 'advance' || user.isAdmin);
    const isAdmin = !!user?.isAdmin;
    
    const sequences = config.sequences || [{
       senderName: config.senderName,
       subject: config.subject,
       htmlContent: config.htmlContent,
       delayDays: 0
    }];
    
    if (rec.currentStep >= sequences.length) {
      db.prepare(`UPDATE recipients SET status = 'delivered' WHERE id = ?`).run(rec.id);
      markCampaignIfFinished(rec.campaignId);
      continue;
    }

    const currentSeq = sequences[rec.currentStep];

    if (isPremiumOrAdvance && config.timezone && config.startTime && config.endTime) {
      if (!isWithinWindow(config.timezone, config.startTime, config.endTime)) {
        continue;
      }
    }

    let smtpPool = [];
    if (isPremiumOrAdvance && config.smtpAccountIds && config.smtpAccountIds.length > 0) {
      const smtpState = await loadActiveSmtpPool(config.smtpAccountIds, rec.userId);
      smtpPool = smtpState.pool;
      if (smtpPool.length === 0) {
        const reason = smtpState.failures.length > 0
          ? `SMTP pool verification failed: ${smtpState.failures.join(' | ')}`
          : smtpState.requestedCount === 0
            ? 'SMTP pool is empty.'
            : smtpState.activeCount === 0
              ? 'All selected SMTP accounts are currently resting.'
              : 'No usable SMTP accounts were available.';
        scheduleCampaignRetry(rec.campaignId, reason);
        continue;
      }
    } else if (config.smtpHost) {
      try {
        const transporter = await verifySmtpConnection({ host: config.smtpHost, port: parseInt(config.smtpPort, 10), user: config.smtpUser, pass: config.smtpPass });
        smtpPool = [{ dbId: 'adhoc', user: config.smtpUser, transporter, consecutiveFails: 0 }];
      } catch (e) {
        scheduleCampaignRetry(rec.campaignId, 'SMTP verification failed: ' + e.message);
        continue;
      }
    }

    if (smtpPool.length === 0) {
      scheduleCampaignRetry(rec.campaignId, 'No usable SMTP configuration found.');
      continue;
    }

    const activeSmtp = smtpPool[Math.floor(Math.random() * smtpPool.length)];
    const trackedHtml = injectTrackingHtml(currentSeq.htmlContent, rec.id, trackingBaseUrl);
    
    console.log(`[SMTP] Attempting send to ${rec.email} using ${activeSmtp.user} (Step ${rec.currentStep})`);
    
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
        const nextDelayDays = sequences[nextStep].delayDays || 0;
        let nextDate = new Date();
        nextDate.setHours(nextDate.getHours() + (nextDelayDays * 24));
        db.prepare(`UPDATE recipients SET currentStep = ?, nextSendAt = ?, sentAt = CURRENT_TIMESTAMP WHERE id = ?`)
          .run(nextStep, nextDate.toISOString(), rec.id);
      } else {
        db.prepare(`UPDATE recipients SET status = 'delivered', currentStep = ?, sentAt = CURRENT_TIMESTAMP WHERE id = ?`)
          .run(nextStep, rec.id);
      }
    } else {
      const errorMsg = result.error || 'Unknown error';
      if (activeSmtp && activeSmtp.dbId !== 'adhoc') {
          activeSmtp.consecutiveFails += 1;
          db.prepare(`UPDATE smtp_accounts SET consecutiveFails = ? WHERE id = ?`).run(activeSmtp.consecutiveFails, activeSmtp.dbId);
          const maxFails = isPremiumOrAdvance ? ADMIN_MAX_CONSECUTIVE_FAILURES : STANDARD_MAX_CONSECUTIVE_FAILURES;
          if (activeSmtp.consecutiveFails >= maxFails) {
            restSmtpAccount(activeSmtp.dbId);
          }
      }
      db.prepare(`UPDATE recipients SET status = 'bounced', error = ?, sentAt = CURRENT_TIMESTAMP WHERE id = ?`).run(errorMsg, rec.id);
      db.prepare(`INSERT INTO event_logs (id, eventId, campaignId, recipientId, eventType, ipAddress, userAgent) VALUES (?, ?, ?, ?, 'BOUNCED', '127.0.0.1', 'Scheduled SMTP Queue')`).run(uuidv4(), rec.id, rec.campaignId, rec.id);
    }
    
    markCampaignIfFinished(rec.campaignId);
    await sleep(SEND_DELAY_MS);
  }
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
    db.prepare(`INSERT INTO campaigns (id, userId, name, status, config) VALUES (?, ?, ?, 'sending', ?)`).run(
      campaignId, userId, campaignName, 
      JSON.stringify({ 
        sequences: finalSequences, normalizedRecipients, 
        smtpAccountIds, smtpHost, smtpPort, smtpUser, smtpPass,
        timezone, startTime, endTime, publicBaseUrl
      })
    );
    
    const insertStmt = db.prepare(`INSERT OR IGNORE INTO recipients (id, campaignId, email, status, currentStep, nextSendAt) VALUES (?, ?, ?, 'pending', 0, CURRENT_TIMESTAMP)`);
    db.transaction(() => {
        for (const email of normalizedRecipients) {
            insertStmt.run(uuidv4(), campaignId, email);
        }
    })();

    // For direct/immediate sends, kick the worker once right away instead of waiting
    // for the next scheduler tick.
    process.nextTick(() => {
      processPendingEmails(publicBaseUrl).catch((err) => {
        console.error('[Campaign Immediate Send Error]', err);
      });
    });

    res.status(202).json({ message: 'Campaign queued successfully.', campaignId, totalRecipients: normalizedRecipients.length });
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

const deleteCampaign = (req, res) => {
  const { id } = req.params;
  const userId = req.session.user?.id;
  try {
    db.prepare("DELETE FROM campaigns WHERE id = ? AND userId = ?").run(id, userId);
    res.json({ success: true });
  } catch (err) {
    console.error('[Campaign Delete Error]', err);
    res.status(500).json({ error: 'Failed to delete campaign.' });
  }
};

export { launchCampaign, getCampaignDetails, updateCampaign, resumeCampaign, deleteCampaign };
