const mongoose = require("mongoose");

const feedbackCounterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

module.exports = mongoose.model("FeedbackCounter", feedbackCounterSchema);
