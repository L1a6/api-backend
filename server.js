const express = require("express");
const { isApiError } = require("./lib/errors");
const {
  createProfile,
  getProfileById,
  listProfiles,
  searchProfiles,
  deleteProfileById
} = require("./lib/profile-service");

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Global middleware ────────────────────────────────────────────────────────

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  next();
});

app.use(express.json());

app.options("*", (req, res) => {
  res.status(204).end();
});

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get("/", (req, res) => {
  res.status(200).json({ status: "success", message: "API is running" });
});

// POST /api/profiles — Create a new profile
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

// GET /api/profiles/search — Natural language query
// IMPORTANT: must be defined BEFORE /api/profiles/:id so Express matches it first
app.get("/api/profiles/search", async (req, res) => {
  try {
    const result = await searchProfiles(req.query);

    return res.status(200).json({
      status: "success",
      page: result.page,
      limit: result.limit,
      total: result.total,
      data: result.profiles
    });
  } catch (error) {
    return handleErrorResponse(error, res);
  }
});

// GET /api/profiles/:id — Single profile by ID
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

// GET /api/profiles — List profiles with filtering, sorting, pagination
app.get("/api/profiles", async (req, res) => {
  try {
    const result = await listProfiles(req.query);

    return res.status(200).json({
      status: "success",
      page: result.page,
      limit: result.limit,
      total: result.total,
      data: result.profiles
    });
  } catch (error) {
    return handleErrorResponse(error, res);
  }
});

// DELETE /api/profiles/:id — Delete a profile
app.delete("/api/profiles/:id", async (req, res) => {
  try {
    await deleteProfileById(req.params.id);
    return res.status(204).end();
  } catch (error) {
    return handleErrorResponse(error, res);
  }
});

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