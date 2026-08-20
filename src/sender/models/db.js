import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure the data directory exists
const dataDir = path.join(__dirname, '../../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize SQLite database
const dbPath = path.join(dataDir, 'sender.db');
const db = new Database(dbPath);

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');

// Define the schemas
const initDb = () => {
  // Users Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE,
      password TEXT NOT NULL,
      subscriptionPlan TEXT DEFAULT 'none', -- 'none', 'basic', 'advance', 'premium'
      trialEndsAt DATETIME,      stripeCustomerId TEXT,
      isAdmin INTEGER DEFAULT 0,
      isSuspended INTEGER DEFAULT 0,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Campaigns Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT DEFAULT 'draft', -- 'draft', 'sending', 'completed', 'aborted'
      abortReason TEXT,
      deliveredCount INTEGER DEFAULT 0,
      bouncedCount INTEGER DEFAULT 0,
      sentReportFile TEXT,
      failedReportFile TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Recipients Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS recipients (
      id TEXT PRIMARY KEY,
      campaignId TEXT NOT NULL,
      email TEXT NOT NULL,
      status TEXT DEFAULT 'pending', -- 'pending', 'sent', 'delivered', 'bounced'
      error TEXT,
      sentAt DATETIME,
      currentStep INTEGER DEFAULT 0,
      nextSendAt DATETIME,
      FOREIGN KEY (campaignId) REFERENCES campaigns(id) ON DELETE CASCADE
    )
  `);

  // SMTP accounts for admin multi-sender rotation
  db.exec(`
    CREATE TABLE IF NOT EXISTS smtp_accounts (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      user TEXT NOT NULL,
      pass TEXT NOT NULL,
      consecutiveFails INTEGER DEFAULT 0,
      restingUntil DATETIME,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Event Logs Table (Designed for high volume inserts)
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_logs (
      id TEXT PRIMARY KEY,
      eventId TEXT NOT NULL, -- Corresponds to a specific tracking pixel or link
      campaignId TEXT NOT NULL,
      recipientId TEXT NOT NULL,
      eventType TEXT NOT NULL, -- 'OPEN', 'CLICK', 'DELIVERED', 'BOUNCED', 'WEBSITE_VISIT'
      url TEXT, -- Used for clicks and website visits
      ipAddress TEXT,
      userAgent TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (campaignId) REFERENCES campaigns(id) ON DELETE CASCADE,
      FOREIGN KEY (recipientId) REFERENCES recipients(id) ON DELETE CASCADE
    )
  `);

  // Scraper Job History Table (Replacing in-memory history.json)
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      categoryId TEXT, -- Added for campaign association
      status TEXT DEFAULT 'queued', -- 'queued', 'running', 'completed', 'failed', 'stopped'
      params TEXT, -- JSON string
      events TEXT, -- JSON string
      files TEXT,  -- JSON string
      leadsFound INTEGER DEFAULT 0,
      phonesFound INTEGER DEFAULT 0,
      error TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // User Categories Table (Replacing in-memory categories.json)
  db.exec(`
    CREATE TABLE IF NOT EXISTS job_categories (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      name TEXT NOT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Auto-Mail Templates Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS auto_mail_templates (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      name TEXT NOT NULL,
      senderName TEXT NOT NULL,
      subject TEXT NOT NULL,
      htmlContent TEXT NOT NULL,
      smtpAccountIds TEXT, -- JSON array of SMTP IDs
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Saved Auto-Mail Sequences
  db.exec(`
    CREATE TABLE IF NOT EXISTS saved_sequences (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      name TEXT NOT NULL,
      config TEXT NOT NULL, -- JSON string storing { sequences: [], smtpAccountIds: [] }
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Master Leaded Table for Global Duplicate Filtering
  db.exec(`
    CREATE TABLE IF NOT EXISTS scraped_leads_master (
      id TEXT PRIMARY KEY,
      value TEXT UNIQUE, -- email or phone
      type TEXT,         -- 'email' or 'phone'
      jobId TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create indexes for fast analytical query performance
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_event_logs_campaignId ON event_logs(campaignId);
    CREATE INDEX IF NOT EXISTS idx_event_logs_recipientId ON event_logs(recipientId);
    CREATE INDEX IF NOT EXISTS idx_event_logs_eventType ON event_logs(eventType);
    CREATE INDEX IF NOT EXISTS idx_smtp_accounts_userId ON smtp_accounts(userId);
    CREATE INDEX IF NOT EXISTS idx_jobs_userId ON jobs(userId);
    CREATE INDEX IF NOT EXISTS idx_job_categories_userId ON job_categories(userId);
    CREATE INDEX IF NOT EXISTS idx_auto_mail_templates_userId ON auto_mail_templates(userId);
  `);

  // Safe schema migration for existing DBs
  const safeAlter = (sql) => {
    try { db.exec(sql); } catch { }
  };

  safeAlter(`ALTER TABLE users ADD COLUMN isAdmin INTEGER DEFAULT 0`);
  safeAlter(`ALTER TABLE users ADD COLUMN isSuspended INTEGER DEFAULT 0`);
  safeAlter(`ALTER TABLE users ADD COLUMN ipAddress TEXT`);

  safeAlter(`ALTER TABLE jobs ADD COLUMN phonesFound INTEGER DEFAULT 0`);
  safeAlter(`ALTER TABLE jobs ADD COLUMN autoMailConfig TEXT`);
  safeAlter(`ALTER TABLE jobs ADD COLUMN categoryId TEXT`);

  safeAlter(`ALTER TABLE campaigns ADD COLUMN abortReason TEXT`);
  safeAlter(`ALTER TABLE campaigns ADD COLUMN deliveredCount INTEGER DEFAULT 0`);
  safeAlter(`ALTER TABLE campaigns ADD COLUMN bouncedCount INTEGER DEFAULT 0`);
  safeAlter(`ALTER TABLE campaigns ADD COLUMN sentReportFile TEXT`);
  safeAlter(`ALTER TABLE campaigns ADD COLUMN failedReportFile TEXT`);
  safeAlter(`ALTER TABLE campaigns ADD COLUMN config TEXT`); // JSON string

  safeAlter(`ALTER TABLE recipients ADD COLUMN error TEXT`);
  safeAlter(`ALTER TABLE recipients ADD COLUMN currentStep INTEGER DEFAULT 0`);
  safeAlter(`ALTER TABLE recipients ADD COLUMN nextSendAt DATETIME`);

  // Platform-wide settings table (admin-controlled toggles, feature flags, etc.)
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
  // Seed defaults — both tracking features ON
  db.exec(`
    INSERT OR IGNORE INTO platform_settings (key, value) VALUES ('openTrackingEnabled',  '1');
    INSERT OR IGNORE INTO platform_settings (key, value) VALUES ('clickTrackingEnabled', '1');
  `);

  // Password Resets Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      expiresAt DATETIME NOT NULL,
      usedAt DATETIME,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token);
    CREATE INDEX IF NOT EXISTS idx_password_resets_userId ON password_resets(userId);
  `);
};

initDb();

/**
 * Read a platform setting by key. Returns defaultValue if not found.
 * @param {string} key
 * @param {string|null} defaultValue
 * @returns {string|null}
 */
export function getSetting(key, defaultValue = null) {
  const row = db.prepare('SELECT value FROM platform_settings WHERE key = ?').get(key);
  return row ? row.value : defaultValue;
}

/**
 * Write (upsert) a platform setting.
 * @param {string} key
 * @param {string|number|boolean} value
 */
export function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO platform_settings (key, value) VALUES (?, ?)').run(key, String(value));
}

export default db;
