import { Db } from "mongodb";
import { config } from "../config.js";

export const collections = {
  patrons: "patron_profiles",
  tables: "table_state_snapshots",
  sessions: "patron_table_sessions",
  activities: "patron_activity_events",
  offers: "offer_catalog",
  recommendations: "offer_recommendations",
  campaigns: "campaign_runs",
  chatSessions: "chat_sessions",
  chatMessages: "chat_messages",
};

async function createVectorIndexIfNeeded(
  db: Db,
  collectionName: string,
  indexName: string,
  path: string
) {
  try {
    await db.command({
      createSearchIndexes: collectionName,
      indexes: [
        {
          name: indexName,
          type: "vectorSearch",
          definition: {
            fields: [
              {
                type: "vector",
                path,
                numDimensions: config.vectorEmbeddingDim,
                similarity: "cosine",
              },
            ],
          },
        },
      ],
    });
  } catch (error) {
    const message = (error as Error).message ?? "";
    if (
      message.includes("already exists") ||
      message.includes("Index already exists")
    ) {
      return;
    }
    throw error;
  }
}

export async function ensureIndexes(db: Db): Promise<void> {
  await db.collection(collections.patrons).createIndex({ patronId: 1 }, { unique: true });
  await db.collection(collections.patrons).createIndex({ tier: 1, adt: -1 });
  await db.collection(collections.patrons).createIndex({ lastActiveAt: -1 });

  await db.collection(collections.tables).createIndex({ tableId: 1 }, { unique: true });
  await db.collection(collections.tables).createIndex({ zone: 1, status: 1 });
  await db.collection(collections.tables).createIndex({ refreshedAt: -1 });

  await db.collection(collections.sessions).createIndex({ patronId: 1, isActive: 1 });
  await db.collection(collections.sessions).createIndex({ tableId: 1, isActive: 1 });
  await db.collection(collections.sessions).createIndex({ lastActionAt: -1 });

  await db.collection(collections.activities).createIndex({ eventId: 1 }, { unique: true });
  await db.collection(collections.activities).createIndex({ patronId: 1, eventTime: -1 });
  await db.collection(collections.activities).createIndex({ activityType: 1, eventTime: -1 });

  await db.collection(collections.offers).createIndex({ offerId: 1 }, { unique: true });
  await db.collection(collections.offers).createIndex({ status: 1, priority: -1 });
  await db.collection(collections.offers).createIndex({ offerType: 1 });

  await db
    .collection(collections.recommendations)
    .createIndex({ recommendationId: 1 }, { unique: true });
  await db.collection(collections.recommendations).createIndex({ patronId: 1, generatedAt: -1 });
  await db.collection(collections.recommendations).createIndex({ status: 1, generatedAt: -1 });

  await db.collection(collections.campaigns).createIndex({ campaignId: 1 }, { unique: true });
  await db.collection(collections.campaigns).createIndex({ status: 1, startAt: -1 });

  await db.collection(collections.chatSessions).createIndex({ sessionId: 1 }, { unique: true });
  await db.collection(collections.chatSessions).createIndex({ marketingUserId: 1, state: 1 });

  await db.collection(collections.chatMessages).createIndex({ messageId: 1 }, { unique: true });
  await db.collection(collections.chatMessages).createIndex({ sessionId: 1, createdAt: 1 });

  await createVectorIndexIfNeeded(
    db,
    collections.patrons,
    "patron_preference_vector_idx",
    "preferenceEmbedding"
  );
  await createVectorIndexIfNeeded(
    db,
    collections.activities,
    "patron_activity_vector_idx",
    "activityEmbedding"
  );
  await createVectorIndexIfNeeded(db, collections.offers, "offer_vector_idx", "offerEmbedding");
}
