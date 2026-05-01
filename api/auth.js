const crypto = require("crypto");
const { ApiError, isApiError } = require("../lib/errors");
const {
  createOrUpdateUserFromGithub,
  issueTokensForUser,
  rotateRefreshToken,
  revokeRefreshToken,
  verifyAccessToken
} = require("../lib/auth");
const {
  buildGithubAuthorizeUrl,
  exchangeGithubCode,
  fetchGithubUser,
  fetchGithubEmail
} = require("../lib/oauth");
const {
  storeOAuthState,
  consumeOAuthState,
  cleanupOAuthStates
} = require("../lib/oauth-state");
const { rateLimit } = require("../lib/rate-limit");

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "";
const WEB_APP_URL = process.env.WEB_APP_URL || "";
const IS_PRODUCTION = process.env.NODE_ENV === "production";

module.exports = async function handler(req, res) {
  const start = Date.now();

  applyCors(req, res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  try {
    const path = normalizePath(req.query && req.query.path);

    if (path === "github" && req.method !== "GET") {
      return methodNotAllowed(res);
    }

    if (path === "github/callback" && req.method !== "GET") {
      return methodNotAllowed(res);
    }

    if (path === "refresh" && req.method !== "POST") {
      return methodNotAllowed(res);
    }

    if (path === "logout" && req.method !== "POST") {
      return methodNotAllowed(res);
    }

    if (path === "me" && req.method !== "GET") {
      return methodNotAllowed(res);
    }

    if (req.method === "GET" && path === "github") {
      return handleGithubAuth(req, res);
    }

    if (req.method === "GET" && path === "github/callback") {
      return handleGithubCallback(req, res);
    }

    if (req.method === "POST" && path === "refresh") {
      return handleRefresh(req, res);
    }

    if (req.method === "POST" && path === "logout") {
      return handleLogout(req, res);
    }

    if (req.method === "GET" && path === "me") {
      return handleMe(req, res);
    }

    return res.status(404).json({ status: "error", message: "Route not found" });
  } catch (error) {
    if (isApiError(error)) {
      return res.status(error.statusCode).json({
        status: "error",
        message: error.message
      });
    }

    console.error(error);
    return res.status(500).json({
      status: "error",
      message: "Internal server error"
    });
  } finally {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.url} ${res.statusCode} ${duration}ms`);
  }
};

function applyCors(req, res) {
  const origin = req.headers.origin;
  const allowedOrigin = WEB_APP_URL && WEB_APP_URL.trim();

  if (origin && allowedOrigin && origin === allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-API-Version, X-CSRF-Token, X-Client"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

function methodNotAllowed(res) {
  return res.status(405).json({
    status: "error",
    message: "Method not allowed"
  });
}

function ensureRateLimit(req, res, scope) {
  const clientKey = getClientKey(req);
  const rateKey = `${req.method}:${scope}`;
  const limitResult = rateLimit({
    key: `auth:${clientKey}:${rateKey}`,
    limit: parseInt(process.env.AUTH_RATE_LIMIT_MAX || "1000", 10),
    windowMs: 60 * 1000
  });

  if (!limitResult.allowed) {
    return res.status(429).json({
      status: "error",
      message: "Too many requests"
    });
  }

  return null;
}

function getClientKey(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }

  const realIp = req.headers["x-real-ip"];
  if (typeof realIp === "string" && realIp.trim()) {
    return realIp.trim();
  }

  const vercelIp = req.headers["x-vercel-ip"];
  if (typeof vercelIp === "string" && vercelIp.trim()) {
    return vercelIp.trim();
  }

  if (req.socket && typeof req.socket.remoteAddress === "string") {
    return req.socket.remoteAddress;
  }

  if (req.connection && typeof req.connection.remoteAddress === "string") {
    return req.connection.remoteAddress;
  }

  return "unknown";
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new ApiError(500, `${name} is not configured`);
  }
  return value.trim();
}

function normalizePath(pathParam) {
  if (!pathParam) return "";
  if (Array.isArray(pathParam)) {
    return pathParam.join("/").replace(/^\/+|\/+$/g, "");
  }
  return String(pathParam).replace(/^\/+|\/+$/g, "");
}

function getSingleQueryParam(value) {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value) || typeof value !== "string") {
    throw new ApiError(422, "Invalid type");
  }
  return value.trim();
}

function requireQueryParam(value, message) {
  const trimmed = getSingleQueryParam(value);
  if (!trimmed) {
    throw new ApiError(400, message);
  }
  return trimmed;
}

function validateLoopbackRedirect(redirectUri) {
  let parsed;
  try {
    parsed = new URL(redirectUri);
  } catch (error) {
    throw new ApiError(400, "Invalid redirect URI");
  }

  const hostname = parsed.hostname;
  const isLoopback = hostname === "localhost" || hostname === "127.0.0.1";

  if (parsed.protocol !== "http:" || !isLoopback) {
    throw new ApiError(400, "Invalid redirect URI");
  }
}

function setAuthCookies(res, accessToken, refreshToken, csrfToken) {
  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax",
    secure: IS_PRODUCTION,
    path: "/"
  };

  res.setHeader("Set-Cookie", [
    buildCookie("access_token", accessToken, cookieOptions),
    buildCookie("refresh_token", refreshToken, cookieOptions),
    buildCookie("csrf_token", csrfToken, {
      ...cookieOptions,
      httpOnly: false
    })
  ]);
}

function clearAuthCookies(res) {
  res.setHeader("Set-Cookie", [
    buildCookie("access_token", "", { path: "/", maxAge: 0 }),
    buildCookie("refresh_token", "", { path: "/", maxAge: 0 }),
    buildCookie("csrf_token", "", { path: "/", maxAge: 0 })
  ]);
}

function buildCookie(name, value, options) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;

  cookieHeader.split(";").forEach((part) => {
    const [key, ...rest] = part.trim().split("=");
    if (!key) return;
    cookies[key] = decodeURIComponent(rest.join("="));
  });

  return cookies;
}

async function handleGithubAuth(req, res) {
  const stateParam = getSingleQueryParam(req.query.state);
  const codeChallenge = getSingleQueryParam(req.query.code_challenge);
  const redirectUri = getSingleQueryParam(req.query.redirect_uri);

  if (stateParam || codeChallenge || redirectUri) {
    if (!stateParam || !codeChallenge || !redirectUri) {
      throw new ApiError(400, "Missing OAuth parameters");
    }

    validateLoopbackRedirect(redirectUri);
    if (ensureRateLimit(req, res, "github")) {
      return;
    }

    const clientId = requireEnv("GITHUB_CLIENT_ID");
    await cleanupOAuthStates();
    await storeOAuthState(stateParam, codeChallenge, redirectUri);

    const url = buildGithubAuthorizeUrl({
      clientId,
      redirectUri,
      state: stateParam,
      codeChallenge
    });

    res.statusCode = 302;
    res.setHeader("Location", url);
    return res.end();
  }

  if (ensureRateLimit(req, res, "github")) {
    return;
  }

  const clientId = requireEnv("GITHUB_CLIENT_ID");
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  const state = crypto.randomBytes(16).toString("base64url");

  res.setHeader("Set-Cookie", [
    buildCookie("oauth_state", state, {
      httpOnly: true,
      sameSite: "lax",
      secure: IS_PRODUCTION,
      path: "/",
      maxAge: 600
    }),
    buildCookie("oauth_verifier", verifier, {
      httpOnly: true,
      sameSite: "lax",
      secure: IS_PRODUCTION,
      path: "/",
      maxAge: 600
    })
  ]);

  const callbackUrl = `${resolvePublicBaseUrl(req)}/auth/github/callback`;
  const url = buildGithubAuthorizeUrl({
    clientId,
    redirectUri: callbackUrl,
    state,
    codeChallenge: challenge
  });

  res.statusCode = 302;
  res.setHeader("Location", url);
  return res.end();
}

async function handleGithubCallback(req, res) {
  const code = requireQueryParam(req.query.code, "Missing OAuth code");
  const state = requireQueryParam(req.query.state, "Missing OAuth state");
  const cookies = parseCookies(req.headers.cookie);
  const oauthState = cookies.oauth_state;
  const oauthVerifier = cookies.oauth_verifier;

  let codeVerifier = null;
  let redirectUri = null;
  let isWebFlow = false;

  if (oauthState || oauthVerifier) {
    if (state !== oauthState) {
      throw new ApiError(401, "Invalid OAuth state");
    }
    if (!oauthVerifier) {
      throw new ApiError(401, "Missing OAuth verifier");
    }

    codeVerifier = oauthVerifier;
    redirectUri = `${resolvePublicBaseUrl(req)}/auth/github/callback`;
    isWebFlow = true;
  } else {
    codeVerifier = requireQueryParam(
      req.query.code_verifier,
      "Missing code verifier"
    );
    redirectUri = requireQueryParam(
      req.query.redirect_uri,
      "Missing redirect URI"
    );
    validateLoopbackRedirect(redirectUri);

    const oauthState = await consumeOAuthState(state);
    if (!oauthState) {
      throw new ApiError(401, "Invalid OAuth state");
    }

    if (oauthState.redirect_uri !== redirectUri) {
      throw new ApiError(401, "Invalid OAuth state");
    }

    const computedChallenge = crypto
      .createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");

    if (computedChallenge !== oauthState.code_challenge) {
      throw new ApiError(401, "Invalid code verifier");
    }
  }

  if (ensureRateLimit(req, res, "github/callback")) {
    return;
  }

  const clientId = requireEnv("GITHUB_CLIENT_ID");
  const clientSecret = requireEnv("GITHUB_CLIENT_SECRET");

  const accessToken = await exchangeGithubCode({
    clientId,
    clientSecret,
    code,
    redirectUri,
    codeVerifier
  });

  const githubUser = await fetchGithubUser(accessToken);
  const email = await fetchGithubEmail(accessToken);

  const user = await createOrUpdateUserFromGithub({
    github_id: String(githubUser.id),
    username: githubUser.login,
    email,
    avatar_url: githubUser.avatar_url || ""
  });

  const tokens = await issueTokensForUser(user);

  if (isWebFlow) {
    if (!WEB_APP_URL) {
      throw new ApiError(500, "WEB_APP_URL is not configured");
    }

    const csrfToken = crypto.randomBytes(16).toString("base64url");
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken, csrfToken);
    res.statusCode = 302;
    res.setHeader("Location", WEB_APP_URL);
    return res.end();
  }

  return res.status(200).json({
    status: "success",
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      email: user.email,
      avatar_url: user.avatar_url
    }
  });
}

async function handleRefresh(req, res) {
  const body = await readJsonBody(req);
  const cookies = parseCookies(req.headers.cookie);
  const refreshToken = cookies.refresh_token || body.refresh_token;

  if (!refreshToken) {
    throw new ApiError(400, "Missing refresh token");
  }

  if (cookies.refresh_token) {
    const csrfHeader = req.headers["x-csrf-token"];
    if (!csrfHeader || csrfHeader !== cookies.csrf_token) {
      throw new ApiError(403, "Invalid CSRF token");
    }
  }

  if (ensureRateLimit(req, res, "refresh")) {
    return;
  }

  const tokens = await rotateRefreshToken(refreshToken);

  if (cookies.refresh_token) {
    const csrfToken = crypto.randomBytes(16).toString("base64url");
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken, csrfToken);
    return res.status(200).json({ status: "success" });
  }

  return res.status(200).json({
    status: "success",
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken
  });
}

async function handleLogout(req, res) {
  const body = await readJsonBody(req);
  const cookies = parseCookies(req.headers.cookie);
  const refreshToken = cookies.refresh_token || body.refresh_token;

  if (!refreshToken) {
    throw new ApiError(400, "Missing refresh token");
  }

  if (cookies.refresh_token) {
    const csrfHeader = req.headers["x-csrf-token"];
    if (!csrfHeader || csrfHeader !== cookies.csrf_token) {
      throw new ApiError(403, "Invalid CSRF token");
    }
  }

  if (ensureRateLimit(req, res, "logout")) {
    return;
  }

  await revokeRefreshToken(refreshToken);
  clearAuthCookies(res);
  return res.status(200).json({ status: "success" });
}

async function handleMe(req, res) {
  const accessToken = extractAccessToken(req);
  if (!accessToken) {
    throw new ApiError(401, "Missing access token");
  }

  const user = await verifyAccessToken(accessToken);
  return res.status(200).json({
    status: "success",
    data: {
      id: user.id,
      username: user.username,
      role: user.role,
      email: user.email,
      avatar_url: user.avatar_url
    }
  });
}

function extractAccessToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && typeof authHeader === "string") {
    const [scheme, value] = authHeader.split(" ");
    if (scheme === "Bearer" && value) {
      return value.trim();
    }
  }

  const cookies = parseCookies(req.headers.cookie);
  if (cookies.access_token) {
    return cookies.access_token;
  }

  return null;
}

function resolvePublicBaseUrl(req) {
  if (PUBLIC_BASE_URL && PUBLIC_BASE_URL.trim()) {
    return PUBLIC_BASE_URL.trim().replace(/\/$/, "");
  }

  const proto = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  if (host) {
    return `${proto}://${host}`;
  }

  return "http://localhost:3000";
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      if (!body) {
        return resolve({});
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new ApiError(400, "Invalid JSON"));
      }
    });
  });
}
