/**
 * scripts/migrate-statuses.js
 * Migrates old ticket status values to the new workflow statuses:
 *   'Pending'    → 'under_review'
 *   'Assigned'   → 'assigned'
 *   'In Progress'→ 'in_progress'
 *   'Resolved'   → 'resolved'
 *   'Not Fixed'  → 'closed'
 *   'submitted'  → 'submitted' (already correct, no change)
 *
 * Also splits problemDescription into title + description for tickets
 * where title is null.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const Ticket   = require('../models/Ticket');

const STATUS_MAP = {
  'Pending':     'under_review',
  'Assigned':    'assigned',
  'In Progress': 'in_progress',
  'Resolved':    'resolved',
  'Not Fixed':   'closed',
};

async function migrate() {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/ict_maintenance_db');
    console.log('Connected to MongoDB');

    /* ── 1. Status migration ────────────────────────────────── */
    let statusUpdated = 0;
    for (const [oldStatus, newStatus] of Object.entries(STATUS_MAP)) {
      const result = await Ticket.updateMany(
        { status: oldStatus },
        { $set: { status: newStatus } }
      );
      if (result.modifiedCount > 0) {
        console.log(`  Migrated ${result.modifiedCount} ticket(s): "${oldStatus}" → "${newStatus}"`);
        statusUpdated += result.modifiedCount;
      }
    }
    console.log(`\nStatus migration complete: ${statusUpdated} ticket(s) updated.`);

    /* ── 2. Title split migration ───────────────────────────── */
    const ticketsWithNullTitle = await Ticket.find({ title: null });
    let titleFixed = 0;
    for (const t of ticketsWithNullTitle) {
      const desc = t.problemDescription || '';
      const lines = desc.split('\n').filter(l => l.trim());
      if (lines.length >= 2) {
        t.title = lines[0].substring(0, 200);
        t.problemDescription = lines.slice(1).join('\n').trim();
      } else if (lines.length === 1) {
        t.title = lines[0].substring(0, 200);
      } else {
        t.title = `Ticket ${t.ticketId}`;
      }
      await t.save();
      titleFixed++;
    }
    console.log(`Title migration complete: ${titleFixed} ticket(s) updated.`);

    /* ── 3. Summary ─────────────────────────────────────────── */
    const allStatuses = await Ticket.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);
    console.log('\nCurrent status distribution:');
    allStatuses.forEach(s => console.log(`  ${s._id}: ${s.count}`));

  } catch (err) {
    console.error('Migration error:', err);
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB.');
  }
}

migrate();
