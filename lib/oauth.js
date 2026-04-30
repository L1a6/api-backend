const crypto = require("crypto");
const { ApiError } = require("./errors");

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";
const GITHUB_EMAIL_URL = "https://api.github.com/user/emails";

function generatePkcePair() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");

  return { verifier, challenge };
}

function buildGithubAuthorizeUrl({
  clientId,
  redirectUri,
  state,
  codeChallenge
}) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    scope: "read:user user:email"
  });

  return `${GITHUB_AUTHORIZE_URL}?${params.toString()}`;
}

async function exchangeGithubCode({
  clientId,
  clientSecret,
  code,
  redirectUri,
  codeVerifier
}) {
  const response = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier
    })
  });

  if (!response.ok) {
    throw new ApiError(502, "GitHub token exchange failed");
  }

  const payload = await response.json();
  if (!payload || !payload.access_token) {
    throw new ApiError(502, "GitHub token exchange failed");
  }

  return payload.access_token;
}

async function fetchGithubUser(accessToken) {
  const response = await fetch(GITHUB_USER_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "insighta-labs"
    }
  });

  if (!response.ok) {
    throw new ApiError(502, "GitHub user lookup failed");
  }

  const payload = await response.json();
  if (!payload || typeof payload.id !== "number" || !payload.login) {
    throw new ApiError(502, "GitHub user lookup failed");
  }

  return payload;
}

async function fetchGithubEmail(accessToken) {
  const response = await fetch(GITHUB_EMAIL_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "insighta-labs"
    }
  });

  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  if (!Array.isArray(payload)) {
    return null;
  }

  const primary = payload.find((item) => item && item.primary && item.verified);
  const fallback = payload.find((item) => item && item.verified);
  const target = primary || fallback;

  return target && target.email ? target.email : null;
}

module.exports = {
  generatePkcePair,
  buildGithubAuthorizeUrl,
  exchangeGithubCode,
  fetchGithubUser,
  fetchGithubEmail
};
