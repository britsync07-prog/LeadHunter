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

const launchCampaign = async (req, res) => {
  try {
    const {
      campaignName,
      senderName,
      subject,
      htmlContent,
      recipients,
      smtpHost,
      smtpPort,
      smtpUser,
      smtpPass,
      smtpAccountIds
    } = req.body;

    if (!campaignName || !subject || !htmlContent || !recipients || recipients.length === 0) {
      return res.status(400).json({ error: 'Missing required campaign data.' });
    }

    // Prevent accidental duplicates in one run.
    const normalizedRecipients = Array.from(
      new Set(
        recipients
          .map((e) => String(e || '').trim().toLowerCase())
          .filter(Boolean)
      )
    );

    if (normalizedRecipients.length === 0) {
      return res.status(400).json({ error: 'No valid recipients provided.' });
    }

    const isAdmin = !!req.session?.user?.isAdmin;
    const userId = req.session?.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized: No user session found.' });
    }
    let smtpPool = [];

    if (isAdmin && smtpAccountIds && smtpAccountIds.length > 0) {
      smtpPool = await loadActiveSmtpPool(smtpAccountIds, userId);
      if (smtpPool.length === 0) {
        return res
          .status(400)
          .json({ error: 'No active/valid SMTP accounts available in the selected pool. They may be resting or have invalid credentials.' });
      }
    } else {
      if (!smtpHost || !smtpPort || !smtpUser || !smtpPass) {
        return res.status(400).json({ error: 'Missing required SMTP credentials.' });
      }
      const transporter = await verifySmtpConnection({
        host: smtpHost,
        port: parseInt(smtpPort, 10),
        user: smtpUser,
        pass: smtpPass
      });
      smtpPool = [{ dbId: 'adhoc', user: smtpUser, transporter, consecutiveFails: 0 }];
    }

    const campaignId = uuidv4();
    db.prepare(`INSERT INTO campaigns (id, userId, name, status) VALUES (?, ?, ?, 'sending')`).run(campaignId, userId, campaignName);

    res.status(202).json({
      message: 'Campaign accepted for delivery.',
      campaignId,
      totalRecipients: normalizedRecipients.length
    });

    process.nextTick(async () => {
      const hostUrl = `${req.protocol}://${req.get('host')}`;
      let deliveredCount = 0;
      let bouncedCount = 0;
      let aborted = false;
      let lastError = '';
      let currentSmtpIndex = 0;

      try {
        for (const email of normalizedRecipients) {
          // Admin-only: never abort from full SMTP exhaustion; wait and resume until account(s) are available again.
          while (smtpPool.length === 0) {
            if (isAdmin && smtpAccountIds && smtpAccountIds.length > 0) {
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
          db.prepare(`INSERT INTO recipients (id, campaignId, email, status) VALUES (?, ?, ?, 'pending')`).run(recipientId, campaignId, email);

          const trackedHtml = injectTrackingHtml(htmlContent, recipientId, hostUrl);
          let result;

          // Admin-only Gmail Interception
          if (isAdmin && email.toLowerCase().endsWith('@gmail.com')) {
            console.log(`[Campaign ${campaignId}] Admin mode: Redirecting Gmail ${email} to webhook.`);
            try {
              const response = await fetch('https://primary-production-3af69.up.railway.app/webhook/gmail', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  email,
                  subject,
                  html: trackedHtml,
                  senderName,
                  campaignId,
                  recipientId,
                  timestamp: new Date().toISOString()
                })
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
            // Standard SMTP delivery
            const activeSmtp = smtpPool[currentSmtpIndex % smtpPool.length];
            currentSmtpIndex += 1;
            result = await sendEmail(activeSmtp.transporter, { name: senderName, email: activeSmtp.user }, email, subject, trackedHtml);
            
            // Link back for failure tracking if needed
            result.activeSmtp = activeSmtp; 
          }

          if (result.ok) {
            db.prepare(`UPDATE recipients SET status = 'delivered', sentAt = CURRENT_TIMESTAMP, error = NULL WHERE id = ?`).run(recipientId);
            db.prepare(
              `INSERT INTO event_logs (id, eventId, campaignId, recipientId, eventType, ipAddress, userAgent) VALUES (?, ?, ?, ?, 'DELIVERED', '127.0.0.1', 'Native SMTP Queue')`
            ).run(uuidv4(), recipientId, campaignId, recipientId);

            deliveredCount += 1;

            if (result.activeSmtp) {
              result.activeSmtp.consecutiveFails = 0;
              if (result.activeSmtp.dbId !== 'adhoc') {
                db.prepare(`UPDATE smtp_accounts SET consecutiveFails = 0 WHERE id = ?`).run(result.activeSmtp.dbId);
              }
            }
          } else {
            const errorMsg = result.error || 'Unknown error';
            db.prepare(`UPDATE recipients SET status = 'bounced', error = ?, sentAt = CURRENT_TIMESTAMP WHERE id = ?`).run(errorMsg, recipientId);
            db.prepare(
              `INSERT INTO event_logs (id, eventId, campaignId, recipientId, eventType, ipAddress, userAgent) VALUES (?, ?, ?, ?, 'BOUNCED', '127.0.0.1', 'Native SMTP Queue')`
            ).run(uuidv4(), recipientId, campaignId, recipientId);

            bouncedCount += 1;
            lastError = errorMsg;

            if (result.activeSmtp) {
              const activeSmtp = result.activeSmtp;
              activeSmtp.consecutiveFails += 1;
              const maxFails = isAdmin ? ADMIN_MAX_CONSECUTIVE_FAILURES : STANDARD_MAX_CONSECUTIVE_FAILURES;
              
              if (activeSmtp.consecutiveFails >= maxFails) {
                console.warn(
                  `[Campaign ${campaignId}] SMTP ${activeSmtp.user} reached ${maxFails} consecutive failures. ${
                    activeSmtp.dbId === 'adhoc' ? 'Removing for this campaign.' : 'Resting for 1 hour.'
                  }`
                );

                if (activeSmtp.dbId !== 'adhoc') {
                  restSmtpAccount(activeSmtp.dbId);
                }

                smtpPool = smtpPool.filter((s) => s.dbId !== activeSmtp.dbId);
                if (smtpPool.length > 0) {
                  currentSmtpIndex = currentSmtpIndex % smtpPool.length;
                } else {
                  currentSmtpIndex = 0;
                }
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
          const abortMsg = `Stopped due to SMTP or worker failure. Last error: ${lastError}`;
          db.prepare(`UPDATE campaigns SET status = 'aborted', abortReason = ?, deliveredCount = ?, bouncedCount = ? WHERE id = ?`).run(
            abortMsg,
            deliveredCount,
            bouncedCount,
            campaignId
          );
        } else {
          db.prepare(`UPDATE campaigns SET status = 'completed', abortReason = NULL, deliveredCount = ?, bouncedCount = ? WHERE id = ?`).run(
            deliveredCount,
            bouncedCount,
            campaignId
          );
        }

        // Always generate sent/failed text reports, even if worker crashed.
        generateReportFiles({ campaignId, campaignName, originalRecipients: normalizedRecipients });
      }
    });
  } catch (error) {
    console.error('[Campaign Error]', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || 'Internal Server Error during campaign launch.' });
    }
  }
};

export { launchCampaign };
