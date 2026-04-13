const GENDERIZE_BASE_URL = "https://api.genderize.io";
const GENDERIZE_TIMEOUT_MS = 5000;

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method !== "GET") {
    return res.status(405).json({
      status: "error",
      message: "Method not allowed"
    });
  }

  try {
    const rawName = req.query?.name;

    if (rawName === undefined) {
      return res.status(400).json({
        status: "error",
        message: "Missing name query parameter"
      });
    }

    if (Array.isArray(rawName) || typeof rawName !== "string") {
      return res.status(422).json({
        status: "error",
        message: "name must be a string"
      });
    }

    const trimmedName = rawName.trim();

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
};
