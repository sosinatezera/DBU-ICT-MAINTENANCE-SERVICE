const crypto = require("crypto");
const https = require("https");

const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const MAX_CERT_RESPONSE_BYTES = 1024 * 1024;
const CERT_REQUEST_TIMEOUT_MS = 5000;
let signingKeyCache = null;
let signingKeyRequest = null;

class GoogleTokenError extends Error {
  constructor(message, transient = false) {
    super(message);
    this.name = "GoogleTokenError";
    this.transient = transient;
  }
}

function invalidToken() {
  return new GoogleTokenError("Google ID token is invalid.");
}

function parseJwtSegment(segment) {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) throw invalidToken();
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch {
    throw invalidToken();
  }
}

function getGoogleSigningKeys(forceRefresh = false) {
  if (
    !forceRefresh &&
    signingKeyCache &&
    signingKeyCache.expiresAt > Date.now()
  ) {
    return Promise.resolve(signingKeyCache.keys);
  }
  if (!forceRefresh && signingKeyRequest) return signingKeyRequest;

  const request = new Promise((resolve, reject) => {
    const req = https.get(
      GOOGLE_CERTS_URL,
      { headers: { Accept: "application/json" } },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(
            new GoogleTokenError(
              "Google signing keys could not be retrieved.",
              true,
            ),
          );
          return;
        }

        let body = "";
        let tooLarge = false;
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
          if (Buffer.byteLength(body) > MAX_CERT_RESPONSE_BYTES) {
            tooLarge = true;
            res.destroy();
          }
        });
        res.on("end", () => {
          if (tooLarge) {
            reject(
              new GoogleTokenError(
                "Google signing key response was too large.",
                true,
              ),
            );
            return;
          }
          try {
            const data = JSON.parse(body);
            const keys = new Map();
            for (const jwk of Array.isArray(data.keys) ? data.keys : []) {
              if (
                jwk &&
                typeof jwk.kid === "string" &&
                jwk.kty === "RSA" &&
                jwk.use === "sig" &&
                (!jwk.alg || jwk.alg === "RS256")
              ) {
                const publicKey = crypto.createPublicKey({
                  key: jwk,
                  format: "jwk",
                });
                if (
                  publicKey.asymmetricKeyDetails?.modulusLength >= 2048
                ) {
                  keys.set(jwk.kid, publicKey);
                }
              }
            }
            if (!keys.size) {
              throw new Error("Google signing key response had no usable keys.");
            }
            const maxAgeMatch = String(res.headers["cache-control"] || "").match(
              /(?:^|,)\s*max-age=(\d+)/i,
            );
            const maxAgeSeconds = Math.min(
              6 * 60 * 60,
              Math.max(1, Number(maxAgeMatch?.[1] || 300)),
            );
            signingKeyCache = {
              keys,
              expiresAt: Date.now() + maxAgeSeconds * 1000,
            };
            resolve(keys);
          } catch {
            reject(
              new GoogleTokenError(
                "Google signing key response could not be validated.",
                true,
              ),
            );
          }
        });
        res.on("error", () => {
          reject(
            new GoogleTokenError(
              "Google signing keys could not be retrieved.",
              true,
            ),
          );
        });
        res.on("aborted", () => {
          reject(
            new GoogleTokenError(
              "Google signing key response was interrupted.",
              true,
            ),
          );
        });
        res.on("close", () => {
          if (!res.complete) {
            reject(
              new GoogleTokenError(
                "Google signing key response was interrupted.",
                true,
              ),
            );
          }
        });
      },
    );
    req.setTimeout(CERT_REQUEST_TIMEOUT_MS, () => {
      req.destroy(
        new GoogleTokenError(
          "Google signing key request timed out.",
          true,
        ),
      );
    });
    req.on("error", (error) => {
      reject(
        error instanceof GoogleTokenError
          ? error
          : new GoogleTokenError(
              "Google signing keys could not be retrieved.",
              true,
            ),
      );
    });
  }).finally(() => {
    if (signingKeyRequest === request) signingKeyRequest = null;
  });

  signingKeyRequest = request;
  return request;
}

function nonceMatches(actual, expected) {
  if (typeof actual !== "string" || typeof expected !== "string") return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

async function verifyGoogleIdToken(
  { idToken, audience, nonce },
  { getSigningKeys = getGoogleSigningKeys } = {},
) {
  if (typeof idToken !== "string" || idToken.length > 16384) {
    throw invalidToken();
  }
  const parts = idToken.split(".");
  if (parts.length !== 3) throw invalidToken();

  const header = parseJwtSegment(parts[0]);
  const payload = parseJwtSegment(parts[1]);
  if (
    !header ||
    typeof header !== "object" ||
    Array.isArray(header) ||
    header.alg !== "RS256" ||
    typeof header.kid !== "string" ||
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    throw invalidToken();
  }

  let signature;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(parts[2])) throw invalidToken();
    signature = Buffer.from(parts[2], "base64url");
  } catch {
    throw invalidToken();
  }

  let keys = await getSigningKeys(false);
  let publicKey = keys.get(header.kid);
  if (!publicKey) {
    keys = await getSigningKeys(true);
    publicKey = keys.get(header.kid);
  }
  if (!publicKey) throw invalidToken();

  const signedContent = Buffer.from(`${parts[0]}.${parts[1]}`);
  if (!crypto.verify("RSA-SHA256", signedContent, publicKey, signature)) {
    throw invalidToken();
  }

  const now = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (
    !audience ||
    !audiences.includes(audience) ||
    (payload.azp !== undefined &&
      (typeof payload.azp !== "string" || payload.azp !== audience)) ||
    (audiences.length > 1 && payload.azp !== audience) ||
    !["accounts.google.com", "https://accounts.google.com"].includes(
      payload.iss,
    ) ||
    !Number.isFinite(payload.exp) ||
    payload.exp <= now ||
    !Number.isFinite(payload.iat) ||
    payload.iat > now + 300 ||
    payload.iat < now - 2 * 60 * 60 ||
    payload.exp - payload.iat > 2 * 60 * 60 ||
    (payload.nbf !== undefined &&
      (!Number.isFinite(payload.nbf) || payload.nbf > now + 300)) ||
    !nonceMatches(payload.nonce, nonce)
  ) {
    throw invalidToken();
  }
  if (
    typeof payload.sub !== "string" ||
    !payload.sub ||
    typeof payload.email !== "string" ||
    !payload.email.trim() ||
    payload.email_verified !== true
  ) {
    throw invalidToken();
  }

  return payload;
}

module.exports = { verifyGoogleIdToken };
