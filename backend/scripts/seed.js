/**
 * seed.js — Full database seed for Smart Computer Maintenance Service
 * Database: ict_maintenance_db
 *
 * Usage:  node scripts/seed.js
 * Flags:  --fresh   drops ALL collections before seeding (full reset)
 *
 * Collections seeded (in order):
 *   1. users
 *   2. technicians
 *   3. categories
 *   4. ictassets
 *   5. tickets
 *   6. assignments
 *   7. maintenancerecords
 *   8. feedbacks
 *   9. notifications
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

// ── Models ────────────────────────────────────────────────────
const User              = require('../models/User');
const Technician        = require('../models/Technician');
const Category          = require('../models/Category');
const ICTAsset          = require('../models/ICTAsset');
const Ticket            = require('../models/Ticket');
const Assignment        = require('../models/Assignment');
const MaintenanceRecord = require('../models/MaintenanceRecord');
const Feedback          = require('../models/Feedback');
const Notification      = require('../models/Notification');

// ── Helpers ────────────────────────────────────────────────────
const log  = (msg) => console.log(`  ✔  ${msg}`);
const warn = (msg) => console.log(`  ⚠  ${msg}`);
const hr   = ()    => console.log('─'.repeat(52));
const isFresh = process.argv.includes('--fresh');

// ══════════════════════════════════════════════════════════════
async function seed() {
  // ── Connect ───────────────────────────────────────────────
  const uri    = process.env.MONGO_URI    || 'mongodb://127.0.0.1:27017';
  const dbName = process.env.MONGO_DB_NAME || 'ict_maintenance_db';

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║   Smart Computer Maintenance Service — Database    ║');
  console.log('║   Seed Script                                      ║');
  console.log('╚══════════════════════════════════════════════════╝\n');
  console.log(`  DB  : ${uri}/${dbName}`);
  console.log(`  Mode: ${isFresh ? 'FRESH (drop all)' : 'SAFE (skip existing)'}\n`);
  hr();

  await mongoose.connect(uri, { dbName });
  console.log(`  Connected to MongoDB → ${dbName}\n`);

  // ── Optional full reset ───────────────────────────────────
  if (isFresh) {
    warn('Dropping all collections…');
    await Promise.all([
      User.deleteMany({}),
      Technician.deleteMany({}),
      Category.deleteMany({}),
      ICTAsset.deleteMany({}),
      Ticket.deleteMany({}),
      Assignment.deleteMany({}),
      MaintenanceRecord.deleteMany({}),
      Feedback.deleteMany({}),
      Notification.deleteMany({}),
    ]);
    log('All collections cleared.\n');
  }

  // ══════════════════════════════════════════════════════════
  // 1. USERS
  // ══════════════════════════════════════════════════════════
  hr();
  console.log('  [1/9] Seeding users…');

  const adminPwd = await bcrypt.hash(process.env.SEED_ADMIN_PASSWORD || 'Admin@1234', 10);
  const techPwd  = await bcrypt.hash(process.env.SEED_TECH_PASSWORD  || 'Tech@1234',  10);
  const staffPwd = await bcrypt.hash(process.env.SEED_REQUESTER_PASSWORD || 'Staff@1234', 10);

  const usersData = [
    // ICT Admin
    { fullName: 'Abebe Kebede',     email: 'admin@ict.local',  password: adminPwd, role: 'ICT Admin',   department: 'ICT Department', phone: '+254 700 000 001', status: 'active' },
    // Technicians
    { fullName: 'Takele Moges',     email: 'tech1@ict.local',  password: techPwd,  role: 'Technician',  department: 'ICT Department', phone: '+254 700 000 002', status: 'active' },
    { fullName: 'Fatuma Hassan',    email: 'tech2@ict.local',  password: techPwd,  role: 'Technician',  department: 'ICT Department', phone: '+254 700 000 003', status: 'active' },
    { fullName: 'James Osei',       email: 'tech3@ict.local',  password: techPwd,  role: 'Technician',  department: 'ICT Department', phone: '+254 700 000 004', status: 'active' },
    // Requesters (staff)
    { fullName: 'Aisha Malik',      email: 'staff1@ict.local', password: staffPwd, role: 'Requester',   department: 'Finance',        phone: '+254 700 000 005', status: 'active' },
    { fullName: 'David Brown',      email: 'staff2@ict.local', password: staffPwd, role: 'Requester',   department: 'Human Resources', phone: '+254 700 000 006', status: 'active' },
    { fullName: 'Grace Njeri',      email: 'staff3@ict.local', password: staffPwd, role: 'Requester',   department: 'Academic Affairs', phone: '+254 700 000 007', status: 'active' },
  ];

  const createdUsers = [];
  for (const u of usersData) {
    const existing = await User.findOne({ email: u.email });
    if (existing) {
      warn(`User already exists: ${u.email} (skipped)`);
      createdUsers.push(existing);
    } else {
      const created = await User.create(u);
      createdUsers.push(created);
      log(`User created: ${u.fullName} [${u.role}]`);
    }
  }

  const [adminUser, tech1User, tech2User, tech3User, staff1User, staff2User, staff3User] = createdUsers;

  // ══════════════════════════════════════════════════════════
  // 2. TECHNICIANS
  // ══════════════════════════════════════════════════════════
  hr();
  console.log('  [2/9] Seeding technicians…');

  const techsData = [
    { user: tech1User._id, specialization: 'Hardware Repair & Desktop Maintenance', available: true },
    { user: tech2User._id, specialization: 'Software, OS & Account Support',        available: true },
    { user: tech3User._id, specialization: 'Laptop Repair & Printer Maintenance',   available: true },
  ];

  const createdTechs = [];
  for (const t of techsData) {
    const existing = await Technician.findOne({ user: t.user });
    if (existing) {
      warn(`Technician profile already exists for user ${t.user} (skipped)`);
      createdTechs.push(existing);
    } else {
      const created = await Technician.create(t);
      createdTechs.push(created);
      log(`Technician created: ${t.specialization}`);
    }
  }

  const [tech1, tech2, tech3] = createdTechs;

  // ══════════════════════════════════════════════════════════
  // 3. CATEGORIES
  // ══════════════════════════════════════════════════════════
  hr();
  console.log('  [3/9] Seeding categories…');

  const categoriesData = [
    { name: 'Hardware Repair',           description: 'Physical repairs — screens, keyboards, power supplies, components' },
    { name: 'Software & OS',             description: 'OS installation, updates, antivirus, application troubleshooting' },
    { name: 'Printer & Peripherals',     description: 'Printer jams, scanner errors, keyboard/mouse replacements' },
    { name: 'Desktop Maintenance',       description: 'Desktop workstation setup, tune-ups, dust cleaning, upgrades' },
    { name: 'Laptop Repair',             description: 'Laptop screen, battery, hinge, and port repairs' },
    { name: 'Account & Access Support',  description: 'User account creation, password resets, access permissions' },
  ];

  const createdCats = [];
  for (const c of categoriesData) {
    const existing = await Category.findOne({ name: c.name });
    if (existing) {
      warn(`Category already exists: ${c.name} (skipped)`);
      createdCats.push(existing);
    } else {
      const created = await Category.create(c);
      createdCats.push(created);
      log(`Category created: ${c.name}`);
    }
  }

  const [catHardware, catSoftware, catPrinter, catDesktop, catLaptop, catAccount] = createdCats;

  // ══════════════════════════════════════════════════════════
  // 4. ICT ASSETS
  // ══════════════════════════════════════════════════════════
  hr();
  console.log('  [4/9] Seeding ICT assets…');

  const assetsData = [
    { asset_name: 'Dell Latitude 5520',      asset_tag: 'ICT-001', category: 'Laptop',     department: 'Finance',         location: 'Admin Block - Room 101', status: 'active',            purchase_date: new Date('2022-03-15'), warranty_expiry: new Date('2025-03-15'), description: 'Staff laptop for finance team' },
    { asset_name: 'HP LaserJet Pro M404dn',  asset_tag: 'ICT-002', category: 'Printer',    department: 'Finance',         location: 'Admin Block - Room 102', status: 'active',            purchase_date: new Date('2021-06-10'), warranty_expiry: new Date('2024-06-10'), description: 'Main office laser printer' },
    { asset_name: 'Lenovo ThinkCentre M720', asset_tag: 'ICT-003', category: 'Desktop',    department: 'Human Resources', location: 'Admin Block - Room 201', status: 'active',            purchase_date: new Date('2021-09-05'), warranty_expiry: new Date('2024-09-05'), description: 'HR department workstation' },
    { asset_name: 'Canon PIXMA G3020',       asset_tag: 'ICT-004', category: 'Printer',    department: 'Academic Affairs', location: 'Academic Block - Room 301', status: 'active',          purchase_date: new Date('2023-02-28'), warranty_expiry: new Date('2026-02-28'), description: 'Colour inkjet for the registrar' },
    { asset_name: 'HP ProBook 450 G8',       asset_tag: 'ICT-005', category: 'Laptop',     department: 'Academic Affairs', location: 'Academic Block - Room 302', status: 'active',          purchase_date: new Date('2022-07-18'), warranty_expiry: new Date('2025-07-18'), description: 'Lecturer laptop' },
    { asset_name: 'Dell OptiPlex 7090',      asset_tag: 'ICT-006', category: 'Desktop',    department: 'ICT Department',  location: 'ICT Office',              status: 'under_maintenance', purchase_date: new Date('2020-11-12'), warranty_expiry: new Date('2023-11-12'), description: 'Desktop workstation under repair' },
    { asset_name: 'Epson EcoTank L3250',     asset_tag: 'ICT-007', category: 'Printer',    department: 'Finance',         location: 'Admin Block - Room 103', status: 'active',            purchase_date: new Date('2023-08-01'), warranty_expiry: new Date('2026-08-01'), description: 'Inkjet printer for accounts' },
    { asset_name: 'Samsung 24" Monitor',     asset_tag: 'ICT-008', category: 'Monitor',    department: 'Human Resources', location: 'Admin Block - Room 202', status: 'active',            purchase_date: new Date('2022-01-10'), warranty_expiry: new Date('2025-01-10'), description: 'External monitor for HR workstation' },
  ];

  const createdAssets = [];
  for (const a of assetsData) {
    const existing = await ICTAsset.findOne({ asset_tag: a.asset_tag });
    if (existing) {
      warn(`Asset already exists: ${a.asset_tag} (skipped)`);
      createdAssets.push(existing);
    } else {
      const created = await ICTAsset.create(a);
      createdAssets.push(created);
      log(`Asset created: ${a.asset_tag} — ${a.asset_name}`);
    }
  }

  const [asset1, asset2, asset3, asset4, asset5, asset6, asset7, asset8] = createdAssets;

  // ══════════════════════════════════════════════════════════
  // 5. TICKETS
  // ══════════════════════════════════════════════════════════
  hr();
  console.log('  [5/9] Seeding tickets…');

  const ticketsData = [
    {
      requester: staff1User._id,
      department: staff1User.department,
      phone: '+254 700 000 005',
      equipmentType: 'Laptop',
      serialNumber: 'DL-5520-SN001',
      officeBlock: 'Admin Block - Room 101',
      problemDescription: 'The laptop screen flickers randomly, especially on battery power. Affects daily work.',
      priority: 'high',
      status: 'resolved',
      assignedTechnician: tech1User._id,
      identifiedProblem: 'Faulty LCD ribbon cable causing intermittent signal loss.',
      resolutionResponse: 'Replaced faulty LCD screen cable. Reseated GPU heatsink. Screen is now stable.',
      isFixed: true,
      feedbackRating: 5,
      feedbackComments: 'Excellent service! Screen fixed within one day. Very professional technician.',
    },
    {
      requester: staff2User._id,
      department: staff2User.department,
      phone: '+254 700 000 006',
      equipmentType: 'Desktop Computer',
      serialNumber: 'TC-M720-SN003',
      officeBlock: 'Admin Block - Room 201',
      problemDescription: 'Desktop workstation running extremely slow. Takes 10+ minutes to boot into Windows.',
      priority: 'medium',
      status: 'in_progress',
      assignedTechnician: tech1User._id,
      identifiedProblem: 'Failing HDD causing I/O bottleneck and excessive boot times.',
    },
    {
      requester: staff1User._id,
      department: staff1User.department,
      phone: '+254 700 000 005',
      equipmentType: 'Printer',
      serialNumber: 'HP-M404-SN002',
      officeBlock: 'Admin Block - Room 102',
      problemDescription: 'The HP LaserJet keeps jamming on A4 paper. Tried clearing the tray but issue persists.',
      priority: 'medium',
      status: 'assigned',
      assignedTechnician: tech2User._id,
    },
    {
      requester: staff3User._id,
      department: staff3User.department,
      phone: '+254 700 000 007',
      equipmentType: 'Desktop Computer',
      serialNumber: null,
      officeBlock: 'Academic Block - Room 301',
      problemDescription: 'Windows update fails at 45% with error code 0x800f0922 on three workstations in the registrar.',
      priority: 'medium',
      status: 'under_review',
    },
    {
      requester: staff2User._id,
      department: staff2User.department,
      phone: '+254 700 000 006',
      equipmentType: 'Monitor',
      serialNumber: 'SAM-24-SN008',
      officeBlock: 'Admin Block - Room 202',
      problemDescription: 'External monitor displays random pixel artifacts and occasionally goes blank for a few seconds.',
      priority: 'high',
      status: 'in_progress',
      assignedTechnician: tech3User._id,
      identifiedProblem: 'Possible GPU overheating or failing display panel.',
    },
    {
      requester: staff3User._id,
      department: staff3User.department,
      phone: '+254 700 000 007',
      equipmentType: 'Laptop',
      serialNumber: 'PB-450G8-SN005',
      officeBlock: 'Academic Block - Room 302',
      problemDescription: 'Laptop battery no longer holds charge. Shuts down immediately when unplugged from power.',
      priority: 'low',
      status: 'closed',
      assignedTechnician: tech1User._id,
      identifiedProblem: 'Battery has reached end of life — 0% charge capacity after 1200 cycles.',
      resolutionResponse: 'Battery is degraded beyond repair. Replacement battery required.',
      isFixed: false,
      reasonIfNotFixed: 'Replacement battery not available in stock. Request submitted to procurement.',
    },
    {
      requester: staff1User._id,
      department: staff1User.department,
      phone: '+254 700 000 005',
      equipmentType: 'Keyboard / Mouse',
      serialNumber: null,
      officeBlock: 'Admin Block - Room 103',
      problemDescription: 'Wireless keyboard types random characters and several keys are unresponsive. Affects F-row and number pad.',
      priority: 'low',
      status: 'resolved',
      assignedTechnician: tech2User._id,
      identifiedProblem: 'Keyboard membrane worn out. Keys F9–F12 and Numpad 0–3 non-functional.',
      resolutionResponse: 'Replaced keyboard with new HP USB keyboard. Old unit disposed.',
      isFixed: true,
      feedbackRating: 4,
      feedbackComments: 'Quick replacement. Would have been nice to have the same model though.',
    },
    {
      requester: staff2User._id,
      department: staff2User.department,
      phone: '+254 700 000 006',
      equipmentType: 'Printer',
      serialNumber: 'EP-L3250-SN007',
      officeBlock: 'Admin Block - Room 103',
      problemDescription: 'Epson printer printing blank pages. Ink tanks are full and no error messages displayed on panel.',
      priority: 'medium',
      status: 'submitted',
    },
  ];

  const createdTickets = [];
  for (const t of ticketsData) {
    const existing = await Ticket.findOne({ problemDescription: t.problemDescription, requester: t.requester });
    if (existing) {
      warn(`Ticket already exists: "${t.problemDescription.slice(0, 40)}…" (skipped)`);
      createdTickets.push(existing);
    } else {
      const created = await Ticket.create(t);
      createdTickets.push(created);
      log(`Ticket created: [${t.priority.toUpperCase()}] ${t.problemDescription.slice(0, 50)}…`);
    }
  }

  const [ticket1, ticket2, ticket3, ticket4, ticket5, ticket6, ticket7, ticket8] = createdTickets;

  // ══════════════════════════════════════════════════════════
  // 6. ASSIGNMENTS
  // ══════════════════════════════════════════════════════════
  hr();
  console.log('  [6/9] Seeding assignments…');

  const assignmentsData = [
    { ticket: ticket1._id, technician: tech1._id, assigned_by: adminUser._id, notes: 'Check display cable and GPU. Replace screen if necessary.',    status: 'completed' },
    { ticket: ticket2._id, technician: tech1._id, assigned_by: adminUser._id, notes: 'Diagnose HDD health and check RAM usage. Consider SSD swap.',    status: 'in_progress' },
    { ticket: ticket3._id, technician: tech2._id, assigned_by: adminUser._id, notes: 'Clear jam, inspect rollers, and run test print.',                status: 'assigned' },
    { ticket: ticket5._id, technician: tech3._id, assigned_by: adminUser._id, notes: 'Check GPU temps and display cable. Run hardware diagnostics.',  status: 'in_progress' },
    { ticket: ticket6._id, technician: tech1._id, assigned_by: adminUser._id, notes: 'Battery diagnostics. Check if replacement is available.',        status: 'completed' },
    { ticket: ticket7._id, technician: tech2._id, assigned_by: adminUser._id, notes: 'Replace keyboard. Verify all keys functional after swap.',      status: 'completed' },
  ];

  const createdAssignments = [];
  for (const a of assignmentsData) {
    const existing = await Assignment.findOne({ ticket: a.ticket, technician: a.technician });
    if (existing) {
      warn(`Assignment already exists for ticket ${a.ticket} (skipped)`);
      createdAssignments.push(existing);
    } else {
      const created = await Assignment.create(a);
      createdAssignments.push(created);
      log(`Assignment created: ticket → technician [${a.status}]`);
    }
  }

  // ══════════════════════════════════════════════════════════
  // 7. MAINTENANCE RECORDS
  // ══════════════════════════════════════════════════════════
  hr();
  console.log('  [7/9] Seeding maintenance records…');

  const recordsData = [
    {
      request: ticket1._id, technician: tech1._id,
      action_taken: 'Replaced faulty LCD screen cable (30-pin ribbon). Reseated GPU heatsink and applied fresh thermal paste. Screen now stable after 2-hour burn-in test.',
      parts_used: 'LCD ribbon cable (30-pin), thermal paste',
      notes: 'Advised user to avoid heavy physical stress on lid hinge.',
      status: 'resolved',
    },
    {
      request: ticket2._id, technician: tech1._id,
      action_taken: 'Ran CrystalDiskInfo — HDD health at 12% (Caution). Cloned drive to new SSD. Testing boot performance.',
      parts_used: 'Samsung 870 EVO 500GB SSD',
      notes: 'Cloning in progress. Will verify Windows activation after reboot.',
      status: 'in_progress',
    },
    {
      request: ticket5._id, technician: tech3._id,
      action_taken: 'Connected external monitor via HDMI — same artifacts appear. Ran GPU stress test — temps peaked at 98°C. Cleaned heatsink and reapplied thermal paste.',
      parts_used: 'Thermal paste (Arctic MX-5)',
      notes: 'GPU runs cooler now. Monitoring for recurrence over 48 hours.',
      status: 'in_progress',
    },
    {
      request: ticket6._id, technician: tech1._id,
      action_taken: 'Ran HP battery diagnostics — Design Capacity: 0 mWh, Cycle Count: 1247. Battery is dead. Checked inventory — no replacement available.',
      parts_used: null,
      notes: 'Referred to procurement for replacement battery order.',
      status: 'resolved',
    },
    {
      request: ticket7._id, technician: tech2._id,
      action_taken: 'Removed faulty wireless keyboard. Installed new HP USB keyboard KB216. Tested all keys including F-row and numpad via online key tester.',
      parts_used: 'HP USB Keyboard KB216',
      notes: 'All keys verified functional. Old keyboard disposed.',
      status: 'resolved',
    },
  ];

  for (const r of recordsData) {
    const existing = await MaintenanceRecord.findOne({ request: r.request, technician: r.technician });
    if (existing) {
      warn(`Maintenance record already exists (skipped)`);
    } else {
      await MaintenanceRecord.create(r);
      log(`Maintenance record created: ${r.status}`);
    }
  }

  // ══════════════════════════════════════════════════════════
  // 8. FEEDBACK
  // ══════════════════════════════════════════════════════════
  hr();
  console.log('  [8/9] Seeding feedback…');

  const feedbackData = [
    { request: ticket1._id, user: staff1User._id, rating: 5, comment: 'Excellent service! Screen fixed within one day. Very professional technician.' },
    { request: ticket6._id, user: staff2User._id, rating: 3, comment: 'Technician was thorough but battery replacement was not possible. Hope procurement sorts it out soon.' },
    { request: ticket7._id, user: staff1User._id, rating: 4, comment: 'Quick replacement. Would have been nice to have the same wireless model though.' },
  ];

  for (const f of feedbackData) {
    const existing = await Feedback.findOne({ request: f.request });
    if (existing) {
      warn(`Feedback already exists for request ${f.request} (skipped)`);
    } else {
      await Feedback.create(f);
      log(`Feedback created: ${f.rating}/5 stars`);
    }
  }

  // ══════════════════════════════════════════════════════════
  // 9. NOTIFICATIONS
  // ══════════════════════════════════════════════════════════
  hr();
  console.log('  [9/9] Seeding notifications…');

  const notifCount = await Notification.countDocuments();
  if (notifCount > 0) {
    warn(`Notifications already exist (${notifCount} found, skipped)`);
  } else {
    const notificationsData = [
      // Admin notifications
      { user: adminUser._id, title: 'New HIGH Priority Ticket',    message: 'A laptop screen flickering ticket was submitted by Aisha Malik (Finance). Priority: HIGH.',         type: 'warning' },
      { user: adminUser._id, title: 'Ticket Resolved',            message: 'Ticket TK-0001 "Laptop screen flickering" has been marked as Resolved.',                        type: 'success' },
      { user: adminUser._id, title: 'New MEDIUM Ticket',          message: 'A desktop slowdown ticket was submitted by David Brown (HR). Priority: MEDIUM.',                 type: 'info'    },
      { user: adminUser._id, title: 'Ticket Not Fixed',           message: 'Ticket for laptop battery replacement was marked Not Fixed — replacement part unavailable.',      type: 'danger'  },
      // Technician notifications
      { user: tech1User._id, title: 'New Assignment',             message: 'You have been assigned a laptop screen flickering ticket (HIGH).',                                type: 'info'    },
      { user: tech1User._id, title: 'New Assignment',             message: 'You have been assigned a desktop slowdown ticket (MEDIUM).',                                     type: 'info'    },
      { user: tech1User._id, title: 'New Assignment',             message: 'You have been assigned a laptop battery replacement ticket (LOW).',                               type: 'info'    },
      { user: tech2User._id, title: 'New Assignment',             message: 'You have been assigned a printer paper jam ticket (MEDIUM).',                                    type: 'info'    },
      { user: tech2User._id, title: 'New Assignment',             message: 'You have been assigned a keyboard replacement ticket (LOW).',                                    type: 'info'    },
      { user: tech3User._id, title: 'New Assignment',             message: 'You have been assigned a monitor artifacts ticket (HIGH).',                                      type: 'info'    },
      // Requester notifications
      { user: staff1User._id, title: 'Ticket Submitted',          message: 'Your ticket for laptop screen flickering has been submitted and is pending review.',              type: 'success' },
      { user: staff1User._id, title: 'Ticket Resolved',           message: 'Your ticket for laptop screen flickering has been resolved. Please leave feedback.',              type: 'success' },
      { user: staff2User._id, title: 'Ticket Submitted',          message: 'Your ticket for desktop slowdown has been submitted and is pending review.',                     type: 'success' },
      { user: staff2User._id, title: 'Ticket In Progress',        message: 'Your ticket for desktop slowdown is now being worked on by a technician.',                       type: 'info'    },
      { user: staff3User._id, title: 'Ticket Submitted',          message: 'Your ticket for Windows update failure has been submitted and is pending review.',               type: 'success' },
      { user: staff2User._id, title: 'Ticket Not Fixed',          message: 'Your laptop battery ticket could not be resolved. Reason: replacement part not available.',       type: 'danger'  },
    ];

    await Notification.insertMany(notificationsData);
    log(`${notificationsData.length} notifications created`);
  }

  // ── Summary ────────────────────────────────────────────────
  hr();
  console.log('\n  ╔══════════════════════════════════════════════════╗');
  console.log('  ║            Seed Complete — Summary               ║');
  console.log('  ╠══════════════════════════════════════════════════╣');
  console.log(`  ║  Users              : ${await User.countDocuments()}`.padEnd(51) + '║');
  console.log(`  ║  Technicians        : ${await Technician.countDocuments()}`.padEnd(51) + '║');
  console.log(`  ║  Categories         : ${await Category.countDocuments()}`.padEnd(51) + '║');
  console.log(`  ║  ICT Assets         : ${await ICTAsset.countDocuments()}`.padEnd(51) + '║');
  console.log(`  ║  Tickets            : ${await Ticket.countDocuments()}`.padEnd(51) + '║');
  console.log(`  ║  Assignments        : ${await Assignment.countDocuments()}`.padEnd(51) + '║');
  console.log(`  ║  Maintenance Records: ${await MaintenanceRecord.countDocuments()}`.padEnd(51) + '║');
  console.log(`  ║  Feedback           : ${await Feedback.countDocuments()}`.padEnd(51) + '║');
  console.log(`  ║  Notifications      : ${await Notification.countDocuments()}`.padEnd(51) + '║');
  console.log('  ╠══════════════════════════════════════════════════╣');
  console.log('  ║  Login Credentials                              ║');
  console.log('  ║  Admin   : admin@ict.local                     ║');
  console.log('  ║  Tech 1  : tech1@ict.local                     ║');
  console.log('  ║  Tech 2  : tech2@ict.local                     ║');
  console.log('  ║  Tech 3  : tech3@ict.local                     ║');
  console.log('  ║  Staff 1 : staff1@ict.local                    ║');
  console.log('  ║  Staff 2 : staff2@ict.local                    ║');
  console.log('  ║  Staff 3 : staff3@ict.local                    ║');
  console.log('  ║  Passwords: set via SEED_* env vars, not shown ║');
  console.log('  ╚══════════════════════════════════════════════════╝\n');

  await mongoose.connection.close();
  console.log('  Connection closed. Done!\n');
  process.exit(0);
}

seed().catch(err => {
  console.error('\n  ✖  Seed failed:', err.message);
  mongoose.connection.close();
  process.exit(1);
});
