# Casino Patron Marketing Data Model (MongoDB Atlas)

This model is designed for a web-only casino marketing platform focused on table gaming, with agentic patron risk-review and PR handoff workflow support.

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

10. `patron_risk_cases`
- Purpose: case-centric lifecycle for loss-chasing detection, AML/financial checks, admin gate, and PR assignment.
- Key fields: `caseId`, `patronId`, `tableId`, `analysisRunId`, `status`, `riskLevel`, `escalationTier`, `currentNode`, `nodeStates`, `lossChasingAssessment`, `financialAssessment`, `adminReview`, `timeline`.
- Indexes: unique `caseId`, `patronId + status`, `riskLevel + status`, `updatedAt`.

11. `pr_agent_profiles`
- Purpose: operational profile of casino PR agents, including capacity and preference signals used by assignment logic.
- Key fields: `prAgentId`, `active`, `maxActivePatrons`, `currentActivePatrons`, `preferredTiers`, `preferredGames`, `preferredLanguages`, `specialtyTags`, `lastAssignedAt`.
- Indexes: unique `prAgentId`, `active + currentActivePatrons`, preference fields as needed for filtering.

12. `pr_assignments`
- Purpose: persisted handoff tasks from approved risk cases to specific PR agents.
- Key fields: `assignmentId`, `caseId`, `patronId`, `prAgentId`, `fitScore`, `status`, `assignedAt`, `acceptedAt`.
- Indexes: unique `assignmentId`, `prAgentId + status`, `caseId`.

## Relationships

- `patron_profiles.patronId` links to:
  - `patron_table_sessions.patronId`
  - `patron_activity_events.patronId`
  - `offer_recommendations.patronId`
  - `chat_sessions.patronContextIds[]`
- `table_state_snapshots.tableId` links to `patron_table_sessions.tableId`.
- `offer_catalog.offerId` links to `offer_recommendations.offerId` and `campaign_runs.includedOfferIds[]`.
- `patron_risk_cases.patronId` links to `patron_profiles.patronId`.
- `patron_risk_cases.analysisRunId` links to table analysis execution metadata from drilldown process.
- `pr_assignments.caseId` links to `patron_risk_cases.caseId`.
- `pr_assignments.prAgentId` links to `pr_agent_profiles.prAgentId`.

## Agentic Risk Workflow

1. User launches table-level ranking via `Start Loss Potential Agent`.
2. User starts patron-level risk review case from a patron card.
3. Agent node 1 generates loss-chasing assessment.
4. Agent node 2 generates financial credit + source-of-funds AML assessment (internal data).
5. Escalation tier is derived from combined risk profile.
6. Admin reviews both outputs and chooses `Approve`, `Reject`, or `RequestMoreInfo`.
7. If approved, assignment engine selects best-fit PR agent by capacity and preference.
8. Assignment is persisted in `pr_assignments` and surfaced in in-app PR queue.

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
