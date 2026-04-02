import db from '../models/db.js';

/**
 * High-performance analytics engine utilizing SQLite aggregates.
 * Designed to quickly calculate CTR, CTOR, Delivery Rates, etc. across potentially millions of rows.
 */
const getCampaignAnalytics = (req, res) => {
  const { campaignId } = req.params;

  try {
    const recipientStats = db.prepare(`
      SELECT 
        COUNT(id) as totalSent
      FROM recipients
      WHERE campaignId = ?
    `).get(campaignId);

    const lifecycleStats = db.prepare(`
      SELECT
        SUM(CASE WHEN eventType = 'DELIVERED' THEN 1 ELSE 0 END) as deliveredCount,
        SUM(CASE WHEN eventType = 'BOUNCED' THEN 1 ELSE 0 END) as bouncedCount
      FROM (
        SELECT eventType, recipientId
        FROM event_logs
        WHERE campaignId = ?
          AND eventType IN ('DELIVERED', 'BOUNCED')
        GROUP BY eventType, recipientId
      )
    `).get(campaignId);

    const eventStats = db.prepare(`
      SELECT 
        SUM(CASE WHEN eventType = 'OPEN' THEN 1 ELSE 0 END) as uniqueOpens,
        SUM(CASE WHEN eventType = 'CLICK' THEN 1 ELSE 0 END) as uniqueClicks,
        SUM(CASE WHEN eventType = 'WEBSITE_VISIT' THEN 1 ELSE 0 END) as uniqueVisits
      FROM (
        SELECT eventType, recipientId 
        FROM event_logs 
        WHERE campaignId = ?
        GROUP BY eventType, recipientId
      )
    `).get(campaignId);

    // 3. Fetch campaign status and abort reason
    const campaignMeta = db.prepare(`SELECT status, abortReason FROM campaigns WHERE id = ?`).get(campaignId);

    const sent = recipientStats.totalSent || 0;
    const delivered = lifecycleStats.deliveredCount || 0;
    const bounced = lifecycleStats.bouncedCount || 0;

    const opens = eventStats.uniqueOpens || 0;
    const clicks = eventStats.uniqueClicks || 0;
    const visits = eventStats.uniqueVisits || 0;

    // 4. Calculate Derived Ratios
    // Protect against division by zero
    const deliveryRate = sent > 0 ? (delivered / sent) * 100 : 0;
    const bounceRate = sent > 0 ? (bounced / sent) * 100 : 0;

    // Core Marketing Metrics
    const openRate = delivered > 0 ? (opens / delivered) * 100 : 0;
    const clickThroughRate = delivered > 0 ? (clicks / delivered) * 100 : 0; // CTR
    const clickToOpenRate = opens > 0 ? (clicks / opens) * 100 : 0; // CTOR
    const websiteVisitRate = clicks > 0 ? (visits / clicks) * 100 : 0;

    res.json({
      campaignId,
      status: campaignMeta?.status || 'unknown',
      abortReason: campaignMeta?.abortReason || null,
      rawCounts: {
        sent,
        delivered,
        bounced,
        uniqueOpens: opens,
        uniqueClicks: clicks,
        uniqueVisits: visits
      },
      metrics: {
        deliveryRate: deliveryRate.toFixed(2) + '%',
        bounceRate: bounceRate.toFixed(2) + '%',
        openRate: openRate.toFixed(2) + '%',
        clickThroughRate: clickThroughRate.toFixed(2) + '%',
        clickToOpenRate: clickToOpenRate.toFixed(2) + '%',
        websiteVisitRate: websiteVisitRate.toFixed(2) + '%'
      }
    });

  } catch (error) {
    console.error(`[Analytics Controller] Error calculating metrics for campaign ${campaignId}: ${error.message}`);
    res.status(500).json({ error: 'Failed to calculate analytics.' });
  }
};

const getAccountAnalytics = (req, res) => {
  const userId = req.session?.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const recipientStats = db.prepare(`
      SELECT 
        COUNT(r.id) as totalSent
      FROM recipients r
      JOIN campaigns c ON r.campaignId = c.id
      WHERE c.userId = ?
    `).get(userId);

    const lifecycleStats = db.prepare(`
      SELECT
        SUM(CASE WHEN eventType = 'DELIVERED' THEN 1 ELSE 0 END) as deliveredCount,
        SUM(CASE WHEN eventType = 'BOUNCED' THEN 1 ELSE 0 END) as bouncedCount
      FROM (
        SELECT e.eventType, e.recipientId
        FROM event_logs e
        JOIN campaigns c ON e.campaignId = c.id
        WHERE c.userId = ?
          AND e.eventType IN ('DELIVERED', 'BOUNCED')
        GROUP BY e.eventType, e.recipientId
      )
    `).get(userId);

    const eventStats = db.prepare(`
      SELECT 
        SUM(CASE WHEN eventType = 'OPEN' THEN 1 ELSE 0 END) as uniqueOpens,
        SUM(CASE WHEN eventType = 'CLICK' THEN 1 ELSE 0 END) as uniqueClicks,
        SUM(CASE WHEN eventType = 'WEBSITE_VISIT' THEN 1 ELSE 0 END) as uniqueVisits
      FROM (
        SELECT e.eventType, e.recipientId 
        FROM event_logs e
        JOIN campaigns c ON e.campaignId = c.id
        WHERE c.userId = ?
        GROUP BY e.eventType, e.recipientId
      )
    `).get(userId);

    const sent = recipientStats?.totalSent || 0;
    const delivered = lifecycleStats?.deliveredCount || 0;
    const bounced = lifecycleStats?.bouncedCount || 0;

    const opens = eventStats?.uniqueOpens || 0;
    const clicks = eventStats?.uniqueClicks || 0;
    const visits = eventStats?.uniqueVisits || 0;

    const deliveryRate = sent > 0 ? (delivered / sent) * 100 : 0;
    const bounceRate = sent > 0 ? (bounced / sent) * 100 : 0;
    const openRate = delivered > 0 ? (opens / delivered) * 100 : 0;
    const clickThroughRate = delivered > 0 ? (clicks / delivered) * 100 : 0; // CTR
    const clickToOpenRate = opens > 0 ? (clicks / opens) * 100 : 0; // CTOR
    const websiteVisitRate = clicks > 0 ? (visits / clicks) * 100 : 0;

    res.json({
      rawCounts: { sent, delivered, bounced, uniqueOpens: opens, uniqueClicks: clicks, uniqueVisits: visits },
      metrics: {
        deliveryRate: deliveryRate.toFixed(1) + '%',
        bounceRate: bounceRate.toFixed(1) + '%',
        openRate: openRate.toFixed(1) + '%',
        clickThroughRate: clickThroughRate.toFixed(1) + '%',
        clickToOpenRate: clickToOpenRate.toFixed(1) + '%',
        websiteVisitRate: websiteVisitRate.toFixed(1) + '%'
      }
    });

  } catch (error) {
    console.error(`[Analytics Controller] Error calculating account metrics: ${error.message}`);
    res.status(500).json({ error: 'Failed to calculate account analytics.' });
  }
};

const getCampaignHistory = (req, res) => {
  const userId = req.session?.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const history = db.prepare(`
      SELECT 
        c.id, 
        c.name, 
        c.status, 
        c.abortReason, 
        COALESCE(recipient_totals.totalSent, 0) as totalSent,
        COALESCE(lifecycle_totals.deliveredCount, 0) as deliveredCount, 
        COALESCE(lifecycle_totals.bouncedCount, 0) as bouncedCount, 
        COALESCE(event_totals.uniqueOpens, 0) as uniqueOpens,
        COALESCE(event_totals.uniqueClicks, 0) as uniqueClicks,
        c.createdAt,
        c.sentReportFile,
        c.failedReportFile
      FROM campaigns c
      LEFT JOIN (
        SELECT campaignId, COUNT(*) as totalSent
        FROM recipients
        GROUP BY campaignId
      ) recipient_totals ON recipient_totals.campaignId = c.id
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
      ) lifecycle_totals ON lifecycle_totals.campaignId = c.id
      LEFT JOIN (
        SELECT campaignId,
               SUM(CASE WHEN eventType = 'OPEN' THEN 1 ELSE 0 END) as uniqueOpens,
               SUM(CASE WHEN eventType = 'CLICK' THEN 1 ELSE 0 END) as uniqueClicks
        FROM (
          SELECT campaignId, eventType, recipientId
          FROM event_logs
          WHERE eventType IN ('OPEN', 'CLICK')
          GROUP BY campaignId, eventType, recipientId
        )
        GROUP BY campaignId
      ) event_totals ON event_totals.campaignId = c.id
      WHERE c.userId = ?
      ORDER BY createdAt DESC
    `).all(userId);

    res.json({ history });
  } catch (error) {
    console.error(`[Analytics Controller] Error fetching campaign history: ${error.message}`);
    res.status(500).json({ error: 'Failed to fetch campaign history.' });
  }
};

export {
  getCampaignAnalytics,
  getAccountAnalytics,
  getCampaignHistory
};
