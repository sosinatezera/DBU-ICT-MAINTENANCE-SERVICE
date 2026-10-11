const test = require("node:test");
const assert = require("node:assert/strict");

process.env.JWT_SECRET = "test-auth-token-secret-with-sufficient-length";
const {
  createAuthToken,
  createGoogleNonceChallenge,
  getBearerToken,
  verifyAuthToken,
  verifyGoogleNonceChallenge,
} = require("../services/authToken");

test("auth token contains a verified user subject and expires within 12 hours", () => {
  const token = createAuthToken("user-123");
  const payload = verifyAuthToken(token);
  assert.equal(payload.sub, "user-123");
  assert.equal(payload.exp - payload.iat, 12 * 60 * 60);
});

test("auth token rejects tampering", () => {
  const token = createAuthToken("user-123");
  const signatureStart = token.lastIndexOf(".") + 1;
  const replacement = token[signatureStart] === "x" ? "y" : "x";
  const tampered =
    token.slice(0, signatureStart) +
    replacement +
    token.slice(signatureStart + 1);
  assert.throws(() => verifyAuthToken(tampered));
});

test("auth token rejects a token signed with a different secret", () => {
  const token = createAuthToken("user-123");
  process.env.JWT_SECRET = "a-different-test-secret-with-sufficient-length";
  assert.throws(() => verifyAuthToken(token));
  process.env.JWT_SECRET = "test-auth-token-secret-with-sufficient-length";
});

test("Google nonce challenge validates and rejects modifications", () => {
  const challenge = createGoogleNonceChallenge();
  assert.equal(verifyGoogleNonceChallenge(challenge), true);
  assert.equal(
    verifyGoogleNonceChallenge({ ...challenge, nonce: `${challenge.nonce}x` }),
    false,
  );
  assert.equal(
    verifyGoogleNonceChallenge({
      ...challenge,
      nonceExpiresAt: Math.floor(Date.now() / 1000) - 1,
    }),
    false,
  );
});

test("bearer extraction accepts only a bearer Authorization header", () => {
  const request = (authorization) => ({
    get: (name) => (name === "authorization" ? authorization : undefined),
  });
  assert.equal(getBearerToken(request("Bearer abc.def.ghi")), "abc.def.ghi");
  assert.equal(getBearerToken(request("Basic abc")), null);
  assert.equal(getBearerToken(request("Bearer invalid token")), null);
});
