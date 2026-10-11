const crypto = require("crypto");

const AUTH_TOKEN_TTL_SECONDS = 12 * 60 * 60;
const GOOGLE_NONCE_TTL_SECONDS = 5 * 60;
const TOKEN_ISSUER = "ict-maintenance-api";

function getSecret() {
  const secret = process.env.JWT_SECRET || "";
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET must be configured in production.");
  }
  return "development-only-change-me";
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function signPayload(payload) {
  const header = encode({ alg: "HS256", typ: "JWT" });
  const body = encode(payload);
  const content = `${header}.${body}`;
  const signature = crypto
    .createHmac("sha256", getSecret())
    .update(content)
    .digest("base64url");
  return `${content}.${signature}`;
}

function parseSegment(segment) {
  if (typeof segment !== "string" || !/^[A-Za-z0-9_-]+$/.test(segment)) {
    throw new Error("Invalid token.");
  }
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid token.");
  }
}

function verifySignature(content, signature) {
  if (typeof signature !== "string" || !/^[A-Za-z0-9_-]+$/.test(signature)) {
    return false;
  }
  const expected = crypto
    .createHmac("sha256", getSecret())
    .update(content)
    .digest();
  const actual = Buffer.from(signature, "base64url");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function verifySignedPayload(token) {
  if (typeof token !== "string" || token.length > 4096) {
    throw new Error("Invalid token.");
  }
  const parts = token.split(".");
  if (
    parts.length !== 3 ||
    !verifySignature(`${parts[0]}.${parts[1]}`, parts[2])
  ) {
    throw new Error("Invalid token.");
  }
  const header = parseSegment(parts[0]);
  const payload = parseSegment(parts[1]);
  if (
    !header ||
    Array.isArray(header) ||
    header.alg !== "HS256" ||
    header.typ !== "JWT" ||
    !payload ||
    Array.isArray(payload)
  ) {
    throw new Error("Invalid token.");
  }
  return payload;
}

function createAuthToken(userId) {
  const now = Math.floor(Date.now() / 1000);
  return signPayload({
    iss: TOKEN_ISSUER,
    sub: String(userId),
    iat: now,
    exp: now + AUTH_TOKEN_TTL_SECONDS,
  });
}

function verifyAuthToken(token) {
  const payload = verifySignedPayload(token);
  const now = Math.floor(Date.now() / 1000);
  if (
    payload.iss !== TOKEN_ISSUER ||
    typeof payload.sub !== "string" ||
    !payload.sub ||
    !Number.isInteger(payload.iat) ||
    !Number.isInteger(payload.exp) ||
    payload.iat > now + 60 ||
    payload.exp <= now ||
    payload.exp - payload.iat > AUTH_TOKEN_TTL_SECONDS
  ) {
    throw new Error("Invalid or expired token.");
  }
  return payload;
}

function createGoogleNonceChallenge() {
  const nonce = crypto.randomBytes(32).toString("base64url");
  const expiresAt = Math.floor(Date.now() / 1000) + GOOGLE_NONCE_TTL_SECONDS;
  const proof = crypto
    .createHmac("sha256", getSecret())
    .update(`${nonce}.${expiresAt}`)
    .digest("base64url");
  return { nonce, nonceExpiresAt: expiresAt, nonceProof: proof };
}

function verifyGoogleNonceChallenge({ nonce, nonceExpiresAt, nonceProof }) {
  if (
    typeof nonce !== "string" ||
    !/^[A-Za-z0-9_-]{32,}$/.test(nonce) ||
    !Number.isInteger(nonceExpiresAt) ||
    nonceExpiresAt <= Math.floor(Date.now() / 1000) ||
    nonceExpiresAt > Math.floor(Date.now() / 1000) + GOOGLE_NONCE_TTL_SECONDS
  ) {
    return false;
  }
  return verifySignature(
    `${nonce}.${nonceExpiresAt}`,
    nonceProof,
  );
}

function getBearerToken(req) {
  const authorization = req.get("authorization") || "";
  const parts = authorization.split(" ");
  if (
    parts.length !== 2 ||
    parts[0].toLowerCase() !== "bearer" ||
    !parts[1] ||
    Array.from(parts[1]).some(
      (character) =>
        !(
          (character >= "a" && character <= "z") ||
          (character >= "A" && character <= "Z") ||
          (character >= "0" && character <= "9") ||
          character === "_" ||
          character === "-" ||
          character === "."
        ),
    )
  ) {
    return null;
  }
  return parts[1];
}

module.exports = {
  AUTH_TOKEN_TTL_SECONDS,
  createAuthToken,
  createGoogleNonceChallenge,
  getBearerToken,
  verifyAuthToken,
  verifyGoogleNonceChallenge,
};
