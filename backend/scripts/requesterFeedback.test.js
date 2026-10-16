const assert = require("node:assert/strict");
const express = require("express");
const { once } = require("node:events");
const test = require("node:test");
const mongoose = require("mongoose");
const RequesterFeedback = require("../models/RequesterFeedback");
const { submitRequesterFeedback } = require("../controllers/requesterFeedbackController");
const requesterFeedbackRoutes = require("../routes/requesterFeedback");

function validFeedback(overrides = {}) {
  return new RequesterFeedback({
    ticket: new mongoose.Types.ObjectId(),
    requester: new mongoose.Types.ObjectId(),
    technician: new mongoose.Types.ObjectId(),
    problemFixed: "Yes",
    equipmentWorkingProperly: "Yes",
    technicianRating: 5,
    satisfactionRating: 4,
    ...overrides,
  });
}

async function callSubmit(body) {
  const response = {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
  let nextError;
  await submitRequesterFeedback(
    { user: { id: new mongoose.Types.ObjectId(), role: "Requester" }, body },
    response,
    (error) => {
      nextError = error;
    },
  );
  if (nextError) throw nextError;
  return response;
}

test("requester feedback accepts valid completed-request responses", async () => {
  const feedback = validFeedback();
  await assert.doesNotReject(feedback.validate());
  assert.equal(feedback.status, "Submitted");
});

test("requester feedback requires comments for incomplete work or equipment faults", async () => {
  for (const answers of [
    { problemFixed: "Partially" },
    { problemFixed: "No" },
    { equipmentWorkingProperly: "No" },
  ]) {
    await assert.rejects(validFeedback(answers).validate(), (error) => {
      assert.ok(error.errors.comments);
      return true;
    });
  }

  await assert.doesNotReject(
    validFeedback({ problemFixed: "Partially", comments: "The issue remains." }).validate(),
  );
});

test("requester feedback constrains answer values and star ratings", async () => {
  await assert.rejects(
    validFeedback({ technicianRating: 6 }).validate(),
    (error) => Boolean(error.errors.technicianRating),
  );
  await assert.rejects(
    validFeedback({ satisfactionRating: 2.5 }).validate(),
    (error) => Boolean(error.errors.satisfactionRating),
  );
  await assert.rejects(
    validFeedback({ equipmentWorkingProperly: "Maybe" }).validate(),
    (error) => Boolean(error.errors.equipmentWorkingProperly),
  );
});

test("requester feedback enforces one feedback record per maintenance request", () => {
  const ticketIndexes = RequesterFeedback.schema.indexes().filter(
    ([keys, options]) => keys.ticket === 1 && options.unique === true,
  );
  assert.equal(ticketIndexes.length, 1);
});

test("Requester API validation rejects missing requests, invalid ratings, and required comments", async () => {
  const missingRequest = await callSubmit({});
  assert.equal(missingRequest.statusCode, 400);

  const invalidRating = await callSubmit({
    ticketId: "MAU-1000",
    problemFixed: "Yes",
    equipmentWorkingProperly: "Yes",
    technicianRating: 6,
    satisfactionRating: 4,
  });
  assert.equal(invalidRating.statusCode, 400);

  const missingExplanation = await callSubmit({
    ticketId: "MAU-1000",
    problemFixed: "Partially",
    equipmentWorkingProperly: "Yes",
    technicianRating: 4,
    satisfactionRating: 3,
  });
  assert.equal(missingExplanation.statusCode, 400);
});

test("requester feedback endpoints are registered and reject unauthenticated access", async () => {
  const app = express();
  app.use("/api/requester-feedback", requesterFeedbackRoutes);
  const server = app.listen(0);
  await once(server, "listening");
  try {
    for (const path of ["eligible-requests", "mine"]) {
      const response = await fetch(
        `http://127.0.0.1:${server.address().port}/api/requester-feedback/${path}`,
      );
      assert.equal(response.status, 401, `${path} should require authentication`);
      assert.equal((await response.json()).message, "Not authenticated.");
    }
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
