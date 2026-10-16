const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");

process.env.JWT_SECRET = "ticket-tracking-test-secret-with-enough-entropy";

const express = require("express");
const Ticket = require("../models/Ticket");
const Technician = require("../models/Technician");
const Assignment = require("../models/Assignment");
const {
  authorizeTicketTracking,
} = require("../middleware/authorizeTicketTracking");
const ticketRoutes = require("../routes/tickets");

function responseRecorder() {
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

function queryResult(value) {
  return {
    select() {
      return this;
    },
    lean: async () => value,
  };
}

test("tracking access is role-scoped and the route rejects anonymous requests", async (t) => {
  const originalTicketFindOne = Ticket.findOne;
  const originalTechnicianFindOne = Technician.findOne;
  const originalAssignmentExists = Assignment.exists;

  t.after(() => {
    Ticket.findOne = originalTicketFindOne;
    Technician.findOne = originalTechnicianFindOne;
    Assignment.exists = originalAssignmentExists;
  });

  let ticket = {
    _id: "ticket-1",
    requester: "requester-1",
    assignedTechnician: "technician-profile-1",
  };
  let assignmentExists = false;
  Ticket.findOne = () => queryResult(ticket);
  Technician.findOne = () => queryResult({ _id: "technician-profile-1" });
  Assignment.exists = async () => assignmentExists;

  async function authorize(user, ticketId = "MAU-0001") {
    const res = responseRecorder();
    let nextCalled = false;
    await authorizeTicketTracking(
      { params: { ticketId }, user },
      res,
      () => {
        nextCalled = true;
      },
    );
    return { res, nextCalled };
  }

  const ownRequest = await authorize({ id: "requester-1", role: "Requester" });
  assert.equal(ownRequest.nextCalled, true);

  const anotherRequest = await authorize({
    id: "requester-2",
    role: "Requester",
  });
  assert.equal(anotherRequest.nextCalled, false);
  assert.equal(anotherRequest.res.statusCode, 404);

  const assignedTechnician = await authorize({
    id: "technician-1",
    role: "Technician",
  });
  assert.equal(assignedTechnician.nextCalled, true);

  ticket.assignedTechnician = null;
  assignmentExists = true;
  const assignmentOnlyTechnician = await authorize({
    id: "technician-1",
    role: "Technician",
  });
  assert.equal(assignmentOnlyTechnician.nextCalled, true);

  assignmentExists = false;
  const unassignedTechnician = await authorize({
    id: "technician-2",
    role: "Technician",
  });
  assert.equal(unassignedTechnician.nextCalled, false);
  assert.equal(unassignedTechnician.res.statusCode, 404);

  const admin = await authorize({ id: "admin-1", role: "ICT Admin" });
  assert.equal(admin.nextCalled, true);

  ticket = null;
  const missingTicket = await authorize(
    { id: "requester-1", role: "Requester" },
    "MAU-9999",
  );
  assert.equal(missingTicket.nextCalled, false);
  assert.equal(missingTicket.res.statusCode, 404);

  const app = express();
  app.use("/api/tickets", ticketRoutes);
  const server = app.listen(0);
  t.after(
    () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  );
  if (!server.listening) await once(server, "listening");

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const response = await fetch(
    `http://127.0.0.1:${address.port}/api/tickets/track/MAU-0001`,
  );
  assert.equal(response.status, 401);
});
