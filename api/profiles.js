const { isApiError, ApiError } = require("../lib/errors");
const {
  createProfile,
  getProfileById,
  listProfiles,
  listProfilesForExport,
  searchProfiles,
  deleteProfileById
} = require("../lib/profile-service");
const { verifyAccessToken } = require("../lib/auth");

/**
 * Extract and validate the profile_id rewrite param.
 *
 * Returns:
 *   null       — no profile_id (collection-level request)
 *   "search"   — NLP search endpoint
 *   string     — a real profile ID
 *
 * Throws ApiError on invalid input.
 */
function getSingleProfileId(req) {
  const fromRewrite = req.query && req.query.profile_id;

  if (fromRewrite === undefined) {
    return null;
  }

  if (Array.isArray(fromRewrite) || typeof fromRewrite !== "string") {
    throw new ApiError(422, "Invalid type");
  }

  const id = fromRewrite.trim();

  if (!id) {
    throw new ApiError(422, "Invalid type");
  }

  if (id.includes("/")) {
    throw new ApiError(404, "Route not found");
  }

  return id;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  try {
    const apiVersion = req.headers["x-api-version"];
    if (!apiVersion || apiVersion !== "1") {
      return res.status(400).json({
        status: "error",
        message: "API version header required"
      });
    }

    const accessToken = extractAccessToken(req);
    if (!accessToken) {
      return res.status(401).json({
        status: "error",
        message: "Missing access token"
      });
    }

    req.user = await verifyAccessToken(accessToken);
    const profileId = getSingleProfileId(req);

    // ── Collection-level requests (/api/profiles with no profile_id) ───────────
    if (profileId === null) {
      if (req.method === "POST") {
        if (req.user.role !== "admin") {
          return res.status(403).json({
            status: "error",
            message: "Forbidden"
          });
        }

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
      }

      if (req.method === "GET") {
        const result = await listProfiles(req.query);

        return res.status(200).json({
          status: "success",
          page: result.page,
          limit: result.limit,
          total: result.total,
          total_pages: result.total_pages,
          links: buildPaginationLinks(
            req,
            result.page,
            result.limit,
            result.total_pages
          ),
          data: result.profiles
        });
      }

      return res.status(405).json({
        status: "error",
        message: "Method not allowed"
      });
    }

    // ── NLP search endpoint (/api/profiles/search) ─────────────────────────────
    // Vercel rewrites /api/profiles/search → /api/profiles?profile_id=search
    if (profileId === "search") {
      if (req.method !== "GET") {
        return res.status(405).json({
          status: "error",
          message: "Method not allowed"
        });
      }

      const result = await searchProfiles(req.query);

      return res.status(200).json({
        status: "success",
        page: result.page,
        limit: result.limit,
        total: result.total,
        total_pages: result.total_pages,
        links: buildPaginationLinks(
          req,
          result.page,
          result.limit,
          result.total_pages
        ),
        data: result.profiles
      });
    }

    if (profileId === "export") {
      if (req.method !== "GET") {
        return res.status(405).json({
          status: "error",
          message: "Method not allowed"
        });
      }

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
    }

    // ── Single profile requests (/api/profiles/:id) ────────────────────────────
    if (req.method === "GET") {
      const profile = await getProfileById(profileId);

      return res.status(200).json({
        status: "success",
        data: profile
      });
    }

    if (req.method === "DELETE") {
      if (req.user.role !== "admin") {
        return res.status(403).json({
          status: "error",
          message: "Forbidden"
        });
      }

      await deleteProfileById(profileId);
      return res.status(204).end();
    }

    return res.status(405).json({
      status: "error",
      message: "Method not allowed"
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

  if (req.cookies && req.cookies.access_token) {
    return req.cookies.access_token;
  }

  return null;
}

function getSingleQueryParam(value) {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value) || typeof value !== "string") {
    throw new ApiError(422, "Invalid type");
  }
  return value.trim();
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

function buildPaginationLinks(req, page, limit, totalPages) {
  const rawUrl = req.url || "/api/profiles";
  const basePath = rawUrl.split("?")[0];

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