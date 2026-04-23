const { isApiError, ApiError } = require("../lib/errors");
const {
  createProfile,
  getProfileById,
  listProfiles,
  searchProfiles,
  deleteProfileById
} = require("../lib/profile-service");

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
    const profileId = getSingleProfileId(req);

    // ── Collection-level requests (/api/profiles with no profile_id) ───────────
    if (profileId === null) {
      if (req.method === "POST") {
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
        data: result.profiles
      });
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