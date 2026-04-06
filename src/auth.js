import bcrypt from "bcryptjs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { v4 as uuidv4 } from "uuid";
import db from "./sender/models/db.js";

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
