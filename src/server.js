import "dotenv/config";

// ── EPIPE Guard ──────────────────────────────────────────────────────────────
// When a browser tab closes mid-scrape, Node throws EPIPE on the dead socket.
// Without this handler the server crashes. We swallow EPIPE silently; all
// other genuine uncaught exceptions still crash as expected.
process.on("uncaughtException", (err) => {
  if (err.code === "EPIPE") return; // Ignore broken-pipe from closed SSE clients
  // Re-throw everything else so real bugs still surface
  console.error("[Fatal] Uncaught exception:", err);
  process.exit(1);
});
import express from "express";
import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import session from "express-session";
import SQLiteStore from "connect-sqlite3";
import validator from "html-validator";
import juice from "juice";
import rateLimit from "express-rate-limit"; // Security
import compression from "compression"; // Performance
import helmet from "helmet"; // Security
import { authenticate, requireAuth, registerUser, changePassword, adminResetPassword, initAuth } from "./auth.js";
import { JobQueue } from "./queue.js";
import { expandNiches } from "./scraper.js";
import * as autoMailController from "./sender/controllers/autoMailController.js";
import { processPendingEmails } from "./sender/controllers/campaignController.js";

// Sender & Tracking Routes
import trackingRoutes from "./sender/routes/trackingRoutes.js";
import apiRoutes from "./sender/routes/apiRoutes.js";
import db from "./sender/models/db.js";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "sk_test_dummy");
const SQLiteSessionStore = SQLiteStore(session);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1); // Trust first proxy (e.g. Nginx)
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const COUNTRY_API = "https://countriesnow.space/api/v0.1";

// --- GLOBAL ERROR HANDLERS (Prevent Puppeteer fatal crashes) ---
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Fatal] Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[Fatal] Uncaught exception:', err);
  // We don't exit here because we want to keep the server alive despite Puppeteer's async "Target closed" errors
});

const queue = new JobQueue(3);
await queue.cleanupStaleJobs(); // --- CLEANUP STUCK JOBS ---
await queue.loadHistory();
await initAuth(); // Ensure DB is seeded and migrated

// --- GLOBAL MIDDLEWARE ---
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} ${res.statusCode} - ${duration}ms`);
  });
  next();
});

app.use(helmet({
  contentSecurityPolicy: false,
}));
app.use(compression());

// --- DISABLE CACHE FOR API ROUTES ---
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

// --- STRIPE WEBHOOK ---
app.post("/api/webhooks/stripe", express.raw({ type: "application/json" }), (req, res) => {
  let event;
  try {
    const sig = req.headers["stripe-signature"];
    if (process.env.STRIPE_WEBHOOK_SECRET && sig) {
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } else {
      event = JSON.parse(req.body.toString());
    }
  } catch (err) {
    console.error("[Stripe Webhook Error]:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const userId = session.client_reference_id;
    let plan = 'premium';
    if (session.amount_total === 7900) plan = 'advance';
    if (session.amount_total === 44900) plan = 'premium';
    if (userId) {
      db.prepare("UPDATE users SET subscriptionPlan = ?, trialEndsAt = NULL WHERE id = ?").run(plan, userId);
      console.log(`[Stripe Webhook] Upgraded user ${userId} to ${plan.toUpperCase()} plan via successful payment.`);
    }
  }
  res.json({ received: true });
});

app.use(express.json({ limit: "10mb" }));

// Static files — no long-term caching so JS/CSS changes take effect immediately
app.use(express.static(path.join(__dirname, "..", "public"), {
  maxAge: 0,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".js") || filePath.endsWith(".css")) {
      res.setHeader("Cache-Control", "no-store");
    } else if (filePath.endsWith(".html")) {
      res.setHeader("Cache-Control", "no-store");
    }
  }
}));

// Faster SQLite Session Store
app.use(
  session({
    store: new SQLiteSessionStore({
      db: 'sessions.db',
      dir: path.join(__dirname, "..", "data")
    }),
    secret: process.env.SESSION_SECRET || "company-secret-key-12345",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false,
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    }
  })
);

// --- RATE LIMITERS ---
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { error: "Too many login/register attempts." },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { 
    ip: false,
    trustProxy: false,
    xForwardedForHeader: false 
  },
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 200,
  message: { error: "Too many API requests." },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { 
    ip: false,
    trustProxy: false,
    xForwardedForHeader: false 
  },
});

app.use("/api/login", authLimiter);
app.use("/api/auth/register", authLimiter);
app.use("/api/", apiLimiter);

const locationCache = {
  countries: null,
  details: new Map()
};

// --- SENDER TRACKING SECURITY & ROUTES ---
const trackingLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 2000,
  message: "Too many tracking requests.",
  standardHeaders: true,
  legacyHeaders: false,
  validate: { ip: false },
});

app.use("/track", trackingLimiter, trackingRoutes);
app.use("/api/sender", requireAuth, apiRoutes);

// --- ADMIN MIDDLEWARE ---
function requireAdmin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Not authenticated" });
  const user = db.prepare("SELECT isAdmin FROM users WHERE id = ?").get(req.session.user.id);
  if (!user || !user.isAdmin) return res.status(403).json({ error: "Admin access required" });
  next();
}

// --- EXTERNAL API KEY MIDDLEWARE ---
const EXTERNAL_API_KEY = process.env.EXTERNAL_API_KEY || "your-secure-api-key";
function requireApiKey(req, res, next) {
  const apiKey = req.headers["x-api-key"] || req.query.apiKey;
  if (!apiKey || apiKey !== EXTERNAL_API_KEY) {
    return res.status(401).json({ error: "Invalid or missing API Key" });
  }
  next();
}

// --- EXTERNAL API ROUTES ---
app.get("/api/external/countries", requireApiKey, async (_req, res) => {
  try { res.json({ countries: await getCountries() }); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

app.get("/api/external/locations", requireApiKey, async (req, res) => {
  const { country, state } = req.query;
  if (!country) return res.status(400).json({ error: "country required" });
  try {
    if (state) return res.json({ country, state, cities: await getCitiesForState(country, state) });
    return res.json({ ...await getCountryDetails(country), country });
  } catch (e) { return res.status(502).json({ error: e.message }); }
});

app.post("/api/external/jobs", requireApiKey, async (req, res) => {
  let { country, cities = [], states = [], niches, scrapeMode = 'both', includeGoogleMaps = true } = req.body || {};
  if (!country || !niches?.length) return res.status(400).json({ error: "Missing required fields (country, niches)" });

  // Auto-expand states into cities if cities are not provided
  if (cities.length === 0 && states.length > 0) {
    try {
      for (const state of states) {
        const stateCities = await getCitiesForState(country, state);
        if (stateCities && stateCities.length > 0) {
          cities.push(...stateCities);
        } else {
          // Robustness: If no cities found (e.g. state is actually a city like London), use the state name itself
          cities.push(state);
        }
      }
    } catch (e) {
      return res.status(502).json({ error: "Failed to fetch cities for states: " + e.message });
    }
  }

  if (cities.length === 0) return res.status(400).json({ error: "No cities found or provided for the given location." });

  const { autoMailConfig } = req.body || {};
  if (autoMailConfig && !isAdmin) {
    return res.status(403).json({ error: "Auto-Mail is an Admin-only feature." });
  }

  const job = queue.addJob({
    id: crypto.randomUUID(),
    params: { country, cities, states, niches, includeGoogleMaps, scrapeMode, userPlan: 'premium', isAdmin: true, maxLeads: 100, autoMailConfig }
  }, "external_server");

  res.status(202).json({ jobId: job.id, status: job.status });
});

app.get("/api/external/jobs/:jobId/status", requireApiKey, (req, res) => {
  const job = queue.getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });

  const result = {
    jobId: job.id,
    status: job.status,
    leadsFound: job.leadsFound || 0,
    files: {},
    error: job.error || null
  };

  if (job.status === "completed" || job.status === "running") {
    // Specifically looking for the 3 requested files
    if (job.files.includes("all_emails.txt")) result.files.emails = `/api/external/jobs/${job.id}/download/all_emails.txt`;
    if (job.files.includes("all_phones.txt")) result.files.numbers = `/api/external/jobs/${job.id}/download/all_phones.txt`;
    if (job.files.includes("google_maps_all.csv")) result.files.csv = `/api/external/jobs/${job.id}/download/google_maps_all.csv`;
  }

  res.json(result);
});

app.get("/api/external/jobs/:jobId/download/:fileName", requireApiKey, (req, res) => {
  const { jobId, fileName } = req.params;
  const job = queue.getJob(jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });

  const filePath = path.join(__dirname, "..", "output", jobId, fileName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File missing" });
  return res.download(filePath);
});

// --- ADMIN API ROUTES ---
app.get("/api/admin/users", requireAdmin, (req, res) => {
  const q = req.query.q ? `%${req.query.q}%` : null;
  let users;
  if (q) {
    users = db.prepare(`
      SELECT id, username, email, subscriptionPlan, trialEndsAt, isAdmin, createdAt, isSuspended
      FROM users WHERE username LIKE ? OR email LIKE ?
      ORDER BY createdAt DESC
    `).all(q, q);
  } else {
    users = db.prepare(`
      SELECT id, username, email, subscriptionPlan, trialEndsAt, isAdmin, createdAt, isSuspended
      FROM users ORDER BY createdAt DESC
    `).all();
  }
  res.json({ users });
});

app.post("/api/admin/users", requireAdmin, async (req, res) => {
  const { username, email, password, plan = "basic", isAdmin: makeAdmin = false } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: "Missing fields" });
  const result = await registerUser(username, email, password);
  if (result.error) return res.status(400).json({ error: result.error });
  db.prepare("UPDATE users SET subscriptionPlan = ?, trialEndsAt = NULL, isAdmin = ? WHERE username = ?")
    .run(plan, makeAdmin ? 1 : 0, username);
  const newUser = db.prepare("SELECT id, username, email, subscriptionPlan, isAdmin, createdAt FROM users WHERE username = ?").get(username);
  res.json({ user: newUser });
});

app.patch("/api/admin/users/:id/plan", requireAdmin, (req, res) => {
  const { plan } = req.body;
  if (!["free", "basic", "advance", "premium"].includes(plan)) return res.status(400).json({ error: "Invalid plan" });
  db.prepare("UPDATE users SET subscriptionPlan = ?, trialEndsAt = NULL WHERE id = ?").run(plan, req.params.id);
  res.json({ success: true });
});

app.patch("/api/admin/users/:id/admin", requireAdmin, (req, res) => {
  const { isAdmin: flag } = req.body;
  db.prepare("UPDATE users SET isAdmin = ? WHERE id = ?").run(flag ? 1 : 0, req.params.id);
  res.json({ success: true });
});

app.delete("/api/admin/users/:id", requireAdmin, (req, res) => {
  if (req.params.id === req.session.user.id) return res.status(400).json({ error: "Self-deletion blocked" });
  db.prepare("DELETE FROM users WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

app.patch("/api/admin/users/:id/password", requireAdmin, async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });
  const result = await adminResetPassword(req.params.id, password);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ success: true });
});

// --- ADMIN AUTO-MAIL ROUTES ---
app.get("/api/admin/auto-mail-templates", requireAdmin, autoMailController.getTemplates);
app.post("/api/admin/auto-mail-templates", requireAdmin, autoMailController.saveTemplate);
app.delete("/api/admin/auto-mail-templates/:id", requireAdmin, autoMailController.deleteTemplate);

app.patch("/api/admin/users/:id/suspend", requireAdmin, (req, res) => {
  const { suspended } = req.body;
  if (req.params.id === req.session.user.id) return res.status(400).json({ error: "Self-suspension blocked" });
  db.prepare("UPDATE users SET isSuspended = ? WHERE id = ?").run(suspended ? 1 : 0, req.params.id);
  res.json({ success: true });
});

// --- AUTH ROUTES ---
app.post("/api/auth/register", async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: "Missing fields" });
  const result = await registerUser(username, email, password);
  if (result.error) return res.status(400).json({ error: result.error });
  const user = await authenticate(username, password);
  if (user) {
    req.session.user = user;
    return res.json({ success: true, username: user.username });
  }
  return res.status(500).json({ error: "Registration ok, login failed" });
});

app.post("/api/auth/password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const result = await changePassword(req.session.user.username, currentPassword, newPassword);
  if (result.error) return res.status(400).json({ error: result.error });
  return res.json({ success: true });
});

app.get("/api/checkout/session", requireAuth, async (req, res) => {
  const { plan } = req.query;
  if (!['basic', 'advance', 'premium'].includes(plan)) return res.status(400).json({ error: "Invalid plan" });
  const user = db.prepare("SELECT id, email, subscriptionPlan, trialEndsAt FROM users WHERE id = ?").get(req.session.user.id);
  const tiers = { none: 0, free: 0, basic: 1, advance: 2, premium: 3 };
  if (tiers[plan] <= (tiers[user.subscriptionPlan] || 0) && tiers[user.subscriptionPlan] !== 'none' && tiers[user.subscriptionPlan] !== 'expired' && tiers[user.subscriptionPlan] !== 'free') {
    return res.redirect("/already_have_plan.html");
  }
  try {
    const domain = `${req.protocol}://${req.get('host')}`;
    const checkoutSession = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{
        price_data: {
          currency: "gbp",
          product_data: { name: `LeadHunter ${plan} Subscription` },
          unit_amount: plan === 'advance' ? 7900 : 44900,
        },
        quantity: 1,
      }],
      mode: "payment",
      success_url: `${domain}/dashboard.html?checkout=success`,
      cancel_url: `${domain}/index.html`,
      client_reference_id: user.id,
      customer_email: user.email
    });
    res.redirect(303, checkoutSession.url);
  } catch (error) { res.status(500).json({ error: "Stripe error" }); }
});

app.post("/api/login", async (req, res) => {
  const { username, password, rememberMe } = req.body;
  const user = await authenticate(username, password);
  if (user && user.suspended) return res.status(403).json({ error: "Suspended" });
  if (user) {
    req.session.user = user;
    if (!rememberMe) req.session.cookie.expires = false;
    return res.json({ username: user.username });
  }
  return res.status(401).json({ error: "Invalid credentials" });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy();
  res.status(204).end();
});

app.get("/api/me", (req, res) => {
  if (req.session.user) {
    // Only jobs with status 'running' count — no queue anymore
    const activeJob = Array.from(queue.jobs.values()).find(j => j.userId === req.session.user.username && j.status === "running");
    const usage = queue.getUserUsage(req.session.user.username);
    const freshUser = db.prepare("SELECT subscriptionPlan, trialEndsAt, email, isAdmin FROM users WHERE id = ?").get(req.session.user.id);
    if (freshUser) {
      req.session.user.subscriptionPlan = freshUser.subscriptionPlan;
      req.session.user.trialEndsAt = freshUser.trialEndsAt;
      req.session.user.email = freshUser.email;
      req.session.user.isAdmin = freshUser.isAdmin;
    }
    return res.json({
      username: req.session.user.username,
      email: req.session.user.email,
      subscriptionPlan: req.session.user.subscriptionPlan,
      trialEndsAt: req.session.user.trialEndsAt,
      isAdmin: !!(freshUser?.isAdmin),
      usage: usage,
      activeJobId: activeJob ? activeJob.id : null
    });
  }
  return res.status(401).json({ error: "Not logged in" });
});

// --- HELPER FUNCTIONS ---
async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.error === true) throw new Error(payload?.message || "Request failed");
  return payload;
}

async function getCountries() {
  if (locationCache.countries) return locationCache.countries;
  const payload = await fetchJson(`${COUNTRY_API}/countries`);
  locationCache.countries = (payload.data || []).map(i => i.country).filter(Boolean).sort((a, b) => a.localeCompare(b));
  return locationCache.countries;
}

async function getCountryDetails(country) {
  if (locationCache.details.has(country)) return locationCache.details.get(country);
  const [s, c] = await Promise.all([
    fetchJson(`${COUNTRY_API}/countries/states`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ country }) }),
    fetchJson(`${COUNTRY_API}/countries/cities`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ country }) })
  ]);
  const details = {
    states: Array.from(new Set((s.data?.states || []).map(i => i.name).filter(Boolean).sort((a, b) => a.localeCompare(b)))),
    cities: Array.from(new Set((c.data || []).filter(Boolean).sort((a, b) => a.localeCompare(b))))
  };
  locationCache.details.set(country, details);
  return details;
}

const stateCityCache = new Map();
async function getCitiesForState(country, state) {
  const key = `${country}::${state}`;
  if (stateCityCache.has(key)) return stateCityCache.get(key);
  try {
    const p = await fetchJson(`${COUNTRY_API}/countries/state/cities`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ country, state }) });
    const cities = (p.data || []).filter(Boolean).sort((a, b) => a.localeCompare(b));
    stateCityCache.set(key, cities);
    return cities;
  } catch { return []; }
}

// --- API ROUTES ---
const checkerCallbacks = new Map();
app.post("/api/checker/callback", (req, res) => {
  const { requestId, message, details } = req.body;
  if (!requestId) return res.status(400).json({ error: "requestId required" });
  checkerCallbacks.set(requestId, { message, details, timestamp: Date.now() });
  setTimeout(() => checkerCallbacks.delete(requestId), 10 * 60 * 1000);
  res.json({ success: true });
});

app.get("/api/checker/status/:requestId", requireAuth, (req, res) => {
  const result = checkerCallbacks.get(req.params.requestId);
  if (result) return res.json(result);
  res.status(404).json({ error: "No update" });
});

app.get("/api/metadata", requireAuth, async (_req, res) => {
  try { res.json({ countries: await getCountries(), source: COUNTRY_API }); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

app.get("/api/location", requireAuth, async (req, res) => {
  const { country, state } = req.query;
  if (!country) return res.status(400).json({ error: "country required" });
  try {
    if (state) return res.json({ country, state, cities: await getCitiesForState(country, state) });
    return res.json({ ...await getCountryDetails(country), source: COUNTRY_API, country });
  } catch (e) { return res.status(502).json({ error: e.message }); }
});

app.post("/api/expand-niches", requireAuth, (req, res) => {
  res.json({ expandedNiches: expandNiches(req.body?.niches || []) });
});

app.get("/api/categories", requireAuth, (req, res) => {
  res.json({ categories: queue.getCategories(req.session.user.username) });
});

app.post("/api/categories", requireAuth, (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: "Name required" });
  const existing = queue.getCategories(req.session.user.username);
  if (existing.some(c => c.name.toLowerCase() === name.toLowerCase())) return res.status(400).json({ error: "Exists" });
  res.status(201).json({ category: queue.addCategory(name.trim(), req.session.user.username) });
});

app.post("/api/jobs", requireAuth, async (req, res) => {
  const { country, cities, states = [], niches, includeGoogleMaps = true, scrapeMode = 'emails', sites, category, autoMailConfig } = req.body || {};
  const userPlan = req.session.user.subscriptionPlan || 'free';
  const isAdmin = !!req.session.user.isAdmin;

  // Usage / scrape-mode restrictions (non-admins only)
  const usage = queue.getUserUsage(req.session.user.username);

  if (!isAdmin) {
    if (userPlan === 'expired' || userPlan === 'free' || userPlan === 'none') {
      return res.status(403).json({ error: "Active subscription required. Please update your plan to continue." });
    }

    let dailyLimit = 0;
    let monthlyLimit = 0;

    if (userPlan === 'premium') {
      // Premium has unlimited leads
      dailyLimit = Infinity;
      monthlyLimit = Infinity;
      if (!includeGoogleMaps || scrapeMode !== 'both') return res.status(403).json({ error: "Premium plan requires Maps+Both" });
    } else if (userPlan === 'advance') {
      return res.status(403).json({ error: "The Scraper is not included in the Advance plan. Please upgrade to Premium to use this feature." });
    } else {
      // Any other plan (none) is treated as expired
      return res.status(403).json({ error: "Active subscription required." });
    }

    if (usage.dailyCount >= dailyLimit || usage.monthlyCount >= monthlyLimit) {
      return res.status(403).json({ error: "Limit reached" });
    }
  }

  try { await getCountryDetails(country); } catch (e) { return res.status(502).json({ error: e.message }); }

  // addJob handles concurrent-limit check internally — no queue, instant reject
  const effectivePlan = isAdmin ? 'admin' : userPlan;
  if (autoMailConfig && !isAdmin) {
    return res.status(403).json({ error: "Auto-Mail is an Admin-only feature." });
  }
  const job = queue.addJob(
    { id: crypto.randomUUID(), params: { country, cities, states, niches, includeGoogleMaps, scrapeMode, sites, category, userPlan: effectivePlan, isAdmin, autoMailConfig } },
    req.session.user.username // username is the userId key used throughout the queue
  );

  if (job.status === 'failed') {
    // Job was instantly rejected due to concurrent limit
    return res.status(429).json({ error: job.error });
  }

  res.status(202).json({ jobId: job.id, status: job.status });
});

app.get("/api/jobs/:jobId/events", requireAuth, (req, res) => {
  const job = queue.getJob(req.params.jobId);
  if (!job) return res.status(404).end();
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // Prevent EPIPE from crashing the server when the client closes the tab
  res.socket?.on("error", () => {
    job.listeners.delete(res);
  });

  try {
    res.flushHeaders();
    // Replay past events so reconnecting clients don't miss anything
    for (const event of job.events) {
      if (res.writableEnded || res.destroyed) break;
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    if (res.flush) res.flush();
  } catch {
    // Client already closed — nothing to do
    return undefined;
  }

  job.listeners.add(res);
  req.on("close", () => job.listeners.delete(res));
  return undefined;
});

app.get("/api/jobs/:jobId/files/:fileName", requireAuth, (req, res) => {
  const job = queue.getJob(req.params.jobId);
  if (!job || !job.files.includes(req.params.fileName)) return res.status(404).json({ error: "Not found" });
  const filePath = path.join(__dirname, "..", "output", job.id, req.params.fileName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File missing" });
  return res.download(filePath);
});

app.post("/api/jobs/:id/stop", requireAuth, (req, res) => {
  const success = queue.stopJob(req.params.id);
  res.json({ success });
});

app.post("/api/jobs/:id/restart", requireAuth, (req, res) => {
  try {
    const success = queue.restartJob(req.params.id);
    res.json({ success });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/history", requireAuth, (req, res) => {
  res.json(queue.getUserHistory(req.session.user.username));
});

app.get("/api/queue", requireAuth, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(queue.getQueueStatus());
});

app.post("/api/check-template", requireAuth, async (req, res) => {
  const { html, testEmail, subject } = req.body;
  if (!html) return res.status(400).json({ error: "No HTML" });
  const findings = [];
  let spamScore = 0;
  if (testEmail) {
    try {
      const r = await fetch("http://127.0.0.1:5678/webhook-test/get", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: testEmail, subject: subject || "Test", html, requestId: crypto.randomUUID() }) });
      if (!r.ok) findings.push("Webhook failed");
    } catch (e) { findings.push("Webhook error"); }
  }
  const spamWords = ["free", "win", "cash", "crypto", "bitcoin", "viagra"];
  spamWords.forEach(w => { if (html.toLowerCase().includes(w)) { spamScore++; findings.push(`Spam word: ${w}`); } });
  if (html.length < 100) findings.push("Too short");
  if (!html.includes("<img")) findings.push("No images");
  try {
    const result = await validator({ data: html, format: "json" });
    const errors = result.messages.filter(m => m.type === "error");
    spamScore += errors.length;
    if (errors.length) findings.push(`HTML errors: ${errors.length}`);
  } catch (e) { }
  const passed = spamScore < 5;
  res.json({ passed, spamScore, findings, status: passed ? "PASS" : "FAIL" });
});

app.listen(PORT, HOST, () => {
  console.log(`Dashboard server running on http://${HOST}:${PORT}`);
  
  // Start the Email Scheduler Worker
  setInterval(() => {
    processPendingEmails(`http://${HOST}:${PORT}`).catch(err => {
      console.error('[Email Scheduler Error]', err);
    });
  }, 60000); // Check every minute
});
