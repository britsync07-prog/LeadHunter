import { LeadScraper } from "./scraper.js";
import path from "node:path";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HISTORY_FILE = path.join(__dirname, "..", "data", "history.json");
const CATEGORIES_FILE = path.join(__dirname, "..", "data", "categories.json");

export class JobQueue {
  constructor(maxConcurrent = 3) {
    this.maxConcurrent = maxConcurrent;
    this.activeJobs = new Map();
    this.queuedJobs = [];
    this.jobs = new Map(); // All jobs (active, queued, completed)
    this.categories = new Map(); // Explicit categories: Map<id, {id, name, userId, createdAt}>
  }

  async loadHistory() {
    try {
      const data = await fsPromises.readFile(HISTORY_FILE, "utf-8");
      const history = JSON.parse(data);
      for (const job of history) {
        job.listeners = new Set();
        if (!job.files) job.files = [];
        this.jobs.set(job.id, job);
      }
    } catch {
      await fsPromises.writeFile(HISTORY_FILE, "[]");
    }

    try {
      const catData = await fsPromises.readFile(CATEGORIES_FILE, "utf-8");
      const categories = JSON.parse(catData);
      for (const cat of categories) {
        this.categories.set(cat.id, cat);
      }
    } catch {
      await fsPromises.writeFile(CATEGORIES_FILE, "[]");
    }
  }

  async saveHistory() {
    const history = Array.from(this.jobs.values()).map(job => {
      const { listeners, ...rest } = job;
      return rest;
    });
    await fsPromises.writeFile(HISTORY_FILE, JSON.stringify(history, null, 2));
  }

  addJob(jobData, userId) {
    const job = {
      ...jobData,
      userId,
      status: "queued",
      events: [],
      listeners: new Set(),
      files: [],
      createdAt: new Date().toISOString()
    };
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
    const job = this.jobs.get(jobId);
    if (!job) return;

    const scraper = new LeadScraper({
      outputRoot: path.join(__dirname, "..", "output"),
      onProgress: (event) => {
        // Dynamically add files as they are discovered/saved
        if (event.fileName && !job.files.includes(event.fileName)) {
          job.files.push(event.fileName);
        }
        this.pushEvent(job, event);
      }
    });

    this.activeJobs.set(jobId, { job, scraper });
    job.status = "running";
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
        // Safely merge files so we don't overwrite dynamically tracked files like CSVs
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
      this.activeJobs.delete(jobId);
      await this.saveHistory();
      this.processQueue();
    }
  }

  stopJob(jobId) {
    // Check if it's an active job
    if (this.activeJobs.has(jobId)) {
      const { job, scraper } = this.activeJobs.get(jobId);
      job.status = "stopped";
      scraper.stop();
      this.pushEvent(job, { type: "job-stopped", message: "Job stopped by user" });
      this.saveHistory();
      return true;
    }

    // Check if it's a queued job
    const queuedIndex = this.queuedJobs.indexOf(jobId);
    if (queuedIndex !== -1) {
      this.queuedJobs.splice(queuedIndex, 1);
      const job = this.jobs.get(jobId);
      if (job) {
        job.status = "stopped";
        this.pushEvent(job, { type: "job-stopped", message: "Job cancelled by user" });
        this.saveHistory();
      }
      return true;
    }

    return false;
  }

  pushEvent(job, event) {
    const payload = { ...event, time: new Date().toISOString() };
    job.events.push(payload);

    // Track usage natively per job (emails only)
    if (payload.type === 'lead-saved' || payload.type === 'phone-saved' || payload.type === 'csv-saved') {
      if (payload.type === 'lead-saved' && payload.emailFileName) {
        // Only count actual emails towards quota
        job.leadsFound = (job.leadsFound || 0) + 1;
      }

      const usage = this.getUserUsage(job.userId);
      const plan = job.params.userPlan || 'basic';
      const isAdmin = job.params.isAdmin || false;
      const dailyLimit = plan === 'basic' ? 300 : 100;
      const monthlyLimit = plan === 'basic' ? 9000 : 3000;

      // Send usage update to listeners
      const usagePayload = {
        type: 'usage-update',
        usage: usage,
        plan: plan,
        isAdmin: isAdmin,
        dailyLimit: isAdmin ? 'Unlimited' : dailyLimit,
        monthlyLimit: isAdmin ? 'Unlimited' : monthlyLimit,
        time: new Date().toISOString()
      };
      job.events.push(usagePayload);
      for (const res of job.listeners) {
        res.write(`data: ${JSON.stringify(usagePayload)}\n\n`);
      }

      if (!isAdmin && (usage.dailyCount >= dailyLimit || usage.monthlyCount >= monthlyLimit)) {
        if (job.processInstance && !job.processInstance.isStopped) {
          job.processInstance.isStopped = true;
          const infoPayload = { type: "info", message: `Plan limit reached (Daily: ${dailyLimit}, Monthly: ${monthlyLimit}). Stopping.`, time: new Date().toISOString() };
          job.events.push(infoPayload);
          for (const res of job.listeners) {
            res.write(`data: ${JSON.stringify(infoPayload)}\n\n`);
          }
        }
      }
    }

    // Track files in the job object immediately when they are mentioned in events
    if (payload.fileName && !job.files.includes(payload.fileName)) {
      job.files.push(payload.fileName);
    }
    if (payload.emailFileName && !job.files.includes(payload.emailFileName)) {
      job.files.push(payload.emailFileName);
    }
    if (payload.allEmailsFileName && !job.files.includes(payload.allEmailsFileName)) {
      job.files.push(payload.allEmailsFileName);
    }
    if (payload.phoneFileName && !job.files.includes(payload.phoneFileName)) {
      job.files.push(payload.phoneFileName);
    }
    if (payload.allPhonesFileName && !job.files.includes(payload.allPhonesFileName)) {
      job.files.push(payload.allPhonesFileName);
    }

    for (const res of job.listeners) {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    }
  }

  getUserUsage(userId) {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const monthStr = todayStr.substring(0, 7);

    let dailyCount = 0;
    let monthlyCount = 0;

    for (const job of this.jobs.values()) {
      if (job.userId === userId && job.leadsFound) {
        const jobDateStr = job.createdAt.split('T')[0];
        const jobMonthStr = jobDateStr.substring(0, 7);

        if (jobDateStr === todayStr) dailyCount += job.leadsFound;
        if (jobMonthStr === monthStr) monthlyCount += job.leadsFound;
      }
    }
    return { dailyCount, monthlyCount };
  }

  getJob(jobId) {
    return this.jobs.get(jobId);
  }

  getUserHistory(userId) {
    return Array.from(this.jobs.values())
      .filter((j) => j.userId === userId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  getQueueStatus() {
    return {
      active: this.activeJobs.size,
      queued: this.queuedJobs.length,
      max: this.maxConcurrent
    };
  }

  hasUserActiveJob(userId) {
    return Array.from(this.jobs.values()).some(
      (job) => job.userId === userId && (job.status === "running" || job.status === "queued")
    );
  }

  // ── Explicit Category Management ── //

  async saveCategories() {
    const cats = Array.from(this.categories.values());
    await fsPromises.writeFile(CATEGORIES_FILE, JSON.stringify(cats, null, 2));
  }

  addCategory(name, userId) {
    // Generate an ID for the category (we use a simple slug or timestamp + random)
    const id = Date.now().toString(36) + Math.random().toString(36).substring(2, 5);
    const category = {
      id,
      name,
      userId,
      createdAt: new Date().toISOString()
    };
    this.categories.set(id, category);
    this.saveCategories();
    return category;
  }

  getCategories(userId) {
    return Array.from(this.categories.values())
      .filter((c) => c.userId === userId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}
