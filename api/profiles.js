const { isApiError, ApiError } = require("../lib/errors");
const {
  createProfile,
  getProfileById,
  listProfiles,
  deleteProfileById
} = require("../lib/profile-service");

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
        const profiles = await listProfiles(req.query || {});

        return res.status(200).json({
          status: "success",
          count: profiles.length,
          data: profiles
        });
      }

      return res.status(405).json({
        status: "error",
        message: "Method not allowed"
      });
    }

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
