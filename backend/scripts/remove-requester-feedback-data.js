require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const mongoose = require("mongoose");

const applyChanges = process.argv.includes("--apply");
const dbName = process.env.MONGO_DB_NAME || "ict_maintenance_db";
const requesterFeedbackTicketFields = {
  $or: [
    { requesterFeedback: { $exists: true } },
    { feedbackRating: { $exists: true } },
    { feedbackComments: { $exists: true } },
  ],
};
const legacyFeedbackPrompt = /Please (?:leave feedback|rate the service)\.$/i;

async function removeRequesterFeedbackData() {
  const uri = (process.env.MONGO_URI || "").trim();
  if (!uri) {
    throw new Error("MONGO_URI must be set in backend/.env before running this migration.");
  }

  await mongoose.connect(uri, { dbName });
  const db = mongoose.connection.db;
  const tickets = db.collection("tickets");
  const notifications = db.collection("notifications");
  const ticketCount = await tickets.countDocuments(requesterFeedbackTicketFields);
  const notificationCount = await notifications.countDocuments({
    message: legacyFeedbackPrompt,
  });
  const feedbackCollectionExists = await db
    .listCollections({ name: "feedbacks" }, { nameOnly: true })
    .hasNext();

  console.log(`Database: ${mongoose.connection.name}`);
  console.log(`Tickets with legacy requester feedback fields: ${ticketCount}`);
  console.log(`Notifications with the legacy feedback prompt: ${notificationCount}`);
  console.log(`Dedicated feedbacks collection exists: ${feedbackCollectionExists}`);

  if (!applyChanges) {
    console.log("Dry run only. Re-run with --apply to permanently remove this feature's data.");
    return;
  }

  const ticketResult = await tickets.updateMany(requesterFeedbackTicketFields, {
    $unset: {
      requesterFeedback: "",
      feedbackRating: "",
      feedbackComments: "",
    },
  });
  if (feedbackCollectionExists) {
    await db.dropCollection("feedbacks");
  }
  const notificationResult = await notifications.updateMany(
    { message: legacyFeedbackPrompt },
    [
      {
        $set: {
          message: {
            $trim: {
              input: {
                $replaceOne: {
                  input: "$message",
                  find: {
                    $cond: [
                      {
                        $regexMatch: {
                          input: "$message",
                          regex: /Please rate the service\.$/i,
                        },
                      },
                      "Please rate the service.",
                      "Please leave feedback.",
                    ],
                  },
                  replacement: "",
                },
              },
            },
          },
        },
      },
    ],
  );

  console.log(`Updated ticket records: ${ticketResult.modifiedCount}`);
  console.log(`Updated notification messages: ${notificationResult.modifiedCount}`);
  console.log(`Dropped dedicated feedbacks collection: ${feedbackCollectionExists}`);
}

removeRequesterFeedbackData()
  .catch((error) => {
    console.error(`Requester feedback data migration failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
