const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Assignment = require("../models/Assignment");
const Technician = require("../models/Technician");
const Ticket = require("../models/Ticket");
const { getTicketById } = require("../controllers/ticketController");

const originals = {
  assignmentExists: Assignment.exists,
  assignmentFind: Assignment.find,
  technicianFindOne: Technician.findOne,
  ticketFindById: Ticket.findById,
};

test.afterEach(() => {
  Assignment.exists = originals.assignmentExists;
  Assignment.find = originals.assignmentFind;
  Technician.findOne = originals.technicianFindOne;
  Ticket.findById = originals.ticketFindById;
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

function configureModels(ticket, technician = null, activeAssignment = false) {
  Ticket.findById = () => ({
    populate() {
      return this;
    },
    lean: async () => ticket,
  });
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
    lean: async () => [],
  });
  Assignment.exists = async () =>
    activeAssignment ? { _id: makeId() } : null;
  Technician.findOne = async () => technician;
}

async function callGetTicket(ticketId, role = "Technician", userId = makeId()) {
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

test("assigned technician can load completed ticket details by Mongo ID", async () => {
  const userId = makeId();
  const technicianId = makeId();
  const ticket = {
    _id: makeId(),
    ticketId: "MAU-0441",
    status: "resolved",
    requester: makeId(),
    assignedTechnician: technicianId,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-09-03T00:00:00Z"),
  };
  configureModels(ticket, { _id: technicianId });

  const response = await callGetTicket(ticket._id, "Technician", userId);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.ticketId, "MAU-0441");
  assert.equal(response.body.data.status, "resolved");
});

test("technician cannot load another technician's completed ticket", async () => {
  const ticket = {
    _id: makeId(),
    ticketId: "MAU-0441",
    status: "resolved",
    requester: makeId(),
    assignedTechnician: makeId(),
  };
  configureModels(ticket, { _id: makeId() });

  const response = await callGetTicket(ticket._id);

  assert.equal(response.statusCode, 403);
  assert.match(response.body.message, /assigned to you/i);
});

test("technician cannot load an unassigned ticket", async () => {
  const ticket = {
    _id: makeId(),
    ticketId: "MAU-0441",
    status: "resolved",
    requester: makeId(),
    assignedTechnician: null,
  };
  configureModels(ticket, { _id: makeId() });

  const response = await callGetTicket(ticket._id);

  assert.equal(response.statusCode, 403);
  assert.match(response.body.message, /assigned to you/i);
});

test("ICT Admin can load ticket details", async () => {
  const ticket = {
    _id: makeId(),
    ticketId: "MAU-0441",
    status: "resolved",
    requester: makeId(),
    assignedTechnician: null,
  };
  configureModels(ticket);

  const response = await callGetTicket(ticket._id, "ICT Admin");

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.ticketId, "MAU-0441");
});

test("missing ticket returns a 404 instead of an empty details response", async () => {
  configureModels(null);

  const response = await callGetTicket(makeId());

  assert.equal(response.statusCode, 404);
  assert.match(response.body.message, /ticket not found/i);
});

test("ticket public code is not accepted as the database lookup ID", async () => {
  configureModels(null);

  const response = await callGetTicket("MAU-0441");

  assert.equal(response.statusCode, 400);
  assert.match(response.body.message, /invalid ticket format/i);
});

test("database errors are forwarded to the standard error handler", async () => {
  Ticket.findById = () => ({
    populate() {
      return this;
    },
    lean: async () => {
      throw new Error("database unavailable");
    },
  });

  await assert.rejects(
    callGetTicket(makeId()),
    /database unavailable/i,
  );
});
