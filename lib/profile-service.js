const { v7: uuidv7 } = require("uuid");
const { getDb } = require("./db");
const { ApiError } = require("./errors");

const API_TIMEOUT_MS = 5000;

const GENDERIZE_API = "https://api.genderize.io";
const AGIFY_API = "https://api.agify.io";
const NATIONALIZE_API = "https://api.nationalize.io";

// ─── Country name → ISO 2-letter code map (for NLP parsing) ───────────────────
const COUNTRY_NAME_TO_ID = {
  // Africa
  angola: "AO",
  benin: "BJ",
  botswana: "BW",
  "burkina faso": "BF",
  burundi: "BI",
  cameroon: "CM",
  "cape verde": "CV",
  chad: "TD",
  comoros: "KM",
  "democratic republic of congo": "CD",
  "dr congo": "CD",
  djibouti: "DJ",
  egypt: "EG",
  eritrea: "ER",
  eswatini: "SZ",
  ethiopia: "ET",
  gabon: "GA",
  gambia: "GM",
  ghana: "GH",
  guinea: "GN",
  "guinea-bissau": "GW",
  "ivory coast": "CI",
  "cote d'ivoire": "CI",
  kenya: "KE",
  lesotho: "LS",
  liberia: "LR",
  libya: "LY",
  madagascar: "MG",
  malawi: "MW",
  mali: "ML",
  mauritania: "MR",
  mauritius: "MU",
  morocco: "MA",
  mozambique: "MZ",
  namibia: "NA",
  niger: "NE",
  nigeria: "NG",
  rwanda: "RW",
  "republic of the congo": "CG",
  congo: "CG",
  senegal: "SN",
  seychelles: "SC",
  "sierra leone": "SL",
  somalia: "SO",
  "south africa": "ZA",
  sudan: "SD",
  "south sudan": "SS",
  swaziland: "SZ",
  tanzania: "TZ",
  togo: "TG",
  tunisia: "TN",
  uganda: "UG",
  zambia: "ZM",
  zimbabwe: "ZW",
  // Americas
  argentina: "AR",
  australia: "AU",
  bolivia: "BO",
  brazil: "BR",
  canada: "CA",
  chile: "CL",
  colombia: "CO",
  ecuador: "EC",
  mexico: "MX",
  "new zealand": "NZ",
  paraguay: "PY",
  peru: "PE",
  "united states": "US",
  usa: "US",
  america: "US",
  uruguay: "UY",
  venezuela: "VE",
  // Europe
  belgium: "BE",
  denmark: "DK",
  finland: "FI",
  france: "FR",
  germany: "DE",
  italy: "IT",
  netherlands: "NL",
  norway: "NO",
  poland: "PL",
  portugal: "PT",
  russia: "RU",
  spain: "ES",
  sweden: "SE",
  switzerland: "CH",
  turkey: "TR",
  ukraine: "UA",
  "united kingdom": "GB",
  uk: "GB",
  britain: "GB",
  england: "GB",
  // Asia
  bangladesh: "BD",
  china: "CN",
  india: "IN",
  indonesia: "ID",
  iran: "IR",
  iraq: "IQ",
  israel: "IL",
  japan: "JP",
  jordan: "JO",
  lebanon: "LB",
  malaysia: "MY",
  pakistan: "PK",
  philippines: "PH",
  "saudi arabia": "SA",
  singapore: "SG",
  "south korea": "KR",
  thailand: "TH",
  vietnam: "VN"
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function getAgeGroup(age) {
  if (age <= 12) return "child";
  if (age <= 19) return "teenager";
  if (age <= 59) return "adult";
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

/**
 * Parse a string filter query param. Returns null if absent, throws on invalid.
 */
function parseFilterString(value, fieldName) {
  if (value === undefined || value === null) return null;

  if (Array.isArray(value) || typeof value !== "string") {
    throw new ApiError(422, "Invalid query parameters");
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new ApiError(400, "Invalid query parameters");
  }

  return trimmed.toLowerCase();
}

/**
 * Parse an integer filter query param. Returns null if absent, throws on invalid.
 */
function parseFilterInt(value) {
  if (value === undefined || value === null) return null;

  if (Array.isArray(value) || typeof value !== "string") {
    throw new ApiError(422, "Invalid query parameters");
  }

  const trimmed = value.trim();
  const num = parseInt(trimmed, 10);

  if (isNaN(num) || String(num) !== trimmed) {
    throw new ApiError(400, "Invalid query parameters");
  }

  return num;
}

/**
 * Parse a float filter query param. Returns null if absent, throws on invalid.
 */
function parseFilterFloat(value) {
  if (value === undefined || value === null) return null;

  if (Array.isArray(value) || typeof value !== "string") {
    throw new ApiError(422, "Invalid query parameters");
  }

  const num = parseFloat(value.trim());

  if (isNaN(num)) {
    throw new ApiError(400, "Invalid query parameters");
  }

  return num;
}

/**
 * Parse a pagination integer param. Returns defaultVal if absent, throws on invalid.
 */
function parsePaginationInt(value, defaultVal, max) {
  if (value === undefined || value === null) return defaultVal;

  if (Array.isArray(value) || typeof value !== "string") {
    throw new ApiError(400, "Invalid query parameters");
  }

  const num = parseInt(value.trim(), 10);

  if (isNaN(num) || num < 1) {
    throw new ApiError(400, "Invalid query parameters");
  }

  return max ? Math.min(num, max) : num;
}

function parseSortParams(query) {
  const VALID_SORT_BY = ["age", "created_at", "gender_probability"];
  const VALID_ORDER = ["asc", "desc"];

  const sortByRaw = query.sort_by;
  const orderRaw = query.order;

  const sortBy = sortByRaw ? sortByRaw.toLowerCase() : "created_at";
  const order = orderRaw ? orderRaw.toLowerCase() : "desc";

  if (sortByRaw !== undefined && !VALID_SORT_BY.includes(sortBy)) {
    throw new ApiError(400, "Invalid query parameters");
  }

  if (orderRaw !== undefined && !VALID_ORDER.includes(order)) {
    throw new ApiError(400, "Invalid query parameters");
  }

  const sortColumnMap = {
    age: "age",
    created_at: "created_at",
    gender_probability: "gender_probability"
  };

  return {
    sortColumn: sortColumnMap[sortBy],
    sortDirection: order === "asc" ? "ASC" : "DESC"
  };
}

function buildFilterConditions(query) {
  const gender = parseFilterString(query.gender);
  const ageGroup = parseFilterString(query.age_group);
  const countryId = parseFilterString(query.country_id);
  const minAge = parseFilterInt(query.min_age);
  const maxAge = parseFilterInt(query.max_age);
  const minGenderProbability = parseFilterFloat(query.min_gender_probability);
  const minCountryProbability = parseFilterFloat(query.min_country_probability);

  const conditions = [];
  const params = [];

  if (gender !== null) {
    conditions.push("LOWER(gender) = ?");
    params.push(gender);
  }

  if (ageGroup !== null) {
    conditions.push("LOWER(age_group) = ?");
    params.push(ageGroup);
  }

  if (countryId !== null) {
    conditions.push("UPPER(country_id) = ?");
    params.push(countryId.toUpperCase());
  }

  if (minAge !== null) {
    conditions.push("age >= ?");
    params.push(minAge);
  }

  if (maxAge !== null) {
    conditions.push("age <= ?");
    params.push(maxAge);
  }

  if (minGenderProbability !== null) {
    conditions.push("gender_probability >= ?");
    params.push(minGenderProbability);
  }

  if (minCountryProbability !== null) {
    conditions.push("country_probability >= ?");
    params.push(minCountryProbability);
  }

  return {
    whereClause: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
    params
  };
}

// ─── NLP Query Parser ─────────────────────────────────────────────────────────

/**
 * Parses a plain-English query string into filter key-value pairs.
 * Returns null if the query cannot be interpreted.
 *
 * Supported keywords:
 *   Gender   : male / males / man / men / boys | female / females / woman / women / girls
 *   Age group: child / children / kids | teenager / teenagers / teen / teens
 *              | adult / adults | senior / seniors / elderly
 *   "young"  : maps to min_age=16, max_age=24 (not a stored age_group)
 *   Age ops  : above N, over N, older than N, at least N
 *              | below N, under N, younger than N, at most N
 *              | between N and M
 *   Country  : "from [country name]" — matched against COUNTRY_NAME_TO_ID
 */
function parseNaturalLanguageQuery(q) {
  const text = q.toLowerCase().trim();
  const filters = {};

  // ── Gender ──────────────────────────────────────────────────────────────────
  const hasMale = /\b(males?|men|man|boys?)\b/.test(text);
  const hasFemale = /\b(females?|women|woman|girls?)\b/.test(text);

  // Only set gender if exactly one gender word group appears
  if (hasMale && !hasFemale) {
    filters.gender = "male";
  } else if (hasFemale && !hasMale) {
    filters.gender = "female";
  }
  // If both appear (e.g. "male and female"), no gender filter is set

  // ── Age group / "young" ─────────────────────────────────────────────────────
  if (/\b(children|child|kids?)\b/.test(text)) {
    filters.age_group = "child";
  } else if (/\bteenagers?\b|\bteens?\b/.test(text)) {
    filters.age_group = "teenager";
  } else if (/\badults?\b/.test(text)) {
    filters.age_group = "adult";
  } else if (/\bseniors?\b|\belderly\b/.test(text)) {
    filters.age_group = "senior";
  } else if (/\byoung\b/.test(text)) {
    // "young" is a parsing keyword only — maps to 16–24
    filters.min_age = 16;
    filters.max_age = 24;
  }

  // ── Explicit age modifiers ──────────────────────────────────────────────────
  // These override any age bounds set by "young" above
  let match;

  if (
    (match = text.match(
      /\b(?:above|over|older than|at least)\s+(\d+)\b/
    ))
  ) {
    filters.min_age = parseInt(match[1], 10);
  }

  if (
    (match = text.match(
      /\b(?:below|under|younger than|at most)\s+(\d+)\b/
    ))
  ) {
    filters.max_age = parseInt(match[1], 10);
  }

  if ((match = text.match(/\bbetween\s+(\d+)\s+and\s+(\d+)\b/))) {
    filters.min_age = parseInt(match[1], 10);
    filters.max_age = parseInt(match[2], 10);
  }

  // ── Country ─────────────────────────────────────────────────────────────────
  // Match "from [country name]" — country may be followed by age modifiers or end of string
  const fromMatch = text.match(
    /\bfrom\s+([a-z][a-z '\-]*)(?=\s+(?:above|below|over|under|between|aged?|who|with|older|younger|at\s+least|at\s+most)|$)/
  );

  if (fromMatch) {
    const raw = fromMatch[1].trim().replace(/\s+/g, " ");
    // Try progressively shorter substrings (handles trailing noise)
    const words = raw.split(" ");
    for (let len = words.length; len > 0; len--) {
      const candidate = words.slice(0, len).join(" ");
      if (COUNTRY_NAME_TO_ID[candidate]) {
        filters.country_id = COUNTRY_NAME_TO_ID[candidate];
        break;
      }
    }
  }

  // Must resolve at least one filter to be interpretable
  return Object.keys(filters).length > 0 ? filters : null;
}

// ─── Row mappers ──────────────────────────────────────────────────────────────

/** Full profile — used for GET /api/profiles/:id */
function mapProfileRowFull(row) {
  return {
    id: row.id,
    name: row.name,
    gender: row.gender,
    gender_probability: row.gender_probability,
    sample_size: row.sample_size,
    age: row.age,
    age_group: row.age_group,
    country_id: row.country_id,
    country_name: row.country_name || "",
    country_probability: row.country_probability,
    created_at: row.created_at
  };
}

/** List/search profile — used for GET /api/profiles and GET /api/profiles/search */
function mapProfileRowList(row) {
  return {
    id: row.id,
    name: row.name,
    gender: row.gender,
    gender_probability: row.gender_probability,
    age: row.age,
    age_group: row.age_group,
    country_id: row.country_id,
    country_name: row.country_name || "",
    country_probability: row.country_probability,
    created_at: row.created_at
  };
}

// ─── Upstream API helpers ─────────────────────────────────────────────────────

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

// ─── DB operations ────────────────────────────────────────────────────────────

async function findProfileByNormalizedName(normalizedName) {
  const db = await getDb();
  const row = await db.get(
    `SELECT id, name, gender, gender_probability, sample_size, age, age_group,
            country_id, country_name, country_probability, created_at
     FROM profiles
     WHERE normalized_name = ?
     LIMIT 1`,
    normalizedName
  );

  return row ? mapProfileRowFull(row) : null;
}

async function insertProfile(profile) {
  const db = await getDb();
  await db.run(
    `INSERT INTO profiles (
       id, normalized_name, name, gender, gender_probability, sample_size,
       age, age_group, country_id, country_name, country_probability, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      profile.id,
      profile.normalized_name,
      profile.name,
      profile.gender,
      profile.gender_probability,
      profile.sample_size,
      profile.age,
      profile.age_group,
      profile.country_id,
      profile.country_name,
      profile.country_probability,
      profile.created_at
    ]
  );
}

// ─── Public service functions ─────────────────────────────────────────────────

async function createProfile(body) {
  const normalizedName = normalizeNameFromBody(body);

  const existing = await findProfileByNormalizedName(normalizedName);
  if (existing) {
    return { alreadyExists: true, profile: existing };
  }

  const [genderizePayload, agifyPayload, nationalizePayload] =
    await Promise.all([
      fetchApiJson(
        `${GENDERIZE_API}?name=${encodeURIComponent(normalizedName)}`,
        "Genderize"
      ),
      fetchApiJson(
        `${AGIFY_API}?name=${encodeURIComponent(normalizedName)}`,
        "Agify"
      ),
      fetchApiJson(
        `${NATIONALIZE_API}?name=${encodeURIComponent(normalizedName)}`,
        "Nationalize"
      )
    ]);

  const genderize = parseGenderize(genderizePayload);
  const agify = parseAgify(agifyPayload);
  const nationalize = parseNationalize(nationalizePayload);

  // Look up country name from our map
  const countryName =
    Object.entries(COUNTRY_NAME_TO_ID).find(
      ([, code]) => code === nationalize.country_id
    )?.[0] || "";

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
    country_name: countryName,
    country_probability: nationalize.country_probability,
    created_at: new Date().toISOString()
  };

  try {
    await insertProfile(profile);
  } catch (error) {
    if (String(error && error.message).includes("UNIQUE")) {
      const current = await findProfileByNormalizedName(normalizedName);
      if (current) {
        return { alreadyExists: true, profile: current };
      }
    }
    throw error;
  }

  return { alreadyExists: false, profile: mapProfileRowFull(profile) };
}

async function getProfileById(id) {
  const db = await getDb();
  const row = await db.get(
    `SELECT id, name, gender, gender_probability, sample_size, age, age_group,
            country_id, country_name, country_probability, created_at
     FROM profiles
     WHERE id = ?
     LIMIT 1`,
    id
  );

  if (!row) {
    throw new ApiError(404, "Profile not found");
  }

  return mapProfileRowFull(row);
}

/**
 * List profiles with full filtering, sorting, and pagination.
 *
 * Accepts a query object (typically req.query) with:
 *   Filters : gender, age_group, country_id, min_age, max_age,
 *             min_gender_probability, min_country_probability
 *   Sorting : sort_by (age | created_at | gender_probability), order (asc | desc)
 *   Paging  : page (default 1), limit (default 10, max 50)
 *
 * Returns { page, limit, total, profiles }
 */
async function listProfiles(query) {
  // ── Pagination ───────────────────────────────────────────────────────────────
  const page = parsePaginationInt(query.page, 1, null);
  const limit = parsePaginationInt(query.limit, 10, 50);
  const offset = (page - 1) * limit;

  const { whereClause, params } = buildFilterConditions(query);
  const { sortColumn, sortDirection } = parseSortParams(query);

  const db = await getDb();

  // ── Count total matching rows ────────────────────────────────────────────────
  const countRow = await db.get(
    `SELECT COUNT(*) AS total FROM profiles ${whereClause}`,
    params
  );
  const total = countRow.total;
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

  // ── Fetch paginated rows ─────────────────────────────────────────────────────
  const rows = await db.all(
    `SELECT id, name, gender, gender_probability, age, age_group,
            country_id, country_name, country_probability, created_at
     FROM profiles
     ${whereClause}
     ORDER BY ${sortColumn} ${sortDirection}, id ASC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return {
    page,
    limit,
    total,
    total_pages: totalPages,
    profiles: rows.map(mapProfileRowList)
  };
}

async function listProfilesForExport(query) {
  const { whereClause, params } = buildFilterConditions(query);
  const { sortColumn, sortDirection } = parseSortParams(query);
  const db = await getDb();

  const rows = await db.all(
    `SELECT id, name, gender, gender_probability, age, age_group,
            country_id, country_name, country_probability, created_at
     FROM profiles
     ${whereClause}
     ORDER BY ${sortColumn} ${sortDirection}, id ASC`,
    params
  );

  return rows.map(mapProfileRowList);
}

/**
 * Parse a plain-English query and return filtered, paginated profiles.
 * Throws ApiError(422, "Unable to interpret query") if the query can't be parsed.
 */
async function searchProfiles(query) {
  const q = query.q;

  if (q === undefined) {
    throw new ApiError(400, "Missing search query parameter");
  }

  if (Array.isArray(q) || typeof q !== "string") {
    throw new ApiError(422, "Invalid type");
  }

  const trimmed = q.trim();
  if (!trimmed) {
    throw new ApiError(400, "Missing search query parameter");
  }

  const filters = parseNaturalLanguageQuery(trimmed);

  if (!filters) {
    throw new ApiError(422, "Unable to interpret query");
  }

  // Merge parsed filters with any explicit pagination/sort params from the request
  const mergedQuery = {
    ...filters,
    page: query.page,
    limit: query.limit,
    sort_by: query.sort_by,
    order: query.order
  };

  return listProfiles(mergedQuery);
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
  listProfilesForExport,
  searchProfiles,
  deleteProfileById
};