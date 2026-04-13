# Backend Wizards - Stage 0 (API Integration & Data Processing)

This project implements the required endpoint:

- `GET /api/classify?name={name}`

It integrates with the Genderize API (`https://api.genderize.io`) and returns a processed response that follows the exact task contract.

## Live Behavior Summary

The endpoint:

1. Validates `name` query parameter
2. Calls Genderize API with the provided name
3. Extracts:
   - `gender`
   - `probability`
   - `count` (renamed to `sample_size`)
4. Computes `is_confident` with strict rule:
   - `probability >= 0.7` **AND** `sample_size >= 100`
5. Generates `processed_at` on every request (UTC ISO 8601 via `new Date().toISOString()`)

## Response Format

### Success (`200 OK`)

```json
{
  "status": "success",
  "data": {
    "name": "john",
    "gender": "male",
    "probability": 0.99,
    "sample_size": 1234,
    "is_confident": true,
    "processed_at": "2026-04-01T12:00:00.000Z"
  }
}
```

### Error Shape (all errors)

```json
{ "status": "error", "message": "<error message>" }
```

### Implemented Error Cases

- `400 Bad Request`
  - Missing `name` query parameter
  - Empty `name` value
- `422 Unprocessable Entity`
  - `name` is not a string
  - No prediction available (`gender: null` or `count: 0` from Genderize)
- `502 Bad Gateway`
  - Upstream request failure, timeout, bad upstream status, or invalid upstream payload
- `500 Internal Server Error`
  - Unexpected server errors

## CORS

All responses include:

- `Access-Control-Allow-Origin: *`

This satisfies the grading script access requirement.

## Performance and Stability Notes

- App is stateless and async, so it handles concurrent requests.
- Processing overhead is minimal; logic after API call is constant-time and lightweight.
- Genderize call has a timeout guard (`5s`) to prevent hanging requests.

## Tech Stack

- Node.js (>= 18)
- Express 4
- Native `fetch` API (Node 18+)

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Start server:

```bash
npm start
```

3. Default base URL:

```text
http://localhost:3000
```

## Manual Test Commands

### Success Example

```bash
curl "http://localhost:3000/api/classify?name=john"
```

### Missing Name (400)

```bash
curl "http://localhost:3000/api/classify"
```

### Empty Name (400)

```bash
curl "http://localhost:3000/api/classify?name="
```

### Non-string Name (422)

```bash
curl "http://localhost:3000/api/classify?name=john&name=jane"
```

### Edge Case - No Prediction (422)

```bash
curl "http://localhost:3000/api/classify?name=zxqvbnm"
```

## Deployment (for submission)

Deploy to any accepted platform (e.g., Vercel, Railway, Heroku, AWS, PXXL App).

### Vercel (recommended for this repo)

This repo includes a Vercel serverless route at:

- `/api/classify`

Steps:

1. Push this repository to GitHub.
2. In Vercel, click **New Project** and import this GitHub repo.
3. Deploy with default settings.
4. Your live base URL will be:
  - `https://<your-vercel-project>.vercel.app`
5. Test endpoint:
  - `https://<your-vercel-project>.vercel.app/api/classify?name=john`

After deployment, submit:

1. API base URL (for example: `https://your-app.domain.app`)
2. GitHub repository link

## Project Files

- `server.js` - API implementation
- `package.json` - scripts and dependencies
- `README.md` - setup and rubric alignment
