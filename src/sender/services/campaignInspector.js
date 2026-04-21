import db from '../models/db.js';
import { normalizeRecipientEmail } from './emailSanitizer.js';

const coerceString = (value, fallback = '') => {
  if (typeof value !== 'string') return fallback;
  return value.trim();
};

const normalizeStringArray = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => coerceString(item))
    .filter(Boolean);
};

const normalizeSequences = (sequences, fallback = []) => {
  const source = Array.isArray(sequences) ? sequences : fallback;
  const normalized = source.map((step, index) => {
    const delayDays = Number(step?.delayDays ?? 0);
    return {
      delayDays: Number.isFinite(delayDays) && delayDays >= 0 ? delayDays : 0,
      senderName: coerceString(step?.senderName),
      subject: coerceString(step?.subject),
      htmlContent: typeof step?.htmlContent === 'string' ? step.htmlContent.trim() : '',
      templateId: coerceString(step?.templateId)
    };
  });

  if (normalized.length === 0) {
    throw new Error('At least one follow-up step is required.');
  }

  normalized.forEach((step, index) => {
    if (!step.senderName || !step.subject || !step.htmlContent) {
      throw new Error(`Sequence step ${index + 1} is incomplete.`);
    }
  });

  return normalized;
};

const normalizeCampaignConfigInput = (payload, existingConfig = {}) => {
  const nextConfig = {
    ...existingConfig
  };

  if (Object.prototype.hasOwnProperty.call(payload, 'sequences')) {
    nextConfig.sequences = normalizeSequences(payload.sequences, existingConfig.sequences);
  } else if (!Array.isArray(nextConfig.sequences) || nextConfig.sequences.length === 0) {
    nextConfig.sequences = normalizeSequences(existingConfig.sequences, []);
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'smtpAccountIds')) {
    nextConfig.smtpAccountIds = normalizeStringArray(payload.smtpAccountIds);
  } else if (!Array.isArray(nextConfig.smtpAccountIds)) {
    nextConfig.smtpAccountIds = normalizeStringArray(existingConfig.smtpAccountIds);
  }

  const stringFields = ['smtpHost', 'smtpUser', 'smtpPass', 'timezone', 'startTime', 'endTime', 'publicBaseUrl'];
  for (const field of stringFields) {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      nextConfig[field] = coerceString(payload[field]);
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'smtpPort')) {
    const port = Number(payload.smtpPort);
    nextConfig.smtpPort = Number.isFinite(port) && port > 0 ? port : null;
  } else if (nextConfig.smtpPort != null) {
    const port = Number(nextConfig.smtpPort);
    nextConfig.smtpPort = Number.isFinite(port) && port > 0 ? port : null;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'normalizedRecipients')) {
    nextConfig.normalizedRecipients = normalizeStringArray(payload.normalizedRecipients).map((email) => email.toLowerCase());
  } else if (!Array.isArray(nextConfig.normalizedRecipients)) {
    nextConfig.normalizedRecipients = normalizeStringArray(existingConfig.normalizedRecipients).map((email) => email.toLowerCase());
  }

  return nextConfig;
};

const getCampaignAggregateStats = (campaignId) => {
  const counts = db.prepare(`
    SELECT
      COALESCE(recipient_totals.totalSent, 0) as sent,
      COALESCE(lifecycle_totals.deliveredCount, 0) as delivered,
      COALESCE(lifecycle_totals.bouncedCount, 0) as bounced,
      COALESCE(event_totals.uniqueOpens, 0) as uniqueOpens,
      COALESCE(event_totals.uniqueClicks, 0) as uniqueClicks,
      COALESCE(event_totals.uniqueVisits, 0) as uniqueVisits
    FROM (SELECT ? as campaignId) as base
    LEFT JOIN (
      SELECT campaignId, COUNT(*) as totalSent
      FROM recipients
      WHERE status != 'pending'
      GROUP BY campaignId
    ) recipient_totals ON recipient_totals.campaignId = base.campaignId
    LEFT JOIN (
      SELECT campaignId,
             SUM(CASE WHEN eventType = 'DELIVERED' THEN 1 ELSE 0 END) as deliveredCount,
             SUM(CASE WHEN eventType = 'BOUNCED' THEN 1 ELSE 0 END) as bouncedCount
      FROM (
        SELECT campaignId, eventType, recipientId
        FROM event_logs
        WHERE eventType IN ('DELIVERED', 'BOUNCED')
        GROUP BY campaignId, eventType, recipientId
      )
      GROUP BY campaignId
    ) lifecycle_totals ON lifecycle_totals.campaignId = base.campaignId
    LEFT JOIN (
      SELECT campaignId,
             SUM(CASE WHEN eventType = 'OPEN' THEN 1 ELSE 0 END) as uniqueOpens,
             SUM(CASE WHEN eventType = 'CLICK' THEN 1 ELSE 0 END) as uniqueClicks,
             SUM(CASE WHEN eventType = 'WEBSITE_VISIT' THEN 1 ELSE 0 END) as uniqueVisits
      FROM (
        SELECT campaignId, eventType, recipientId
        FROM event_logs
        WHERE eventType IN ('OPEN', 'CLICK', 'WEBSITE_VISIT')
        GROUP BY campaignId, eventType, recipientId
      )
      GROUP BY campaignId
    ) event_totals ON event_totals.campaignId = base.campaignId
  `).get(campaignId) || {};

  const sent = counts.sent || 0;
  const delivered = counts.delivered || 0;
  const bounced = counts.bounced || 0;
  const opens = counts.uniqueOpens || 0;
  const clicks = counts.uniqueClicks || 0;
  const visits = counts.uniqueVisits || 0;

  const metrics = {
    deliveryRate: sent > 0 ? Number(((delivered / sent) * 100).toFixed(2)) : 0,
    bounceRate: sent > 0 ? Number(((bounced / sent) * 100).toFixed(2)) : 0,
    openRate: delivered > 0 ? Number(((opens / delivered) * 100).toFixed(2)) : 0,
    clickThroughRate: delivered > 0 ? Number(((clicks / delivered) * 100).toFixed(2)) : 0,
    clickToOpenRate: opens > 0 ? Number(((clicks / opens) * 100).toFixed(2)) : 0,
    websiteVisitRate: clicks > 0 ? Number(((visits / clicks) * 100).toFixed(2)) : 0
  };

  return {
    rawCounts: {
      sent,
      delivered,
      bounced,
      uniqueOpens: opens,
      uniqueClicks: clicks,
      uniqueVisits: visits
    },
    metrics
  };
};

const getCampaignRecipients = (campaignId, limit = 50) => db.prepare(`
  SELECT id, email, status, error, sentAt, currentStep, nextSendAt
  FROM recipients
  WHERE campaignId = ?
  ORDER BY sentAt DESC, email ASC
  LIMIT ?
`).all(campaignId, limit).map((recipient) => ({
  ...recipient,
  email: normalizeRecipientEmail(recipient.email) || recipient.email
}));

const getCampaignEvents = (campaignId, limit = 30) => db.prepare(`
  SELECT e.eventType, e.url, e.timestamp, e.ipAddress, r.email
  FROM event_logs e
  LEFT JOIN recipients r ON r.id = e.recipientId
  WHERE e.campaignId = ?
  ORDER BY e.timestamp DESC
  LIMIT ?
`).all(campaignId, limit);

const getCampaignDetail = (campaignId) => {
  const campaign = db.prepare(`
    SELECT id, userId, name, status, abortReason, createdAt, sentReportFile, failedReportFile, config
    FROM campaigns
    WHERE id = ?
  `).get(campaignId);

  if (!campaign) return null;

  let config = {};
  try {
    config = JSON.parse(campaign.config || '{}');
  } catch {
    config = {};
  }

  return {
    ...campaign,
    config,
    ...getCampaignAggregateStats(campaignId),
    recipients: getCampaignRecipients(campaignId),
    recentEvents: getCampaignEvents(campaignId)
  };
};

export {
  getCampaignAggregateStats,
  getCampaignDetail,
  normalizeCampaignConfigInput,
  normalizeSequences,
  normalizeStringArray
};
