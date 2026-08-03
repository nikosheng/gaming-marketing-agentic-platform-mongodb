import { Db } from "mongodb";
import { config } from "../config.js";

export const collections = {
  patrons: "patron_profiles",
  tables: "table_state_snapshots",
  sessions: "patron_table_sessions",
  offers: "offer_catalog",
  recommendations: "offer_recommendations",
  campaigns: "campaign_runs",
  chatSessions: "chat_sessions",
  chatMessages: "chat_messages",
  riskCases: "patron_risk_cases",
  prAgents: "pr_agent_profiles",
  prAssignments: "pr_assignments",
  tableStateHistory: "table_state_history",
  minBetRecommendations: "table_minbet_recommendations",
  minBetAudit: "table_minbet_audit",
  offerApprovalAudit: "offer_approval_audit",
  // Alert Dashboard
  alertRules: "alert_rules",
  patronAlerts: "patron_alerts",
  tableRoundHistory: "table_round_history",
  tableRoundCounters: "table_round_counters",
  // Patron History Analysis
  patronInteractions: "patron_interaction_history",
  patronAnalysisReports: "patron_analysis_reports",
  // PR Efficiency
  prKpiSearches: "pr_kpi_searches",
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

async function dropLegacyParallelArrayIndexIfExists(db: Db): Promise<void> {
  const coll = db.collection(collections.prAgents);
  try {
    const indexes = await coll.listIndexes().toArray();
    for (const index of indexes) {
      const key = index.key as Record<string, number> | undefined;
      if (!key) continue;
      const hasPreferredTiers = Object.prototype.hasOwnProperty.call(key, "preferredTiers");
      const hasPreferredGames = Object.prototype.hasOwnProperty.call(key, "preferredGames");
      if (hasPreferredTiers && hasPreferredGames && index.name && index.name !== "_id_") {
        await coll.dropIndex(index.name);
      }
    }
  } catch (error) {
    const message = (error as Error).message ?? "";
    if (
      message.includes("ns does not exist") ||
      message.includes("NamespaceNotFound")
    ) {
      return;
    }
    throw error;
  }
}

export async function ensureIndexes(db: Db): Promise<void> {
  await db.collection(collections.patrons).createIndex({ patronId: 1 }, { unique: true });
  await db.collection(collections.patrons).createIndex({ tier: 1, adt: -1 });
  await db.collection(collections.patrons).createIndex({ region: 1 });
  await db.collection(collections.patrons).createIndex({ region: 1, tier: 1, adt: -1 });
  await db.collection(collections.patrons).createIndex({ lastActiveAt: -1 });
  await db.collection(collections.patrons).createIndex({ "activities.eventTime": -1 });
  await db.collection(collections.patrons).createIndex({
    "activities.activityType": 1,
    "activities.eventTime": -1,
  });

  await db.collection(collections.tables).createIndex({ tableId: 1 }, { unique: true });
  await db.collection(collections.tables).createIndex({ zone: 1, status: 1 });
  await db.collection(collections.tables).createIndex({ refreshedAt: -1 });

  await db.collection(collections.sessions).createIndex({ patronId: 1, isActive: 1 });
  await db.collection(collections.sessions).createIndex({ tableId: 1, isActive: 1 });
  await db.collection(collections.sessions).createIndex({ lastActionAt: -1 });

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

  await db.collection(collections.riskCases).createIndex({ caseId: 1 }, { unique: true });
  await db.collection(collections.riskCases).createIndex({ patronId: 1, status: 1 });
  await db.collection(collections.riskCases).createIndex({ riskLevel: 1, status: 1 });
  await db.collection(collections.riskCases).createIndex({ updatedAt: -1 });

  await dropLegacyParallelArrayIndexIfExists(db);
  await db.collection(collections.prAgents).createIndex({ prAgentId: 1 }, { unique: true });
  await db.collection(collections.prAgents).createIndex({ active: 1, currentActivePatrons: 1 });
  // MongoDB cannot create a compound index across two array fields (parallel arrays).
  // Keep these as separate multikey indexes for filtering.
  await db.collection(collections.prAgents).createIndex({ preferredTiers: 1 });
  await db.collection(collections.prAgents).createIndex({ preferredGames: 1 });

  await db.collection(collections.prAssignments).createIndex({ assignmentId: 1 }, { unique: true });
  await db.collection(collections.prAssignments).createIndex({ prAgentId: 1, status: 1 });
  await db.collection(collections.prAssignments).createIndex({ caseId: 1 });

  await db
    .collection(collections.tableStateHistory)
    .createIndex({ tableId: 1, refreshedAt: -1 });
  // 7-day retention for history snapshots
  await db
    .collection(collections.tableStateHistory)
    .createIndex({ refreshedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 7 });

  await db
    .collection(collections.minBetRecommendations)
    .createIndex({ recommendationId: 1 }, { unique: true });
  await db
    .collection(collections.minBetRecommendations)
    .createIndex({ tableId: 1, createdAt: -1 });
  await db
    .collection(collections.minBetRecommendations)
    .createIndex({ status: 1, expiresAt: 1 });

  await db.collection(collections.minBetAudit).createIndex({ tableId: 1, at: -1 });

  await db
    .collection(collections.offerApprovalAudit)
    .createIndex({ offerId: 1, decidedAt: -1 });
  await db
    .collection(collections.offerApprovalAudit)
    .createIndex({ decision: 1, decidedAt: -1 });

  await createVectorIndexIfNeeded(
    db,
    collections.patrons,
    "patron_preference_vector_idx",
    "preferenceEmbedding"
  );
  await createVectorIndexIfNeeded(db, collections.offers, "offer_vector_idx", "offerEmbedding");

  // ---------- Alert Dashboard indexes ----------

  await db.collection(collections.alertRules).createIndex({ ruleId: 1 }, { unique: true });
  await db.collection(collections.alertRules).createIndex({ status: 1, createdAt: -1 });

  await db.collection(collections.patronAlerts).createIndex({ alertId: 1 }, { unique: true });
  await db.collection(collections.patronAlerts).createIndex({ ruleId: 1, triggeredAt: -1 });
  await db.collection(collections.patronAlerts).createIndex({ patronId: 1, triggeredAt: -1 });
  await db.collection(collections.patronAlerts).createIndex({ tableId: 1, triggeredAt: -1 });
  await db.collection(collections.patronAlerts).createIndex({ status: 1, triggeredAt: -1 });
  // 30-day TTL for patron alerts
  await db
    .collection(collections.patronAlerts)
    .createIndex({ triggeredAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

  await db
    .collection(collections.tableRoundHistory)
    .createIndex({ tableId: 1, roundNumber: 1, patronId: 1 });
  await db
    .collection(collections.tableRoundHistory)
    .createIndex({ tableId: 1, patronId: 1, roundNumber: -1 });
  // 7-day TTL for round history
  await db
    .collection(collections.tableRoundHistory)
    .createIndex({ recordedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 7 });

  await db.collection(collections.tableRoundCounters).createIndex({ tableId: 1 }, { unique: true });

  // ---------- PR Efficiency indexes ----------

  await db
    .collection(collections.prKpiSearches)
    .createIndex({ searchId: 1 }, { unique: true });
  await db
    .collection(collections.prKpiSearches)
    .createIndex({ searchedAt: -1 });

  // Vector index for interaction records — enables KPI semantic search
  await createVectorIndexIfNeeded(
    db,
    collections.patronInteractions,
    "interaction_embedding_idx",
    "interactionEmbedding"
  );

  // ---------- Patron Interaction History indexes ----------

  await db
    .collection(collections.patronInteractions)
    .createIndex({ interactionId: 1 }, { unique: true });
  await db
    .collection(collections.patronInteractions)
    .createIndex({ patronId: 1, occurredAt: -1 });
  await db
    .collection(collections.patronInteractions)
    .createIndex({ recordedBy: 1, occurredAt: -1 });
  await db
    .collection(collections.patronInteractions)
    .createIndex({ type: 1, occurredAt: -1 });
  // No TTL — interaction history is permanent

  // ---------- Patron Analysis Report indexes ----------

  await db
    .collection(collections.patronAnalysisReports)
    .createIndex({ reportId: 1 }, { unique: true });
  await db
    .collection(collections.patronAnalysisReports)
    .createIndex({ patronId: 1, generatedAt: -1 });
  await db
    .collection(collections.patronAnalysisReports)
    .createIndex({ triggeredByAlertId: 1 }, { unique: true });
  await db
    .collection(collections.patronAnalysisReports)
    .createIndex({ status: 1, generatedAt: -1 });
}
