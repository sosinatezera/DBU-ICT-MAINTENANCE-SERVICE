const GENDERS = Object.freeze([
  "Male",
  "Female",
  "Other",
  "Prefer not to say",
]);

const genderByNormalizedValue = new Map(
  GENDERS.map((gender) => [gender.toLowerCase(), gender]),
);

function normalizeGender(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return value;

  const trimmed = value.trim();
  if (!trimmed) return null;
  return genderByNormalizedValue.get(trimmed.toLowerCase()) || trimmed;
}

module.exports = { GENDERS, normalizeGender };
