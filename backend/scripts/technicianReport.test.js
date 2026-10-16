const { afterEach, test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Assignment = require("../models/Assignment");
const Notification = require("../models/Notification");
const Technician = require("../models/Technician");
const Ticket = require("../models/Ticket");
const User = require("../models/User");
const { submitTechnicianFeedback } = require("../controllers/ticketController");

const originals = {
  assignmentExists: Assignment.exists,
  assignmentUpdateMany: Assignment.updateMany,
  notificationCreate: Notification.create,
  technicianFindOne: Technician.findOne,
  ticketFindById: Ticket.findById,
  userFind: User.find,
};

afterEach(() => {
  Assignment.exists = originals.assignmentExists;
  Assignment.updateMany = originals.assignmentUpdateMany;
  Notification.create = originals.notificationCreate;
  Technician.findOne = originals.technicianFindOne;
  Ticket.findById = originals.ticketFindById;
  User.find = originals.userFind;
});

const makeId = () => new mongoose.Types.ObjectId();

function configureReportRequest({
  ticket = {},
  userId = makeId(),
  assigned = true,
} = {}) {
  let saveCount = 0;
  const techId = makeId();
  const document = {
    _id: makeId(),
    ticketId: "MAU-1001",
    status: "in_progress",
    requester: null,
    assignedTechnician: assigned ? userId : makeId(),
    technicianFeedback: null,
    markModified() {},
    async save() {
      saveCount += 1;
    },
    ...ticket,
  };
  Ticket.findById = async () => document;
  Technician.findOne = async () => ({ _id: techId });
  Assignment.exists = async () => (assigned ? { _id: makeId() } : null);
  Assignment.updateMany = async () => ({ modifiedCount: 1 });
  Notification.create = async (notification) => notification;
  User.find = () => ({ select: async () => [] });
  return {
    ticket: document,
    userId,
    get saveCount() {
      return saveCount;
    },
  };
}

async function submit({ ticketId, userId, body }) {
  const req = {
    params: { id: String(ticketId) },
    user: { id: userId, role: "Technician", name: "Test Technician" },
    body,
  };
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
  };
  let nextError;
  await submitTechnicianFeedback(req, res, (error) => {
    nextError = error;
  });
  if (nextError) throw nextError;
  return res;
}

function validReport(overrides = {}) {
  return {
    diagnosis: "The network adapter failed its diagnostics.",
    workPerformed: "Repaired the adapter and verified connectivity.",
    repairResult: "Partially Resolved",
    status: "In Progress",
    timeSpentMinutes: 45,
    followUpRequired: false,
    resolution: "Connectivity is restored pending long-term monitoring.",
    partsUsed: "Replacement network adapter",
    reasonNotFixed: "",
    recommendation: "",
    technicianNotes: "Retest after one week.",
    technicianConfirmed: true,
    ...overrides,
  };
}

test("submits and persists a maintenance report without resolving partial work", async () => {
  const state = configureReportRequest();
  const response = await submit({
    ticketId: state.ticket._id,
    userId: state.userId,
    body: validReport(),
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.success, true);
  assert.equal(state.saveCount, 1);
  assert.equal(state.ticket.status, "in_progress");
  assert.equal(state.ticket.technicianFeedback.diagnosis, validReport().diagnosis);
  assert.equal(
    state.ticket.technicianFeedback.workPerformed,
    validReport().workPerformed,
  );
  assert.equal(state.ticket.technicianFeedback.partsUsed, "Replacement network adapter");
  assert.equal(state.ticket.technicianFeedback.timeSpentMinutes, 45);
  assert.equal(
    String(state.ticket.technicianFeedback.technician.technicianId),
    String(state.userId),
  );
  assert.equal(response.body.data.technicianConfirmed, true);
});

test("submits a Resolved report without advancing ticket status", async () => {
  const state = configureReportRequest();
  state.ticket.status = "in_progress";
  const response = await submit({
    ticketId: state.ticket._id,
    userId: state.userId,
    body: validReport({ repairResult: "Resolved", status: "Fixed" }),
  });

  assert.equal(response.statusCode, 201);
  assert.equal(state.ticket.status, "in_progress");
  assert.equal(state.ticket.isFixed, true);
  assert.equal(state.ticket.technicianFeedback.repairResult, "Resolved");
  assert.equal(response.body.data.repairResult, "Resolved");
  assert.match(response.body.message, /status separately/i);
});

test("requires diagnosis and work performed", async () => {
  for (const [field, overrides, expected] of [
    ["diagnosis", { diagnosis: "   " }, "Diagnosis is required."],
    ["workPerformed", { workPerformed: "   " }, "Work performed is required."],
  ]) {
    const state = configureReportRequest();
    const response = await submit({
      ticketId: state.ticket._id,
      userId: state.userId,
      body: validReport(overrides),
    });
    assert.equal(response.statusCode, 422, field);
    assert.equal(response.body.message, expected, field);
    assert.equal(response.body.field, field);
    assert.equal(state.saveCount, 0);
  }
});

test("requires explicit confirmation of the submitted report", async () => {
  const state = configureReportRequest();
  const response = await submit({
    ticketId: state.ticket._id,
    userId: state.userId,
    body: validReport({ technicianConfirmed: false }),
  });

  assert.equal(response.statusCode, 422);
  assert.equal(response.body.field, "technicianConfirmed");
  assert.equal(state.saveCount, 0);
});

test("rejects invalid, fractional, and negative time spent", async () => {
  for (const timeSpentMinutes of [-1, 1.5, 10081]) {
    const state = configureReportRequest();
    const response = await submit({
      ticketId: state.ticket._id,
      userId: state.userId,
      body: validReport({ timeSpentMinutes }),
    });
    assert.equal(response.statusCode, 422);
    assert.equal(response.body.field, "timeSpentMinutes");
    assert.equal(state.saveCount, 0);
  }
});

test("rejects non-text report fields", async () => {
  const state = configureReportRequest();
  const response = await submit({
    ticketId: state.ticket._id,
    userId: state.userId,
    body: validReport({ workPerformed: 123 }),
  });

  assert.equal(response.statusCode, 422);
  assert.equal(response.body.message, "Work performed must be text.");
  assert.equal(response.body.field, "workPerformed");
  assert.equal(state.saveCount, 0);
});

test("rejects an invalid ticket ID and an unassigned technician", async () => {
  const invalidIdResponse = await submit({
    ticketId: "invalid",
    userId: makeId(),
    body: validReport(),
  });
  assert.equal(invalidIdResponse.statusCode, 400);

  const state = configureReportRequest({ assigned: false });
  const response = await submit({
    ticketId: state.ticket._id,
    userId: state.userId,
    body: validReport(),
  });
  assert.equal(response.statusCode, 403);
  assert.equal(state.saveCount, 0);
});

test("repeated submissions return the saved report without creating another", async () => {
  const state = configureReportRequest();
  const body = validReport();
  const firstResponse = await submit({
    ticketId: state.ticket._id,
    userId: state.userId,
    body,
  });
  const secondResponse = await submit({
    ticketId: state.ticket._id,
    userId: state.userId,
    body,
  });

  assert.equal(firstResponse.statusCode, 201);
  assert.equal(secondResponse.statusCode, 200);
  assert.match(secondResponse.body.message, /already submitted/i);
  assert.equal(state.saveCount, 1);
});
