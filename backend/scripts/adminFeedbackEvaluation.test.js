const { afterEach, test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Assignment = require("../models/Assignment");
const Technician = require("../models/Technician");
const Ticket = require("../models/Ticket");
const {
  editAdminFeedback,
  getAdminFeedback,
  getAdminFeedbackEvaluations,
  submitAdminFeedback,
} = require("../controllers/ticketController");
const { authenticate } = require("../middleware/auth");
const ticketsRouter = require("../routes/tickets");

const originalFindById = Ticket.findById;
const originalFind = Ticket.find;
const originalCountDocuments = Ticket.countDocuments;
const originalTechnicianFindOne = Technician.findOne;
const originalAssignmentExists = Assignment.exists;

afterEach(() => {
  Ticket.findById = originalFindById;
  Ticket.find = originalFind;
  Ticket.countDocuments = originalCountDocuments;
  Technician.findOne = originalTechnicianFindOne;
  Assignment.exists = originalAssignmentExists;
});

function validEvaluation(overrides = {}) {
  return {
    reportReviewDecision: "Approved",
    workQuality: "Excellent",
    technicalAccuracy: "Good",
    repairEffectiveness: "Excellent",
    reportCompleteness: "Good",
    safetyProcedureCompliance: "Not Applicable",
    evaluationStatus: "Reviewed",
    adminComment: "The report is clear and the repair has been verified.",
    followUpRequired: false,
    ...overrides,
  };
}

function configureTicket({ existingFeedback = null, hasReport = true } = {}) {
  let saveCount = 0;
  const document = {
    _id: new mongoose.Types.ObjectId(),
    ticketId: "MAU-2041",
    requester: null,
    assignedTechnician: null,
    technicianFeedback: hasReport ? { technicianConfirmed: true } : null,
    adminFeedback: existingFeedback,
    markModified() {},
    async save() {
      saveCount += 1;
    },
    get saveCount() {
      return saveCount;
    },
  };
  Ticket.findById = async () => document;
  return document;
}

async function call(controller, ticket, body, user = {}) {
  const req = {
    params: { id: String(ticket._id) },
    body,
    user: {
      id: new mongoose.Types.ObjectId(),
      role: "ICT Admin",
      name: "Verified Administrator",
      ...user,
    },
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
  await controller(req, res, (error) => {
    nextError = error;
  });
  if (nextError) throw nextError;
  return res;
}

test("creates a complete evaluation linked to the selected ticket and server identity", async () => {
  const ticket = configureTicket();
  const technicianReport = ticket.technicianFeedback;
  const response = await call(submitAdminFeedback, ticket, {
    ...validEvaluation(),
    admin: { adminName: "Untrusted identity" },
    admin_name: "Untrusted identity",
    submittedAt: "2000-01-01T00:00:00.000Z",
    adminConfirmed: false,
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.success, true);
  assert.equal(ticket.adminFeedback.reportReviewDecision, "Approved");
  assert.equal(ticket.adminFeedback.evaluationStatus, "Reviewed");
  assert.equal(ticket.adminFeedback.admin.adminName, "Verified Administrator");
  assert.ok(ticket.adminFeedback.admin.adminId);
  assert.equal(ticket.saveCount, 1);
  assert.strictEqual(ticket.technicianFeedback, technicianReport);
  assert.ok(ticket.adminFeedback.submittedAt instanceof Date);
  assert.notEqual(ticket.adminFeedback.submittedAt.toISOString(), "2000-01-01T00:00:00.000Z");
});

test("rejects evaluation without a technician report", async () => {
  const ticket = configureTicket({ hasReport: false });
  const response = await call(submitAdminFeedback, ticket, validEvaluation());

  assert.equal(response.statusCode, 422);
  assert.match(response.body.message, /technician maintenance report/i);
  assert.equal(ticket.adminFeedback, null);
  assert.equal(ticket.saveCount, 0);
});

test("requires corrective action when the report needs correction", async () => {
  const ticket = configureTicket();
  const response = await call(submitAdminFeedback, ticket, validEvaluation({
    reportReviewDecision: "Needs Correction",
  }));

  assert.equal(response.statusCode, 422);
  assert.match(response.body.message, /corrective action/i);
  assert.equal(ticket.saveCount, 0);
});

test("updates an existing evaluation without replacing the record or original date", async () => {
  const submittedAt = new Date("2026-01-10T12:00:00.000Z");
  const existingFeedback = {
    adminConfirmed: true,
    submittedAt,
    admin: { adminId: new mongoose.Types.ObjectId(), adminName: "Previous Reviewer" },
  };
  const ticket = configureTicket({ existingFeedback });
  const response = await call(editAdminFeedback, ticket, validEvaluation({
    reportReviewDecision: "Needs Correction",
    administrativeRecommendation: "Repeat the device diagnostics and attach the results.",
  }));

  assert.equal(response.statusCode, 200);
  assert.equal(ticket.adminFeedback.reportReviewDecision, "Needs Correction");
  assert.equal(ticket.adminFeedback.admin.adminName, "Verified Administrator");
  assert.equal(ticket.adminFeedback.submittedAt, submittedAt);
  assert.equal(response.body.data.evaluationStatus, "Reviewed");
  assert.equal(ticket.saveCount, 1);
});

test("rejects invalid ratings and missing admin comments without saving", async () => {
  for (const [overrides, expectedMessage] of [
    [{ workQuality: "Unacceptable" }, /work quality/i],
    [{ adminComment: "   " }, /admin comments are required/i],
  ]) {
    const ticket = configureTicket();
    const response = await call(
      submitAdminFeedback,
      ticket,
      validEvaluation(overrides),
    );

    assert.equal(response.statusCode, 422);
    assert.match(response.body.message, expectedMessage);
    assert.equal(ticket.saveCount, 0);
  }
});

function adminFeedbackRouteMiddleware(method) {
  const routeLayer = ticketsRouter.stack.find(
    (layer) =>
      layer.route?.path === "/:id/admin-feedback" &&
      layer.route.methods[method],
  );
  assert.ok(routeLayer, `missing ${method.toUpperCase()} admin feedback route`);
  const [authentication, authorization] = routeLayer.route.stack.map(
    (layer) => layer.handle,
  );
  assert.strictEqual(authentication, authenticate);
  assert.equal(typeof authorization, "function");
  return authorization;
}

test("create and edit routes allow only authenticated ICT Admin roles", () => {
  for (const method of ["post", "put"]) {
    const authorizeAdmin = adminFeedbackRouteMiddleware(method);
    for (const role of ["Requester", "Technician"]) {
      const response = {
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
      let continued = false;
      authorizeAdmin({ user: { role } }, response, () => {
        continued = true;
      });
      assert.equal(response.statusCode, 403);
      assert.equal(continued, false);
    }

    const adminResponse = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      },
    };
    let adminContinued = false;
    authorizeAdmin({ user: { role: "ICT Admin" } }, adminResponse, () => {
      adminContinued = true;
    });
    assert.equal(adminContinued, true);
  }
});

test("assigned technicians can read relevant admin feedback but unrelated technicians cannot", async () => {
  const ticketId = new mongoose.Types.ObjectId();
  const requesterId = new mongoose.Types.ObjectId();
  const technicianId = new mongoose.Types.ObjectId();
  const technicianProfileId = new mongoose.Types.ObjectId();
  Ticket.findById = () => ({
    select: async () => ({
      _id: ticketId,
      adminFeedback: {
        adminConfirmed: true,
        reportReviewDecision: "Approved",
        evaluationStatus: "Reviewed",
        adminComment: "Repair checked.",
        admin: { adminName: "Verified Administrator" },
        submittedAt: new Date("2026-10-01T00:00:00.000Z"),
      },
      requester: requesterId,
      assignedTechnician: technicianId,
      status: "resolved",
      ticketId: "MAU-2041",
    }),
  });
  Technician.findOne = ({ user }) => ({
    select: async () =>
      String(user) === String(technicianId)
        ? { _id: technicianProfileId }
        : null,
  });

  const readFeedback = async (userId) => {
    const req = {
      params: { id: String(ticketId) },
      user: { id: userId, role: "Technician" },
    };
    const res = {
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
    let nextError;
    await getAdminFeedback(req, res, (error) => {
      nextError = error;
    });
    if (nextError) throw nextError;
    return res;
  };

  Assignment.exists = async (filter) =>
    filter.ticket.equals(ticketId) &&
    filter.technician.equals(technicianProfileId)
      ? { _id: new mongoose.Types.ObjectId() }
      : null;

  const assignedResponse = await readFeedback(technicianId);
  assert.equal(assignedResponse.statusCode, 200);
  assert.equal(assignedResponse.body.data.reportReviewDecision, "Approved");
  assert.equal(assignedResponse.body.data.admin_name, "Verified Administrator");
  assert.equal("adminConfirmed" in assignedResponse.body.data, false);

  const unrelatedResponse = await readFeedback(new mongoose.Types.ObjectId());
  assert.equal(unrelatedResponse.statusCode, 403);
});

test("evaluation list route is registered before /:id and allows only ICT Admin", () => {
  const listLayer = ticketsRouter.stack.find(
    (layer) =>
      layer.route?.path === "/admin-feedback" &&
      layer.route.methods.get,
  );
  assert.ok(listLayer, "missing GET /admin-feedback evaluation list route");

  const detailLayer = ticketsRouter.stack.find(
    (layer) => layer.route?.path === "/:id" && layer.route.methods.get,
  );
  assert.ok(detailLayer, "missing GET /:id ticket detail route");
  assert.ok(
    ticketsRouter.stack.indexOf(listLayer) <
      ticketsRouter.stack.indexOf(detailLayer),
    "evaluation list route must be registered before /:id",
  );

  const [authentication, authorization] = listLayer.route.stack.map(
    (layer) => layer.handle,
  );
  assert.strictEqual(authentication, authenticate);
  assert.equal(typeof authorization, "function");

  for (const role of ["Requester", "Technician"]) {
    const response = {
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
    let continued = false;
    authorization({ user: { role } }, response, () => {
      continued = true;
    });
    assert.equal(response.statusCode, 403);
    assert.equal(continued, false);
  }

  const adminResponse = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  let adminContinued = false;
  authorization({ user: { role: "ICT Admin" } }, adminResponse, () => {
    adminContinued = true;
  });
  assert.equal(adminContinued, true);
});

test("lists saved evaluations from MongoDB with filters and server pagination", async () => {
  const submittedAt = new Date("2026-10-01T00:00:00.000Z");
  let capturedFilter = null;
  const captured = {};
  Ticket.find = (filter) => {
    capturedFilter = filter;
    const chain = {
      populate() {
        return chain;
      },
      sort(spec) {
        captured.sort = spec;
        return chain;
      },
      skip(value) {
        captured.skip = value;
        return chain;
      },
      limit(value) {
        captured.limit = value;
        return chain;
      },
      async lean() {
        return [
          {
            _id: new mongoose.Types.ObjectId(),
            ticketId: "MAU-2041",
            title: "Router replacement",
            equipmentType: "Router",
            assignedTechnician: { fullName: "Sam Tech" },
            assetId: { asset_tag: "ICT-001", asset_name: "Core Router" },
            technicianFeedback: {
              technicianConfirmed: true,
              technician: { technicianName: "Sam Tech" },
            },
            adminFeedback: {
              adminConfirmed: true,
              reportReviewDecision: "Approved",
              workQuality: "Excellent",
              evaluationStatus: "Reviewed",
              adminComment: "The report is clear and verified.",
              administrativeRecommendation: "Keep the current procedure.",
              followUpRequired: false,
              admin: { adminId: new mongoose.Types.ObjectId(), adminName: "Verified Administrator" },
              submittedAt,
            },
          },
        ];
      },
    };
    return chain;
  };
  Ticket.countDocuments = async () => 1;

  const req = {
    query: { page: "1", limit: "10", decision: "Approved", search: "MAU" },
    user: { id: new mongoose.Types.ObjectId(), role: "ICT Admin" },
  };
  const res = {
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
  let nextError;
  await getAdminFeedbackEvaluations(req, res, (error) => {
    nextError = error;
  });
  if (nextError) throw nextError;

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.length, 1);
  assert.deepEqual(res.body.pagination, {
    page: 1,
    limit: 10,
    total: 1,
    pages: 1,
  });

  assert.equal(capturedFilter["adminFeedback.adminConfirmed"], true);
  assert.equal(capturedFilter["adminFeedback.reportReviewDecision"], "Approved");
  assert.ok(Array.isArray(capturedFilter.$or), "search must build an $or query");
  assert.deepEqual(captured.sort, { "adminFeedback.submittedAt": -1 });
  assert.equal(captured.skip, 0);
  assert.equal(captured.limit, 10);

  const row = res.body.data[0];
  assert.equal(row.ticketId, "MAU-2041");
  assert.equal(row.equipmentName, "Router");
  assert.equal(row.technicianName, "Sam Tech");
  assert.equal(row.decision, "Approved");
  assert.equal(row.workQuality, "Excellent");
  assert.equal(row.evaluationStatus, "Reviewed");
  assert.equal(row.reviewedBy, "Verified Administrator");
  assert.equal(row.feedbackDate, submittedAt);
  assert.equal(row.hasTechnicianReport, true);
  assert.equal(row.evaluation.admin_name, "Verified Administrator");
});

test("evaluation list rejects invalid filters without querying the database", async () => {
  let queried = false;
  Ticket.find = () => {
    queried = true;
    throw new Error("Ticket.find must not run for an invalid filter");
  };
  Ticket.countDocuments = async () => {
    queried = true;
    return 0;
  };

  const req = {
    query: { decision: "Maybe" },
    user: { id: new mongoose.Types.ObjectId(), role: "ICT Admin" },
  };
  const res = {
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
  let nextError;
  await getAdminFeedbackEvaluations(req, res, (error) => {
    nextError = error;
  });
  if (nextError) throw nextError;

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.equal(queried, false);
});
