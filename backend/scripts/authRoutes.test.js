const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");

process.env.JWT_SECRET = "auth-route-test-secret-with-32-characters";
process.env.GOOGLE_CLIENT_ID = "auth-route-test.apps.googleusercontent.com";

const express = require("express");
const { verifyGoogleNonceChallenge } = require("../services/authToken");
const authRoutes = require("../routes/auth");

const app = express();
app.use(express.json());
app.use("/api/auth", authRoutes);
const server = app.listen(0);

test.before(async () => {
  if (!server.listening) await once(server, "listening");
});

test.after(async () => {
  if (server.listening) {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("mounted auth routes expose Google config and the login validation contract", async () => {
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const apiBase = `http://127.0.0.1:${address.port}/api/auth`;

  const configResponse = await fetch(`${apiBase}/google/config`);
  assert.equal(configResponse.status, 200);
  const config = await configResponse.json();
  assert.equal(config.success, true);
  assert.equal(config.enabled, true);
  assert.equal(config.clientId, process.env.GOOGLE_CLIENT_ID);
  assert.equal(verifyGoogleNonceChallenge(config), true);

  const loginResponse = await fetch(`${apiBase}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(loginResponse.status, 422);
  assert.deepEqual(await loginResponse.json(), {
    success: false,
    message: "Email and password are required.",
  });
});