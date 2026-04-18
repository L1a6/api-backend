const { isApiError } = require("../../lib/errors");
const { createProfile, listProfiles } = require("../../lib/profile-service");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  try {
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
