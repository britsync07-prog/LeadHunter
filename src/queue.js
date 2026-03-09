import { LeadScraper } from "./scraper.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import db from "./sender/models/db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class JobQueue {
  constructor() {
    this.jobs = new Map(); // All jobs session
    this.activeJobs = new Map(); // Map<jobId, { job, scraper, listeners }>
    this.userActiveJobCounts = new Map(); // Map<userId, count>
  }

  getPlanLimits(plan) {
    const p = (plan || 'free').toLowerCase().trim();
    if (p === 'admin') return { concurrentJobs: Infinity }; // Unlimited
    if (p === 'premium') return { concurrentJobs: 5 };
    if (p === 'advance') return { concurrentJobs: 1 };
    if (p === 'basic') return { concurrentJobs: 1 };
    return { concurrentJobs: 1 }; // free / unknown — 1 job, instant reject if exceeded
  }

  async cleanupStaleJobs() {
    console.log("[System] Cleaning up stale jobs and campaigns from previous session...");

    // 1. Cleanup Scraper Jobs
    const result = db.prepare("UPDATE jobs SET status = 'failed', error = 'Server was restarted' WHERE status = 'running' OR status = 'queued'").run();
    if (result.changes > 0) {
      console.log(`[System] Marked ${result.changes} stale scraper jobs as failed.`);
    }

    // 2. Cleanup Sender Campaigns (if any were stuck in 'sending')
    try {
      const campResult = db.prepare("UPDATE campaigns SET status = 'aborted', abortReason = 'Server was restarted' WHERE status = 'sending'").run();
      if (campResult.changes > 0) {
        console.log(`[System] Aborted ${campResult.changes} stale email campaigns.`);
      }
    } catch (e) {
      // Ignore if table doesn't exist yet
    }
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

    this.activeJobs.set(job.id, { job, scraper });
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
        UPDATE jobs SET status = ?, files = ?, leadsFound = ?, error = ?, events = ?
        WHERE id = ?
      `).run(
        job.status,
        JSON.stringify(job.files),
        job.leadsFound || 0,
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

    if (payload.type === 'lead-saved' || payload.type === 'phone-saved' || payload.type === 'csv-saved') {
      if ((payload.type === 'lead-saved' && payload.emailFileName) || (payload.type === 'phone-saved' && payload.phoneFileName)) {
        job.leadsFound = (job.leadsFound || 0) + 1;
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

      if (plan === 'premium') {
        dailyLimit = 6000;
        monthlyLimit = 180000;
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
        dailyLimit: isAdmin ? 'Unlimited' : dailyLimit,
        monthlyLimit: isAdmin ? 'Unlimited' : monthlyLimit,
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
    const rows = db.prepare("SELECT * FROM jobs WHERE userId = ? ORDER BY createdAt DESC").all(userId);
    return rows.map(row => ({
      ...row,
      params: JSON.parse(row.params),
      events: JSON.parse(row.events),
      files: JSON.parse(row.files)
    }));
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
}
