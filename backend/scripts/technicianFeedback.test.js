const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");
const TechnicianFeedback = require("../models/TechnicianFeedback");

const categories = [
  "Technical Difficulty",
  "Spare Parts Shortage",
  "Recurring Fault",
  "Resource Problem",
  "Safety Concern",
  "Improvement Suggestion",
];
const statuses = [
  "Submitted",
  "Under Review",
  "Action Required",
  "Resolved",
];

test("technician feedback schema accepts the required feature fields", async () => {
  const feedback = new TechnicianFeedback({
    technician: new mongoose.Types.ObjectId(),
    technicianName: "ICT Technician",
    category: "Technical Difficulty",
    description: "Network switch repeatedly drops its uplink.",
    recommendation: "Inspect and replace the faulty switch module.",
    followUpRequired: true,
  });

  await assert.doesNotReject(feedback.validate());
  assert.equal(feedback.status, "Submitted");
  assert.equal(feedback.followUpRequired, true);
  assert.ok(feedback.submittedAt instanceof Date);
});

test("technician feedback schema exposes the six requested categories and statuses", () => {
  const categoryValues = TechnicianFeedback.schema.path("category").enumValues;
  const statusValues = TechnicianFeedback.schema.path("status").enumValues;

  categories.forEach((category) => assert.ok(categoryValues.includes(category)));
  statuses.forEach((status) => assert.ok(statusValues.includes(status)));
});

test("technician feedback schema rejects invalid category, status, and oversized text", async () => {
  const feedback = new TechnicianFeedback({
    technician: new mongoose.Types.ObjectId(),
    category: "Invalid category",
    description: "x".repeat(2001),
    status: "Closed",
  });

  await assert.rejects(feedback.validate(), (error) => {
    assert.ok(error.errors.category);
    assert.ok(error.errors.description);
    assert.ok(error.errors.followUpRequired);
    assert.ok(error.errors.status);
    return true;
  });
});
