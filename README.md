# Backend Wizards - Stage 1 (Data Persistence & API Design)

This project implements the Stage 1 API with:

- Multi-API integration (Genderize, Agify, Nationalize)
- Data persistence in SQLite
- Idempotent profile creation by name
- Filtering, retrieval, and deletion endpoints

## Implemented Endpoints

### 1) Create Profile

- Method: POST
- Route: /api/profiles
- Request body:

{
  "name": "ella"
}

Success:

- 201 Created for a new profile
- 200 with message "Profile already exists" when duplicate name is submitted

### 2) Get Single Profile

- Method: GET
- Route: /api/profiles/{id}
- Success: 200

### 3) Get All Profiles

- Method: GET
- Route: /api/profiles
- Optional filters (case-insensitive): gender, country_id, age_group
- Success: 200 with count and data array

### 4) Delete Profile

- Method: DELETE
- Route: /api/profiles/{id}
- Success: 204 No Content

## External APIs Used

- Genderize: https://api.genderize.io?name={name}
- Agify: https://api.agify.io?name={name}
- Nationalize: https://api.nationalize.io?name={name}

## Classification Rules

- Age group:
  - 0-12: child
  - 13-19: teenager
  - 20-59: adult
  - 60+: senior
- Nationality:
  - Highest-probability country from Nationalize country list

## Required Response Rules Covered

- CORS header on all responses: Access-Control-Allow-Origin: *
- Error format:

{ "status": "error", "message": "<error message>" }

- 400 for missing or empty name
- 422 for invalid type
- 404 for profile not found
- 500 for internal failures
- 502 for invalid upstream responses with exact message:
  - Genderize returned an invalid response
  - Agify returned an invalid response
  - Nationalize returned an invalid response

## Data Model

Stored fields:

- id (UUID v7)
- name
- gender
- gender_probability
- sample_size
- age
- age_group
- country_id
- country_probability
- created_at (UTC ISO 8601)

SQLite file location:

- Local: data/profiles.db
- Vercel runtime: /tmp/profiles.db

## Local Run

1. Install dependencies:

npm install

2. Start API:

npm start

3. Base URL:

http://localhost:3000

## Manual Test Commands

Create profile:

curl -X POST http://localhost:3000/api/profiles -H "Content-Type: application/json" -d "{\"name\":\"ella\"}"

Create duplicate (returns existing):

curl -X POST http://localhost:3000/api/profiles -H "Content-Type: application/json" -d "{\"name\":\"ella\"}"

Get all profiles:

curl "http://localhost:3000/api/profiles"

Get filtered profiles:

curl "http://localhost:3000/api/profiles?gender=female&country_id=NG&age_group=adult"

Get single profile:

curl "http://localhost:3000/api/profiles/<profile-id>"

Delete profile:

curl -X DELETE "http://localhost:3000/api/profiles/<profile-id>"

## Vercel Deployment

This repo includes Vercel API routes:

- /api/profiles (GET, POST)
- /api/profiles/{id} (GET, DELETE)

Deploy steps:

1. Push repo to GitHub.
2. Import repo in Vercel as a new project.
3. Deploy with defaults.
4. Use your live base URL:

https://<your-project>.vercel.app

## Submission

Submit:

- API base URL (your live Vercel URL)
- GitHub repository link

Then verify the grader response after each submission attempt.
