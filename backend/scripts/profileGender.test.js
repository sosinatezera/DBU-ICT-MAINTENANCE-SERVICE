const { afterEach, test } = require("node:test");
const assert = require("node:assert/strict");
const User = require("../models/User");
const { getMe } = require("../controllers/authController");
const { updateMyProfile } = require("../controllers/userController");

const originalFindById = User.findById;
const originalFindByIdAndUpdate = User.findByIdAndUpdate;

afterEach(() => {
  User.findById = originalFindById;
  User.findByIdAndUpdate = originalFindByIdAndUpdate;
});

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

async function callController(controller, req) {
  const response = makeResponse();
  let nextError;
  await controller(req, response, (error) => {
    nextError = error;
  });
  if (nextError) throw nextError;
  return response;
}

const genderCases = [
  ["Male", "Male"],
  ["mAlE", "Male"],
  ["Female", "Female"],
  ["female", "Female"],
  ["Other", "Other"],
  ["other", "Other"],
  ["Prefer not to say", "Prefer not to say"],
  [" prefer NOT to say ", "Prefer not to say"],
];

for (const [submittedGender, expectedGender] of genderCases) {
  test(`profile gender "${submittedGender}" saves and reloads as "${expectedGender}"`, async () => {
    const userId = "user-1";
    let savedUser;

    User.findByIdAndUpdate = (_id, update, options) => {
      assert.equal(update.gender, expectedGender);
      assert.equal(options.new, true);
      assert.equal(options.runValidators, true);
      savedUser = {
        _id: userId,
        fullName: "Test User",
        email: "test@example.com",
        gender: update.gender,
        toObject() {
          return {
            _id: this._id,
            fullName: this.fullName,
            email: this.email,
            gender: this.gender,
          };
        },
      };
      return { select: async () => savedUser };
    };
    User.findById = () => ({
      select: async () => savedUser,
    });

    const saveResponse = await callController(updateMyProfile, {
      user: { id: userId },
      body: { gender: submittedGender },
    });
    assert.equal(saveResponse.statusCode, 200);
    assert.equal(saveResponse.body.success, true);
    assert.equal(saveResponse.body.data.gender, expectedGender);

    const reloadResponse = await callController(getMe, {
      user: { id: userId },
    });
    assert.equal(reloadResponse.statusCode, 200);
    assert.equal(reloadResponse.body.user.gender, expectedGender);
  });
}
