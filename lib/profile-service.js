const { v7: uuidv7 } = require("uuid");
const { getDb } = require("./db");
const { ApiError } = require("./errors");

const API_TIMEOUT_MS = 5000;

const GENDERIZE_API = "https://api.genderize.io";
const AGIFY_API = "https://api.agify.io";
const NATIONALIZE_API = "https://api.nationalize.io";

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function getAgeGroup(age) {
  if (age <= 12) {
    return "child";
  }

  if (age <= 19) {
    return "teenager";
  }

  if (age <= 59) {
    return "adult";
  }

  return "senior";
}

function normalizeNameFromBody(body) {
  if (body === undefined || body === null) {
    throw new ApiError(400, "Missing or empty name");
  }

  if (typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(422, "Invalid type");
  }

  if (!Object.prototype.hasOwnProperty.call(body, "name")) {
    throw new ApiError(400, "Missing or empty name");
  }

  if (typeof body.name !== "string") {
    throw new ApiError(422, "Invalid type");
  }

  const trimmed = body.name.trim();
  if (!trimmed) {
    throw new ApiError(400, "Missing or empty name");
  }

  return trimmed.toLowerCase();
}

function normalizeFilterValue(value) {
  if (value === undefined) {
    return null;
  }

  if (Array.isArray(value) || typeof value !== "string") {
    throw new ApiError(422, "Invalid type");
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new ApiError(400, "Invalid query parameter");
  }

  return trimmed.toLowerCase();
}

async function fetchApiJson(url, externalApi) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error("Upstream non-200 response");
    }

    return await response.json();
  } catch (error) {
    throw new ApiError(502, `${externalApi} returned an invalid response`);
  } finally {
    clearTimeout(timeout);
  }
}

function parseGenderize(payload) {
  if (!payload || typeof payload !== "object") {
    throw new ApiError(502, "Genderize returned an invalid response");
  }

  const { gender, probability, count } = payload;

  if (gender === null || count === 0) {
    throw new ApiError(502, "Genderize returned an invalid response");
  }

  if (
    typeof gender !== "string" ||
    !isFiniteNumber(probability) ||
    !isFiniteNumber(count) ||
    probability < 0 ||
    probability > 1 ||
    count < 0
  ) {
    throw new ApiError(502, "Genderize returned an invalid response");
  }

  return {
    gender: gender.toLowerCase(),
    gender_probability: probability,
    sample_size: Math.trunc(count)
  };
}

function parseAgify(payload) {
  if (!payload || typeof payload !== "object") {
    throw new ApiError(502, "Agify returned an invalid response");
  }

  const { age } = payload;
  if (age === null) {
    throw new ApiError(502, "Agify returned an invalid response");
  }

  if (!isFiniteNumber(age) || age < 0) {
    throw new ApiError(502, "Agify returned an invalid response");
  }

  const normalizedAge = Math.trunc(age);

  return {
    age: normalizedAge,
    age_group: getAgeGroup(normalizedAge)
  };
}

function parseNationalize(payload) {
  if (!payload || typeof payload !== "object") {
    throw new ApiError(502, "Nationalize returned an invalid response");
  }

  if (!Array.isArray(payload.country) || payload.country.length === 0) {
    throw new ApiError(502, "Nationalize returned an invalid response");
  }

  let bestCountry = null;

  for (const country of payload.country) {
    if (
      country &&
      typeof country.country_id === "string" &&
      country.country_id.trim() &&
      isFiniteNumber(country.probability)
    ) {
      if (!bestCountry || country.probability > bestCountry.probability) {
        bestCountry = country;
      }
    }
  }

  if (!bestCountry) {
    throw new ApiError(502, "Nationalize returned an invalid response");
  }

  return {
    country_id: bestCountry.country_id.toUpperCase(),
    country_probability: bestCountry.probability
  };
}

function mapProfileRow(row) {
  return {
    id: row.id,
    name: row.name,
    gender: row.gender,
    gender_probability: row.gender_probability,
    sample_size: row.sample_size,
    age: row.age,
    age_group: row.age_group,
    country_id: row.country_id,
    country_probability: row.country_probability,
    created_at: row.created_at
  };
}

async function findProfileByNormalizedName(normalizedName) {
  const db = await getDb();
  const row = await db.get(
    `
    SELECT
      id,
      name,
      gender,
      gender_probability,
      sample_size,
      age,
      age_group,
      country_id,
      country_probability,
      created_at
    FROM profiles
    WHERE normalized_name = ?
    LIMIT 1
    `,
    normalizedName
  );

  return row ? mapProfileRow(row) : null;
}

async function insertProfile(profile) {
  const db = await getDb();
  await db.run(
    `
    INSERT INTO profiles (
      id,
      normalized_name,
      name,
      gender,
      gender_probability,
      sample_size,
      age,
      age_group,
      country_id,
      country_probability,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    profile.id,
    profile.normalized_name,
    profile.name,
    profile.gender,
    profile.gender_probability,
    profile.sample_size,
    profile.age,
    profile.age_group,
    profile.country_id,
    profile.country_probability,
    profile.created_at
  );
}

async function createProfile(body) {
  const normalizedName = normalizeNameFromBody(body);

  const existing = await findProfileByNormalizedName(normalizedName);
  if (existing) {
    return {
      alreadyExists: true,
      profile: existing
    };
  }

  const [genderizePayload, agifyPayload, nationalizePayload] = await Promise.all([
    fetchApiJson(`${GENDERIZE_API}?name=${encodeURIComponent(normalizedName)}`, "Genderize"),
    fetchApiJson(`${AGIFY_API}?name=${encodeURIComponent(normalizedName)}`, "Agify"),
    fetchApiJson(`${NATIONALIZE_API}?name=${encodeURIComponent(normalizedName)}`, "Nationalize")
  ]);

  const genderize = parseGenderize(genderizePayload);
  const agify = parseAgify(agifyPayload);
  const nationalize = parseNationalize(nationalizePayload);

  const profile = {
    id: uuidv7(),
    normalized_name: normalizedName,
    name: normalizedName,
    gender: genderize.gender,
    gender_probability: genderize.gender_probability,
    sample_size: genderize.sample_size,
    age: agify.age,
    age_group: agify.age_group,
    country_id: nationalize.country_id,
    country_probability: nationalize.country_probability,
    created_at: new Date().toISOString()
  };

  try {
    await insertProfile(profile);
  } catch (error) {
    if (String(error && error.message).includes("UNIQUE")) {
      const current = await findProfileByNormalizedName(normalizedName);
      if (current) {
        return {
          alreadyExists: true,
          profile: current
        };
      }
    }

    throw error;
  }

  return {
    alreadyExists: false,
    profile: mapProfileRow(profile)
  };
}

async function getProfileById(id) {
  const db = await getDb();
  const row = await db.get(
    `
    SELECT
      id,
      name,
      gender,
      gender_probability,
      sample_size,
      age,
      age_group,
      country_id,
      country_probability,
      created_at
    FROM profiles
    WHERE id = ?
    LIMIT 1
    `,
    id
  );

  if (!row) {
    throw new ApiError(404, "Profile not found");
  }

  return mapProfileRow(row);
}

async function listProfiles(query) {
  const gender = normalizeFilterValue(query.gender);
  const countryId = normalizeFilterValue(query.country_id);
  const ageGroup = normalizeFilterValue(query.age_group);

  const conditions = [];
  const params = [];

  if (gender) {
    conditions.push("LOWER(gender) = ?");
    params.push(gender);
  }

  if (countryId) {
    conditions.push("LOWER(country_id) = ?");
    params.push(countryId);
  }

  if (ageGroup) {
    conditions.push("LOWER(age_group) = ?");
    params.push(ageGroup);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const db = await getDb();
  const rows = await db.all(
    `
    SELECT
      id,
      name,
      gender,
      age,
      age_group,
      country_id
    FROM profiles
    ${whereClause}
    ORDER BY datetime(created_at) DESC, id DESC
    `,
    ...params
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    gender: row.gender,
    age: row.age,
    age_group: row.age_group,
    country_id: row.country_id
  }));
}

async function deleteProfileById(id) {
  const db = await getDb();
  const result = await db.run("DELETE FROM profiles WHERE id = ?", id);

  if (!result || result.changes === 0) {
    throw new ApiError(404, "Profile not found");
  }
}

module.exports = {
  createProfile,
  getProfileById,
  listProfiles,
  deleteProfileById
};
