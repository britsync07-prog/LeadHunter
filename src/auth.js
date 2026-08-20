import bcrypt from "bcryptjs";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { v4 as uuidv4 } from "uuid";
import nodemailer from "nodemailer";
import db, { getSetting } from "./sender/models/db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const USERS_FILE = path.join(__dirname, "..", "data", "users.json");

let _migrated = false;

// Seamless 1-time background migration from the flat file to SQLite.
export async function initAuth() {
  if (_migrated) return;
  try {
    const data = await fs.readFile(USERS_FILE, "utf-8");
    const jsonUsers = JSON.parse(data);

    const insert = db.prepare(`INSERT OR IGNORE INTO users (id, username, password, subscriptionPlan) VALUES (?, ?, ?, ?)`);
    const insertMany = db.transaction((users) => {
      for (const user of users) {
        insert.run(uuidv4(), user.username, user.password, user.subscriptionPlan || 'basic');
      }
    });
    insertMany(jsonUsers);

    // Back up the file so we know the migration ran
    await fs.rename(USERS_FILE, USERS_FILE + ".bak");
  } catch (err) {
    // Ignored, usually means file already renamed/deleted
  }

  // Failsafe: if the db is 100% empty, seed the standard admin
  const count = db.prepare("SELECT COUNT(*) as c FROM users").get();
  if (count.c === 0) {
    const hashedPassword = await bcrypt.hash("admin123", 10);
    db.prepare("INSERT INTO users (id, username, password, subscriptionPlan, isAdmin) VALUES (?, ?, ?, ?, 1)").run(uuidv4(), "admin", hashedPassword, "premium");
  }

  _migrated = true;
}

export async function authenticate(username, password) {
  // Migration check is now in server.js startup
  const user = db.prepare("SELECT * FROM users WHERE username = ? OR email = ?").get(username, username);

  if (user && (await bcrypt.compare(password, user.password))) {
    if (user.isSuspended) {
      return { suspended: true };
    }

    let activePlan = user.subscriptionPlan;
    
    return {
      id: user.id,
      username: user.username,
      subscriptionPlan: activePlan,
      email: user.email,
      trialEndsAt: user.trialEndsAt,
      isAdmin: !!user.isAdmin
    };
  }
  return null;
}

export async function registerUser(username, email, password, ipAddress = null) {
  try {
    const existing = db.prepare("SELECT id FROM users WHERE username = ? OR email = ?").get(username, email);
    if (existing) {
      return { error: "Username or email already exists." };
    }

    if (ipAddress) {
      const existingIp = db.prepare("SELECT id FROM users WHERE ipAddress = ?").get(ipAddress);
      if (existingIp) {
        return { error: "An account has already been registered from this IP address." };
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newId = uuidv4();
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 3);
    db.prepare(`
      INSERT INTO users (id, username, email, password, subscriptionPlan, trialEndsAt, ipAddress)
      VALUES (?, ?, ?, ?, 'free', ?, ?)
    `).run(newId, username, email, hashedPassword, trialEndsAt.toISOString(), ipAddress);

    return { success: true, username };
  } catch (error) {
    console.error("[Auth] Registration error:", error);
    return { error: "Internal database error during registration." };
  }
}

export async function changePassword(username, currentPassword, newPassword) {
  const user = await authenticate(username, currentPassword);
  if (!user) {
    return { error: "Incorrect current password." };
  }

  try {
    const hashedNew = await bcrypt.hash(newPassword, 10);
    db.prepare("UPDATE users SET password = ? WHERE id = ?").run(hashedNew, user.id);
    return { success: true };
  } catch (error) {
    console.error("[Auth] Password change error:", error);
    return { error: "Database error while updating password." };
  }
}

export async function adminResetPassword(userId, newPassword) {
  try {
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    db.prepare("UPDATE users SET password = ? WHERE id = ?").run(hashedPassword, userId);
    return { success: true };
  } catch (error) {
    console.error("[Auth] Admin password reset error:", error);
    return { error: "Failed to reset password in database." };
  }
}

/**
 * Retrieves the system SMTP configuration from platform_settings.
 */
export function getSystemSmtpConfig() {
  const host = getSetting('system_smtp_host');
  const port = parseInt(getSetting('system_smtp_port') || '587', 10);
  const secureSetting = getSetting('system_smtp_secure');
  const secure = secureSetting === '1' || port === 465;
  const user = getSetting('system_smtp_user');
  const pass = getSetting('system_smtp_pass');
  const fromName = getSetting('system_smtp_from_name') || 'LeadHunter Security';
  const fromEmail = getSetting('system_smtp_from_email') || user;

  if (!host || !user || !pass) {
    return null;
  }

  return {
    host,
    port,
    secure,
    user,
    pass,
    fromName,
    fromEmail
  };
}

/**
 * Creates a Nodemailer transporter using system SMTP configuration.
 */
export function createSystemTransporter(configOverride = null) {
  const config = configOverride || getSystemSmtpConfig();
  if (!config) {
    throw new Error("System SMTP is not configured. Please contact the administrator.");
  }

  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass
    }
  });
}

/**
 * Dispatches a password reset email to the user.
 */
export async function requestPasswordReset(emailOrUsername, publicBaseUrl) {
  const normalized = String(emailOrUsername || '').trim();
  if (!normalized) {
    return { error: "Please provide your username or email address." };
  }

  // Look up user
  const user = db.prepare("SELECT id, username, email FROM users WHERE username = ? OR email = ?").get(normalized, normalized);
  if (!user || !user.email) {
    // Return friendly generic response to prevent username/email harvesting
    return { success: true, message: "If an account matches that username or email, a reset link has been dispatched." };
  }

  // Check system SMTP configuration
  const smtpConfig = getSystemSmtpConfig();
  if (!smtpConfig) {
    console.error("[Auth] Cannot send password reset: System SMTP is not configured.");
    return { error: "The system email service is currently not configured. Please contact the administrator." };
  }

  try {
    // Generate secure 32-byte cryptographic token
    const token = crypto.randomBytes(32).toString('hex');
    const resetId = uuidv4();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

    // Save token in DB
    db.prepare(`
      INSERT INTO password_resets (id, userId, token, expiresAt)
      VALUES (?, ?, ?, ?)
    `).run(resetId, user.id, token, expiresAt);

    const resetUrl = `${publicBaseUrl.replace(/\/+$/, '')}/reset-password.html?token=${encodeURIComponent(token)}`;

    // Build modern, branded responsive email
    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Reset Your LeadHunter Password</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #0f172a; margin: 0; padding: 0; }
          .container { max-width: 560px; margin: 40px auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
          .header { background: linear-gradient(135deg, #1e1b4b, #312e81); padding: 32px 24px; text-align: center; color: #ffffff; }
          .header h1 { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.02em; }
          .content { padding: 32px 28px; line-height: 1.6; }
          .button { display: inline-block; background: #4f46e5; color: #ffffff !important; text-decoration: none; font-size: 15px; font-weight: 600; padding: 14px 28px; border-radius: 10px; margin: 24px 0; text-align: center; }
          .footer { padding: 20px 28px; background: #f8fafc; border-top: 1px solid #f1f5f9; font-size: 12px; color: #64748b; text-align: center; }
          .code-box { background: #f1f5f9; padding: 12px; border-radius: 8px; font-family: monospace; font-size: 12px; word-break: break-all; color: #334155; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>LeadHunter Security</h1>
          </div>
          <div class="content">
            <p style="font-size: 16px; font-weight: 600; color: #1e293b; margin-top: 0;">Hello ${user.username},</p>
            <p style="color: #475569;">We received a request to reset the password for your LeadHunter account. Click the button below to choose a new password:</p>
            
            <div style="text-align: center;">
              <a href="${resetUrl}" class="button" target="_blank">Reset Password</a>
            </div>

            <p style="color: #64748b; font-size: 13px;">This password reset link is valid for <strong>60 minutes</strong>. If you did not make this request, you can safely ignore this email — your password will remain unchanged.</p>
            
            <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 24px 0;" />
            
            <p style="color: #94a3b8; font-size: 12px; margin-bottom: 6px;">If the button above does not work, copy and paste this link into your browser:</p>
            <div class="code-box">${resetUrl}</div>
          </div>
          <div class="footer">
            &copy; ${new Date().getFullYear()} LeadHunter Platform. All rights reserved.
          </div>
        </div>
      </body>
      </html>
    `;

    const transporter = createSystemTransporter(smtpConfig);
    await transporter.sendMail({
      from: `"${smtpConfig.fromName}" <${smtpConfig.fromEmail}>`,
      to: user.email,
      subject: "Reset Your LeadHunter Password",
      html: emailHtml
    });

    console.log(`[Auth] Password reset email sent to ${user.email} for user ${user.username}`);
    return { success: true, message: "If an account matches that username or email, a reset link has been dispatched." };
  } catch (err) {
    console.error("[Auth] Failed to dispatch password reset email:", err);
    return { error: `Failed to dispatch reset email: ${err.message}` };
  }
}

/**
 * Validates a password reset token.
 */
export function verifyPasswordResetToken(token) {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: "Missing or invalid token." };
  }

  const record = db.prepare(`
    SELECT r.id, r.userId, r.expiresAt, r.usedAt, u.username, u.email
    FROM password_resets r
    JOIN users u ON r.userId = u.id
    WHERE r.token = ?
  `).get(token);

  if (!record) {
    return { valid: false, error: "Invalid password reset link." };
  }

  if (record.usedAt) {
    return { valid: false, error: "This password reset link has already been used." };
  }

  if (new Date(record.expiresAt) < new Date()) {
    return { valid: false, error: "This password reset link has expired. Please request a new one." };
  }

  return { valid: true, username: record.username, email: record.email };
}

/**
 * Completes the password reset using a verified token.
 */
export async function completePasswordReset(token, newPassword) {
  if (!newPassword || newPassword.length < 6) {
    return { error: "Password must be at least 6 characters." };
  }

  const tokenCheck = verifyPasswordResetToken(token);
  if (!tokenCheck.valid) {
    return { error: tokenCheck.error };
  }

  try {
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    const record = db.prepare("SELECT id, userId FROM password_resets WHERE token = ?").get(token);

    db.transaction(() => {
      db.prepare("UPDATE users SET password = ? WHERE id = ?").run(hashedPassword, record.userId);
      db.prepare("UPDATE password_resets SET usedAt = CURRENT_TIMESTAMP WHERE id = ?").run(record.id);
    })();

    console.log(`[Auth] Password successfully reset for user ${tokenCheck.username}`);
    return { success: true, message: "Password updated successfully." };
  } catch (err) {
    console.error("[Auth] Complete password reset error:", err);
    return { error: "Database error while updating password." };
  }
}

export function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    const fresh = db.prepare("SELECT isSuspended FROM users WHERE id = ?").get(req.session.user.id);
    if (fresh && fresh.isSuspended) {
      req.session.destroy();
      return res.status(403).json({ error: "Your account has been suspended. Please contact support." });
    }
    return next();
  }
  return res.status(401).json({ error: "Unauthorized" });
}
