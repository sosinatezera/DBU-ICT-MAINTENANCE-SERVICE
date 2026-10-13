const test = require("node:test");
const assert = require("node:assert/strict");
const User = require("../models/User");
const { authenticate } = require("../middleware/auth");
const { createAuthToken } = require("../services/authToken");

process.env.JWT_SECRET = "test-auth-middleware-secret-with-sufficient-length";

const originalFindById = User.findById;

test.afterEach(() => {
  User.findById = originalFindById;
});

function createRequest(authorization, user = null) {
  return {
    user,
    get(name) {
      return name === "authorization" ? authorization : undefined;
    },
  };
}

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

async function authenticateRequest(req) {
  const res = createResponse();
  let nextCalled = false;
  let nextError;
  await authenticate(req, res, (error) => {
    nextCalled = true;
    nextError = error;
  });
  if (nextError) throw nextError;
  return { req, res, nextCalled };
}

function createExpiredToken() {
  const originalNow = Date.now;
  try {
    Date.now = () => originalNow() - (12 * 60 * 60 + 2) * 1000;
    return createAuthToken("507f1f77bcf86cd799439011");
  } finally {
    Date.now = originalNow;
  }
}

test("authentication rejects missing and invalid access tokens", async () => {
  const missing = await authenticateRequest(createRequest(undefined));
  assert.equal(missing.res.statusCode, 401);
  assert.equal(missing.nextCalled, false);

  const invalid = await authenticateRequest(
    createRequest("Bearer not.a.valid.token"),
  );
  assert.equal(invalid.res.statusCode, 401);
  assert.match(invalid.res.body.message, /invalid or expired/i);
  assert.equal(invalid.nextCalled, false);
});

test("authentication rejects expired access tokens", async () => {
  const result = await authenticateRequest(
    createRequest(`Bearer ${createExpiredToken()}`),
  );
  assert.equal(result.res.statusCode, 401);
  assert.match(result.res.body.message, /invalid or expired/i);
  assert.equal(result.nextCalled, false);
});

test("authentication takes identity and role from the database user", async () => {
  const user = {
    _id: "507f1f77bcf86cd799439011",
    role: "Technician",
    status: "active",
    fullName: "Verified Technician",
  };
  let lookedUpId;
  User.findById = (id) => {
    lookedUpId = String(id);
    return { select: async () => user };
  };

  const token = createAuthToken(user._id);
  const result = await authenticateRequest(
    createRequest(`Bearer ${token}`, {
      id: "507f1f77bcf86cd799439099",
      role: "ICT Admin",
    }),
  );

  assert.equal(result.nextCalled, true);
  assert.equal(lookedUpId, user._id);
  assert.deepEqual(result.req.user, {
    id: user._id,
    role: user.role,
    name: user.fullName,
    status: user.status,
  });
});
