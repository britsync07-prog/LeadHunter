import db from '../models/db.js';
import { v4 as uuidv4 } from 'uuid';
import { createTransporter } from '../services/mailer.js';

/**
 * Validates the SMTP credentials by attempting a connection before saving.
 */
const verifySmtpConnection = async (smtpConfig) => {
    const transporter = createTransporter(smtpConfig);
    try {
        await transporter.verify();
        return true;
    } catch (error) {
        throw new Error(`SMTP Connection Failed: ${error.message}`);
    }
};

export const getSmtpAccounts = (req, res) => {
    const sessionUser = req.session?.user;
    const isPremiumOrAdvance = sessionUser && (sessionUser.subscriptionPlan === 'premium' || sessionUser.subscriptionPlan === 'advance' || sessionUser.isAdmin);

    if (!isPremiumOrAdvance) {
        return res.status(403).json({ error: "Only Premium and Advance users can use Multiple SMTP Load Balancing." });
    }

    const userId = req.session.user.id;
    try {
        const accounts = db.prepare(`SELECT id, host, port, user, consecutiveFails, restingUntil, createdAt FROM smtp_accounts WHERE userId = ? ORDER BY createdAt DESC`).all(userId);
        res.json({ accounts });
    } catch (error) {
        console.error('[SMTP Controller] Error fetching accounts:', error);
        res.status(500).json({ error: 'Failed to fetch SMTP accounts.' });
    }
};

export const addSmtpAccount = async (req, res) => {
    const sessionUser = req.session?.user;
    const isPremiumOrAdvance = sessionUser && (sessionUser.subscriptionPlan === 'premium' || sessionUser.subscriptionPlan === 'advance' || sessionUser.isAdmin);

    if (!isPremiumOrAdvance) {
        return res.status(403).json({ error: "Only Premium and Advance users can save Multiple SMTP credentials." });
    }

    const { host, port, user, pass } = req.body;
    if (!host || !port || !user || !pass) {
        return res.status(400).json({ error: "Missing required SMTP credentials." });
    }

    const userId = req.session.user.id;

    try {
        // Verify credentials before saving
        await verifySmtpConnection({ host, port: parseInt(port, 10), user, pass });

        const id = uuidv4();
        db.prepare(
            `INSERT INTO smtp_accounts (id, userId, host, port, user, pass) VALUES (?, ?, ?, ?, ?, ?)`
        ).run(id, userId, host, parseInt(port, 10), user, pass);

        res.status(201).json({ success: true, account: { id, host, port, user, consecutiveFails: 0, restingUntil: null } });
    } catch (error) {
        console.error('[SMTP Controller] Error adding account:', error);
        res.status(400).json({ error: error.message || 'Failed to add SMTP account.' });
    }
};

export const deleteSmtpAccount = (req, res) => {
    const sessionUser = req.session?.user;
    const isPremiumOrAdvance = sessionUser && (sessionUser.subscriptionPlan === 'premium' || sessionUser.subscriptionPlan === 'advance' || sessionUser.isAdmin);

    if (!isPremiumOrAdvance) {
        return res.status(403).json({ error: "Only Premium and Advance users can delete Multiple SMTP credentials." });
    }

    const { id } = req.params;
    const userId = req.session.user.id;

    try {
        db.prepare(`DELETE FROM smtp_accounts WHERE id = ? AND userId = ?`).run(id, userId);
        res.json({ success: true });
    } catch (error) {
        console.error('[SMTP Controller] Error deleting account:', error);
        res.status(500).json({ error: 'Failed to delete SMTP account.' });
    }
};
