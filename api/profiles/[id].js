const { isApiError, ApiError } = require("../../lib/errors");
const { getProfileById, deleteProfileById } = require("../../lib/profile-service");

function extractId(query) {
  const id = query && query.id;

  if (Array.isArray(id) || typeof id !== "string" || !id.trim()) {
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
    const id = extractId(req.query || {});

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
