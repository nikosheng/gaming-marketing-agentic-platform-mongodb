# Loss Potential Agentic Review - Design Plan

## Summary
- Design a new per-patron agentic workflow launched from each patron card after table analysis, focused on:
  - Loss-chasing risk evaluation.
  - Financial credit + source-of-funds AML check (internal data only for MVP).
  - Human-in-loop decision with escalation tiers.
  - PR assignment to an appropriate casino PR agent based on capacity and preferences.
- Scope for this phase is design-first only (schema + API contracts + LangGraph topology + modern UI/UX spec), not implementation.

## Current State Analysis
- The current table analysis flow exists in `src/web/table-drilldown-agent.ts` and returns ranked patrons with loss potential metrics only.
- The current API for table analysis exists in `app/api/tables/[tableId]/analyze/route.ts` and returns one-shot analysis output; no persisted case workflow.
- Patron list rendering and the `Start Loss Potential Agent` trigger exist in `app/ui/dashboard-client.tsx`, but there is no per-patron action button or case modal.
- Existing data model and collections cover patrons, sessions, offers, and recommendations (`src/types.ts`, `docs/data-model.md`, `src/web/collections.ts`) but do not model:
  - multi-stage compliance/approval cases,
  - PR staffing/capacity preferences,
  - case timeline events and escalations.

## Proposed Changes

### 1) Data Schema Modeling (New Collections + Type Additions)
- Update `src/types.ts` with new domain types/interfaces:
  - `RiskCaseStatus`: `Draft | InReview | AwaitingAdmin | Approved | Rejected | Assigned | Closed`.
  - `RiskLevel`: `Low | Medium | High | Critical`.
  - `AgentNodeStatus`: `Pending | Running | Completed | Failed | Skipped`.
  - `AdminDecision`: `Approve | Reject | RequestMoreInfo`.
  - `PatronRiskCase`:
    - IDs/context: `caseId`, `patronId`, `tableId`, `analysisRunId`.
    - model outputs: `lossChasingAssessment`, `financialAssessment`.
    - workflow state: `status`, `riskLevel`, `currentNode`, `escalationTier`.
    - audit: `createdAt`, `updatedAt`, `createdBy`, `timeline`.
  - `LossChasingAssessment`:
    - `score`, `label`, `drivers`, `confidence`, `explanation`.
  - `FinancialAssessment`:
    - `amlRiskScore`, `creditBand`, `sourceOfFundsRisk`, `checklist`, `confidence`, `analystNotes`.
  - `AdminReviewRecord`:
    - approver identity, decision, rationale, requested actions, timestamp.
  - `PRAgentProfile`:
    - identity (`prAgentId`, `name`, `active`),
    - capacity (`maxActivePatrons`, `currentActivePatrons`),
    - preference vectors (`preferredTiers`, `preferredGames`, `preferredLanguages`, `specialtyTags`),
    - assignment metadata (`lastAssignedAt`).
  - `PRAssignment`:
    - `assignmentId`, `caseId`, `patronId`, `prAgentId`, `fitScore`, `status`, `assignedAt`, `acceptedAt`.
  - `RiskCaseTimelineEvent`:
    - `eventType`, `actorType`, `actorId`, `payload`, `createdAt`.
- Update `docs/data-model.md` to add new collections and relationship diagrams:
  - `patron_risk_cases`
  - `pr_agent_profiles`
  - `pr_assignments`
  - `risk_case_timeline` (or embedded timeline strategy documented as a decision).
- Update `src/web/collections.ts` with new collection constants:
  - `riskCases`, `prAgents`, `prAssignments` (and optional `riskTimeline` if separate collection).
- Index strategy to document:
  - `patron_risk_cases`: unique `caseId`, `patronId+status`, `riskLevel+status`, `updatedAt`.
  - `pr_agent_profiles`: `active`, `currentActivePatrons`, compound preference indexes where helpful.
  - `pr_assignments`: unique `assignmentId`, `prAgentId+status`, `caseId`.

### 2) LangGraph Flow Design (Case-Oriented, Human-In-The-Loop)
- New orchestrator design target file: `src/web/patron-risk-case-agent.ts` (design spec only in this phase).
- Graph nodes (sequential + gated):
  1. `initialize_case`:
     - Build/persist case skeleton from patron + table context.
  2. `evaluate_loss_chasing`:
     - Derive behavioral signals and produce `LossChasingAssessment`.
  3. `evaluate_financial_credit_aml`:
     - Internal-data AML/SOF checklist scoring and confidence output.
  4. `risk_escalation_router`:
     - Assign escalation tier (`Standard` vs `Senior`) from combined risk.
  5. `await_admin_review` (human gate):
     - Pause until admin action event arrives.
  6. `assign_pr_agent` (post-approval only):
     - Compute fit score from capacity + preferences + patron profile.
  7. `emit_assignment_notice`:
     - Persist in-app assignment queue event.
  8. `finalize_case`.
- Failure and branch behavior:
  - If AML node fails => set node status `Failed`, case status `InReview`, timeline event + admin override option.
  - If admin rejects => case status `Rejected`, graph ends.
  - If `RequestMoreInfo` => loop to targeted re-evaluation node with bounded retry count.
- State contract (documented in plan, implemented later):
  - `caseId`, `patronContext`, `lossAssessment`, `financialAssessment`, `riskTier`, `adminDecision`, `prAssignment`, `timelineEvents`.

### 3) API Contract Design
- Extend/introduce API route specifications:
  - `POST /api/tables/[tableId]/analyze` (existing):
    - Keep existing ranking response; add optional `analysisRunId` for downstream per-patron case launch.
  - `POST /api/patrons/[patronId]/risk-case`:
    - Input: `tableId`, `analysisRunId`, optional operator notes.
    - Output: created case summary + initial node statuses.
  - `GET /api/patrons/[patronId]/risk-case/latest`:
    - Output: latest case with node cards, timeline, and admin action requirements.
  - `POST /api/risk-cases/[caseId]/admin-decision`:
    - Input: `decision`, `rationale`, `requestedActions`.
    - Output: updated case state + next node statuses.
  - `GET /api/risk-cases/queue`:
    - Output: admin work queue grouped by escalation tier.
  - `GET /api/pr-assignments/queue`:
    - Output: PR follow-up queue for in-app handoff.
- Validation approach:
  - Validate required fields and allowed enums at route boundary.
  - Emit deterministic error payloads (`ok: false`, `error`, optional `code`).

### 4) Frontend UX Design (Modern + Fancy, Process-Centric)
- Primary file for future implementation: `app/ui/dashboard-client.tsx`.
- Add per-patron action in drill-down list:
  - New button on each patron card: `Start Risk Review`.
  - Button opens process modal/drawer with timeline + node progress.
- New UI states/components (can remain within same file first, then refactor):
  - `RiskProcessModal`:
    - Header with patron + current risk badge + escalation chip.
    - Horizontal stepper for nodes (loss, AML, admin, PR assignment).
    - Rich cards for both agent outputs (scores, checklist, confidence, rationale).
  - `AdminApprovalDialog`:
    - Decision options (`Approve`, `Reject`, `Request More Info`).
    - Required rationale text area.
    - Escalation indicator (`Standard`/`Senior`).
  - `PRMatchPanel`:
    - Ranked PR candidates with `fitScore`, capacity, and preference match tags.
  - `CaseTimelinePanel`:
    - Immutable event feed with actor and timestamp.
- Visual language guidance for modern style in `app/globals.css`:
  - Glassmorphism + gradient accent cards for process stages.
  - Animated state transitions for node status (`Running` shimmer, `Completed` glow).
  - Color semantics for risk levels and compliance severity.
  - Accessible contrast and keyboard focus states for modal actions.

### 5) Data Flow and Behavioral Specification
- User journey:
  1. User runs table analysis (`Start Loss Potential Agent`).
  2. Ranked patron cards show key metrics and new `Start Risk Review` action.
  3. Clicking action creates/opens a case and starts two-agent evaluation sequence.
  4. System waits for admin in approval dialog; applies escalation rule.
  5. On approval, PR assignment node chooses best-fit available PR agent.
  6. Assignment appears in in-app PR queue; case status transitions to `Assigned`.
- Escalation rule (design decision):
  - `Critical` and high AML-risk cases route to senior-tier admin queue.
  - Others route to standard admin queue.
- PR fit scoring model (design decision):
  - Weighted score combining capacity availability + tier/game/language preference overlap + recency fairness.

## Assumptions & Decisions
- Confirmed decisions from stakeholder:
  - This phase is design-first only.
  - AML/KYC uses internal profile/activity data only.
  - Human gate uses escalation tiers.
  - Handoff uses in-app assignment queue.
  - PR availability uses capacity slots + preference matching.
  - Financial evidence model uses structured checklist + analyst notes (no document upload in MVP).
- Assumptions to keep implementation safe:
  - Existing authentication/authorization layer for admin actions is handled outside this feature.
  - Existing patron/session identifiers remain stable and unique.
  - No external messaging/webhook delivery required in MVP.

## Verification Steps (For Implementation Phase)
- Data model validation:
  - Confirm all new enums/interfaces compile and align with persisted payload shapes.
  - Validate index creation scripts for new collections.
- Workflow validation:
  - Simulate case lifecycle: create -> evaluate nodes -> admin approve/reject -> PR assignment.
  - Confirm escalation routing and retry behavior for `RequestMoreInfo`.
- API validation:
  - Contract tests for required payload fields and enum validation.
  - Error-path checks for missing case/patron/admin decision payloads.
- UX validation:
  - Patron-card button launches modal with correct case context.
  - Admin decision updates node status and timeline in near-real-time (via refresh/poll in MVP).
  - PR queue reflects assigned cases with fit metadata.
- Non-functional checks:
  - Ensure UI remains responsive under concurrent case operations.
  - Confirm timeline audit completeness for compliance traceability.

