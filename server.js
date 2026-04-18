const express = require("express");
const { isApiError } = require("./lib/errors");
const {
  createProfile,
  getProfileById,
  listProfiles,
  deleteProfileById
} = require("./lib/profile-service");

const app = express();
const PORT = process.env.PORT || 3000;

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  next();
});

app.use(express.json());

app.options("*", (req, res) => {
  res.status(204).end();
});

app.get("/", (req, res) => {
  res.status(200).json({ status: "success", message: "API is running" });
});

app.post("/api/profiles", async (req, res) => {
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

app.get("/api/profiles/:id", async (req, res) => {
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

app.get("/api/profiles", async (req, res) => {
  try {
    const profiles = await listProfiles(req.query);

    return res.status(200).json({
      status: "success",
      count: profiles.length,
      data: profiles
    });
  } catch (error) {
    return handleErrorResponse(error, res);
  }
});

app.delete("/api/profiles/:id", async (req, res) => {
  try {
    await deleteProfileById(req.params.id);
    return res.status(204).end();
  } catch (error) {
    return handleErrorResponse(error, res);
  }
});

app.use((req, res) => {
  res.status(404).json({ status: "error", message: "Route not found" });
});

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

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
