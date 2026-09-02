/**
 * scripts/accounts.js — Single source of truth for the seeded test accounts.
 * Shared by seed.js (seeds/repairs the accounts) and scripts/testAuth.js
 * (verifies them against the database and the live login API).
 *
 * Passwords are needed to hash/compare but are NEVER logged or printed.
 */
module.exports = [
  {
    fullName: 'Test Requester',
    email:    'requester@dbu.edu.et',
    password: 'Requester123!',
    role:     'Requester',
    department: 'Academic Affairs',
    isTechnician: false,
  },
  {
    fullName: 'ICT Technician',
    email:    'technician@dbu.edu.et',
    password: 'Tech123!',
    role:     'Technician',
    department: 'ICT Department',
    isTechnician: true,
  },
  {
    fullName: 'ICT Admin',
    email:    'admin@dbu.edu.et',
    password: 'Admin123!',
    role:     'ICT Admin',
    department: 'System Administration',
    isTechnician: false,
  },
];