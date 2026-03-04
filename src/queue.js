import { LeadScraper } from "./scraper.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import db from "./sender/models/db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class JobQueue {
  constructor(maxConcurrent = 3) {
    this.maxConcurrent = maxConcurrent;
    this.activeJobs = new Map();
    this.queuedJobs = [];
    this.jobs = new Map(); // Currently active or recently accessed jobs in memory
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
      status: "queued",
      events: [],
      listeners: new Set(),
      files: [],
      leadsFound: 0,
      createdAt: new Date().toISOString()
    };

    // Persist to DB immediately
    db.prepare(`
      INSERT INTO jobs (id, userId, status, params, events, files, leadsFound, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      job.id,
      job.userId,
      job.status,
      JSON.stringify(job.params),
      JSON.stringify(job.events),
      JSON.stringify(job.files),
      job.leadsFound,
      job.createdAt
    );

    this.jobs.set(job.id, job);
    this.queuedJobs.push(job.id);
    this.processQueue();
    return job;
  }

  async processQueue() {
    if (this.activeJobs.size >= this.maxConcurrent || this.queuedJobs.length === 0) {
      return;
    }

    const jobId = this.queuedJobs.shift();
    let job = this.jobs.get(jobId);

    if (!job) {
      // Load from DB if not in memory
      const row = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
      if (!row) return;
      job = {
        ...row,
        params: JSON.parse(row.params),
        events: JSON.parse(row.events),
        files: JSON.parse(row.files),
        listeners: new Set()
      };
      this.jobs.set(jobId, job);
    }

    const scraper = new LeadScraper({
      outputRoot: path.join(__dirname, "..", "output"),
      onProgress: (event) => {
        if (event.fileName && !job.files.includes(event.fileName)) {
          job.files.push(event.fileName);
        }
        this.pushEvent(job, event);
      }
    });

    this.activeJobs.set(jobId, { job, scraper });
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
      this.activeJobs.delete(jobId);
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

    const queuedIndex = this.queuedJobs.indexOf(jobId);
    if (queuedIndex !== -1) {
      this.queuedJobs.splice(queuedIndex, 1);
      const job = this.jobs.get(jobId) || db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
      if (job) {
        const updatedJob = { ...job, status: "stopped" };
        if (typeof updatedJob.events === 'string') updatedJob.events = JSON.parse(updatedJob.events);
        this.pushEvent(updatedJob, { type: "job-stopped", message: "Job cancelled by user" });
        db.prepare("UPDATE jobs SET status = ?, events = ? WHERE id = ?").run("stopped", JSON.stringify(updatedJob.events), job.id);
      }
      return true;
    }

    return false;
  }

  pushEvent(job, event) {
    const payload = { ...event, time: new Date().toISOString() };
    job.events.push(payload);

    if (payload.type === 'lead-saved' || payload.type === 'phone-saved' || payload.type === 'csv-saved') {
      if (payload.type === 'lead-saved' && payload.emailFileName) {
        job.leadsFound = (job.leadsFound || 0) + 1;
      }

      const usage = this.getUserUsage(job.userId);
      const plan = job.params.userPlan || 'basic';
      const isAdmin = job.params.isAdmin || false;
      const dailyLimit = plan === 'basic' ? 300 : 100;
      const monthlyLimit = plan === 'basic' ? 9000 : 3000;

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
        res.write(`data: ${JSON.stringify(usagePayload)}\n\n`);
        if (res.flush) res.flush();
      }

      if (!isAdmin && (usage.dailyCount >= dailyLimit || usage.monthlyCount >= monthlyLimit)) {
        if (job.processInstance && !job.processInstance.isStopped) {
          job.processInstance.isStopped = true;
          const infoPayload = { type: "info", message: `Plan limit reached. Stopping.`, time: new Date().toISOString() };
          for (const res of job.listeners) {
            res.write(`data: ${JSON.stringify(infoPayload)}\n\n`);
            if (res.flush) res.flush();
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
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
      if (res.flush) res.flush();
    }

    // Asynchronously update events in DB for large jobs (optional: debounce this for ultra-high speed)
    // For now, we update it in processQueue finally, but let's do a partial update for "Live" persistence
    if (job.events.length % 10 === 0) {
        db.prepare("UPDATE jobs SET events = ?, files = ?, leadsFound = ? WHERE id = ?")
          .run(JSON.stringify(job.events), JSON.stringify(job.files), job.leadsFound, job.id);
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
      queued: this.queuedJobs.length,
      max: this.maxConcurrent
    };
  }

  hasUserActiveJob(userId) {
    const row = db.prepare(`
        SELECT id FROM jobs 
        WHERE userId = ? AND (status = 'running' OR status = 'queued')
        LIMIT 1
    `).get(userId);
    return !!row;
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
