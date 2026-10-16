const { afterEach, test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Assignment = require("../models/Assignment");
const MaintenanceRecord = require("../models/MaintenanceRecord");
const Notification = require("../models/Notification");
const Technician = require("../models/Technician");
const Ticket = require("../models/Ticket");
const User = require("../models/User");
const {
  getTicketById,
  submitTechnicianFeedback,
  updateStatus,
} = require("../controllers/ticketController");
const { errorHandler } = require("../middleware/errorHandler");

const originals = {
  startSession: mongoose.startSession,
  assignmentExists: Assignment.exists,
  assignmentFind: Assignment.find,
  assignmentUpdateMany: Assignment.updateMany,
  maintenanceCreate: MaintenanceRecord.create,
  maintenanceFindOne: MaintenanceRecord.findOne,
  notificationCreate: Notification.create,
  technicianFindOne: Technician.findOne,
  ticketFindById: Ticket.findById,
  ticketFindByIdAndUpdate: Ticket.findByIdAndUpdate,
  userFind: User.find,
};

afterEach(() => {
  mongoose.startSession = originals.startSession;
  Assignment.exists = originals.assignmentExists;
  Assignment.find = originals.assignmentFind;
  Assignment.updateMany = originals.assignmentUpdateMany;
  MaintenanceRecord.create = originals.maintenanceCreate;
  MaintenanceRecord.findOne = originals.maintenanceFindOne;
  Notification.create = originals.notificationCreate;
  Technician.findOne = originals.technicianFindOne;
  Ticket.findById = originals.ticketFindById;
  Ticket.findByIdAndUpdate = originals.ticketFindByIdAndUpdate;
  User.find = originals.userFind;
});

const makeId = () => new mongoose.Types.ObjectId();

function makeTicket(overrides = {}) {
  return {
    _id: makeId(),
    ticketId: "MAU-1001",
    status: "accepted",
    requester: makeId(),
    assignedTechnician: makeId(),
    technicianFeedback: null,
    markModified() {},
    async save() {},
    ...overrides,
  };
}

function resolvedTechnicianReport(userId, overrides = {}) {
  return {
    diagnosis: "The network adapter failed its hardware diagnostics.",
    workPerformed: "Repaired the network adapter and verified connectivity.",
    repairResult: "Resolved",
    technicianConfirmed: true,
    technician: { technicianId: userId, technicianName: "Test User" },
    ...overrides,
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

function makeQuery(value) {
  return {
    populate() {
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve(value).then(resolve, reject);
    },
  };
}

function configureModels(
  ticket,
  { technician, activeAssignment = false, previousDiagnosis = null } = {},
) {
  let persistedRecord = null;
  let latestDiagnosis = previousDiagnosis
    ? { diagnosis: previousDiagnosis }
    : null;
  let ticketLookupId = null;
  let assignmentQuery = null;
  let statusUpdateCount = 0;
  mongoose.startSession = async () => ({
    withTransaction: async (callback) => callback(),
    endSession: async () => {},
  });
  Ticket.findById = async (id) => {
    ticketLookupId = id;
    return ticket;
  };
  Ticket.findByIdAndUpdate = (_id, update) => {
    statusUpdateCount += 1;
    Object.assign(ticket, update);
    return makeQuery({
      ...ticket,
      requester: { _id: ticket.requester },
      assignedTechnician: ticket.assignedTechnician
        ? { _id: ticket.assignedTechnician }
        : null,
    });
  };
  Technician.findOne = async () => technician || null;
  Assignment.exists = async (query) => {
    assignmentQuery = query;
    return activeAssignment ? { _id: makeId() } : null;
  };
  Assignment.updateMany = async () => ({ modifiedCount: 1 });
  Assignment.find = () => ({
    select() {
      return this;
    },
    populate() {
      return this;
    },
    sort() {
      return this;
    },
    async lean() {
      return [];
    },
  });
  MaintenanceRecord.create = async (records) => {
    const [record] = Array.isArray(records) ? records : [records];
    persistedRecord = { _id: makeId(), createdAt: new Date(), ...record };
    if (persistedRecord.diagnosis) latestDiagnosis = persistedRecord;
    return [persistedRecord];
  };
  MaintenanceRecord.findOne = () => ({
    sort() {
      return this;
    },
    select() {
      return this;
    },
    async lean() {
      return latestDiagnosis;
    },
  });
  Notification.create = async (notification) => notification;
  User.find = () => ({
    select: async () => [],
  });
  return {
    get persistedRecord() {
      return persistedRecord;
    },
    get latestDiagnosis() {
      return latestDiagnosis;
    },
    get ticketLookupId() {
      return ticketLookupId;
    },
    get assignmentQuery() {
      return assignmentQuery;
    },
    get statusUpdateCount() {
      return statusUpdateCount;
    },
  };
}

async function callUpdateStatus({ ticketId, userId, role = "Technician", body }) {
  const req = {
    params: { id: String(ticketId) },
    user: { id: userId, role, name: "Test User" },
    body,
  };
  const res = makeResponse();
  let nextError;
  await updateStatus(req, res, (error) => {
    nextError = error;
  });
  if (nextError) throw nextError;
  return res;
}

async function callSubmitTechnicianFeedback({ ticketId, userId, body }) {
  const req = {
    params: { id: String(ticketId) },
    user: { id: userId, role: "Technician", name: "Test User" },
    body,
  };
  const res = makeResponse();
  let nextError;
  await submitTechnicianFeedback(req, res, (error) => {
    nextError = error;
  });
  if (nextError) throw nextError;
  return res;
}

async function callGetTicketById({ ticketId, userId, role = "ICT Admin" }) {
  const req = {
    params: { id: String(ticketId) },
    user: { id: userId, role },
  };
  const res = makeResponse();
  let nextError;
  await getTicketById(req, res, (error) => {
    nextError = error;
  });
  if (nextError) throw nextError;
  return res;
}

test("assigned technician updates status and persists maintenance fields", async () => {
  const userId = makeId();
  const techId = makeId();
  const ticket = makeTicket({ assignedTechnician: userId.toHexString() });
  const models = configureModels(ticket, {
    technician: { _id: techId },
  });

  const response = await callUpdateStatus({
    ticketId: ticket._id,
    userId,
    body: {
      status: "in_progress",
      actionTaken: "Replaced the damaged power adapter.",
      partsUsed: "65W power adapter",
      notes: "Tested and confirmed stable power.",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.status, "in_progress");
  assert.equal(ticket.status, "in_progress");
  assert.equal(models.persistedRecord.action_taken, "Replaced the damaged power adapter.");
  assert.equal(models.persistedRecord.parts_used, "65W power adapter");
  assert.equal(models.persistedRecord.notes, "Tested and confirmed stable power.");
  assert.equal(String(models.persistedRecord.technician), String(techId));
});

test("status-update maintenance payload matches the database model", async () => {
  const record = new MaintenanceRecord({
    request: makeId(),
    technician: makeId(),
    diagnosis: "The network adapter failed its diagnostics.",
    action_taken: "Repaired the adapter and verified connectivity.",
    parts_used: null,
    notes: null,
    status: "in_progress",
  });

  await assert.doesNotReject(record.validate());
});

test("technician can log activity on the current status without rewriting ticket status", async () => {
  const userId = makeId();
  const techId = makeId();
  const ticket = makeTicket({
    status: "in_progress",
    assignedTechnician: userId,
  });
  const models = configureModels(ticket, { technician: { _id: techId } });

  const response = await callUpdateStatus({
    ticketId: ticket._id,
    userId,
    body: {
      status: "IN_PROGRESS",
      actionTaken: "Checked the repaired workstation and verified operation.",
      partsUsed: "Replacement power cable",
      notes: "Stable after testing.",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.body.message, /status remains "In Progress"/i);
  assert.equal(ticket.status, "in_progress");
  assert.equal(models.statusUpdateCount, 0);
  assert.equal(models.persistedRecord.action_taken, "Checked the repaired workstation and verified operation.");
  assert.equal(models.persistedRecord.parts_used, "Replacement power cable");
  assert.equal(models.persistedRecord.notes, "Stable after testing.");
  assert.equal(String(models.persistedRecord.technician), String(techId));
  assert.ok(models.persistedRecord.createdAt instanceof Date);
});

test("technician activity without a new diagnosis preserves the saved diagnosis", async () => {
  const userId = makeId();
  const savedDiagnosis = "The device overheated because its cooling fan failed.";
  const ticket = makeTicket({
    status: "in_progress",
    assignedTechnician: userId,
  });
  const models = configureModels(ticket, {
    technician: { _id: makeId() },
    previousDiagnosis: savedDiagnosis,
  });

  const response = await callUpdateStatus({
    ticketId: ticket._id,
    userId,
    body: {
      status: "in_progress",
      actionTaken: "Cleaned the fan assembly and tested the device.",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(models.persistedRecord.diagnosis, savedDiagnosis);
  assert.equal(response.body.data.diagnosis, savedDiagnosis);
});

test("technician selecting the current status without activity is a successful no-op", async () => {
  const userId = makeId();
  const ticket = makeTicket({
    status: "in_progress",
    assignedTechnician: userId,
  });
  const models = configureModels(ticket, { technician: { _id: makeId() } });

  const response = await callUpdateStatus({
    ticketId: ticket._id,
    userId,
    body: { status: "in_progress" },
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.body.message, /already "In Progress"/i);
  assert.equal(ticket.status, "in_progress");
  assert.equal(models.statusUpdateCount, 0);
  assert.equal(models.persistedRecord, null);
});

test("assigned technician can resolve a ticket with a confirmed Resolved report", async () => {
  const userId = makeId();
  const ticket = makeTicket({
    status: "in_progress",
    assignedTechnician: userId,
    technicianFeedback: resolvedTechnicianReport(userId),
  });
  const techId = makeId();
  const models = configureModels(ticket, {
    technician: { _id: techId },
  });

  const response = await callUpdateStatus({
    ticketId: ticket._id,
    userId,
    body: {
      status: "resolved",
      diagnosis: "The network adapter failed its hardware diagnostics.",
      actionTaken: "Repaired the network adapter and verified connectivity.",
      partsUsed: "Replacement network adapter",
      notes: "Confirmed stable connectivity after repair.",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(ticket.status, "resolved");
  assert.equal(String(models.ticketLookupId), String(ticket._id));
  assert.equal(models.persistedRecord.status, "resolved");
  assert.equal(
    models.persistedRecord.diagnosis,
    "The network adapter failed its hardware diagnostics.",
  );
  assert.equal(
    response.body.data.diagnosis,
    "The network adapter failed its hardware diagnostics.",
  );
  assert.equal(
    response.body.maintenanceRecord.diagnosis,
    "The network adapter failed its hardware diagnostics.",
  );
  Ticket.findById = () => ({
    populate() {
      return this;
    },
    async lean() {
      return { ...ticket };
    },
  });
  const detailsResponse = await callGetTicketById({
    ticketId: ticket._id,
    userId,
  });
  assert.equal(detailsResponse.statusCode, 200);
  assert.equal(detailsResponse.body.data.status, "resolved");
  assert.equal(
    detailsResponse.body.data.diagnosis,
    "The network adapter failed its hardware diagnostics.",
  );
  assert.equal(
    models.persistedRecord.parts_used,
    "Replacement network adapter",
  );
  assert.equal(
    models.persistedRecord.notes,
    "Confirmed stable connectivity after repair.",
  );
  assert.equal(String(models.persistedRecord.technician), String(techId));
});

test("technician submits a Resolved report, then explicitly resolves the request", async () => {
  const userId = makeId();
  const techId = makeId();
  const ticket = makeTicket({
    status: "in_progress",
    assignedTechnician: userId,
  });
  configureModels(ticket, { technician: { _id: techId } });

  const reportResponse = await callSubmitTechnicianFeedback({
    ticketId: ticket._id,
    userId,
    body: {
      diagnosis: "The network adapter failed its hardware diagnostics.",
      workPerformed: "Repaired the network adapter and verified connectivity.",
      repairResult: "Resolved",
      status: "Fixed",
      timeSpentMinutes: 45,
      followUpRequired: false,
      resolution: "Connectivity is restored.",
      technicianConfirmed: true,
    },
  });

  assert.equal(reportResponse.statusCode, 201);
  assert.equal(reportResponse.body.data.repairResult, "Resolved");
  assert.equal(ticket.status, "in_progress");

  const statusResponse = await callUpdateStatus({
    ticketId: ticket._id,
    userId,
    body: {
      status: "resolved",
      diagnosis: "The network adapter failed its hardware diagnostics.",
      actionTaken: "Repaired the network adapter and verified connectivity.",
    },
  });

  assert.equal(statusResponse.statusCode, 200);
  assert.equal(ticket.status, "resolved");
  assert.equal(statusResponse.body.data.status, "resolved");

  Ticket.findById = () => ({
    populate() {
      return this;
    },
    async lean() {
      return { ...ticket };
    },
  });
  const refreshed = await callGetTicketById({
    ticketId: ticket._id,
    userId,
    role: "Technician",
  });
  assert.equal(refreshed.statusCode, 200);
  assert.equal(refreshed.body.data.status, "resolved");
  assert.equal(
    refreshed.body.data.technician_feedback.repairResult,
    "Resolved",
  );
});

test("assigned technician can resolve from a legacy Resolved report status", async () => {
  const userId = makeId();
  const ticket = makeTicket({
    status: "in_progress",
    assignedTechnician: userId,
    technicianFeedback: resolvedTechnicianReport(userId, {
      repairResult: null,
      status: "Resolved",
    }),
  });
  const models = configureModels(ticket, { technician: { _id: makeId() } });

  const response = await callUpdateStatus({
    ticketId: ticket._id,
    userId,
    body: {
      status: "resolved",
      diagnosis: "The network adapter failed its hardware diagnostics.",
      actionTaken: "Repaired the network adapter and verified connectivity.",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(ticket.status, "resolved");
  assert.equal(models.persistedRecord.status, "resolved");
});

test("resolved ticket accepts empty optional parts and notes with a Resolved report", async () => {
  const userId = makeId();
  const ticket = makeTicket({
    status: "in_progress",
    assignedTechnician: userId,
    technicianFeedback: resolvedTechnicianReport(userId),
  });
  const models = configureModels(ticket, { technician: { _id: makeId() } });

  const response = await callUpdateStatus({
    ticketId: ticket._id,
    userId,
    body: {
      status: "resolved",
      diagnosis: "The device failed its network adapter diagnostics.",
      actionTaken: "Repaired the network adapter and verified connectivity.",
      partsUsed: null,
      notes: null,
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(ticket.status, "resolved");
  assert.equal(models.persistedRecord.parts_used, null);
  assert.equal(models.persistedRecord.notes, null);
});

test("Mongoose validation errors return the specific field message", () => {
  const res = makeResponse();
  const error = new mongoose.Error.ValidationError();
  error.errors.action_taken = { message: "Action taken is required." };

  errorHandler(error, {}, res, () => {});

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, "Action taken is required.");
  assert.equal(res.body.field, "action_taken");
  assert.equal(res.body.errors.action_taken, "Action taken is required.");
});

test("technician cannot move a ticket backward in the workflow", async () => {
  const userId = makeId();
  const ticket = makeTicket({
    status: "in_progress",
    assignedTechnician: userId,
  });
  configureModels(ticket, { technician: { _id: makeId() } });

  const response = await callUpdateStatus({
    ticketId: ticket._id,
    userId,
    body: { status: "accepted" },
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.body.message, /cannot change ticket status/i);
  assert.equal(ticket.status, "in_progress");
});

test("active assignment profile authorizes its linked user account", async () => {
  const userId = makeId();
  const techId = makeId();
  const ticket = makeTicket({ assignedTechnician: makeId() });
  const models = configureModels(ticket, {
    technician: { _id: techId },
    activeAssignment: true,
  });

  const response = await callUpdateStatus({
    ticketId: ticket._id,
    userId,
    body: { status: "in_progress" },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(String(models.assignmentQuery.technician), String(techId));
  assert.equal(String(models.assignmentQuery.ticket), String(ticket._id));
});

test("legacy ticket Technician ID authorizes only its linked user account", async () => {
  const userId = makeId();
  const techId = makeId();
  const ticket = makeTicket({
    status: "in_progress",
    assignedTechnician: techId,
    technicianFeedback: resolvedTechnicianReport(userId),
  });
  configureModels(ticket, { technician: { _id: techId } });

  const response = await callUpdateStatus({
    ticketId: ticket._id,
    userId,
    body: {
      status: "resolved",
      diagnosis: "The network adapter was faulty.",
      actionTaken: "Repaired the network adapter and verified connectivity.",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(ticket.status, "resolved");
});

test("technician cannot resolve a ticket without a confirmed maintenance report", async () => {
  const userId = makeId();
  const ticket = makeTicket({
    status: "in_progress",
    assignedTechnician: userId,
  });
  const models = configureModels(ticket, { technician: { _id: makeId() } });

  const response = await callUpdateStatus({
    ticketId: ticket._id,
    userId,
    body: {
      status: "resolved",
      diagnosis: "The network adapter failed its hardware diagnostics.",
      actionTaken: "Repaired the network adapter and verified connectivity.",
    },
  });

  assert.equal(response.statusCode, 409);
  assert.match(response.body.message, /confirmed maintenance report is required/i);
  assert.equal(ticket.status, "in_progress");
  assert.equal(models.statusUpdateCount, 0);
  assert.equal(models.persistedRecord, null);
});

test("technician cannot resolve a ticket with an unresolved maintenance report", async () => {
  const userId = makeId();
  const ticket = makeTicket({
    status: "in_progress",
    assignedTechnician: userId,
    technicianFeedback: resolvedTechnicianReport(userId, {
      repairResult: "Partially Resolved",
    }),
  });
  const models = configureModels(ticket, { technician: { _id: makeId() } });

  const response = await callUpdateStatus({
    ticketId: ticket._id,
    userId,
    body: {
      status: "resolved",
      diagnosis: "The network adapter failed its hardware diagnostics.",
      actionTaken: "Repaired the adapter; an upstream issue remains.",
    },
  });

  assert.equal(response.statusCode, 409);
  assert.match(response.body.message, /Partially Resolved/);
  assert.match(response.body.message, /Edit and save the report/);
  assert.equal(ticket.status, "in_progress");
  assert.equal(models.statusUpdateCount, 0);
  assert.equal(models.persistedRecord, null);
});

test("technician cannot close a ticket after an unsuccessful repair", async () => {
  const userId = makeId();
  const ticket = makeTicket({
    status: "resolved",
    assignedTechnician: userId,
    technicianFeedback: resolvedTechnicianReport(userId, {
      repairResult: null,
      status: "Not Fixed",
    }),
  });
  const models = configureModels(ticket, { technician: { _id: makeId() } });

  const response = await callUpdateStatus({
    ticketId: ticket._id,
    userId,
    body: { status: "closed" },
  });

  assert.equal(response.statusCode, 409);
  assert.match(response.body.message, /Not Resolved/);
  assert.equal(ticket.status, "resolved");
  assert.equal(models.statusUpdateCount, 0);
});

test("technician cannot resolve a ticket with an incomplete maintenance report", async () => {
  const userId = makeId();
  const ticket = makeTicket({
    status: "in_progress",
    assignedTechnician: userId,
    technicianFeedback: resolvedTechnicianReport(userId, {
      diagnosis: " ",
    }),
  });
  const models = configureModels(ticket, { technician: { _id: makeId() } });

  const response = await callUpdateStatus({
    ticketId: ticket._id,
    userId,
    body: {
      status: "resolved",
      diagnosis: "The network adapter failed its hardware diagnostics.",
      actionTaken: "Repaired the network adapter and verified connectivity.",
    },
  });

  assert.equal(response.statusCode, 409);
  assert.match(response.body.message, /report is incomplete/i);
  assert.equal(ticket.status, "in_progress");
  assert.equal(models.statusUpdateCount, 0);
  assert.equal(models.persistedRecord, null);
});

test("technician cannot resolve a ticket without a diagnosis", async () => {
  const userId = makeId();
  const ticket = makeTicket({
    status: "in_progress",
    assignedTechnician: userId,
  });
  const models = configureModels(ticket, { technician: { _id: makeId() } });

  const response = await callUpdateStatus({
    ticketId: ticket._id,
    userId,
    body: {
      status: "resolved",
      diagnosis: "   ",
      actionTaken: "Repaired the network adapter and verified connectivity.",
    },
  });

  assert.equal(response.statusCode, 422);
  assert.equal(
    response.body.message,
    "Please enter the diagnosis before resolving this request.",
  );
  assert.equal(response.body.field, "diagnosis");
  assert.equal(ticket.status, "in_progress");
  assert.equal(models.persistedRecord, null);
});

test("technician cannot update a ticket assigned to another user", async () => {
  const ticket = makeTicket();
  configureModels(ticket, { technician: { _id: makeId() } });

  const response = await callUpdateStatus({
    ticketId: ticket._id,
    userId: makeId(),
    body: { status: "in_progress" },
  });

  assert.equal(response.statusCode, 403);
  assert.match(response.body.message, /assigned to you/i);
  assert.equal(ticket.status, "accepted");
});

test("technician cannot update an unassigned ticket", async () => {
  const ticket = makeTicket({ assignedTechnician: null });
  configureModels(ticket, { technician: { _id: makeId() } });

  const response = await callUpdateStatus({
    ticketId: ticket._id,
    userId: makeId(),
    body: { status: "in_progress" },
  });

  assert.equal(response.statusCode, 403);
  assert.match(response.body.message, /ask an ict admin/i);
  assert.equal(ticket.status, "accepted");
});

test("ICT Admin can update status without technician assignment", async () => {
  const ticket = makeTicket();
  configureModels(ticket);

  const response = await callUpdateStatus({
    ticketId: ticket._id,
    userId: makeId(),
    role: "ICT Admin",
    body: { status: "in_progress" },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(ticket.status, "in_progress");
});

test("invalid ticket ID is rejected with HTTP 400", async () => {
  const response = await callUpdateStatus({
    ticketId: "invalid",
    userId: makeId(),
    body: { status: "in_progress" },
  });

  assert.equal(response.statusCode, 400);
});

test("missing ticket returns HTTP 404", async () => {
  configureModels(null);

  const response = await callUpdateStatus({
    ticketId: makeId(),
    userId: makeId(),
    body: { status: "in_progress" },
  });

  assert.equal(response.statusCode, 404);
  assert.match(response.body.message, /ticket not found/i);
});

test("maintenance details require a non-empty action taken", async () => {
  const userId = makeId();
  const ticket = makeTicket({ assignedTechnician: userId });
  configureModels(ticket, { technician: { _id: makeId() } });

  const response = await callUpdateStatus({
    ticketId: ticket._id,
    userId,
    body: { status: "in_progress", partsUsed: "Cable" },
  });

  assert.equal(response.statusCode, 422);
  assert.equal(response.body.field, "actionTaken");
});

test("invalid ticket status is rejected with a useful message", async () => {
  const userId = makeId();
  const ticket = makeTicket({ assignedTechnician: userId });
  configureModels(ticket, { technician: { _id: makeId() } });

  const response = await callUpdateStatus({
    ticketId: ticket._id,
    userId,
    body: { status: "done" },
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.body.message, /status/i);
  assert.equal(ticket.status, "accepted");
});
