import { closeClient, getDb } from "../db.js";
import { webCollections } from "../web/collections.js";

const LEGACY_ACTIVITY_COLLECTION = "patron_activity_events";
const BATCH_SIZE = 500;

type LegacyActivity = {
  eventId?: string;
  patronId?: string;
  activityType?: string;
  source?: string;
  amount?: number;
  pointsDelta?: number;
  metadata?: Record<string, string | number | boolean>;
  activityEmbedding?: number[];
  eventTime?: Date | string;
};

function toDate(value: Date | string | undefined): Date {
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

async function migrate() {
  const db = await getDb();
  const legacyCollection = db.collection(LEGACY_ACTIVITY_COLLECTION);
  const patronsCollection = db.collection(webCollections.patrons);

  const totalLegacyEvents = await legacyCollection.countDocuments({});
  console.log(`Found ${totalLegacyEvents} legacy activity events.`);

  if (totalLegacyEvents === 0) {
    console.log("No legacy events found. Nothing to migrate.");
    return;
  }

  let processed = 0;
  let migrated = 0;
  let skippedMissingPatronId = 0;
  let skippedMissingPatronProfile = 0;

  const cursor = legacyCollection.find({}, { batchSize: BATCH_SIZE });
  for await (const raw of cursor) {
    processed += 1;
    const activity = raw as LegacyActivity;
    if (!activity.patronId) {
      skippedMissingPatronId += 1;
      continue;
    }

    const embeddedActivity = {
      eventId: activity.eventId ?? `migrated-${raw._id}`,
      activityType: activity.activityType ?? "TableBet",
      source: activity.source ?? "TableSystem",
      amount: activity.amount ?? 0,
      pointsDelta: activity.pointsDelta ?? 0,
      metadata: activity.metadata ?? {},
      activityEmbedding: Array.isArray(activity.activityEmbedding) ? activity.activityEmbedding : [],
      eventTime: toDate(activity.eventTime),
    };

    const result = await patronsCollection.updateOne(
      { patronId: activity.patronId },
      {
        $set: { updatedAt: new Date() },
        $addToSet: { activities: embeddedActivity },
      }
    );

    if (result.matchedCount === 0) {
      skippedMissingPatronProfile += 1;
      continue;
    }

    if (result.modifiedCount > 0) {
      migrated += 1;
    }

    if (processed % BATCH_SIZE === 0) {
      console.log(`Processed ${processed}/${totalLegacyEvents} events...`);
    }
  }

  console.log("Migration complete.");
  console.log(
    JSON.stringify(
      {
        totalLegacyEvents,
        processed,
        migrated,
        skippedMissingPatronId,
        skippedMissingPatronProfile,
        unchanged: processed - migrated - skippedMissingPatronId - skippedMissingPatronProfile,
      },
      null,
      2
    )
  );

  console.log(
    "Optional cleanup command (run manually if results look correct): db.patron_activity_events.drop()"
  );
}

migrate()
  .catch((error) => {
    console.error("Migration failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeClient();
  });
