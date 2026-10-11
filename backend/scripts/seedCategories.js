/**
 * scripts/seedCategories.js — Idempotent maintenance-category seed
 * Loads the ICT maintenance taxonomy into the Category collection so the
 * requester's Category dropdown is served from MongoDB, not from a JS constant.
 *
 * Usage:  node scripts/seedCategories.js
 * Runs:   npm run seed:categories
 *
 * SINGLE SOURCE OF TRUTH
 * The taxonomy is imported from utils/ictCategoryHierarchy.js, the same module
 * the API falls back to. Nothing here re-types the category list, so the seed
 * and the service can never disagree about what a category is.
 *
 * IDEMPOTENT / NON-DESTRUCTIVE
 *   $set         → canonical name, group + sortOrder are backfilled/corrected,
 *                  so case variants and older rows land in the right heading.
 *   $setOnInsert → active only. `active` is therefore NEVER overwritten,
 *                  so an admin's deliberate deactivation survives every re-run.
 * Existing requests are never touched: Ticket.category stores the category
 * value as a string.
 *
 * PRE-EXISTING ROWS THAT ARE NOT IN THE TAXONOMY
 * Legacy categories are left untouched; existing tickets retain their stored
 * category strings while the request form displays the current taxonomy.
 */
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const mongoose = require("mongoose");
const Category = require("../models/Category");
const { ICT_CATEGORY_GROUPS } = require("../utils/ictCategoryHierarchy");

const log = (msg) => console.log(`  ✔  ${msg}`);

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    let created = 0;
    let updated = 0;

    for (const { group, categories } of ICT_CATEGORY_GROUPS) {
      for (let index = 0; index < categories.length; index += 1) {
        const name = categories[index];
        const sortOrder = (index + 1) * 10;
        const exactMatch = await Category.findOne({ name }).select("_id").lean();
        const existing =
          exactMatch ||
          (await Category.findOne({
            name: new RegExp(
              `^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
              "i",
            ),
          })
            .select("_id")
            .lean());
        const result = await Category.updateOne(
          existing ? { _id: existing._id } : { name },
          {
            /* Canonicalize case variants without creating another row. */
            $set: { name, group, sortOrder },
            /* active is only ever set at insert time — an admin's manual
               deactivation must not be undone by re-running this script. */
            $setOnInsert: { active: true },
          },
          { upsert: true },
        );
        if (result.upsertedCount > 0) created += 1;
        else updated += 1;
      }
    }

    const total = await Category.countDocuments();
    const activeCount = await Category.countDocuments({ active: true });
    const expected = ICT_CATEGORY_GROUPS.reduce(
      (n, g) => n + g.categories.length,
      0,
    );

    console.log("");
    log(`taxonomy entries: ${expected} across ${ICT_CATEGORY_GROUPS.length} groups`);
    log(`created: ${created}`);
    log(`existing (group/order corrected, active left untouched): ${updated}`);
    log(`collection total: ${total} (${activeCount} active)`);
    console.log("Category seed complete.");
    process.exit(0);
  } catch (err) {
    console.error("Category seed failed:", err.message);
    process.exit(1);
  }
})();
