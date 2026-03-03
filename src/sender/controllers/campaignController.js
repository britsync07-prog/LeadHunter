import db from '../models/db.js';
import { createTransporter, injectTrackingHtml, sendEmail } from '../services/mailer.js';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure abort-related columns exist (safe to run every boot)
try { db.exec(`ALTER TABLE campaigns ADD COLUMN abortReason TEXT`); } catch { }
try { db.exec(`ALTER TABLE campaigns ADD COLUMN deliveredCount INTEGER DEFAULT 0`); } catch { }
try { db.exec(`ALTER TABLE campaigns ADD COLUMN bouncedCount INTEGER DEFAULT 0`); } catch { }
try { db.exec(`ALTER TABLE recipients ADD COLUMN error TEXT`); } catch { }

const MAX_CONSECUTIVE_FAILURES = 3;

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
 * Filters out any that are currently "resting".
 */
const loadActiveSmtpPool = async (smtpAccountIds, userId) => {
    if (!smtpAccountIds || smtpAccountIds.length === 0) return [];

    // Fetch from DB
    const placeholders = smtpAccountIds.map(() => '?').join(',');
    const accounts = db.prepare(`SELECT * FROM smtp_accounts WHERE id IN (${placeholders}) AND userId = ?`).all(...smtpAccountIds, userId);

    // Filter active ones
    const now = new Date();
    const active = accounts.filter(acc => !acc.restingUntil || new Date(acc.restingUntil) <= now);

    // Verify and map to transporters
    const pool = [];
    for (const acc of active) {
        try {
            const transporter = await verifySmtpConnection({ host: acc.host, port: acc.port, user: acc.user, pass: acc.pass });
            pool.push({
                dbId: acc.id,
                user: acc.user,
                transporter,
                consecutiveFails: 0 // Reset in-memory streak for this campaign session
            });
        } catch (err) {
            console.warn(`[SMTP Pool] Skipping ${acc.user} - verification failed: ${err.message}`);
        }
    }
    return pool;
};

const restSmtpAccount = (dbId) => {
    const restUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // +1 Hour
    db.prepare(`UPDATE smtp_accounts SET consecutiveFails = 3, restingUntil = ? WHERE id = ?`).run(restUntil, dbId);
    console.warn(`[SMTP Manager] Account ${dbId} rests until ${restUntil}`);
};

const generateReportFiles = (campaignId, campaignName) => {
    try {
        const recipients = db.prepare(`SELECT email, status, error FROM recipients WHERE campaignId = ?`).all(campaignId);

        const sent = recipients.filter(r => r.status === 'delivered').map(r => r.email);
        const failed = recipients.filter(r => r.status !== 'delivered').map(r => `${r.email} - ${r.error || 'Pending/Aborted'}`);

        const safeName = campaignName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const publicDir = path.join(__dirname, '..', '..', '..', 'public');

        if (sent.length > 0) fs.writeFileSync(path.join(publicDir, `Sent_Emails_${safeName}.txt`), sent.join('\n'));
        if (failed.length > 0) fs.writeFileSync(path.join(publicDir, `Failed_Emails_${safeName}.txt`), failed.join('\n'));

        console.log(`[Campaign ${campaignId}] Generated TXT reports.`);
    } catch (err) {
        console.error('[Campaign] Error generating text reports:', err);
    }
};

const launchCampaign = async (req, res) => {
    try {
        const { campaignName, senderName, subject, htmlContent, recipients, smtpHost, smtpPort, smtpUser, smtpPass, smtpAccountIds } = req.body;

        // 1. Basic Validation
        if (!campaignName || !subject || !htmlContent || !recipients || recipients.length === 0) {
            return res.status(400).json({ error: "Missing required campaign data." });
        }

        const isAdmin = req.session?.user?.isAdmin;
        const userId = req.session?.user?.id || 'standard_user';
        let smtpPool = [];

        // 2. Setup SMTP Pool (Admin Load Balancing OR Standard Ad-Hoc)
        if (isAdmin && smtpAccountIds && smtpAccountIds.length > 0) {
            smtpPool = await loadActiveSmtpPool(smtpAccountIds, userId);
            if (smtpPool.length === 0) {
                return res.status(400).json({ error: "No active/valid SMTP accounts available in the selected pool. They may be resting or have invalid credentials." });
            }
        } else {
            if (!smtpHost || !smtpPort || !smtpUser || !smtpPass) {
                return res.status(400).json({ error: "Missing required SMTP credentials." });
            }
            const transporter = await verifySmtpConnection({ host: smtpHost, port: parseInt(smtpPort, 10), user: smtpUser, pass: smtpPass });
            smtpPool = [{ dbId: 'adhoc', user: smtpUser, transporter, consecutiveFails: 0 }];
        }

        // 3. Initialize Campaign
        const campaignId = uuidv4();
        db.prepare(`INSERT INTO campaigns (id, userId, name, status) VALUES (?, ?, ?, 'sending')`)
            .run(campaignId, userId, campaignName);

        res.status(202).json({ message: 'Campaign accepted for delivery.', campaignId, totalRecipients: recipients.length });

        // 4. Asynchronous Delivery Worker
        process.nextTick(async () => {
            const hostUrl = `${req.protocol}://${req.get('host')}`;
            let deliveredCount = 0;
            let bouncedCount = 0;
            let aborted = false;
            let lastError = '';

            let currentSmtpIndex = 0;

            for (const email of recipients) {
                // Check if we need to sleep due to all SMTPs resting
                if (smtpPool.length === 0) {
                    if (isAdmin && smtpAccountIds && smtpAccountIds.length > 0) {
                        console.log(`[Campaign ${campaignId}] ⛔ ALL SMTPs in REST mode. Sleeping worker for 1 Hour...`);
                        await new Promise(r => setTimeout(r, 60 * 60 * 1000)); // 1 hour sleep
                        console.log(`[Campaign ${campaignId}] Waking up, reloading SMTP pool...`);
                        smtpPool = await loadActiveSmtpPool(smtpAccountIds, userId);
                        if (smtpPool.length === 0) {
                            aborted = true;
                            lastError = "All SMTP accounts remained invalid/resting after 1 hour sleep.";
                            break;
                        }
                    } else {
                        // Standard user crashed
                        aborted = true;
                        lastError = "Standard SMTP failed consecutively. Aborted.";
                        break;
                    }
                }

                const recipientId = uuidv4();
                db.prepare(`INSERT INTO recipients (id, campaignId, email, status) VALUES (?, ?, ?, 'pending')`)
                    .run(recipientId, campaignId, email);

                const trackedHtml = injectTrackingHtml(htmlContent, recipientId, hostUrl);

                // Select SMTP Round-Robin
                const activeSmtp = smtpPool[currentSmtpIndex % smtpPool.length];

                // Dispatch
                const result = await sendEmail(activeSmtp.transporter, { name: senderName, email: activeSmtp.user }, email, subject, trackedHtml);

                if (result.ok) {
                    db.prepare(`UPDATE recipients SET status = 'delivered', sentAt = CURRENT_TIMESTAMP WHERE id = ?`).run(recipientId);
                    db.prepare(`INSERT INTO event_logs (id, eventId, campaignId, recipientId, eventType, ipAddress, userAgent) VALUES (?, ?, ?, ?, 'DELIVERED', '127.0.0.1', 'Native SMTP Queue')`)
                        .run(uuidv4(), recipientId, campaignId, recipientId);

                    deliveredCount++;
                    activeSmtp.consecutiveFails = 0; // Reset streak on success
                    currentSmtpIndex++; // Move to next SMTP only on success, to balance load evenly
                } else {
                    const errorMsg = result.error || 'Unknown SMTP error';
                    db.prepare(`UPDATE recipients SET status = 'bounced', error = ?, sentAt = CURRENT_TIMESTAMP WHERE id = ?`)
                        .run(errorMsg, recipientId);
                    db.prepare(`INSERT INTO event_logs (id, eventId, campaignId, recipientId, eventType, ipAddress, userAgent) VALUES (?, ?, ?, ?, 'BOUNCED', '127.0.0.1', 'Native SMTP Queue')`)
                        .run(uuidv4(), recipientId, campaignId, recipientId);

                    bouncedCount++;
                    activeSmtp.consecutiveFails++;
                    lastError = errorMsg;

                    if (activeSmtp.consecutiveFails >= MAX_CONSECUTIVE_FAILURES) {
                        console.warn(`[Campaign ${campaignId}] SMTP ${activeSmtp.user} has 3 consecutive fails. Removing from pool.`);
                        if (activeSmtp.dbId !== 'adhoc') {
                            restSmtpAccount(activeSmtp.dbId);
                        }
                        // Remove from active memory pool
                        smtpPool = smtpPool.filter(s => s.dbId !== activeSmtp.dbId);
                    }
                }

                db.prepare(`UPDATE campaigns SET deliveredCount = ?, bouncedCount = ? WHERE id = ?`)
                    .run(deliveredCount, bouncedCount, campaignId);

                // ⏳ Ensure 3-second delay between every single dispatch
                await new Promise(r => setTimeout(r, 3000));
            }

            // 5. Finalize Campaign
            if (aborted) {
                const abortMsg = `Stopped due to hard SMTP exhaustion. Last error: ${lastError}`;
                db.prepare(`UPDATE campaigns SET status = 'aborted', abortReason = ?, deliveredCount = ?, bouncedCount = ? WHERE id = ?`)
                    .run(abortMsg, deliveredCount, bouncedCount, campaignId);
            } else {
                db.prepare(`UPDATE campaigns SET status = 'completed', deliveredCount = ?, bouncedCount = ? WHERE id = ?`)
                    .run(deliveredCount, bouncedCount, campaignId);
            }

            // Generate TXT Files
            generateReportFiles(campaignId, campaignName);
        });

    } catch (error) {
        console.error('[Campaign Error]', error);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message || 'Internal Server Error during campaign launch.' });
        }
    }
};

export {
    launchCampaign
};
