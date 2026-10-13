const { afterEach, test } = require("node:test");
const assert = require("node:assert/strict");
const Ticket = require("../models/Ticket");
const Feedback = require("../models/Feedback");
const User = require("../models/User");
const Notification = require("../models/Notification");
const { submitRequesterFeedback } = require("../controllers/ticketController");

const originals = {
  ticketFindById: Ticket.findById,
  feedbackExists: Feedback.exists,
  feedbackCreate: Feedback.create,
  userFindById: User.findById,
  userFind: User.find,
  notificationInsertMany: Notification.insertMany,
};

afterEach(() => {
  Ticket.findById = originals.ticketFindById;
  Feedback.exists = originals.feedbackExists;
  Feedback.create = originals.feedbackCreate;
  User.findById = originals.userFindById;
  User.find = originals.userFind;
  Notification.insertMany = originals.notificationInsertMany;
});

function makeRequest(ticket, body = {}, requesterId = "507f1f77bcf86cd799439011") {
  Ticket.findById = async () => ticket;
  Feedback.exists = async () => false;
  return {
    params: { id: String(ticket._id) },
    body,
    user: { id: requesterId, role: "Requester" },
  };
}

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

function makeTicket(overrides = {}) {
  return {
    _id: "507f1f77bcf86cd799439021",
    requester: "507f1f77bcf86cd799439011",
    status: "resolved",
    ticketId: "MAU-1234",
    assignedTechnician: null,
    requesterFeedback: null,
    feedbackRating: null,
    feedbackComments: null,
    markModified() {},
    async save() {},
    ...overrides,
  };
}

const completeFeedback = {
  overallRating: 5,
  serviceQuality: "Excellent",
  repairQuality: "Fully Fixed",
  technicianProfessionalism: "Excellent",
  responseTimeliness: "Good",
  communication: "Excellent",
  satisfactionLevel: "Very Satisfied",
  wouldRecommend: "Yes",
  followUpRequested: false,
  comment: "The issue was resolved.",
};

async function submit(request) {
  const response = makeResponse();
  let nextError;
  await submitRequesterFeedback(request, response, (error) => {
    nextError = error;
  });
  if (nextError) throw nextError;
  return response;
}

test("rejects feedback for another requester's ticket", async () => {
  const ticket = makeTicket();
  const response = await submit(
    makeRequest(ticket, completeFeedback, "507f1f77bcf86cd799439099"),
  );

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.success, false);
});

test("rejects submissions from non-requester roles", async () => {
  const ticket = makeTicket();
  const request = makeRequest(ticket, completeFeedback);
  request.user.role = "Technician";
  const response = await submit(request);

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.success, false);
});

test("rejects feedback before the maintenance request is resolved", async () => {
  const ticket = makeTicket({ status: "in_progress" });
  const response = await submit(makeRequest(ticket, completeFeedback));

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.success, false);
});

test("requires follow-up when repair quality is Not Fixed", async () => {
  const ticket = makeTicket();
  const response = await submit(
    makeRequest(ticket, { ...completeFeedback, repairQuality: "Not Fixed" }),
  );

  assert.equal(response.statusCode, 422);
  assert.match(response.body.message, /follow-up request is required/i);
});

test("saves linked feedback without changing ticket status", async () => {
  const ticket = makeTicket();
  const feedbackId = "507f1f77bcf86cd799439031";
  Ticket.findById = async () => ticket;
  Feedback.exists = async () => false;
  Feedback.create = async (data) => ({ _id: feedbackId, ...data });
  const requester = {
    _id: ticket.requester,
    fullName: "Test Requester",
  };
  User.findById = () => ({ select: async () => requester });

  const response = await submit({
    params: { id: String(ticket._id) },
    body: completeFeedback,
    user: { id: ticket.requester, role: "Requester" },
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.success, true);
  assert.equal(ticket.status, "resolved");
  assert.equal(ticket.requesterFeedback.feedbackId, feedbackId);
  assert.equal(ticket.requesterFeedback.repairQuality, "Fully Fixed");
  assert.equal(ticket.requesterFeedback.followUpRequested, false);
  assert.ok(ticket.requesterFeedback.submittedAt instanceof Date);
});

test("records and notifies a pending follow-up without reopening the ticket", async () => {
  const technicianId = "507f1f77bcf86cd799439041";
  const ticket = makeTicket({ assignedTechnician: technicianId });
  const feedbackId = "507f1f77bcf86cd799439031";
  Ticket.findById = async () => ticket;
  Feedback.exists = async () => false;
  Feedback.create = async (data) => ({ _id: feedbackId, ...data });
  const requester = {
    _id: ticket.requester,
    fullName: "Test Requester",
  };
  User.findById = () => ({ select: async () => requester });
  User.find = () => ({
    select: () => ({
      lean: async () => [{ _id: "507f1f77bcf86cd799439051" }],
    }),
  });
  let notifications = [];
  Notification.insertMany = async (records) => {
    notifications = records;
    return [];
  };

  const response = await submit({
    params: { id: String(ticket._id) },
    body: {
      ...completeFeedback,
      repairQuality: "Not Fixed",
      followUpRequested: true,
    },
    user: { id: ticket.requester, role: "Requester" },
  });

  assert.equal(response.statusCode, 201);
  assert.equal(ticket.status, "resolved");
  assert.equal(ticket.requesterFeedback.followUpRequested, true);
  assert.equal(ticket.requesterFeedback.followUpStatus, "Pending");
  assert.deepEqual(
    notifications.map((notification) => String(notification.user)).sort(),
    ["507f1f77bcf86cd799439041", "507f1f77bcf86cd799439051"],
  );
});

test("rejects a duplicate standalone feedback record", async () => {
  const ticket = makeTicket();
  const request = makeRequest(ticket, completeFeedback);
  Feedback.exists = async () => true;
  const response = await submit(request);

  assert.equal(response.statusCode, 409);
  assert.equal(response.body.success, false);
});

test("validates rating bounds and repair-quality options at the schema layer", () => {
  const feedback = new Feedback({
    request: "507f1f77bcf86cd799439021",
    user: "507f1f77bcf86cd799439011",
    rating: 6,
    repairQuality: "Unknown",
  });
  const error = feedback.validateSync();

  assert.ok(error.errors.rating);
  assert.ok(error.errors.repairQuality);
});
