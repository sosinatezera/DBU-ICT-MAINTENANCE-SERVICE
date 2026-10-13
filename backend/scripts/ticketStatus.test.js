const { afterEach, test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Assignment = require("../models/Assignment");
const MaintenanceRecord = require("../models/MaintenanceRecord");
const Notification = require("../models/Notification");
const Technician = require("../models/Technician");
const Ticket = require("../models/Ticket");
const User = require("../models/User");
const { updateStatus } = require("../controllers/ticketController");

const originals = {
  assignmentExists: Assignment.exists,
  assignmentFind: Assignment.find,
  assignmentUpdateMany: Assignment.updateMany,
  maintenanceCreate: MaintenanceRecord.create,
  notificationCreate: Notification.create,
  technicianFindOne: Technician.findOne,
  ticketFindById: Ticket.findById,
  ticketFindByIdAndUpdate: Ticket.findByIdAndUpdate,
  userFind: User.find,
};

afterEach(() => {
  Assignment.exists = originals.assignmentExists;
  Assignment.find = originals.assignmentFind;
  Assignment.updateMany = originals.assignmentUpdateMany;
  MaintenanceRecord.create = originals.maintenanceCreate;
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

function configureModels(ticket, { technician, activeAssignment = false } = {}) {
  let persistedRecord = null;
  let assignmentQuery = null;
  Ticket.findById = async () => ticket;
  Ticket.findByIdAndUpdate = (_id, update) => {
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
  MaintenanceRecord.create = async (record) => {
    persistedRecord = { _id: makeId(), createdAt: new Date(), ...record };
    return persistedRecord;
  };
  Notification.create = async (notification) => notification;
  User.find = () => ({
    select: async () => [],
  });
  return {
    get persistedRecord() {
      return persistedRecord;
    },
    get assignmentQuery() {
      return assignmentQuery;
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

test("assigned technician can resolve a ticket with submitted work details", async () => {
  const userId = makeId();
  const ticket = makeTicket({
    status: "in_progress",
    assignedTechnician: userId,
  });
  const models = configureModels(ticket, {
    technician: { _id: makeId() },
  });

  const response = await callUpdateStatus({
    ticketId: ticket._id,
    userId,
    body: {
      status: "resolved",
      actionTaken: "Repaired the network adapter and verified connectivity.",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(ticket.status, "resolved");
  assert.equal(models.persistedRecord.status, "resolved");
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
