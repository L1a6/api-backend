const { getDb } = require("./db");

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

async function storeOAuthState(state, codeChallenge, redirectUri) {
  const db = await getDb();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + OAUTH_STATE_TTL_MS);

  await db.run(
    `INSERT OR REPLACE INTO oauth_states
       (state, code_challenge, redirect_uri, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    state,
    codeChallenge,
    redirectUri,
    expiresAt.toISOString(),
    now.toISOString()
  );

  await cleanupOAuthStates();
}

async function consumeOAuthState(state) {
  const db = await getDb();
  const row = await db.get(
    `SELECT state, code_challenge, redirect_uri, expires_at
     FROM oauth_states
     WHERE state = ?
     LIMIT 1`,
    state
  );

  if (!row) {
    return null;
  }

  await db.run("DELETE FROM oauth_states WHERE state = ?", state);

  if (new Date(row.expires_at).getTime() < Date.now()) {
    return null;
  }

  return row;
}

async function cleanupOAuthStates() {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.run("DELETE FROM oauth_states WHERE expires_at < ?", now);
}

module.exports = {
  storeOAuthState,
  consumeOAuthState,
  cleanupOAuthStates
};
