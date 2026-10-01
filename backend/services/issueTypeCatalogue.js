/**
 * services/issueTypeCatalogue.js
 * The single place that answers "what Issue Types exist right now?".
 *
 * WHY A SERVICE
 * The catalogue has two possible sources — the IssueType collection and the
 * hard-coded ICT_ISSUE_TYPES array in utils/ictCategoryHierarchy.js — and
 * several callers (the requester dropdown, createTicket, the admin update path)
 * must all see exactly the same answer. Resolving it in one place is what stops
 * the dropdown offering a value the API would then reject.
 *
 * RESOLUTION ORDER
 *   1. Active rows in the IssueType collection, ordered by sortOrder then name.
 *   2. If that collection is empty, the hard-coded ICT_ISSUE_TYPES array.
 *
 * The fallback is deliberate and must stay. A database outage, an unseeded
 * deployment or an admin who deactivated everything must never leave the
 * requester facing a required, permanently unselectable Issue Type field — the
 * previous behaviour of the form was a dead end, not a clear message. Serving
 * the built-in catalogue keeps submissions working and lets an admin fix the
 * data afterwards.
 *
 * SEPARATE FROM CATEGORY
 * Nothing here knows about Category. The catalogue is shared by every category;
 * Category and Issue Type remain two independent fields.
 */
const IssueType = require("../models/IssueType");
const {
  ICT_CATEGORY_GROUPS,
  ICT_ISSUE_TYPES,
  OTHER_ISSUE_TYPE,
  normalizeIssueTypeValue,
  resolveCategoryLabel,
} = require("../utils/ictCategoryHierarchy");

/* Short cache so a requester's dropdown render does not hit MongoDB on every
   keystroke of the search box, while an admin's change still shows up quickly
   on the next page load. */
const CACHE_TTL_MS = 5000;

let _cache = { at: 0, labels: null, source: null };
let _seedAttempted = false;

/* The long side of "Other ICT Issue" reveals a free-text box on the form whose
   typed description is submitted as the Issue Type. That text is stored, so it
   needs a bound; this matches the input's own maxlength in the request form. */
const CUSTOM_TEXT_MAX_LENGTH = 150;

/** Drop the cached catalogue so the next read re-queries MongoDB. Call after
 *  any write to the IssueType collection. */
function invalidateCatalogueCache() {
  _cache = { at: 0, labels: null, source: null };
}

function codeCatalogue() {
  return { labels: [...ICT_ISSUE_TYPES], source: "code" };
}

/** Populate the collection from the built-in catalogue the first time it is
 *  found empty. Runs at most once per process and only when the collection is
 *  empty, so it can never resurrect rows an admin has since deleted. Uses
 *  unordered inserts, so a duplicate-key race leaves the rest of the catalogue
 *  in place, and any failure at all just means the code fallback is used. */
async function seedIssueTypesIfEmpty() {
  if (_seedAttempted) return;
  _seedAttempted = true;
  try {
    const existing = await IssueType.countDocuments();
    if (existing > 0) return;
    await IssueType.insertMany(
      ICT_ISSUE_TYPES.map((name, index) => ({
        name,
        active: true,
        sortOrder: index,
        seeded: true,
      })),
      { ordered: false },
    );
    invalidateCatalogueCache();
  } catch (_) {
    /* Duplicate-key race, permissions, or a database that is still connecting.
       None of these should stop the form working — the code fallback covers it. */
  }
}

/** The active catalogue, in dropdown order. Never returns an empty list: an
 *  empty collection falls back to the built-in catalogue. */
async function resolveIssueTypeCatalogue() {
  const now = Date.now();
  if (_cache.labels && now - _cache.at < CACHE_TTL_MS) {
    return { labels: _cache.labels, source: _cache.source };
  }

  let labels = [];
  try {
    const docs = await IssueType.find({ active: true })
      .sort({ sortOrder: 1, name: 1 })
      .select("name")
      .lean();
    labels = docs.map((doc) => doc.name).filter(Boolean);
  } catch (_) {
    /* Database unreachable. The built-in catalogue still lets the form work. */
    labels = [];
  }

  if (!labels.length) {
    await seedIssueTypesIfEmpty();
    try {
      const docs = await IssueType.find({ active: true })
        .sort({ sortOrder: 1, name: 1 })
        .select("name")
        .lean();
      labels = docs.map((doc) => doc.name).filter(Boolean);
    } catch (_) {
      labels = [];
    }
  }

  if (!labels.length) {
    const fallback = codeCatalogue();
    _cache = { at: now, labels: fallback.labels, source: fallback.source };
    return fallback;
  }

  _cache = { at: now, labels, source: "database" };
  return { labels: [...labels], source: "database" };
}

/** The catalogue as a { categoryLabel: [issueType, ...] } map, the exact shape
 *  GET /api/categories/maintenance has always returned. Every category gets the
 *  same ordered list, mirroring how the built-in catalogue is shaped. */
async function resolveIssueTypeMap() {
  const { labels } = await resolveIssueTypeCatalogue();
  return Object.fromEntries(
    ICT_CATEGORY_GROUPS.flatMap(({ categories }) =>
      categories.map((label) => [label, [...labels]]),
    ),
  );
}

/** Is this value one of the catalogue's own entries? Case-insensitive, matching
 *  how the built-in catalogue has always been compared. */
async function isKnownIssueType(value) {
  const target = normalizeIssueTypeValue(value);
  if (!target) return false;
  const { labels } = await resolveIssueTypeCatalogue();
  return labels.some((item) => normalizeIssueTypeValue(item) === target);
}

/** May this submitted value be stored as the Issue Type of a ticket in this
 *  category? The async replacement for the synchronous
 *  ictCategoryHierarchy.isIssueTypeAllowed, which cannot see the database.
 *
 *  Accepted when it is a catalogue entry. Failing that, free text is accepted
 *  only when the catalogue offers "Other ICT Issue" — the escape hatch that
 *  reveals the free-text box — and the text is not itself a catalogue value,
 *  so a stale or hand-crafted payload cannot smuggle one in as custom text.
 *  Category must still be present: it is a separate required field.
 *
 *  CUSTOM_TEXT_MAX_LENGTH is enforced HERE ONLY. It matches the maxlength on
 *  the request form's "Specify Issue / Service" input exactly, so no submission
 *  made through the UI can be refused, while a hand-crafted payload can no
 *  longer push an unbounded string into the database. */
async function isIssueTypeAccepted(
  issueType,
  category,
  { allowCustom = false } = {},
) {
  const value = String(issueType || "").trim();
  if (!value) return false;
  if (!resolveCategoryLabel(category)) return false;

  const { labels } = await resolveIssueTypeCatalogue();
  const target = normalizeIssueTypeValue(value);
  const isActiveCatalogueValue = labels.some(
    (item) => normalizeIssueTypeValue(item) === target,
  );
  if (isActiveCatalogueValue) {
    return !allowCustom;
  }

  if (!allowCustom) return false;

  const allowsCustom = labels.some(
    (item) =>
      normalizeIssueTypeValue(item) ===
      normalizeIssueTypeValue(OTHER_ISSUE_TYPE),
  );
  if (!allowsCustom) return false;

  const knownTypes = await IssueType.find().select("name").lean();
  if (
    ICT_ISSUE_TYPES.some((item) => normalizeIssueTypeValue(item) === target) ||
    knownTypes.some((item) => normalizeIssueTypeValue(item.name) === target)
  ) {
    return false;
  }

  return value.length <= CUSTOM_TEXT_MAX_LENGTH;
}

/** The update-path counterpart, mirroring the documented leniency of
 *  ictCategoryHierarchy.isIssueTypeAllowedForUpdate so existing records stay
 *  editable.
 *
 *  GRANDFATHERING (storedIssueType). Deactivating an issue type must not
 *  freeze the tickets that already use it. If the submitted value is the same
 *  one the ticket already stores, it is accepted unchanged — whether it is
 *  active, deactivated, or a legacy free-text description that was never in the
 *  catalogue at all. The admin is preserving a historical value, not choosing a
 *  new one, so validating it against the current catalogue would be wrong: it
 *  would reject the ticket's own stored value the moment its issue type was
 *  deactivated, leaving the record uneditable.
 *
 *  Anything DIFFERENT from the stored value goes through the full checks, so a
 *  new value must be a currently-active catalogue entry (or the bounded
 *  "Other ICT Issue" free-text escape hatch). This is what keeps a deactivated
 *  issue type out of new tickets while letting old ones keep working.
 *
 *  Requests created before this taxonomy existed carry a free-text category
 *  ("Laptop", "Email Problem") and no Issue Type at all. For such a record an
 *  update also accepts any known Issue Type, because requiring the strict
 *  pairing would leave it impossible to edit. A modern category never reaches
 *  that branch — it is present in the map, so an unknown Issue Type is still
 *  refused.
 *
 *  CUSTOM_TEXT_MAX_LENGTH is deliberately NOT applied to a preserved stored
 *  value: a ticket stored before this bound existed may already hold a longer
 *  custom description, and re-saving it unchanged must not fail. It IS applied
 *  when the admin supplies a different value. */
async function isIssueTypeAcceptedForUpdate(
  issueType,
  category,
  storedIssueType,
) {
  const value = String(issueType || "").trim();
  if (!value) return false;
  if (!resolveCategoryLabel(category)) return false;

  /* Preserve-what-is-stored: always allowed, see the note above. */
  const stored = String(storedIssueType || "").trim();
  if (
    stored &&
    normalizeIssueTypeValue(stored) === normalizeIssueTypeValue(value)
  ) {
    return true;
  }

  if (await isIssueTypeAccepted(value, category)) return true;

  const { labels } = await resolveIssueTypeCatalogue();
  const map = await resolveIssueTypeMap();
  const isModernCategory = map[resolveCategoryLabel(category)] !== undefined;
  if (isModernCategory) return false;

  const target = normalizeIssueTypeValue(value);
  return labels.some((item) => normalizeIssueTypeValue(item) === target);
}

module.exports = {
  resolveIssueTypeCatalogue,
  resolveIssueTypeMap,
  isKnownIssueType,
  isIssueTypeAccepted,
  isIssueTypeAcceptedForUpdate,
  invalidateCatalogueCache,
  CUSTOM_TEXT_MAX_LENGTH,
};
