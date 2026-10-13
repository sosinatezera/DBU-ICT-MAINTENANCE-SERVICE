function mongoIdString(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if (typeof value.toHexString === "function") return value.toHexString();
    if (value._id !== undefined && value._id !== value) {
      return mongoIdString(value._id);
    }
  }
  return String(value);
}

function sameMongoId(left, right) {
  const leftId = mongoIdString(left);
  return leftId !== "" && leftId === mongoIdString(right);
}

module.exports = { mongoIdString, sameMongoId };
