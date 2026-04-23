# Insighta Labs — Demographic Intelligence API

A Node.js/Express REST API for querying demographic profile data. Supports advanced filtering, sorting, pagination, and plain-English natural language search.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Seeding the Database](#seeding-the-database)
3. [API Endpoints](#api-endpoints)
4. [Natural Language Search — Parsing Approach](#natural-language-search--parsing-approach)
5. [Limitations & Edge Cases](#limitations--edge-cases)
6. [Deployment](#deployment)

---

## Getting Started

### Prerequisites

- Node.js ≥ 18
- npm

### Installation

```bash
npm install
```

### Running locally

```bash
node server.js
```

The server starts on port `3000` by default. Override with `PORT=<n>`.

### Environment variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | HTTP port for Express server | `3000` |
| `DB_PATH` | Override SQLite file location | `data/profiles.db` |

---

## Seeding the Database

Copy the provided seed file into the `data/` directory:

```bash
cp seed_profiles.json data/seed_profiles.json
```

Then run:

```bash
node scripts/seed.js
```

**The seed script is idempotent** — re-running it will skip any profiles that already exist (matched by lowercase name). It uses a single database transaction for speed and atomicity.

---

## API Endpoints

All responses include `Access-Control-Allow-Origin: *`.  
All error responses follow the structure:

```json
{ "status": "error", "message": "<description>" }
```

---

### `GET /api/profiles`

List profiles with optional filtering, sorting, and pagination.

**Query parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `gender` | string | `male` or `female` |
| `age_group` | string | `child`, `teenager`, `adult`, or `senior` |
| `country_id` | string | ISO 3166-1 alpha-2 code (e.g. `NG`, `KE`) |
| `min_age` | integer | Minimum age (inclusive) |
| `max_age` | integer | Maximum age (inclusive) |
| `min_gender_probability` | float | Minimum gender confidence score |
| `min_country_probability` | float | Minimum country confidence score |
| `sort_by` | string | `age`, `created_at`, or `gender_probability` (default: `created_at`) |
| `order` | string | `asc` or `desc` (default: `desc`) |
| `page` | integer | Page number, ≥ 1 (default: `1`) |
| `limit` | integer | Results per page, 1–50 (default: `10`) |

All filters are combinable. A result must satisfy **every** filter passed.

**Example**

```
GET /api/profiles?gender=male&country_id=NG&min_age=25&sort_by=age&order=desc&page=1&limit=10
```

**Success response — 200**

```json
{
  "status": "success",
  "page": 1,
  "limit": 10,
  "total": 142,
  "data": [
    {
      "id": "b3f9c1e2-7d4a-4c91-9c2a-1f0a8e5b6d12",
      "name": "emmanuel",
      "gender": "male",
      "gender_probability": 0.99,
      "age": 34,
      "age_group": "adult",
      "country_id": "NG",
      "country_name": "Nigeria",
      "country_probability": 0.85,
      "created_at": "2026-04-01T12:00:00.000Z"
    }
  ]
}
```

---

### `GET /api/profiles/search`

Natural language query interface. Converts plain English into demographic filters.

**Query parameters**

| Parameter | Description |
|-----------|-------------|
| `q` | Plain English query string (required) |
| `page` | Page number (default: `1`) |
| `limit` | Results per page, 1–50 (default: `10`) |
| `sort_by` | Same as `/api/profiles` |
| `order` | Same as `/api/profiles` |

**Example**

```
GET /api/profiles/search?q=young males from nigeria&page=1&limit=10
```

**Success response — 200** (same shape as `/api/profiles`)

**Error — uninterpretable query — 422**

```json
{ "status": "error", "message": "Unable to interpret query" }
```

---

### `GET /api/profiles/:id`

Fetch a single profile by UUID v7.

**Success response — 200**

```json
{
  "status": "success",
  "data": {
    "id": "...",
    "name": "emmanuel",
    "gender": "male",
    "gender_probability": 0.99,
    "sample_size": 24500,
    "age": 34,
    "age_group": "adult",
    "country_id": "NG",
    "country_name": "Nigeria",
    "country_probability": 0.85,
    "created_at": "2026-04-01T12:00:00.000Z"
  }
}
```

---

### `POST /api/profiles`

Create a new profile. Calls Genderize, Agify, and Nationalize APIs to enrich the name.

**Request body**

```json
{ "name": "amara" }
```

**Success — 201** (new profile) or **200** (already exists).

---

### `DELETE /api/profiles/:id`

Delete a profile. Returns `204 No Content` on success.

---

## Natural Language Search — Parsing Approach

The `/api/profiles/search` endpoint uses a **rule-based parser** — no AI or LLM is involved. It applies a series of regex patterns to the lowercased query string and extracts one or more filter values.

### How it works

The parser runs in four sequential steps:

**Step 1 — Gender detection**

Checks for gender keywords. Sets `gender` only if exactly one gender group is found.

| Keywords detected | Result |
|-------------------|--------|
| `male`, `males`, `man`, `men`, `boys`, `boy` | `gender = male` |
| `female`, `females`, `woman`, `women`, `girls`, `girl` | `gender = female` |
| Both gender groups appear in the same query | No gender filter (e.g. "male and female teenagers") |

**Step 2 — Age group detection**

Checked in priority order (first match wins):

| Keywords | Mapped filter |
|----------|---------------|
| `child`, `children`, `kids`, `kid` | `age_group = child` |
| `teenager`, `teenagers`, `teen`, `teens` | `age_group = teenager` |
| `adult`, `adults` | `age_group = adult` |
| `senior`, `seniors`, `elderly` | `age_group = senior` |
| `young` *(only if none of the above matched)* | `min_age = 16` + `max_age = 24` |

> **Note:** `young` is a parsing keyword only. It is not stored as an `age_group`. It maps exclusively to ages 16–24 for query purposes.

**Step 3 — Explicit age modifier detection**

These patterns override or complement age group bounds set in Step 2:

| Pattern | Filter |
|---------|--------|
| `above N`, `over N`, `older than N`, `at least N` | `min_age = N` |
| `below N`, `under N`, `younger than N`, `at most N` | `max_age = N` |
| `between N and M` | `min_age = N`, `max_age = M` |

**Step 4 — Country detection**

Looks for the pattern `from [country name]`. The country name is matched against a built-in dictionary of ~80 countries (name → ISO 3166-1 alpha-2 code). Multi-word countries (e.g. "south africa", "sierra leone") are matched using a greedy-then-trim algorithm.

| Example phrase | Mapped filter |
|----------------|---------------|
| `from nigeria` | `country_id = NG` |
| `from south africa` | `country_id = ZA` |
| `from kenya` | `country_id = KE` |
| `from the united kingdom` | *(not matched — "the" prefix not in map)* |
| `from uk` | `country_id = GB` |

### Full example mappings

| Query | Parsed filters |
|-------|----------------|
| `young males` | `gender=male`, `min_age=16`, `max_age=24` |
| `females above 30` | `gender=female`, `min_age=30` |
| `people from angola` | `country_id=AO` |
| `adult males from kenya` | `gender=male`, `age_group=adult`, `country_id=KE` |
| `male and female teenagers above 17` | `age_group=teenager`, `min_age=17` |
| `seniors from nigeria` | `age_group=senior`, `country_id=NG` |
| `young women from ghana` | `gender=female`, `min_age=16`, `max_age=24`, `country_id=GH` |
| `children below 10` | `age_group=child`, `max_age=10` |

### Uninterpretable queries

If no filters can be extracted, the API returns:

```json
{ "status": "error", "message": "Unable to interpret query" }
```

---

## Limitations & Edge Cases

### Parser limitations

1. **No synonym expansion.** Words like `guys`, `gentlemen`, `lads`, `gents`, `dudes` are not recognised as gender keywords.

2. **`young` conflicts with age modifiers.** If a query contains both `young` and an explicit age modifier (e.g. "young people above 30"), both are applied — `min_age` will be overwritten to 30 and `max_age` will remain 24. This produces an impossible range (`min_age > max_age`) which returns zero results rather than an error.

3. **No stemming or spelling correction.** Typos (`femelle`, `nigerria`) and pluralisation variants outside the supported list will not be recognised.

4. **Country prefix articles not supported.** Phrases like "from the united states" or "from the uk" will not match because the dictionary keys do not include leading articles.

5. **Only one country per query.** If a user writes "from nigeria or kenya", only the first `from [country]` match is used.

6. **No relative time expressions.** Queries like "profiles created this month" or "recently added" are not supported.

7. **No name search.** Searching by partial name (e.g. "find john") is not supported.

8. **`young adults` is parsed as `adults`.** The age group `adult` is matched before the `young` keyword check, so "young adults" maps to `age_group=adult` rather than `min_age=16, max_age=24`.

9. **No negation.** Phrases like "not from nigeria" or "excluding seniors" are not supported.

10. **No compound age ranges via keywords.** "Middle-aged", "pre-teen", "elderly adults" are not recognised.

### General limitations

- The database is SQLite-backed and not suitable for high-concurrency write loads.
- On Vercel, the SQLite database is stored in `/tmp` and is ephemeral — data is lost on cold starts. For production persistence, use an external database.
- The seed script must be run manually before the API can serve meaningful data.

---

## Deployment

### Vercel

Deploy with:

```bash
vercel --prod
```

The `vercel.json` rewrites route `/api/profiles/:id` through the single serverless function at `api/profiles.js`. The `/api/profiles/search` path is handled automatically because Vercel passes `profile_id=search` through the rewrite, which the handler detects and dispatches to the NLP search logic.

**Important:** After deploying to Vercel, run the seed script locally against your production database (set `DB_PATH` to the Vercel `/tmp` path, or use a remote DB) before submitting.

### Railway / Heroku / other platforms

Set `PORT` and optionally `DB_PATH`, then run:

```bash
node server.js
```

Add the following to `package.json` scripts:

```json
{
  "scripts": {
    "start": "node server.js",
    "seed": "node scripts/seed.js"
  }
}
```

Then seed with:

```bash
npm run seed
```