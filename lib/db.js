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
    return path.join("/tmp", "profiles.db");
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
      sample_size INTEGER NOT NULL,
      age INTEGER NOT NULL,
      age_group TEXT NOT NULL,
      country_id TEXT NOT NULL,
      country_probability REAL NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_profiles_gender ON profiles(gender);
    CREATE INDEX IF NOT EXISTS idx_profiles_country ON profiles(country_id);
    CREATE INDEX IF NOT EXISTS idx_profiles_age_group ON profiles(age_group);
  `);
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
