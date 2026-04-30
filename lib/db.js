const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");

let dbPromise;

function resolveDbPath() {
  if (process.env.DB_PATH && process.env.DB_PATH.trim()) {
    return process.env.DB_PATH.trim();
  }

  if (process.env.VERCEL) {
    const tmpPath = path.join("/tmp", "profiles.db");
    const bundledPath = path.join(process.cwd(), "data", "profiles.db");

    // On a cold start /tmp is empty — copy the pre-seeded DB bundle if available
    if (!fs.existsSync(tmpPath) && fs.existsSync(bundledPath)) {
      fs.copyFileSync(bundledPath, tmpPath);
    }

    return tmpPath;
  }

  const dataDirectory = path.join(process.cwd(), "data");
  fs.mkdirSync(dataDirectory, { recursive: true });
  return path.join(dataDirectory, "profiles.db");
}

async function initializeSchema(db) {
  await db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      normalized_name TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      gender TEXT NOT NULL,
      gender_probability REAL NOT NULL,
      sample_size INTEGER NOT NULL DEFAULT 0,
      age INTEGER NOT NULL,
      age_group TEXT NOT NULL,
      country_id TEXT NOT NULL,
      country_name TEXT NOT NULL DEFAULT '',
      country_probability REAL NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_profiles_gender ON profiles(gender);
    CREATE INDEX IF NOT EXISTS idx_profiles_country ON profiles(country_id);
    CREATE INDEX IF NOT EXISTS idx_profiles_age_group ON profiles(age_group);
    CREATE INDEX IF NOT EXISTS idx_profiles_age ON profiles(age);
    CREATE INDEX IF NOT EXISTS idx_profiles_gender_prob ON profiles(gender_probability);
    CREATE INDEX IF NOT EXISTS idx_profiles_country_prob ON profiles(country_probability);
    CREATE INDEX IF NOT EXISTS idx_profiles_created_at ON profiles(created_at);

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      github_id TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL,
      email TEXT,
      avatar_url TEXT,
      role TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      last_login_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_users_github_id ON users(github_id);
    CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
  `);

  // Migration: add country_name column for Stage 1 → Stage 2 upgrades
  const columns = await db.all("PRAGMA table_info(profiles)");
  const columnNames = columns.map((c) => c.name);

  if (!columnNames.includes("country_name")) {
    await db.exec(
      "ALTER TABLE profiles ADD COLUMN country_name TEXT NOT NULL DEFAULT ''"
    );
  }
}

async function getDb() {
  if (!dbPromise) {
    dbPromise = open({
      filename: resolveDbPath(),
      driver: sqlite3.Database,
      mode: sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE
    });

    const db = await dbPromise;
    await initializeSchema(db);
  }

  return dbPromise;
}

module.exports = {
  getDb
};