# Casino Patron Marketing Data Model (MongoDB Atlas)

This model is designed for a web-only casino marketing platform focused on table gaming.

## Collections

1. `patron_profiles`
- Purpose: core patron profile, ADT, game preferences, loyalty state.
- Key fields: `patronId`, `tier`, `adt`, `preferredGames`, `pointsBalance`, `preferenceEmbedding`.
- Indexes: unique `patronId`, tier/ADT, last activity timestamp.
- Vector index: `preferenceEmbedding` for preference-to-offer matching.

2. `table_state_snapshots`
- Purpose: 1-minute table heatmap snapshot for floor occupancy.
- Key fields: `tableId`, `zone`, `gameType`, `patronCount`, `avgBetAmount`, `occupancyRate`, `refreshedAt`.
- Indexes: unique `tableId`, zone/status, snapshot recency.

3. `patron_table_sessions`
- Purpose: active patron behavior on tables, used for click-to-zoom drilldown.
- Key fields: `patronId`, `tableId`, `sessionBetAmount`, `behaviorTags`, `isActive`.
- Indexes: patron active sessions, table active sessions, recent actions.

4. `patron_activity_events`
- Purpose: all cross-channel activity events (cage, table, loyalty, POS).
- Key fields: `eventId`, `patronId`, `activityType`, `amount`, `pointsDelta`, `metadata`, `activityEmbedding`.
- Indexes: unique `eventId`, patron timeline, activity type timeline.
- Vector index: `activityEmbedding` for semantic behavior retrieval.

5. `offer_catalog`
- Purpose: canonical marketing offers available for matching/generation.
- Key fields: `offerId`, `offerType`, `eligibilityRules`, `priority`, `status`, `offerEmbedding`.
- Indexes: unique `offerId`, status/priority, type.
- Vector index: `offerEmbedding` for similarity search from patron/activity vectors.

6. `offer_recommendations`
- Purpose: generated offer decisions per patron with confidence and action.
- Key fields: `recommendationId`, `patronId`, `offerId`, `relevanceScore`, `confidence`, `status`, `generatedBy`.
- Indexes: unique `recommendationId`, patron timeline, status timeline.

7. `campaign_runs`
- Purpose: campaign orchestration and KPI tracking.
- Key fields: `campaignId`, `goal`, `segmentCriteria`, `includedOfferIds`, `targetPatronIds`, `metrics`.
- Indexes: unique `campaignId`, status/start.

8. `chat_sessions`
- Purpose: AI marketing assistant session context for web users.
- Key fields: `sessionId`, `marketingUserId`, `patronContextIds`, `state`.
- Indexes: unique `sessionId`, user/state.

9. `chat_messages`
- Purpose: message-level conversation and agent execution output.
- Key fields: `sessionId`, `messageId`, `role`, `content`, `agentName`, `model`, `references`.
- Indexes: unique `messageId`, session chronology.

## Relationships

- `patron_profiles.patronId` links to:
  - `patron_table_sessions.patronId`
  - `patron_activity_events.patronId`
  - `offer_recommendations.patronId`
  - `chat_sessions.patronContextIds[]`
- `table_state_snapshots.tableId` links to `patron_table_sessions.tableId`.
- `offer_catalog.offerId` links to `offer_recommendations.offerId` and `campaign_runs.includedOfferIds[]`.

## Vector Search Strategy

- Atlas vector indexes are created for:
  - patron preference vectors
  - patron activity vectors
  - offer vectors
- Expected flow:
  1. Aggregate recent patron activity.
  2. Retrieve top-k similar offers using vector similarity.
  3. Post-rank with business rules (tier, ADT, risk flags, budget).
  4. Save top recommendations in `offer_recommendations`.
