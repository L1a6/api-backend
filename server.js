const crypto = require("crypto");
const express = require("express");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const { isApiError, ApiError } = require("./lib/errors");
const {
  createProfile,
  getProfileById,
  listProfiles,
  listProfilesForExport,
  searchProfiles,
  deleteProfileById
} = require("./lib/profile-service");
const {
  createOrUpdateUserFromGithub,
  issueTokensForUser,
  rotateRefreshToken,
  revokeRefreshToken,
  verifyAccessToken
} = require("./lib/auth");
const {
  generatePkcePair,
  buildGithubAuthorizeUrl,
  exchangeGithubCode,
  fetchGithubUser,
  fetchGithubEmail
} = require("./lib/oauth");
const {
  storeOAuthState,
  consumeOAuthState,
  cleanupOAuthStates
} = require("./lib/oauth-state");

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "";
const WEB_APP_URL = process.env.WEB_APP_URL || "";
const IS_PRODUCTION = process.env.NODE_ENV === "production";

// ─── Global middleware ────────────────────────────────────────────────────────

app.use((req, res, next) => {
  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    console.log(
      `${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs.toFixed(
        1
      )}ms`
    );
  });

  next();
});

app.use((req, res, next) => {
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
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS"
  );
  next();
});

app.use(cookieParser());
app.use(express.json());

app.options("*", (req, res) => {
  res.status(204).end();
});

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: "error", message: "Too many requests" }
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user ? req.user.id : req.ip),
  message: { status: "error", message: "Too many requests" }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new ApiError(500, `${name} is not configured`);
  }
  return value.trim();
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

  return `http://localhost:${PORT}`;
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

  res.cookie("access_token", accessToken, cookieOptions);
  res.cookie("refresh_token", refreshToken, cookieOptions);

  res.cookie("csrf_token", csrfToken, {
    httpOnly: false,
    sameSite: "lax",
    secure: IS_PRODUCTION,
    path: "/"
  });
}

function clearAuthCookies(res) {
  res.clearCookie("access_token", { path: "/" });
  res.clearCookie("refresh_token", { path: "/" });
  res.clearCookie("csrf_token", { path: "/" });
}

function extractAccessToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && typeof authHeader === "string") {
    const [scheme, value] = authHeader.split(" ");
    if (scheme === "Bearer" && value) {
      return { token: value.trim(), source: "header" };
    }
  }

  if (req.cookies && req.cookies.access_token) {
    return { token: req.cookies.access_token, source: "cookie" };
  }

  return null;
}

function requireApiVersion(req, res, next) {
  const version = req.headers["x-api-version"];
  if (!version) {
    return res.status(400).json({
      status: "error",
      message: "API version header required"
    });
  }

  if (version !== "1") {
    return res.status(400).json({
      status: "error",
      message: "API version header required"
    });
  }

  return next();
}

async function authenticateAccessToken(req, res, next) {
  try {
    const extracted = extractAccessToken(req);
    if (!extracted) {
      throw new ApiError(401, "Missing access token");
    }

    const user = await verifyAccessToken(extracted.token);
    req.user = user;
    req.authSource = extracted.source;
    return next();
  } catch (error) {
    return handleErrorResponse(error, res);
  }
}

function requireCsrfForCookieAuth(req, res, next) {
  const isSafe = ["GET", "HEAD", "OPTIONS"].includes(req.method);
  if (isSafe || req.authSource !== "cookie") {
    return next();
  }

  const csrfHeader = req.headers["x-csrf-token"];
  const csrfCookie = req.cookies && req.cookies.csrf_token;

  if (!csrfHeader || !csrfCookie || csrfHeader !== csrfCookie) {
    return res.status(403).json({
      status: "error",
      message: "Invalid CSRF token"
    });
  }

  return next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ status: "error", message: "Forbidden" });
    }
    return next();
  };
}

function buildPaginationLinks(req, page, limit, totalPages) {
  const basePath = `${req.baseUrl}${req.path}`;

  const makeLink = (targetPage) => {
    const params = new URLSearchParams(req.query);
    params.set("page", String(targetPage));
    params.set("limit", String(limit));
    return `${basePath}?${params.toString()}`;
  };

  return {
    self: makeLink(page),
    next: page < totalPages ? makeLink(page + 1) : null,
    prev: page > 1 && totalPages > 0 ? makeLink(page - 1) : null
  };
}

function csvEscape(value) {
  if (value === null || value === undefined) {
    return "";
  }

  const stringValue = String(value);
  if (/[,"\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

function requiresClientHeader(req) {
  const headerValue = req.headers["x-client"];
  return typeof headerValue === "string" && headerValue === "web";
}

function getRefreshTokenFromRequest(req) {
  if (req.cookies && req.cookies.refresh_token) {
    return { token: req.cookies.refresh_token, source: "cookie" };
  }

  if (req.body && typeof req.body.refresh_token === "string") {
    return { token: req.body.refresh_token.trim(), source: "body" };
  }

  return null;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get("/", (req, res) => {
  res.status(200).json({ status: "success", message: "API is running" });
});

app.use("/auth", authLimiter);

app.get("/auth/github", async (req, res) => {
  try {
    const clientId = requireEnv("GITHUB_CLIENT_ID");

    const stateParam = getSingleQueryParam(req.query.state);
    const codeChallenge = getSingleQueryParam(req.query.code_challenge);
    const redirectUri = getSingleQueryParam(req.query.redirect_uri);

    if (stateParam || codeChallenge || redirectUri) {
      if (!stateParam || !codeChallenge || !redirectUri) {
        throw new ApiError(400, "Missing OAuth parameters");
      }

      validateLoopbackRedirect(redirectUri);
      await cleanupOAuthStates();
      await storeOAuthState(stateParam, codeChallenge, redirectUri);

      const url = buildGithubAuthorizeUrl({
        clientId,
        redirectUri,
        state: stateParam,
        codeChallenge
      });

      return res.redirect(url);
    }

    const { verifier, challenge } = generatePkcePair();
    const state = crypto.randomBytes(16).toString("base64url");

    res.cookie("oauth_state", state, {
      httpOnly: true,
      sameSite: "lax",
      secure: IS_PRODUCTION,
      maxAge: 10 * 60 * 1000,
      path: "/"
    });

    res.cookie("oauth_verifier", verifier, {
      httpOnly: true,
      sameSite: "lax",
      secure: IS_PRODUCTION,
      maxAge: 10 * 60 * 1000,
      path: "/"
    });

    const callbackUrl = `${resolvePublicBaseUrl(req)}/auth/github/callback`;
    const url = buildGithubAuthorizeUrl({
      clientId,
      redirectUri: callbackUrl,
      state,
      codeChallenge: challenge
    });

    return res.redirect(url);
  } catch (error) {
    return handleErrorResponse(error, res);
  }
});

app.get("/auth/github/callback", async (req, res) => {
  try {
    const clientId = requireEnv("GITHUB_CLIENT_ID");
    const clientSecret = requireEnv("GITHUB_CLIENT_SECRET");

    const code = requireQueryParam(req.query.code, "Missing OAuth code");
    const state = requireQueryParam(req.query.state, "Missing OAuth state");
    const oauthState = req.cookies && req.cookies.oauth_state;
    const oauthVerifier = req.cookies && req.cookies.oauth_verifier;

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

    res.clearCookie("oauth_state", { path: "/" });
    res.clearCookie("oauth_verifier", { path: "/" });

    if (isWebFlow) {
      if (!WEB_APP_URL) {
        throw new ApiError(500, "WEB_APP_URL is not configured");
      }

      const csrfToken = crypto.randomBytes(16).toString("base64url");
      setAuthCookies(res, tokens.accessToken, tokens.refreshToken, csrfToken);
      return res.redirect(WEB_APP_URL);
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
  } catch (error) {
    return handleErrorResponse(error, res);
  }
});

app.post("/auth/refresh", async (req, res) => {
  try {
    const refresh = getRefreshTokenFromRequest(req);
    if (!refresh || !refresh.token) {
      throw new ApiError(400, "Missing refresh token");
    }

    if (refresh.source === "cookie") {
      const csrfHeader = req.headers["x-csrf-token"];
      const csrfCookie = req.cookies && req.cookies.csrf_token;
      if (!csrfHeader || !csrfCookie || csrfHeader !== csrfCookie) {
        throw new ApiError(403, "Invalid CSRF token");
      }
    }

    const tokens = await rotateRefreshToken(refresh.token);

    if (refresh.source === "cookie" || requiresClientHeader(req)) {
      const csrfToken = crypto.randomBytes(16).toString("base64url");
      setAuthCookies(res, tokens.accessToken, tokens.refreshToken, csrfToken);
      return res.status(200).json({ status: "success" });
    }

    return res.status(200).json({
      status: "success",
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken
    });
  } catch (error) {
    return handleErrorResponse(error, res);
  }
});

app.post("/auth/logout", async (req, res) => {
  try {
    const refresh = getRefreshTokenFromRequest(req);
    if (!refresh || !refresh.token) {
      throw new ApiError(400, "Missing refresh token");
    }

    if (refresh.source === "cookie") {
      const csrfHeader = req.headers["x-csrf-token"];
      const csrfCookie = req.cookies && req.cookies.csrf_token;
      if (!csrfHeader || !csrfCookie || csrfHeader !== csrfCookie) {
        throw new ApiError(403, "Invalid CSRF token");
      }
    }

    await revokeRefreshToken(refresh.token);
    clearAuthCookies(res);
    return res.status(200).json({ status: "success" });
  } catch (error) {
    return handleErrorResponse(error, res);
  }
});

app.use("/api", authenticateAccessToken, requireCsrfForCookieAuth, apiLimiter);

app.get("/api/users/me", authenticateAccessToken, (req, res) => {
  return res.status(200).json({
    status: "success",
    data: {
      id: req.user.id,
      username: req.user.username,
      role: req.user.role,
      email: req.user.email,
      avatar_url: req.user.avatar_url
    }
  });
});

const profilesRouter = express.Router();
profilesRouter.use(requireApiVersion);

profilesRouter.get("/export", async (req, res) => {
  try {
    const format = getSingleQueryParam(req.query.format);
    if (!format || format.toLowerCase() !== "csv") {
      throw new ApiError(400, "Invalid export format");
    }

    const profiles = await listProfilesForExport(req.query);
    const header =
      "id,name,gender,gender_probability,age,age_group,country_id,country_name,country_probability,created_at";
    const rows = profiles.map((profile) =>
      [
        profile.id,
        profile.name,
        profile.gender,
        profile.gender_probability,
        profile.age,
        profile.age_group,
        profile.country_id,
        profile.country_name,
        profile.country_probability,
        profile.created_at
      ]
        .map(csvEscape)
        .join(",")
    );

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="profiles_${timestamp}.csv"`
    );
    return res.status(200).send([header, ...rows].join("\n"));
  } catch (error) {
    return handleErrorResponse(error, res);
  }
});

profilesRouter.get("/search", async (req, res) => {
  try {
    const result = await searchProfiles(req.query);

    return res.status(200).json({
      status: "success",
      page: result.page,
      limit: result.limit,
      total: result.total,
      total_pages: result.total_pages,
      links: buildPaginationLinks(req, result.page, result.limit, result.total_pages),
      data: result.profiles
    });
  } catch (error) {
    return handleErrorResponse(error, res);
  }
});

profilesRouter.get("/:id", async (req, res) => {
  try {
    const profile = await getProfileById(req.params.id);

    return res.status(200).json({
      status: "success",
      data: profile
    });
  } catch (error) {
    return handleErrorResponse(error, res);
  }
});

profilesRouter.get("/", async (req, res) => {
  try {
    const result = await listProfiles(req.query);

    return res.status(200).json({
      status: "success",
      page: result.page,
      limit: result.limit,
      total: result.total,
      total_pages: result.total_pages,
      links: buildPaginationLinks(req, result.page, result.limit, result.total_pages),
      data: result.profiles
    });
  } catch (error) {
    return handleErrorResponse(error, res);
  }
});

profilesRouter.post("/", requireRole("admin"), async (req, res) => {
  try {
    const result = await createProfile(req.body);

    if (result.alreadyExists) {
      return res.status(200).json({
        status: "success",
        message: "Profile already exists",
        data: result.profile
      });
    }

    return res.status(201).json({
      status: "success",
      data: result.profile
    });
  } catch (error) {
    return handleErrorResponse(error, res);
  }
});

profilesRouter.delete("/:id", requireRole("admin"), async (req, res) => {
  try {
    await deleteProfileById(req.params.id);
    return res.status(204).end();
  } catch (error) {
    return handleErrorResponse(error, res);
  }
});

app.use("/api/profiles", profilesRouter);

// 404 fallthrough
app.use((req, res) => {
  res.status(404).json({ status: "error", message: "Route not found" });
});

// ─── Error handler ────────────────────────────────────────────────────────────

function handleErrorResponse(error, res) {
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
}

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

app.get("/auth/me", authenticateAccessToken, async (req, res) => {
  return res.status(200).json({
    status: "success",
    data: {
      id: req.user.id,
      username: req.user.username,
      role: req.user.role,
      email: req.user.email,
      avatar_url: req.user.avatar_url
    }
  });
});