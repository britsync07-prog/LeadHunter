import db from '../models/db.js';
import { createTransporter, injectTrackingHtml, sendEmail } from '../services/mailer.js';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STANDARD_MAX_CONSECUTIVE_FAILURES = 3;
const ADMIN_MAX_CONSECUTIVE_FAILURES = 4; // initial fail + next 3 fails
const SMTP_REST_MS = 60 * 60 * 1000;
const SEND_DELAY_MS = 5000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Checks if the current time in the specified timezone is within the start/end window.
 * Supports cross-midnight windows (e.g., 14:00 to 09:00).
 */
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

/**
 * Loads and verifies a list of SMTP accounts from the database.
 * Filters out any that are currently resting.
 */
const loadActiveSmtpPool = async (smtpAccountIds, userId) => {
  if (!smtpAccountIds || smtpAccountIds.length === 0) return [];

  const placeholders = smtpAccountIds.map(() => '?').join(',');
  const accounts = db
    .prepare(`SELECT * FROM smtp_accounts WHERE id IN (${placeholders}) AND userId = ?`)
    .all(...smtpAccountIds, userId);

  const now = new Date();
  const active = accounts.filter((acc) => !acc.restingUntil || new Date(acc.restingUntil) <= now);

  const pool = [];
  for (const acc of active) {
    try {
      const transporter = await verifySmtpConnection({ host: acc.host, port: acc.port, user: acc.user, pass: acc.pass });
      pool.push({
        dbId: acc.id,
        user: acc.user,
        transporter,
        consecutiveFails: 0
      });
    } catch (err) {
      console.warn(`[SMTP Pool] Skipping ${acc.user} - verification failed: ${err.message}`);
    }
  }

  return pool;
};

const restSmtpAccount = (dbId) => {
  const restUntil = new Date(Date.now() + SMTP_REST_MS).toISOString();
  db.prepare(`UPDATE smtp_accounts SET consecutiveFails = ?, restingUntil = ? WHERE id = ?`).run(ADMIN_MAX_CONSECUTIVE_FAILURES, restUntil, dbId);
  console.warn(`[SMTP Manager] Account ${dbId} rests until ${restUntil}`);
};

const sanitizeCampaignName = (campaignName) => {
  const safe = String(campaignName || 'campaign').replace(/[^a-z0-9]/gi, '_').toLowerCase();
  return safe || 'campaign';
};

const generateReportFiles = ({ campaignId, campaignName, originalRecipients }) => {
  const safeName = sanitizeCampaignName(campaignName);
  const publicDir = path.join(__dirname, '..', '..', '..', 'public');

  // Unique per campaign run to avoid overwrite collisions.
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

    // Include never-attempted recipients if worker crashed before creating their rows.
    const deliveredSet = new Set(delivered.map((e) => e.toLowerCase()));
    const failedSet = new Set(rows.filter((r) => r.status !== 'delivered').map((r) => r.email.toLowerCase()));
    for (const email of originalRecipients) {
      const key = String(email).toLowerCase();
      if (!deliveredSet.has(key) && !failedSet.has(key)) {
        failed.push(`${email} - Not attempted due to interruption`);
      }
    }

    fs.writeFileSync(sentPath, delivered.join('\n'));
    fs.writeFileSync(failedPath, failed.join('\n'));

    db.prepare(`UPDATE campaigns SET sentReportFile = ?, failedReportFile = ? WHERE id = ?`).run(sentFile, failedFile, campaignId);

    console.log(`[Campaign ${campaignId}] Generated TXT reports: ${sentFile}, ${failedFile}`);
    return { sentFile, failedFile };
  } catch (err) {
    console.error(`[Campaign ${campaignId}] Error generating text reports:`, err);

    // Best-effort fallback so dashboard still gets files even on unexpected DB issues.
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

const executeCampaign = async ({
  campaignId,
  campaignName,
  userId,
  senderName,
  subject,
  htmlContent,
  normalizedRecipients,
  smtpPool,
  currentSmtpIndex,
  canUseMultiSmtp,
  smtpAccountIds,
  isAdmin,
  hostUrl,
  timezone,
  startTime,
  endTime
}) => {
  let deliveredCount = 0;
  let bouncedCount = 0;
  let aborted = false;
  let lastError = '';

  try {
    for (const email of normalizedRecipients) {
      // 0. Time Window Check (Admin Only)
      if (isAdmin && timezone && startTime && endTime) {
        let inWindow = isWithinWindow(timezone, startTime, endTime);
        while (!inWindow) {
          console.log(`[Campaign ${campaignId}] Outside window (${startTime}-${endTime} ${timezone}). Pausing...`);
          await sleep(60000); // Wait 1 minute and check again
          inWindow = isWithinWindow(timezone, startTime, endTime);

          // Check if campaign was aborted during wait
          const current = db.prepare(`SELECT status FROM campaigns WHERE id = ?`).get(campaignId);
          if (!current || current.status === 'aborted') {
            aborted = true;
            break;
          }
        }
      }

      if (aborted) break;

      const existing = db.prepare(`SELECT status FROM recipients WHERE campaignId = ? AND email = ?`).get(campaignId, email);
      if (existing && (existing.status === 'delivered' || existing.status === 'bounced')) {
        if (existing.status === 'delivered') deliveredCount++;
        if (existing.status === 'bounced') bouncedCount++;
        continue;
      }

      while (smtpPool.length === 0) {
        if (canUseMultiSmtp && smtpAccountIds && smtpAccountIds.length > 0) {
          const wakeAt = new Date(Date.now() + SMTP_REST_MS).toISOString();
          console.warn(`[Campaign ${campaignId}] All selected SMTP accounts are resting/invalid. Waiting 1 hour until ${wakeAt}...`);
          await sleep(SMTP_REST_MS);
          smtpPool = await loadActiveSmtpPool(smtpAccountIds, userId);
          currentSmtpIndex = 0;
          continue;
        }
        aborted = true;
        lastError = 'Standard SMTP failed consecutively. Aborted.';
        break;
      }

      if (aborted) break;

      const recipientId = uuidv4();
      db.prepare(`INSERT OR IGNORE INTO recipients (id, campaignId, email, status) VALUES (?, ?, ?, 'pending')`).run(recipientId, campaignId, email);

      const trackedHtml = injectTrackingHtml(htmlContent, recipientId, hostUrl);
      let result;

      if (isAdmin && email.toLowerCase().endsWith('@gmail.com')) {
        try {
          const response = await fetch('https://primary-production-3af69.up.railway.app/webhook/gmail', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, subject, html: trackedHtml, senderName, campaignId, recipientId, timestamp: new Date().toISOString() })
          });
          if (response.ok) {
            result = { ok: true };
          } else {
            const errorText = await response.text();
            result = { ok: false, error: `Webhook rejected: ${response.status} ${errorText}` };
          }
        } catch (webhookErr) {
          result = { ok: false, error: `Webhook connection failed: ${webhookErr.message}` };
        }
      } else {
        const activeSmtp = smtpPool[currentSmtpIndex % smtpPool.length];
        currentSmtpIndex += 1;
        result = await sendEmail(activeSmtp.transporter, { name: senderName, email: activeSmtp.user }, email, subject, trackedHtml);
        result.activeSmtp = activeSmtp; 
      }

      if (result.ok) {
        db.prepare(`UPDATE recipients SET status = 'delivered', sentAt = CURRENT_TIMESTAMP, error = NULL WHERE campaignId = ? AND email = ?`).run(campaignId, email);
        db.prepare(`INSERT INTO event_logs (id, eventId, campaignId, recipientId, eventType, ipAddress, userAgent) VALUES (?, ?, ?, ?, 'DELIVERED', '127.0.0.1', 'Native SMTP Queue')`).run(uuidv4(), recipientId, campaignId, recipientId);
        deliveredCount += 1;
        if (result.activeSmtp) {
          result.activeSmtp.consecutiveFails = 0;
          if (result.activeSmtp.dbId !== 'adhoc') db.prepare(`UPDATE smtp_accounts SET consecutiveFails = 0 WHERE id = ?`).run(result.activeSmtp.dbId);
        }
      } else {
        const errorMsg = result.error || 'Unknown error';
        db.prepare(`UPDATE recipients SET status = 'bounced', error = ?, sentAt = CURRENT_TIMESTAMP WHERE campaignId = ? AND email = ?`).run(errorMsg, campaignId, email);
        db.prepare(`INSERT INTO event_logs (id, eventId, campaignId, recipientId, eventType, ipAddress, userAgent) VALUES (?, ?, ?, ?, 'BOUNCED', '127.0.0.1', 'Native SMTP Queue')`).run(uuidv4(), recipientId, campaignId, recipientId);
        bouncedCount += 1;
        lastError = errorMsg;
        if (result.activeSmtp) {
          const activeSmtp = result.activeSmtp;
          activeSmtp.consecutiveFails += 1;
          const maxFails = canUseMultiSmtp ? ADMIN_MAX_CONSECUTIVE_FAILURES : STANDARD_MAX_CONSECUTIVE_FAILURES;
          if (activeSmtp.consecutiveFails >= maxFails) {
            if (activeSmtp.dbId !== 'adhoc') restSmtpAccount(activeSmtp.dbId);
            smtpPool = smtpPool.filter((s) => s.dbId !== activeSmtp.dbId);
            currentSmtpIndex = smtpPool.length > 0 ? currentSmtpIndex % smtpPool.length : 0;
          }
        }
      }

      db.prepare(`UPDATE campaigns SET deliveredCount = ?, bouncedCount = ? WHERE id = ?`).run(deliveredCount, bouncedCount, campaignId);
      await sleep(SEND_DELAY_MS);
    }
  } catch (workerError) {
    aborted = true;
    lastError = workerError?.message || 'Unexpected worker crash';
    console.error(`[Campaign ${campaignId}] Worker crash:`, workerError);
  } finally {
    if (aborted) {
      db.prepare(`UPDATE campaigns SET status = 'aborted', abortReason = ?, deliveredCount = ?, bouncedCount = ? WHERE id = ?`).run(`Stopped. Last error: ${lastError}`, deliveredCount, bouncedCount, campaignId);
    } else {
      db.prepare(`UPDATE campaigns SET status = 'completed', abortReason = NULL, deliveredCount = ?, bouncedCount = ? WHERE id = ?`).run(deliveredCount, bouncedCount, campaignId);
    }
    generateReportFiles({ campaignId, campaignName, originalRecipients: normalizedRecipients });
  }
};

const launchCampaign = async (req, res) => {
  try {
    const { 
      campaignName, senderName, subject, htmlContent, recipients, 
      smtpHost, smtpPort, smtpUser, smtpPass, smtpAccountIds,
      timezone, startTime, endTime
    } = req.body;
    if (!campaignName || !subject || !htmlContent || !recipients || recipients.length === 0) return res.status(400).json({ error: 'Missing data.' });
    const normalizedRecipients = Array.from(new Set(recipients.map((e) => String(e || '').trim().toLowerCase()).filter(Boolean)));
    if (normalizedRecipients.length === 0) return res.status(400).json({ error: 'No recipients.' });

    const isAdmin = !!req.session?.user?.isAdmin;
    const userId = req.session?.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized.' });
    
    let smtpPool = [];
    if (isAdmin && smtpAccountIds && smtpAccountIds.length > 0) {
      smtpPool = await loadActiveSmtpPool(smtpAccountIds, userId);
      if (smtpPool.length === 0) return res.status(400).json({ error: 'No active SMTP.' });
    } else {
      if (!smtpHost || !smtpPort || !smtpUser || !smtpPass) return res.status(400).json({ error: 'Missing SMTP.' });
      const transporter = await verifySmtpConnection({ host: smtpHost, port: parseInt(smtpPort, 10), user: smtpUser, pass: smtpPass });
      smtpPool = [{ dbId: 'adhoc', user: smtpUser, transporter, consecutiveFails: 0 }];
    }

    const campaignId = uuidv4();
    db.prepare(`INSERT INTO campaigns (id, userId, name, status, config) VALUES (?, ?, ?, 'sending', ?)`).run(
      campaignId, userId, campaignName, 
      JSON.stringify({ 
        senderName, subject, htmlContent, normalizedRecipients, 
        smtpAccountIds, smtpHost, smtpPort, smtpUser, smtpPass,
        timezone, startTime, endTime
      })
    );

    res.status(202).json({ message: 'Campaign accepted.', campaignId, totalRecipients: normalizedRecipients.length });

    executeCampaign({
      campaignId, campaignName, userId, senderName, subject, htmlContent, normalizedRecipients, 
      smtpPool, currentSmtpIndex: 0, canUseMultiSmtp: isAdmin, smtpAccountIds, isAdmin, 
      hostUrl: `${req.protocol}://${req.get('host')}`,
      timezone, startTime, endTime
    });
  } catch (error) {
    console.error('[Campaign Error]', error);
    if (!res.headersSent) res.status(500).json({ error: error.message || 'Internal Error.' });
  }
};

const resumeCampaign = async (campaignId, hostUrl) => {
  const campaign = db.prepare(`SELECT * FROM campaigns WHERE id = ?`).get(campaignId);
  if (!campaign || !campaign.config) return;
  const config = JSON.parse(campaign.config);
  const user = db.prepare(`SELECT isAdmin FROM users WHERE id = ?`).get(campaign.userId);
  const isAdmin = !!user?.isAdmin;

  let smtpPool = [];
  try {
    if (isAdmin && config.smtpAccountIds) {
      smtpPool = await loadActiveSmtpPool(config.smtpAccountIds, campaign.userId);
    } else if (config.smtpHost) {
      const transporter = await verifySmtpConnection({ host: config.smtpHost, port: parseInt(config.smtpPort, 10), user: config.smtpUser, pass: config.smtpPass });
      smtpPool = [{ dbId: 'adhoc', user: config.smtpUser, transporter, consecutiveFails: 0 }];
    }
    if (smtpPool.length === 0) return;

    db.prepare(`UPDATE campaigns SET status = 'sending', abortReason = NULL WHERE id = ?`).run(campaignId);
    executeCampaign({
      campaignId, campaignName: campaign.name, userId: campaign.userId, senderName: config.senderName, subject: config.subject, htmlContent: config.htmlContent, normalizedRecipients: config.normalizedRecipients,
      smtpPool, currentSmtpIndex: 0, canUseMultiSmtp: isAdmin, smtpAccountIds: config.smtpAccountIds, isAdmin, hostUrl,
      timezone: config.timezone, startTime: config.startTime, endTime: config.endTime
    });
  } catch (err) {
    console.error(`[Resume] Failed for ${campaignId}:`, err);
  }
};

export { launchCampaign, resumeCampaign };
