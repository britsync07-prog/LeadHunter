import db from '../models/db.js';
import { v4 as uuidv4 } from 'uuid';

export const getTemplates = (req, res) => {
    if (!req.session.user || !req.session.user.isAdmin) {
        return res.status(403).json({ error: "Admin access required." });
    }
    const userId = req.session.user.id;
    try {
        const templates = db.prepare(`SELECT * FROM auto_mail_templates WHERE userId = ? ORDER BY createdAt DESC`).all(userId);
        res.json({ templates: templates.map(t => ({ ...t, smtpAccountIds: JSON.parse(t.smtpAccountIds || '[]') })) });
    } catch (error) {
        console.error('[AutoMail Controller] Error fetching templates:', error);
        res.status(500).json({ error: 'Failed to fetch templates.' });
    }
};

export const saveTemplate = (req, res) => {
    if (!req.session.user || !req.session.user.isAdmin) {
        return res.status(403).json({ error: "Admin access required." });
    }
    const { id, name, senderName, subject, htmlContent, smtpAccountIds } = req.body;
    const userId = req.session.user.id;

    if (!name || !senderName || !subject || !htmlContent) {
        return res.status(400).json({ error: 'Missing required template fields.' });
    }

    try {
        if (id) {
            // Update
            db.prepare(`UPDATE auto_mail_templates SET name=?, senderName=?, subject=?, htmlContent=?, smtpAccountIds=? WHERE id=? AND userId=?`)
              .run(name, senderName, subject, htmlContent, JSON.stringify(smtpAccountIds || []), id, userId);
            res.json({ success: true, id });
        } else {
            // Create
            const newId = uuidv4();
            db.prepare(`INSERT INTO auto_mail_templates (id, userId, name, senderName, subject, htmlContent, smtpAccountIds) VALUES (?, ?, ?, ?, ?, ?, ?)`)
              .run(newId, userId, name, senderName, subject, htmlContent, JSON.stringify(smtpAccountIds || []));
            res.status(201).json({ success: true, id: newId });
        }
    } catch (error) {
        console.error('[AutoMail Controller] Error saving template:', error);
        res.status(500).json({ error: 'Failed to save template.' });
    }
};

export const deleteTemplate = (req, res) => {
    if (!req.session.user || !req.session.user.isAdmin) {
        return res.status(403).json({ error: "Admin access required." });
    }
    const { id } = req.params;
    const userId = req.session.user.id;
    try {
        db.prepare(`DELETE FROM auto_mail_templates WHERE id = ? AND userId = ?`).run(id, userId);
        res.json({ success: true });
    } catch (error) {
        console.error('[AutoMail Controller] Error deleting template:', error);
        res.status(500).json({ error: 'Failed to delete template.' });
    }
};
