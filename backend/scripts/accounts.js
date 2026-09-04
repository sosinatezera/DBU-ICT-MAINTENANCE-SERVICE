/**
 * scripts/accounts.js — Single source of truth for the seeded test accounts.
 * Shared by seed.js (seeds/repairs the accounts) and scripts/testAuth.js
 * (verifies them against the database and the live login API).
 *
 * Passwords are needed to hash/compare but are NEVER logged or printed.
 *
 * Recommended practice for any shared/deployed environment:
 *   SEED_ADMIN_PASSWORD, SEED_TECH_PASSWORD, SEED_REQUESTER_PASSWORD
 * can be set via environment variables to override the development-only
 * defaults below. The defaults are intentionally weak because they are
 * used to stand up a local development database only.
 */
module.exports = [
  {
    fullName: 'Test Requester',
    email:    'requester@dbu.edu.et',
    password: process.env.SEED_REQUESTER_PASSWORD || 'Requester123!',
    role:     'Requester',
    department: 'Academic Affairs',
    isTechnician: false,
  },
  {
    fullName: 'ICT Technician',
    email:    'technician@dbu.edu.et',
    password: process.env.SEED_TECH_PASSWORD || 'Tech123!',
    role:     'Technician',
    department: 'ICT Department',
    isTechnician: true,
  },
  {
    fullName: 'ICT Admin',
    email:    'admin@dbu.edu.et',
    password: process.env.SEED_ADMIN_PASSWORD || 'Admin123!',
    role:     'ICT Admin',
    department: 'System Administration',
    isTechnician: false,
  },
];