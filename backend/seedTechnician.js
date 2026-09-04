/**
 * seedTechnician.js
 * Create a Technician user for testing.
 *
 * Run from backend folder:
 *   node seedTechnician.js
 */

require("dotenv").config({ path: "./.env" });

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const User = require("./models/User");
const Technician = require("./models/Technician");

const MONGO_URI =
  process.env.MONGO_URI || "mongodb://localhost:27017/ict_maintenance_db";

async function seedTechnician() {
  try {
    console.log("Connecting to MongoDB...");

    await mongoose.connect(MONGO_URI);

    console.log("Connected to MongoDB");

    // Check whether a Technician already exists
    const existingTech = await User.findOne({
      role: "Technician",
    });

    if (existingTech) {
      console.log("");
      console.log("=== TECHNICIAN USER ALREADY EXISTS ===");
      console.log(`Email:  ${existingTech.email}`);
      console.log(`Role:   ${existingTech.role}`);
      console.log(`Status: ${existingTech.status}`);
      console.log("=======================================");
      console.log("");

      return;
    }

    // Technician login credentials (env-overridable, never printed)
    const email = "technician@dbu.edu.et";
    const password = process.env.SEED_TECH_PASSWORD || "Technician123!";
    const fullName = "Test Technician";
    const department = "ICT Infrastructure and Security Services";
    const phone = "+251-11-681-0000";

    const hashedPassword = await bcrypt.hash(password, 12);

    console.log("Creating Technician user...");

    const user = await User.create({
      fullName,
      email: email.toLowerCase(),
      password: hashedPassword,
      role: "Technician",
      department,
      phone,
      status: "active",
    });

    console.log(`User created: ${user._id}`);

    // Create Technician profile
    await Technician.create({
      user: user._id,
      specialization: "Hardware Repair",
      available: true,
    });

    console.log("Technician profile created successfully.");

    console.log("");
    console.log("==========================================");
    console.log("       TECHNICIAN ACCOUNT CREATED         ");
    console.log("==========================================");
    console.log("Email:    technician@dbu.edu.et");
    console.log("Password: (set, not shown)");
    console.log("Role:     Technician");
    console.log("Status:   active");
    console.log("==========================================");
    console.log("");
    console.log("Login: http://localhost:3000/views/login.html");
    console.log("Dashboard: /views/technician/dashboard.html");
    console.log("");
  } catch (err) {
    console.error("");
    console.error("Seed failed:", err.message);

    if (err.code === 11000) {
      console.error("A user with this email already exists.");
    }
  } finally {
    await mongoose.connection.close();
    console.log("MongoDB connection closed.");
  }
}

seedTechnician();
