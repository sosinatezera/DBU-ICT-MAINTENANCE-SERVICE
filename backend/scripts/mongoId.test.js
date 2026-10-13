const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { mongoIdString, sameMongoId } = require("../utils/mongoId");

test("matches ObjectIds against authenticated ID strings", () => {
  const id = new mongoose.Types.ObjectId();

  assert.equal(sameMongoId(id, id.toHexString()), true);
  assert.equal(sameMongoId(id.toHexString(), id), true);
});

test("matches populated references and serialized IDs", () => {
  const id = new mongoose.Types.ObjectId();

  assert.equal(sameMongoId({ _id: id, fullName: "Technician" }, id), true);
  assert.equal(sameMongoId({ _id: id.toHexString() }, id), true);
  assert.equal(mongoIdString({ _id: id }), id.toHexString());
});

test("does not treat missing or different IDs as an assignment match", () => {
  const assignedId = new mongoose.Types.ObjectId();
  const anotherId = new mongoose.Types.ObjectId();

  assert.equal(sameMongoId(null, assignedId), false);
  assert.equal(sameMongoId(assignedId, anotherId), false);
});
