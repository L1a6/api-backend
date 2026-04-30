const { ApiError, isApiError } = require("../lib/errors");
const { verifyAccessToken } = require("../lib/auth");
const { rateLimit } = require("../lib/rate-limit");

module.exports = async function handler(req, res) {
  const start = Date.now();

  try {
    const limitResult = rateLimit({
      key: `users:${req.headers.authorization || req.headers.cookie || req.ip}`,
      limit: 60,
      windowMs: 60 * 1000
    });

    if (!limitResult.allowed) {
      return res.status(429).json({
        status: "error",
        message: "Too many requests"
      });
    }

    const userId = req.query && req.query.user_id;
    if (userId !== "me") {
      return res.status(404).json({
        status: "error",
        message: "Route not found"
      });
    }

    if (req.method !== "GET") {
      return res.status(405).json({
        status: "error",
        message: "Method not allowed"
      });
    }

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

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) {
    return cookies;
  }

  cookieHeader.split(";").forEach((part) => {
    const [key, ...rest] = part.trim().split("=");
    if (!key) return;
    cookies[key] = decodeURIComponent(rest.join("="));
  });

  return cookies;
}
