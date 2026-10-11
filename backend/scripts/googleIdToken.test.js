const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { verifyGoogleIdToken } = require("../services/googleIdToken");

const CLIENT_ID = "test-client.apps.googleusercontent.com";
const NONCE = "test-sign-in-nonce";
const KEY_ID = "test-signing-key";
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const signingKeys = new Map([[KEY_ID, publicKey]]);

function makeToken(overrides = {}, headerOverrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "RS256",
    kid: KEY_ID,
    typ: "JWT",
    ...headerOverrides,
  };
  const payload = {
    iss: "https://accounts.google.com",
    aud: CLIENT_ID,
    sub: "google-subject",
    email: "requester@example.edu",
    email_verified: true,
    nonce: NONCE,
    iat: now,
    exp: now + 3600,
    ...overrides,
  };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString(
    "base64url",
  );
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  const signedContent = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto
    .sign("RSA-SHA256", Buffer.from(signedContent), privateKey)
    .toString("base64url");
  return `${signedContent}.${signature}`;
}

function verify(idToken) {
  return verifyGoogleIdToken(
    { idToken, audience: CLIENT_ID, nonce: NONCE },
    { getSigningKeys: async () => signingKeys },
  );
}

test("accepts a correctly signed token with valid Google claims and nonce", async () => {
  const claims = await verify(makeToken());
  assert.equal(claims.email, "requester@example.edu");
  assert.equal(claims.sub, "google-subject");
});

test("rejects malformed tokens and algorithms other than RS256", async () => {
  await assert.rejects(verify("not.a.valid-token"));
  await assert.rejects(verify(makeToken({}, { alg: "none" })));
});

test("rejects an invalid signature", async () => {
  const token = makeToken();
  const [header, payload, signature] = token.split(".");
  const altered =
    (signature[0] === "A" ? "B" : "A") + signature.slice(1);
  await assert.rejects(verify(`${header}.${payload}.${altered}`));
});

test("rejects incorrect issuer, audience, and nonce", async () => {
  await assert.rejects(verify(makeToken({ iss: "attacker.example" })));
  await assert.rejects(verify(makeToken({ aud: "another-client" })));
  await assert.rejects(verify(makeToken({ nonce: "another-sign-in" })));
  await assert.rejects(verify(makeToken({ azp: "another-client" })));
  await assert.rejects(verify(makeToken({ azp: "" })));
});

test("rejects expired tokens and tokens without verified email", async () => {
  const now = Math.floor(Date.now() / 1000);
  await assert.rejects(verify(makeToken({ exp: now - 1, iat: now - 3600 })));
  await assert.rejects(verify(makeToken({ iat: now - 3 * 60 * 60 })));
  await assert.rejects(verify(makeToken({ nbf: now + 301 })));
  await assert.rejects(verify(makeToken({ email_verified: false })));
});

test("rejects missing required identity claims", async () => {
  await assert.rejects(verify(makeToken({ sub: "" })));
  await assert.rejects(verify(makeToken({ email: "" })));
});
