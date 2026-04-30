const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { v7: uuidv7 } = require("uuid");
const { getDb } = require("./db");
const { ApiError } = require("./errors");

const ACCESS_TOKEN_TTL_SECONDS = parseInt(
  process.env.ACCESS_TOKEN_TTL_SECONDS || "180",
  10
);
const REFRESH_TOKEN_TTL_SECONDS = parseInt(
  process.env.REFRESH_TOKEN_TTL_SECONDS || "300",
  10
);

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new ApiError(500, `${name} is not configured`);
  }
  return value.trim();
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function generateRefreshToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function generateAccessToken(user) {
  const secret = requireEnv("ACCESS_TOKEN_SECRET");
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      username: user.username
    },
    secret,
    { expiresIn: ACCESS_TOKEN_TTL_SECONDS }
  );
}

async function getUserById(userId) {
  const db = await getDb();
  return db.get(
    `SELECT id, github_id, username, email, avatar_url, role, is_active,
            last_login_at, created_at
     FROM users
     WHERE id = ?
     LIMIT 1`,
    userId
  );
}

async function createOrUpdateUserFromGithub(payload) {
  const db = await getDb();
  const now = new Date().toISOString();

  const existing = await db.get(
    `SELECT id, github_id, username, email, avatar_url, role, is_active,
            last_login_at, created_at
     FROM users
     WHERE github_id = ?
     LIMIT 1`,
    payload.github_id
  );

  if (existing) {
    await db.run(
      `UPDATE users
       SET username = ?, email = ?, avatar_url = ?, last_login_at = ?
       WHERE id = ?`,
      payload.username,
      payload.email,
      payload.avatar_url,
      now,
      existing.id
    );

    return {
      ...existing,
      username: payload.username,
      email: payload.email,
      avatar_url: payload.avatar_url,
      last_login_at: now
    };
  }

  const user = {
    id: uuidv7(),
    github_id: payload.github_id,
    username: payload.username,
    email: payload.email,
    avatar_url: payload.avatar_url,
    role: "analyst",
    is_active: 1,
    last_login_at: now,
    created_at: now
  };

  await db.run(
    `INSERT INTO users (
       id, github_id, username, email, avatar_url, role, is_active,
       last_login_at, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    user.id,
    user.github_id,
    user.username,
    user.email,
    user.avatar_url,
    user.role,
    user.is_active,
    user.last_login_at,
    user.created_at
  );

  return user;
}

async function storeRefreshToken(userId, refreshToken) {
  const db = await getDb();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000);

  await db.run(
    `INSERT INTO refresh_tokens (token_hash, user_id, expires_at, revoked_at, created_at)
     VALUES (?, ?, ?, NULL, ?)`,
    hashToken(refreshToken),
    userId,
    expiresAt.toISOString(),
    now.toISOString()
  );

  return expiresAt.toISOString();
}

async function revokeRefreshToken(refreshToken) {
  const db = await getDb();
  const now = new Date().toISOString();
  const tokenHash = hashToken(refreshToken);

  await db.run(
    `UPDATE refresh_tokens
     SET revoked_at = ?
     WHERE token_hash = ? AND revoked_at IS NULL`,
    now,
    tokenHash
  );
}

async function rotateRefreshToken(refreshToken) {
  const db = await getDb();
  const tokenHash = hashToken(refreshToken);
  const row = await db.get(
    `SELECT token_hash, user_id, expires_at, revoked_at
     FROM refresh_tokens
     WHERE token_hash = ?
     LIMIT 1`,
    tokenHash
  );

  if (!row || row.revoked_at) {
    throw new ApiError(401, "Invalid refresh token");
  }

  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw new ApiError(401, "Refresh token expired");
  }

  await revokeRefreshToken(refreshToken);

  const user = await getUserById(row.user_id);
  if (!user) {
    throw new ApiError(401, "User not found");
  }

  if (!user.is_active) {
    throw new ApiError(403, "User is inactive");
  }

  const accessToken = generateAccessToken(user);
  const newRefreshToken = generateRefreshToken();
  await storeRefreshToken(user.id, newRefreshToken);

  return { accessToken, refreshToken: newRefreshToken, user };
}

async function issueTokensForUser(user) {
  if (!user.is_active) {
    throw new ApiError(403, "User is inactive");
  }

  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken();
  await storeRefreshToken(user.id, refreshToken);

  return { accessToken, refreshToken };
}

async function verifyAccessToken(accessToken) {
  const secret = requireEnv("ACCESS_TOKEN_SECRET");

  let payload;
  try {
    payload = jwt.verify(accessToken, secret);
  } catch (error) {
    throw new ApiError(401, "Invalid or expired access token");
  }

  const userId = payload && payload.sub;
  if (!userId) {
    throw new ApiError(401, "Invalid or expired access token");
  }

  const user = await getUserById(userId);
  if (!user) {
    throw new ApiError(401, "User not found");
  }

  if (!user.is_active) {
    throw new ApiError(403, "User is inactive");
  }

  return user;
}

module.exports = {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  createOrUpdateUserFromGithub,
  issueTokensForUser,
  revokeRefreshToken,
  rotateRefreshToken,
  verifyAccessToken
};
