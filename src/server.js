import "dotenv/config";
import express from "express";
import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import session from "express-session";
import sessionFileStore from "session-file-store";
import validator from "html-validator";
import juice from "juice";
import rateLimit from "express-rate-limit"; // Security
import { authenticate, requireAuth, registerUser, changePassword } from "./auth.js";
import { JobQueue } from "./queue.js";
import { expandNiches } from "./scraper.js";

// Sender & Tracking Routes
import trackingRoutes from "./sender/routes/trackingRoutes.js";
import apiRoutes from "./sender/routes/apiRoutes.js";
import db from "./sender/models/db.js";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "sk_test_dummy");

const FileStore = sessionFileStore(session);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const COUNTRY_API = "https://countriesnow.space/api/v0.1";

const queue = new JobQueue(3);
await queue.loadHistory();

// Ensure sessions directory exists
const sessionsDir = path.join(__dirname, "..", "data", "sessions");
if (!fs.existsSync(sessionsDir)) {
  fs.mkdirSync(sessionsDir, { recursive: true });
}

// --- STRIPE WEBHOOK (Must be registered before express.json middleware) ---
app.post("/api/webhooks/stripe", express.raw({ type: "application/json" }), (req, res) => {
  let event;
  try {
    const sig = req.headers["stripe-signature"];
    if (process.env.STRIPE_WEBHOOK_SECRET && sig) {
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } else {
      // Insecure fallback for local dev without secrets
      event = JSON.parse(req.body.toString());
    }
  } catch (err) {
    console.error("[Stripe Webhook Error]:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const userId = session.client_reference_id;

    // Reverse-engineer the plan from the transaction amount
    let plan = 'premium';
    if (session.amount_total === 900) plan = 'basic';
    if (session.amount_total === 2900) plan = 'advance';

    if (userId) {
      db.prepare("UPDATE users SET subscriptionPlan = ?, trialEndsAt = NULL WHERE id = ?").run(plan, userId);
      console.log(`[Stripe Webhook] Upgraded user ${userId} to ${plan.toUpperCase()} plan via successful payment.`);
    }
  }
  res.json({ received: true });
});

app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));
app.use(
  session({
    store: new FileStore({
      path: sessionsDir,
      retries: 5,
      ttl: 30 * 24 * 60 * 60, // 30 days
      logFn: () => { }, // Silences the retry logs
    }),
    secret: "company-secret-key-12345", // Change this to a secure random string in production
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false,
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
  })
);

const locationCache = {
  countries: null,
  details: new Map()
};

// --- SENDER TRACKING SECURITY & ROUTES ---

// 1. High-Performance Rate Limiter for Tracking
// Protects against DDoS or analytics poisoning (spam clicks/opens)
const trackingLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 500, // Limit each IP to 500 tracking events per window
  message: "Too many tracking requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

// 2. Mount high-volume Tracking gateway
app.use("/track", trackingLimiter, trackingRoutes);

// 3. Mount secure Analytics API gateway (requires Auth)
app.use("/api/sender", requireAuth, apiRoutes);

// --- ADMIN MIDDLEWARE ---

function requireAdmin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Not authenticated" });
  const user = db.prepare("SELECT isAdmin FROM users WHERE id = ?").get(req.session.user.id);
  if (!user || !user.isAdmin) return res.status(403).json({ error: "Admin access required" });
  next();
}

// --- ADMIN API ROUTES ---

// List / search all users
app.get("/api/admin/users", requireAdmin, (req, res) => {
  const q = req.query.q ? `%${req.query.q}%` : null;
  let users;
  if (q) {
    users = db.prepare(`
      SELECT id, username, email, subscriptionPlan, trialEndsAt, isAdmin, createdAt
      FROM users WHERE username LIKE ? OR email LIKE ?
      ORDER BY createdAt DESC
    `).all(q, q);
  } else {
    users = db.prepare(`
      SELECT id, username, email, subscriptionPlan, trialEndsAt, isAdmin, createdAt
      FROM users ORDER BY createdAt DESC
    `).all();
  }
  res.json({ users });
});

// Create user (admin)
app.post("/api/admin/users", requireAdmin, async (req, res) => {
  const { username, email, password, plan = "basic", isAdmin: makeAdmin = false } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: "username, email and password are required" });
  const result = await registerUser(username, email, password);
  if (result.error) return res.status(400).json({ error: result.error });
  // Update plan + admin flag right away
  db.prepare("UPDATE users SET subscriptionPlan = ?, trialEndsAt = NULL, isAdmin = ? WHERE username = ?")
    .run(plan, makeAdmin ? 1 : 0, username);
  const newUser = db.prepare("SELECT id, username, email, subscriptionPlan, isAdmin, createdAt FROM users WHERE username = ?").get(username);
  res.json({ user: newUser });
});

// Update subscription plan
app.patch("/api/admin/users/:id/plan", requireAdmin, (req, res) => {
  const { plan } = req.body;
  const validPlans = ["free", "basic", "advance", "premium"];
  if (!validPlans.includes(plan)) return res.status(400).json({ error: "Invalid plan" });
  db.prepare("UPDATE users SET subscriptionPlan = ?, trialEndsAt = NULL WHERE id = ?").run(plan, req.params.id);
  res.json({ success: true });
});

// Toggle admin role
app.patch("/api/admin/users/:id/admin", requireAdmin, (req, res) => {
  const { isAdmin: flag } = req.body;
  db.prepare("UPDATE users SET isAdmin = ? WHERE id = ?").run(flag ? 1 : 0, req.params.id);
  res.json({ success: true });
});

// Delete user
app.delete("/api/admin/users/:id", requireAdmin, (req, res) => {
  // Prevent self-deletion
  if (req.params.id === req.session.user.id) return res.status(400).json({ error: "You cannot delete your own account" });
  db.prepare("DELETE FROM users WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

// Suspend / unsuspend user
app.patch("/api/admin/users/:id/suspend", requireAdmin, (req, res) => {
  const { suspended } = req.body;
  if (req.params.id === req.session.user.id) return res.status(400).json({ error: "You cannot suspend your own account" });
  db.prepare("UPDATE users SET isSuspended = ? WHERE id = ?").run(suspended ? 1 : 0, req.params.id);
  res.json({ success: true });
});

// --- AUTH ROUTES ---


app.post("/api/auth/register", async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const result = await registerUser(username, email, password);
  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  // Instantly authenticate the new user session
  const user = await authenticate(username, password);
  if (user) {
    req.session.user = user;
    req.session.cookie.expires = false; // standard session
    return res.json({ success: true, username: user.username });
  }

  return res.status(500).json({ error: "Signup successful but auto-login failed." });
});

app.post("/api/auth/password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const result = await changePassword(req.session.user.username, currentPassword, newPassword);
  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  return res.json({ success: true });
});

app.get("/api/checkout/session", requireAuth, async (req, res) => {
  const { plan } = req.query;
  const sessionUser = req.session.user;

  if (!['basic', 'advance', 'premium'].includes(plan)) {
    return res.status(400).json({ error: "Invalid subscription plan selected." });
  }

  // Fetch fresh user data from DB to check current tier and trial status
  const user = db.prepare("SELECT id, email, subscriptionPlan, trialEndsAt FROM users WHERE id = ?").get(sessionUser.id);

  // Prevent duplicate purchases or downgrades
  // Tiers logic: free (0) -> basic (1) -> advance (2) -> premium (3)
  const tiers = { free: 0, basic: 1, advance: 2, premium: 3 };
  const currentTier = tiers[user.subscriptionPlan] || 0;
  const targetTier = tiers[plan];

  // If trialEndsAt is NULL, the user has a *paid* plan.
  // We block the purchase if they are trying to buy the same or a lower tier.
  if (!user.trialEndsAt && targetTier <= currentTier && currentTier > 0) {
    // Generate a sleek error page instead of raw JSON so the user isn't stuck
    return res.send(`
      <html><body style="font-family: sans-serif; text-align: center; padding: 50px;">
        <h2>Oops! Invalid Upgrade</h2>
        <p>You already have the <b>${user.subscriptionPlan.toUpperCase()}</b> plan.</p>
        <p>You cannot purchase or downgrade to <b>${plan.toUpperCase()}</b>.</p>
        <a href="/dashboard.html" style="color: blue;">Return to Dashboard</a>
      </body></html>
    `);
  }

  try {
    const domain = `${req.protocol}://${req.get('host')}`;

    const checkoutSession = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `LeadHunter ${plan.charAt(0).toUpperCase() + plan.slice(1)} Subscription`,
              description: `Powerful ${plan} tier scraping platform.`,
            },
            unit_amount: plan === 'basic' ? 900 : plan === 'advance' ? 2900 : 4900,
          },
          quantity: 1,
        },
      ],
      mode: "payment", // Simplification to avoid complex subscription prorations for now
      success_url: `${domain}/dashboard.html?checkout=success`,
      cancel_url: `${domain}/index.html`,
      client_reference_id: user.id, // Used by the Webhook to unlock the user's account
      customer_email: user.email // Pre-fill Stripe Form
    });

    res.redirect(303, checkoutSession.url);
  } catch (error) {
    console.error("[Stripe Session Error]:", error);
    res.status(500).json({ error: "Failed to generate secure checkout portal." });
  }
});

app.post("/api/login", async (req, res) => {
  const { username, password, rememberMe } = req.body;
  const user = await authenticate(username, password);
  if (user && user.suspended) {
    return res.status(403).json({ error: "Your account has been suspended. Please contact support." });
  }
  if (user) {
    req.session.user = user;
    if (rememberMe) {
      // 30 days session
      req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
    } else {
      // Session cookie (cleared when browser closes)
      req.session.cookie.expires = false;
    }
    return res.json({ username: user.username });
  }
  return res.status(401).json({ error: "Invalid username or password" });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy();
  res.status(204).end();
});

app.get("/api/me", (req, res) => {
  if (req.session.user) {
    const activeJob = Array.from(queue.jobs.values()).find(
      j => j.userId === req.session.user.username && (j.status === "running" || j.status === "queued")
    );
    const usage = queue.getUserUsage(req.session.user.username);

    // Always read plan & trial from DB so Stripe webhook changes are reflected immediately
    // without requiring the user to log out and back in.
    const freshUser = db.prepare("SELECT subscriptionPlan, trialEndsAt, email FROM users WHERE id = ?")
      .get(req.session.user.id);

    if (freshUser) {
      // Keep session in sync so subsequent checks are consistent
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
      isAdmin: freshUser ? !!freshUser.isAdmin : false,
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

  if (!response.ok || payload?.error === true) {
    const message = payload?.msg || payload?.message || `Failed request ${url}: ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

async function getCountries() {
  if (locationCache.countries) return locationCache.countries;

  const payload = await fetchJson(`${COUNTRY_API}/countries`);
  const countries = (payload.data || [])
    .map((item) => item.country)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  locationCache.countries = countries;
  return countries;
}

async function getCountryDetails(country) {
  if (locationCache.details.has(country)) return locationCache.details.get(country);

  const [statesPayload, citiesPayload] = await Promise.all([
    fetchJson(`${COUNTRY_API}/countries/states`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ country })
    }),
    fetchJson(`${COUNTRY_API}/countries/cities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ country })
    })
  ]);

  const states = (statesPayload.data?.states || [])
    .map((item) => item.name)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  const cities = (citiesPayload.data || [])
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  const details = {
    states: Array.from(new Set(states)),
    cities: Array.from(new Set(cities))
  };

  locationCache.details.set(country, details);
  return details;
}

// Cache for per-state city lookups
const stateCityCache = new Map();

async function getCitiesForState(country, state) {
  const cacheKey = `${country}::${state}`;
  if (stateCityCache.has(cacheKey)) return stateCityCache.get(cacheKey);

  try {
    const payload = await fetchJson(`${COUNTRY_API}/countries/state/cities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ country, state })
    });
    const cities = (payload.data || []).filter(Boolean).sort((a, b) => a.localeCompare(b));
    stateCityCache.set(cacheKey, cities);
    return cities;
  } catch (err) {
    console.warn(`[Location] State city lookup failed for ${state}, ${country}:`, err.message);
    return [];
  }
}

// --- API ROUTES ---

const checkerCallbacks = new Map();

app.post("/api/checker/callback", (req, res) => {
  const { requestId, message, details } = req.body;
  console.log(`Received callback for ${requestId}: ${message}`);
  if (!requestId) return res.status(400).json({ error: "requestId is required" });

  checkerCallbacks.set(requestId, {
    message,
    details,
    timestamp: Date.now()
  });

  // Cleanup old callbacks after 10 minutes
  setTimeout(() => checkerCallbacks.delete(requestId), 10 * 60 * 1000);

  res.json({ success: true });
});

app.get("/api/checker/status/:requestId", requireAuth, (req, res) => {
  const result = checkerCallbacks.get(req.params.requestId);
  if (result) {
    return res.json(result);
  }
  res.status(404).json({ error: "No update yet" });
});

app.get("/api/metadata", requireAuth, async (_req, res) => {
  try {
    const countries = await getCountries();
    res.json({ countries, source: COUNTRY_API });
  } catch (error) {
    res.status(502).json({ error: `CountriesNow API unavailable: ${error.message}` });
  }
});

app.get("/api/location", requireAuth, async (req, res) => {
  const country = req.query.country;
  const state = req.query.state;

  if (!country || typeof country !== "string") {
    return res.status(400).json({ error: "country query param is required" });
  }

  try {
    // If a specific state is requested, return only the cities for that state
    if (state && typeof state === "string") {
      const cities = await getCitiesForState(country, state);
      return res.json({ country, state, cities });
    }

    const details = await getCountryDetails(country);
    return res.json({ ...details, source: COUNTRY_API, country });
  } catch (error) {
    return res.status(502).json({ error: `CountriesNow API unavailable: ${error.message}` });
  }
});

app.post("/api/expand-niches", requireAuth, (req, res) => {
  const { niches = [] } = req.body || {};
  res.json({ expandedNiches: expandNiches(niches) });
});

app.get("/api/categories", requireAuth, (req, res) => {
  const categories = queue.getCategories(req.session.user.username);
  res.json({ categories });
});

app.post("/api/categories", requireAuth, (req, res) => {
  const { name } = req.body || {};
  if (!name || typeof name !== "string") {
    return res.status(400).json({ error: "Category name is required" });
  }

  // Basic dupe check (case-insensitive)
  const existing = queue.getCategories(req.session.user.username);
  if (existing.some(c => c.name.toLowerCase() === name.toLowerCase())) {
    return res.status(400).json({ error: "Category already exists" });
  }

  const category = queue.addCategory(name.trim(), req.session.user.username);
  res.status(201).json({ category });
});

app.post("/api/jobs", requireAuth, async (req, res) => {
  const { country, cities, states = [], niches, includeGoogleMaps = true, scrapeMode = 'emails', sites, category } = req.body || {};

  if (queue.hasUserActiveJob(req.session.user.username)) {
    return res.status(429).json({ error: "You already have a job running or in the queue. Please wait or stop the current job before starting a new one." });
  }

  if (!country || !Array.isArray(cities) || !cities.length || !Array.isArray(niches) || !niches.length) {
    return res.status(400).json({ error: "country, cities, and niches are required." });
  }

  // --- Subscription Plan Enforcement ---
  const userPlan = req.session.user.subscriptionPlan || 'basic';
  const isAdmin = req.session.user.isAdmin === 1;
  const usage = queue.getUserUsage(req.session.user.username);

  if (!isAdmin) {
    if (userPlan === 'basic') {
      if (includeGoogleMaps) return res.status(403).json({ error: "Basic plan does not include Google Maps scraping." });
      if (scrapeMode !== 'emails') return res.status(403).json({ error: "Basic plan only allows scraping emails." });

      if (usage.dailyCount >= 300) return res.status(403).json({ error: "Daily limit of 300 emails reached on Basic plan." });
      if (usage.monthlyCount >= 9000) return res.status(403).json({ error: "Monthly limit of 9000 emails reached on Basic plan." });
    } else if (userPlan === 'advance' || userPlan === 'premium') {
      if (!includeGoogleMaps || scrapeMode !== 'both') {
        return res.status(403).json({ error: "Advance/Premium plans require Google Maps and 'both' scrape mode (emails + phones) for high quality leads." });
      }

      if (usage.dailyCount >= 100) return res.status(403).json({ error: `Daily limit of 100 premium leads reached on ${userPlan} plan.` });
      if (usage.monthlyCount >= 3000) return res.status(403).json({ error: `Monthly limit of 3000 premium leads reached on ${userPlan} plan.` });
    }
  }
  // -------------------------------------

  try {
    await getCountryDetails(country); // Validate country/fetch cache
  } catch (error) {
    return res.status(502).json({ error: `CountriesNow API unavailable: ${error.message}` });
  }

  const jobData = {
    id: crypto.randomUUID(),
    params: { country, cities, states, niches, includeGoogleMaps, scrapeMode, sites, category, userPlan, isAdmin }
  };

  const job = queue.addJob(jobData, req.session.user.username);
  res.status(202).json({ jobId: job.id, status: job.status });
});

app.get("/api/jobs/:jobId/events", requireAuth, (req, res) => {
  const job = queue.getJob(req.params.jobId);
  if (!job) return res.status(404).end();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  for (const event of job.events) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  job.listeners.add(res);

  req.on("close", () => {
    job.listeners.delete(res);
  });

  return undefined;
});

app.get("/api/jobs/:jobId/files/:fileName", requireAuth, (req, res) => {
  const job = queue.getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });

  const fileName = req.params.fileName;
  if (!job.files.includes(fileName)) {
    return res.status(404).json({ error: "File not available for this job" });
  }

  const filePath = path.join(__dirname, "..", "output", job.id, fileName);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found on disk" });
  }

  return res.download(filePath);
});

app.post("/api/jobs/:jobId/stop", requireAuth, (req, res) => {
  const success = queue.stopJob(req.params.jobId);
  if (success) {
    return res.json({ message: "Job stop initiated" });
  }
  return res.status(404).json({ error: "Job not found or not in a stoppable state" });
});

app.get("/api/history", requireAuth, (req, res) => {
  const history = queue.getUserHistory(req.session.user.username);
  res.json(history);
});

app.get("/api/queue", requireAuth, (req, res) => {
  res.json(queue.getQueueStatus());
});

app.post("/api/check-template", requireAuth, async (req, res) => {
  const { html, testEmail, subject } = req.body;
  if (!html) return res.status(400).json({ error: "No HTML template provided" });

  const spamWords = ["free", "win", "winner", "prize", "cash", "act now", "limited time", "guarantee", "congratulations", "urgent", "money", "income", "profit", "earn", "dollar", "crypto", "bitcoin", "lottery", "gift card", "reward", "viagra", "pharmacy", "medicine", "drugs", "no cost", "best price", "save big", "buy now", "click here", "subscribe", "urgent", "secret", "unlimited", "apply now", "claims", "collect", "extra", "junk", "marketing", "promotion", "sales", "special", "stop", "unsubscribe"];

  const findings = [];
  let spamScore = 0;
  let webhookStatus = null;
  const requestId = crypto.randomUUID();

  // Webhook integration
  if (testEmail) {
    try {
      // If n8n is in docker, localhost:5678 works if port is mapped to host
      const webhookResponse = await fetch("http://127.0.0.1:5678/webhook-test/get", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: testEmail,
          subject: subject || "Test Email",
          html,
          requestId // Send this to n8n so it can call back
        })
      });

      if (webhookResponse.ok) {
        try {
          const n8nData = await webhookResponse.json();
          webhookStatus = n8nData.message || n8nData.status || "Test email successfully sent to n8n!";
        } catch (e) {
          webhookStatus = "Test email sent, but n8n returned an empty response.";
        }
      } else {
        const errorText = await webhookResponse.text();
        webhookStatus = `Webhook Error: ${webhookResponse.status} - ${errorText || webhookResponse.statusText}`;
      }
    } catch (error) {
      webhookStatus = `Failed to connect to n8n: ${error.message}`;
    }
  }

  // Check for spam words (case insensitive)
  const lowerHtml = html.toLowerCase();
  spamWords.forEach(word => {
    if (lowerHtml.includes(word)) {
      spamScore += 1;
      findings.push(`Spam word found: "${word}"`);
    }
  });

  // Structural checks
  if (html.length < 100) findings.push("Template is too short (might be flagged as spam).");
  if (!html.includes("<img")) findings.push("No images found (plain text emails are okay, but rich templates should have some images).");
  if (html.includes("<img") && !html.includes("alt=")) findings.push("Images found without alt tags (common spam indicator).");
  if (html.includes("<style") && !juice(html).includes("style=")) findings.push("Styles are not inlined (essential for email delivery).");
  if (!html.includes("unsubscribe") && !html.includes("stop")) findings.push("No unsubscribe link or footer found (high spam risk).");

  // HTML Validation
  try {
    const result = await validator({ data: html, format: "json" });
    const errors = result.messages.filter(m => {
      if (m.type !== "error") return false;

      const msg = m.message.toLowerCase();
      // Ignore common email-specific false positives
      if (msg.includes("xmlns:v") || msg.includes("xmlns:o")) return false;
      if (msg.includes("mso-")) return false;
      if (msg.includes("doctype")) return false;
      if (msg.includes("meta") && msg.includes("attribute") && msg.includes("property") && msg.includes("not allowed")) return false;
      if (msg.includes("meta") && msg.includes("missing") && (msg.includes("content") || msg.includes("property"))) return false;

      return true;
    });

    if (errors.length > 0) {
      findings.push(`HTML Syntax Errors (${errors.length}):`);
      errors.forEach(err => {
        findings.push(`- Line ${err.lastLine || err.lastRow || '?'}: ${err.message}`);
      });
      spamScore += errors.length;
    }
  } catch (e) {
    findings.push("HTML Validation failed to run (might be malformed).");
  }

  const passed = spamScore < 5;
  res.json({
    passed,
    spamScore,
    findings,
    webhookStatus,
    requestId,
    status: passed ? "PASS" : "FAIL"
  });
});

app.listen(PORT, HOST, () => {
  console.log(`Dashboard server running on http://${HOST}:${PORT}`);
});
