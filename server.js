const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;
const GENDERIZE_BASE_URL = "https://api.genderize.io";
const GENDERIZE_TIMEOUT_MS = 5000;

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  next();
});

app.get("/", (req, res) => {
  res.status(200).json({ status: "success", message: "API is running" });
});

app.get("/api/classify", async (req, res) => {
  try {
    const { name } = req.query;

    if (name === undefined) {
      return res.status(400).json({
        status: "error",
        message: "Missing name query parameter"
      });
    }

    if (typeof name !== "string") {
      return res.status(422).json({
        status: "error",
        message: "name must be a string"
      });
    }

    const trimmedName = name.trim();

    if (!trimmedName) {
      return res.status(400).json({
        status: "error",
        message: "name query parameter cannot be empty"
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GENDERIZE_TIMEOUT_MS);

    let upstreamResponse;
    try {
      upstreamResponse = await fetch(
        `${GENDERIZE_BASE_URL}?name=${encodeURIComponent(trimmedName)}`,
        { signal: controller.signal }
      );
    } catch (error) {
      clearTimeout(timeout);
      return res.status(502).json({
        status: "error",
        message: "Failed to fetch prediction from upstream service"
      });
    }

    clearTimeout(timeout);

    if (!upstreamResponse.ok) {
      return res.status(502).json({
        status: "error",
        message: "Upstream service returned an error"
      });
    }

    const payload = await upstreamResponse.json();

    const responseName = payload.name;
    const gender = payload.gender;
    const probability = payload.probability;
    const sampleSize = payload.count;

    if (gender === null || sampleSize === 0) {
      return res.status(422).json({
        status: "error",
        message: "No prediction available for the provided name"
      });
    }

    if (
      typeof responseName !== "string" ||
      typeof gender !== "string" ||
      typeof probability !== "number" ||
      typeof sampleSize !== "number"
    ) {
      return res.status(502).json({
        status: "error",
        message: "Upstream response format was invalid"
      });
    }

    const isConfident = probability >= 0.7 && sampleSize >= 100;

    return res.status(200).json({
      status: "success",
      data: {
        name: responseName,
        gender,
        probability,
        sample_size: sampleSize,
        is_confident: isConfident,
        processed_at: new Date().toISOString()
      }
    });
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: "Internal server error"
    });
  }
});

app.use((req, res) => {
  res.status(404).json({ status: "error", message: "Route not found" });
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
