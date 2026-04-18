const { isApiError, ApiError } = require("../../lib/errors");
const {
  createProfile,
  getProfileById,
  listProfiles,
  deleteProfileById
} = require("../../lib/profile-service");

function getPathSegments(query) {
  const id = query && query.id;

  if (id === undefined) {
    return [];
  }

  if (Array.isArray(id)) {
    return id;
  }

  if (typeof id === "string") {
    return [id];
  }

  throw new ApiError(422, "Invalid type");
}

function getSingleIdOrThrow(segments) {
  if (segments.length !== 1) {
    throw new ApiError(404, "Route not found");
  }

  const id = segments[0].trim();
  if (!id) {
    throw new ApiError(422, "Invalid type");
  }

  return id;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  try {
    const segments = getPathSegments(req.query || {});

    if (segments.length === 0) {
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

    const id = getSingleIdOrThrow(segments);

    if (req.method === "GET") {
      const profile = await getProfileById(id);

      return res.status(200).json({
        status: "success",
        data: profile
      });
    }

    if (req.method === "DELETE") {
      await deleteProfileById(id);
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
