import { LeadScraper } from "./scraper.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import db from "./sender/models/db.js";
import { resumeCampaign } from "./sender/controllers/campaignController.js";
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class JobQueue extends EventEmitter {
  constructor() {
    super();
    this.jobs = new Map(); // All jobs session
    this.activeJobs = new Map(); // Map<jobId, { job, scraper, listeners, smtpPool, currentSmtpIndex }>
    this.userActiveJobCounts = new Map(); // Map<userId, count>
  }

  getPlanLimits(plan) {
    const p = (plan || 'free').toLowerCase().trim();
    if (p === 'admin') return { concurrentJobs: Infinity }; // Unlimited
    if (p === 'premium') return { concurrentJobs: 1 };
    if (p === 'advance') return { concurrentJobs: 1 };
    if (p === 'basic') return { concurrentJobs: 1 };
    return { concurrentJobs: 1 }; // free / unknown — 1 job, instant reject if exceeded
  }

  async cleanupStaleJobs() {
    console.log("[System] Cleaning up stale jobs and campaigns from previous session...");

    // 1. Resume Stale Scraper Jobs
    try {
      const staleJobs = db.prepare("SELECT * FROM jobs WHERE status IN ('running', 'queued')").all();
      if (staleJobs.length > 0) {
        console.log(`[System] Found ${staleJobs.length} interrupted scraper jobs. Resuming them...`);
        for (const row of staleJobs) {
          try {
            const job = {
              id: row.id,
              userId: row.userId,
              status: row.status,
              params: JSON.parse(row.params || '{}'),
              events: JSON.parse(row.events || '[]'),
              files: JSON.parse(row.files || '[]'),
              leadsFound: row.leadsFound || 0,
              createdAt: row.createdAt,
              listeners: new Set()
            };
            
            this.jobs.set(job.id, job);
            this.pushEvent(job, { type: "info", message: "Server restarted. Auto-resuming job..." });
            this.runScraper(job);
          } catch (err) {
            console.error(`[System] Failed to resume job ${row.id}:`, err);
            db.prepare("UPDATE jobs SET status = 'failed', error = 'Failed to resume' WHERE id = ?").run(row.id);
          }
        }
      }
    } catch (e) {
      console.error("[System] Error resuming jobs:", e);
    }

    // 2. Resume Sender Campaigns
    try {
      const staleCampaigns = db.prepare("SELECT id FROM campaigns WHERE status = 'sending'").all();
      if (staleCampaigns.length > 0) {
        console.log(`[System] Found ${staleCampaigns.length} interrupted campaigns. Resuming...`);
        for (const camp of staleCampaigns) {
          // Use a default hostUrl or wait for first request? 
          // Better to just resume with a placeholder if needed, or assume localhost/3000
          resumeCampaign(camp.id, `http://localhost:3000`); 
        }
      }
    } catch (e) {
      console.error("[System] Error resuming campaigns:", e);
    }
  }

  restartJob(jobId) {
    const job = this.getJob(jobId);
    if (!job) throw new Error("Job not found");
    if (this.activeJobs.has(jobId)) throw new Error("Job is already running");

    job.status = "queued";
    job.error = null;
    this.pushEvent(job, { type: "info", message: "Manually restarting job..." });
    db.prepare("UPDATE jobs SET status = 'queued', error = NULL WHERE id = ?").run(jobId);
    
    this.runScraper(job);
    return true;
  }

  async loadHistory() {
    // Migration: If history.json exists, we could migrate it, but for a "fast" fix
    // we just ensure the DB is ready. The constructor already imports db.
    // We'll keep this method for compatibility with server.js call.
    return Promise.resolve();
  }

  async saveHistory() {
    // No longer needed as we save to DB per event/status change
    return Promise.resolve();
  }

  addJob(jobData, userId) {
    const job = {
      ...jobData,
      userId,
      status: "pending",
      events: [],
      listeners: new Set(),
      files: [],
      leadsFound: 0,
      createdAt: new Date().toISOString()
    };

    // Check concurrent job limit — instant reject, no queuing
    const limits = this.getPlanLimits(job.params.userPlan);
    const activeUserJobs = this.userActiveJobCounts.get(userId) || 0;

    if (activeUserJobs >= limits.concurrentJobs) {
      // Persist the rejected job so history shows it
      job.status = 'failed';
      const limitLabel = limits.concurrentJobs === Infinity ? 'unlimited' : limits.concurrentJobs;
      job.error = `Concurrent job limit of ${limitLabel} reached for your plan. Please wait for your running jobs to finish.`;
      db.prepare(`
        INSERT INTO jobs (id, userId, status, params, events, files, leadsFound, createdAt, error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        job.id, job.userId, job.status,
        JSON.stringify(job.params), JSON.stringify(job.events),
        JSON.stringify(job.files), job.leadsFound, job.createdAt, job.error
      );
      this.jobs.set(job.id, job);
      return job; // Return rejected job — caller sees status = 'failed'
    }

    if (job.params.autoMailConfig && !job.campaignId) {
      job.campaignId = "auto_" + job.id;
      try {
        const actualDbUserId = job.params.dbUserId || job.userId;
        db.prepare(`
          INSERT INTO campaigns (id, userId, name, status, config) 
          VALUES (?, ?, ?, 'sending', ?)
        `).run(job.campaignId, actualDbUserId, `Scraper Auto-Mail: ${Array.isArray(job.params.niches) ? job.params.niches.join(', ') : 'Jobs'}`, JSON.stringify(job.params.autoMailConfig));
      } catch (e) {
        console.error("Failed to insert auto mail campaign", e);
      }
    }

    // Persist to DB with pending status
    db.prepare(`
      INSERT INTO jobs (id, userId, status, params, events, files, leadsFound, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      job.id, job.userId, job.status,
      JSON.stringify(job.params), JSON.stringify(job.events),
      JSON.stringify(job.files), job.leadsFound, job.createdAt
    );

    this.jobs.set(job.id, job);
    this.runScraper(job); // Start immediately — no queue
    return job;
  }

  // Called after a job finishes — no queue to drain, kept for extensibility
  processQueue() { }

  async runScraper(job) {
    // This method is called when a job is confirmed to run (either instantly or from queue)
    const scraper = new LeadScraper({
      outputRoot: path.join(__dirname, "..", "output"),
      onProgress: (event) => {
        if (event.fileName && !job.files.includes(event.fileName)) {
          job.files.push(event.fileName);
        }
        this.pushEvent(job, event);
      }
    });

    this.activeJobs.set(job.id, { job, scraper, smtpPool: [], currentSmtpIndex: 0 });
    const activeCount = (this.userActiveJobCounts.get(job.userId) || 0) + 1;
    this.userActiveJobCounts.set(job.userId, activeCount);

    job.status = "running";
    db.prepare("UPDATE jobs SET status = ? WHERE id = ?").run(job.status, job.id);
    this.pushEvent(job, { type: "info", message: "Job started" });

    try {
      const result = await scraper.run({
        jobId: job.id,
        country: job.params.country,
        cities: job.params.cities,
        states: job.params.states,
        niches: job.params.niches,
        includeGoogleMaps: job.params.includeGoogleMaps !== false,
        includeSocial: job.params.includeSocial === true,
        scrapeMode: job.params.scrapeMode || 'emails',
        sites: job.params.sites,
        userPlan: job.params.userPlan
      });

      if (job.status !== "stopped") {
        job.status = "completed";
        job.files = Array.from(new Set([...(job.files || []), ...(result.files || [])]));
        this.pushEvent(job, { type: "job-completed", files: job.files });
      }
    } catch (error) {
      if (job.status !== "stopped") {
        job.status = "failed";
        job.error = error.message;
        this.pushEvent(job, { type: "job-failed", message: error.message });
      }
    } finally {
      // Decrement user's active job count
      const finalCount = (this.userActiveJobCounts.get(job.userId) || 1) - 1;
      this.userActiveJobCounts.set(job.userId, finalCount);

      this.activeJobs.delete(job.id);

      db.prepare(`
        UPDATE jobs SET status = ?, files = ?, leadsFound = ?, phonesFound = ?, error = ?, events = ?
        WHERE id = ?
      `).run(
        job.status,
        JSON.stringify(job.files),
        job.leadsFound || 0,
        job.phonesFound || 0,
        job.error || null,
        JSON.stringify(job.events),
        job.id
      );

      // Attempt to start the next queued job
      this.processQueue();
    }
  }


  stopJob(jobId) {
    if (this.activeJobs.has(jobId)) {
      const { job, scraper } = this.activeJobs.get(jobId);
      job.status = "stopped";
      scraper.stop();
      this.pushEvent(job, { type: "job-stopped", message: "Job stopped by user" });
      db.prepare("UPDATE jobs SET status = ?, events = ? WHERE id = ?").run(job.status, JSON.stringify(job.events), job.id);
      return true;
    }
    return false;
  }

  pushEvent(job, event) {
    const payload = { ...event, time: new Date().toISOString() };
    job.events.push(payload);

    // Keep memory usage isolated (bound to max 1000 recent events)
    if (job.events.length > 1000) {
      job.events = job.events.slice(job.events.length - 1000);
    }

    if (payload.type === 'lead-saved' || payload.type === 'phone-saved' || payload.type === 'csv-saved' || payload.type === 'business-processed') {
      if (payload.type === 'lead-saved' && payload.email) {
        job.leadsFound = (job.leadsFound || 0) + 1;

        // Trigger Auto-Mail if enabled
        if (job.params.autoMailConfig && job.campaignId) {
           try {
             const recId = crypto.randomUUID();
             db.prepare(`UPDATE campaigns SET status='sending' WHERE id = ?`).run(job.campaignId);
             db.prepare(`INSERT OR IGNORE INTO recipients (id, campaignId, email, status, currentStep, nextSendAt) VALUES (?, ?, ?, 'pending', 0, CURRENT_TIMESTAMP)`).run(recId, job.campaignId, payload.email);
             console.log(`[Auto-Mail] Queued instant email for: ${payload.email}`);
             this.emit('auto-mail-queued'); 
             this.pushEvent(job, { type: "info", message: `Auto-Mail sequence queued for ${payload.email}` });
           } catch(err) {
             this.pushEvent(job, { type: "info", message: `Failed to queue Auto-Mail for ${payload.email}: ${err.message}` });
           }
        }
      }
      if (payload.type === 'phone-saved' && payload.phone) {
        job.phonesFound = (job.phonesFound || 0) + 1;
      }

      // --- PER-JOB LIMIT ENFORCEMENT ---
      if (job.params?.maxLeads && job.leadsFound >= job.params.maxLeads) {
        const active = this.activeJobs.get(job.id);
        if (active && active.scraper && !active.scraper.isStopped) {
          active.scraper.stop();
          const limitMsg = { type: "info", message: `Per-job limit of ${job.params.maxLeads} leads reached. Stopping and saving files...`, time: new Date().toISOString() };
          job.events.push(limitMsg);
          for (const res of job.listeners) {
            this.safeWrite(job, res, limitMsg);
          }
        }
      }

      const usage = this.getUserUsage(job.userId);
      const plan = job.params.userPlan || 'basic';
      const isAdmin = job.params.isAdmin || false;

      let dailyLimit = 100;
      let monthlyLimit = 3000;

      if (plan === 'premium' || isAdmin) {
        dailyLimit = Infinity;
        monthlyLimit = Infinity;
      } else if (plan === 'advance') {
        dailyLimit = 1000;
        monthlyLimit = 30000;
      } else if (plan === 'basic') {
        dailyLimit = 300;
        monthlyLimit = 9000;
      } else {
        dailyLimit = 100;
        monthlyLimit = 3000;
      }

      const usagePayload = {
        type: 'usage-update',
        usage: usage,
        plan: plan,
        isAdmin: isAdmin,
        dailyLimit: (isAdmin || plan === 'premium') ? 'Unlimited' : dailyLimit,
        monthlyLimit: (isAdmin || plan === 'premium') ? 'Unlimited' : monthlyLimit,
        time: new Date().toISOString()
      };

      for (const res of job.listeners) {
        this.safeWrite(job, res, usagePayload);
      }

      if (!isAdmin && (usage.dailyCount >= dailyLimit || usage.monthlyCount >= monthlyLimit)) {
        const active = this.activeJobs.get(job.id);
        if (active && active.scraper && !active.scraper.isStopped) {
          active.scraper.stop();
          const infoPayload = { type: "info", message: `Plan limit reached. Stopping.`, time: new Date().toISOString() };
          for (const res of job.listeners) {
            this.safeWrite(job, res, infoPayload);
          }
        }
      }
    }

    // Update job files in memory
    if (payload.fileName && !job.files.includes(payload.fileName)) job.files.push(payload.fileName);
    if (payload.emailFileName && !job.files.includes(payload.emailFileName)) job.files.push(payload.emailFileName);
    if (payload.allEmailsFileName && !job.files.includes(payload.allEmailsFileName)) job.files.push(payload.allEmailsFileName);
    if (payload.phoneFileName && !job.files.includes(payload.phoneFileName)) job.files.push(payload.phoneFileName);
    if (payload.allPhonesFileName && !job.files.includes(payload.allPhonesFileName)) job.files.push(payload.allPhonesFileName);

    for (const res of job.listeners) {
      this.safeWrite(job, res, payload);
    }

    // Asynchronously update events in DB for large jobs (optional: debounce this for ultra-high speed)
    // For now, we update it in processQueue finally, but let's do a partial update for "Live" persistence
    if (job.events.length % 10 === 0) {
      db.prepare("UPDATE jobs SET events = ?, files = ?, leadsFound = ? WHERE id = ?")
        .run(JSON.stringify(job.events), JSON.stringify(job.files), job.leadsFound, job.id);
    }
  }

  /**
   * Safely write an SSE event to a response stream.
   * Silently drops dead connections (EPIPE) instead of crashing the server.
   */
  safeWrite(job, res, payload) {
    try {
      if (res.writableEnded || res.destroyed) {
        job.listeners.delete(res);
        return;
      }
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
      if (res.flush) res.flush();
    } catch (err) {
      // Client closed connection — remove silently
      job.listeners.delete(res);
    }
  }

  getUserUsage(userId) {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const monthStr = todayStr.substring(0, 7);

    // Optimized SQLite usage query
    const rows = db.prepare(`
        SELECT leadsFound, createdAt FROM jobs 
        WHERE userId = ? AND leadsFound > 0 AND createdAt >= ?
    `).all(userId, monthStr + "-01");

    let dailyCount = 0;
    let monthlyCount = 0;

    for (const row of rows) {
      const jobDateStr = row.createdAt.split('T')[0];
      if (jobDateStr === todayStr) dailyCount += row.leadsFound;
      monthlyCount += row.leadsFound;
    }

    return { dailyCount, monthlyCount };
  }

  getJob(jobId) {
    let job = this.jobs.get(jobId);
    if (!job) {
      const row = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
      if (row) {
        job = {
          ...row,
          params: JSON.parse(row.params),
          events: JSON.parse(row.events),
          files: JSON.parse(row.files),
          listeners: new Set()
        };
        this.jobs.set(jobId, job);
      }
    }
    return job;
  }

  getUserHistory(userId) {
    const rows = db.prepare(`
      SELECT j.*, 
             c.name as campaignName,
             c.status as campaignStatus, 
             COALESCE(recipient_totals.totalEmailsSent, 0) as totalEmailsSent,
             COALESCE(lifecycle_totals.deliveredCount, 0) as deliveredCount,
             COALESCE(lifecycle_totals.bouncedCount, 0) as bouncedCount,
             COALESCE(event_totals.uniqueOpens, 0) as uniqueOpens,
             COALESCE(event_totals.uniqueClicks, 0) as uniqueClicks
      FROM jobs j
      LEFT JOIN campaigns c ON c.id = 'auto_' || j.id
      LEFT JOIN (
        SELECT campaignId, COUNT(*) as totalEmailsSent
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
      WHERE j.userId = ? 
      ORDER BY j.createdAt DESC
    `).all(userId);

    return rows.map(row => {
      const { campaignName, campaignStatus, deliveredCount, bouncedCount, totalEmailsSent, uniqueOpens, uniqueClicks, ...jobData } = row;
      return {
        ...jobData,
        campaignName,
        campaignStatus,
        deliveredCount,
        bouncedCount,
        totalEmailsSent,
        uniqueOpens,
        uniqueClicks,
        params: JSON.parse(jobData.params),
        events: JSON.parse(jobData.events),
        files: JSON.parse(jobData.files)
      };
    });
  }

  getQueueStatus() {
    return {
      active: this.activeJobs.size,
      queued: 0, // No queue — jobs are instant-run or instant-reject
    };
  }

  addCategory(name, userId) {
    const id = Date.now().toString(36) + Math.random().toString(36).substring(2, 5);
    db.prepare("INSERT INTO job_categories (id, userId, name) VALUES (?, ?, ?)")
      .run(id, userId, name);
    return { id, name, userId, createdAt: new Date().toISOString() };
  }

  getCategories(userId) {
    return db.prepare("SELECT * FROM job_categories WHERE userId = ? ORDER BY name ASC").all(userId);
  }

  deleteCategory(id, userId) {
    db.prepare("DELETE FROM job_categories WHERE id = ? AND userId = ?").run(id, userId);
  }

  deleteJob(jobId, userId) {
    // Prevent deletion of a currently running job
    if (this.activeJobs.has(jobId)) {
      throw new Error("Cannot delete a running job. Stop it first.");
    }
    // Delete campaign associated with the job (cascades recipients + event_logs)
    db.prepare("DELETE FROM campaigns WHERE id = ?").run(`auto_${jobId}`);
    // Delete the job itself
    db.prepare("DELETE FROM jobs WHERE id = ? AND userId = ?").run(jobId, userId);
    // Remove from in-memory map if it exists
    this.jobs.delete(jobId);
  }
}
