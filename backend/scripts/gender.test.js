const test = require("node:test");
const assert = require("node:assert/strict");
const User = require("../models/User");
const { normalizeGender } = require("../utils/gender");

test("normalizes accepted gender values to the canonical schema labels", () => {
  assert.equal(normalizeGender(" male "), "Male");
  assert.equal(normalizeGender("FEMALE"), "Female");
  assert.equal(normalizeGender("Other"), "Other");
  assert.equal(normalizeGender(" prefer NOT to say "), "Prefer not to say");
});

test("preserves empty gender as null and does not rewrite unknown values", () => {
  assert.equal(normalizeGender(null), null);
  assert.equal(normalizeGender("  "), null);
  assert.equal(normalizeGender("Nonbinary"), "Nonbinary");
});

test("User schema normalizes gender before persistence validation", () => {
  const user = new User({
    fullName: "Test User",
    email: "test@example.com",
    password: "password123",
    gender: " female ",
  });

  assert.equal(user.gender, "Female");
  assert.equal(user.validateSync(), undefined);
});
