import db from '../models/db.js';
import { v4 as uuidv4 } from 'uuid';

export const getTemplates = (req, res) => {
    // Authorization is handled globally by requirePremiumOrAdmin middleware in server.js
    const userId = req.session.user.id;
    try {
        const templates = db.prepare(`SELECT * FROM auto_mail_templates WHERE userId = ? ORDER BY createdAt DESC`).all(userId);
        res.json({ templates: templates.map(t => ({ ...t, smtpAccountIds: JSON.parse(t.smtpAccountIds || '[]') })) });
    } catch (error) {
        console.error('[AutoMail Controller] Error fetching templates:', error);
        res.status(500).json({ error: 'Failed to fetch templates.' });
    }
};

export const getTemplate = (req, res) => {
    const { id } = req.params;
    const userId = req.session.user.id;
    try {
        const template = db.prepare(`SELECT * FROM auto_mail_templates WHERE id = ? AND userId = ?`).get(id, userId);
        if (!template) return res.status(404).json({ error: 'Template not found.' });
        res.json({ ...template, smtpAccountIds: JSON.parse(template.smtpAccountIds || '[]') });
    } catch (error) {
        console.error('[AutoMail Controller] Error fetching template:', error);
        res.status(500).json({ error: 'Failed to fetch template.' });
    }
};

export const saveTemplate = (req, res) => {
    // Authorization is handled globally by requirePremiumOrAdmin middleware in server.js
    const { id, name, senderName, subject, htmlContent, smtpAccountIds } = req.body;
    const userId = req.session.user.id;

    if (!name || !senderName || !subject || !htmlContent) {
        return res.status(400).json({ error: 'Missing required template fields.' });
    }

    try {
        // Check if we are updating (id present and not 'new')
        if (id && id !== 'new') {
            const result = db.prepare(`UPDATE auto_mail_templates SET name = ?, senderName = ?, subject = ?, htmlContent = ?, smtpAccountIds = ? WHERE id = ? AND userId = ?`)
              .run(name, senderName, subject, htmlContent, JSON.stringify(smtpAccountIds || []), id, userId);

            if (result.changes === 0) {
                // If ID was provided but no row updated, it might be a new template with a specific ID or unauthorized
                const newId = id;
                db.prepare(`INSERT INTO auto_mail_templates (id, userId, name, senderName, subject, htmlContent, smtpAccountIds) VALUES (?, ?, ?, ?, ?, ?, ?)`)
                  .run(newId, userId, name, senderName, subject, htmlContent, JSON.stringify(smtpAccountIds || []));
                return res.status(201).json({ success: true, id: newId });
            }
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
    // Authorization is handled globally by requirePremiumOrAdmin middleware in server.js
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

export const getSavedSequences = (req, res) => {
    const userId = req.session.user.id;
    try {
        const sequences = db.prepare(`SELECT * FROM saved_sequences WHERE userId = ? ORDER BY createdAt DESC`).all(userId);
        res.json({ sequences: sequences.map(s => ({ ...s, config: JSON.parse(s.config) })) });
    } catch (error) {
        console.error('[AutoMail] Error fetching saved sequences:', error);
        res.status(500).json({ error: 'Failed to fetch saved sequences.' });
    }
};

export const saveSequence = (req, res) => {
    const { id, name, config } = req.body;
    const userId = req.session.user.id;
    if (!name || !config) return res.status(400).json({ error: 'Missing required sequence fields.' });

    try {
        if (id && id !== 'new') {
            db.prepare(`UPDATE saved_sequences SET name=?, config=? WHERE id=? AND userId=?`).run(name, JSON.stringify(config), id, userId);
            res.json({ success: true, id });
        } else {
            const newId = uuidv4();
            db.prepare(`INSERT INTO saved_sequences (id, userId, name, config) VALUES (?, ?, ?, ?)`).run(newId, userId, name, JSON.stringify(config));
            res.status(201).json({ success: true, id: newId });
        }
    } catch (error) {
        console.error('[AutoMail] Error saving sequence:', error);
        res.status(500).json({ error: 'Failed to save sequence.' });
    }
};

export const deleteSequence = (req, res) => {
    const { id } = req.params;
    const userId = req.session.user.id;
    try {
        db.prepare(`DELETE FROM saved_sequences WHERE id = ? AND userId = ?`).run(id, userId);
        res.json({ success: true });
    } catch (error) {
        console.error('[AutoMail] Error deleting sequence:', error);
        res.status(500).json({ error: 'Failed to delete sequence.' });
    }
};
