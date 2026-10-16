const { afterEach, test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Assignment = require("../models/Assignment");
const Technician = require("../models/Technician");
const { getMyAssignments } = require("../controllers/technicianController");

const originals = {
  assignmentFind: Assignment.find,
  technicianFindOne: Technician.findOne,
};

afterEach(() => {
  Assignment.find = originals.assignmentFind;
  Technician.findOne = originals.technicianFindOne;
});

const makeId = () => new mongoose.Types.ObjectId();

function makeResponse() {
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

function configureModels(assignments) {
  Technician.findOne = async () => ({ _id: makeId() });
  Assignment.find = () => ({
    populate() {
      return this;
    },
    sort() {
      return this;
    },
    lean: async () => assignments,
  });
}

async function callGetMyAssignments() {
  const response = makeResponse();
  let nextError;
  await getMyAssignments(
    { user: { id: makeId() } },
    response,
    (error) => {
      nextError = error;
    },
  );
  if (nextError) throw nextError;
  return response;
}

test("assignment response always includes nullable technician feedback", async () => {
  const withoutFeedbackId = makeId();
  const withFeedbackId = makeId();
  const legacyFeedbackId = makeId();
  const lowercaseFeedbackId = makeId();
  configureModels([
    {
      _id: makeId(),
      status: "completed",
      technician: { _id: makeId(), user: { _id: makeId(), fullName: "Tech" } },
      ticket: {
        _id: withoutFeedbackId,
        ticketId: "MAU-1001",
        status: "resolved",
      },
    },
    {
      _id: makeId(),
      status: "completed",
      technician: { _id: makeId(), user: { _id: makeId(), fullName: "Tech" } },
      ticket: {
        _id: withFeedbackId,
        ticketId: "MAU-1002",
        status: "resolved",
        technicianFeedback: {
          technicianConfirmed: true,
          diagnosis: "Fault identified",
          workPerformed: "Replaced cable",
          repairResult: "Resolved",
          status: "Fixed",
          resolution: "Connection restored",
          completionDate: new Date("2026-10-01T10:00:00Z"),
        },
      },
    },
    {
      _id: makeId(),
      status: "completed",
      technician: { _id: makeId(), user: { _id: makeId(), fullName: "Tech" } },
      ticket: {
        _id: legacyFeedbackId,
        ticketId: "MAU-1003",
        status: "resolved",
        technicianFeedback: {
          technicianConfirmed: true,
          diagnosis: "Legacy report",
          workPerformed: "Repaired cable",
          repairResult: null,
          status: "Fixed",
        },
      },
    },
    {
      _id: makeId(),
      status: "completed",
      technician: { _id: makeId(), user: { _id: makeId(), fullName: "Tech" } },
      ticket: {
        _id: lowercaseFeedbackId,
        ticketId: "MAU-1004",
        status: "resolved",
        technicianFeedback: {
          technicianConfirmed: true,
          diagnosis: "Legacy result",
          workPerformed: "Repaired cable",
          repairResult: "resolved",
          status: "Fixed",
        },
      },
    },
  ]);

  const response = await callGetMyAssignments();

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  const [
    withoutFeedback,
    withFeedback,
    legacyFeedback,
    lowercaseFeedback,
  ] = response.body.data;
  assert.equal(withoutFeedback.technician_feedback, null);
  assert.equal(withoutFeedback.technician_report, null);
  assert.equal(withoutFeedback.has_feedback, false);
  assert.deepEqual(
    withFeedback.technician_feedback,
    withFeedback.technician_report,
  );
  assert.equal(withFeedback.has_feedback, true);
  assert.equal(withFeedback.technician_feedback.diagnosis, "Fault identified");
  assert.equal(withFeedback.technician_feedback.repairResult, "Resolved");
  assert.equal(legacyFeedback.technician_feedback.repairResult, "Resolved");
  assert.equal(lowercaseFeedback.technician_feedback.repairResult, "Resolved");
  assert.equal(
    withFeedback.technician_feedback.completionDate.toISOString(),
    "2026-10-01T10:00:00.000Z",
  );
});
