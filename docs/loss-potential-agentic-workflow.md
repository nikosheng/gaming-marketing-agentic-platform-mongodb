# Loss Potential Agentic Workflow Design

## Goal

Add a patron-level workflow that starts from table drill-down results and executes:
1. Loss-chasing assessment agent.
2. Financial credit + source-of-funds AML agent (internal signals only).
3. Human admin review with escalation tier routing.
4. PR assignment agent and in-app PR queue handoff.

## LangGraph Topology

### Node Sequence

1. `initialize_case`
- Input: `patronId`, `tableId`, `analysisRunId`, optional operator note.
- Output: case shell persisted in `patron_risk_cases`, node status set to running.

2. `evaluate_loss_chasing`
- Uses table session intensity, ADT, behavior tags, and recent activity anomalies.
- Returns `LossChasingAssessment` (`score`, `label`, `confidence`, `drivers`, `explanation`).

3. `evaluate_financial_credit_aml`
- Uses patron profile and activities arrays.
- Produces `FinancialAssessment`:
  - `amlRiskScore`, `creditBand`, `sourceOfFundsRisk`, checklist items, analyst notes.

4. `risk_escalation_router`
- Inputs both assessment outputs.
- Writes `riskLevel` and `escalationTier`:
  - `Critical` or high AML => `Senior`
  - otherwise => `Standard`

5. `await_admin_review` (human gate)
- Graph waits for admin decision event.
- Allowed decisions:
  - `Approve` => continue
  - `Reject` => finalize as rejected
  - `RequestMoreInfo` => route back to targeted re-evaluation node with bounded retries.

6. `assign_pr_agent`
- Candidate pool: active PR agents with available capacity.
- Fit score combines:
  - free capacity ratio,
  - tier/game/language preference overlap,
  - recency fairness (`lastAssignedAt`).
- Writes top candidate and assignment metadata.

7. `emit_assignment_notice`
- Persists assignment event for in-app PR queue consumption.

8. `finalize_case`
- Terminal status:
  - `Assigned` (approved and assigned),
  - `Rejected`,
  - `InReview` (if unresolved).

### Failure Handling

- Agent node failure sets node status to `Failed`, appends timeline event, and keeps case actionable by admin.
- `RequestMoreInfo` loops only up to configured retry limit to prevent infinite cycles.

## API Contract Design

### `POST /api/patrons/[patronId]/risk-case`
- Creates a new risk case and starts the first two agent nodes.
- Request body:
```json
{
  "tableId": "T-001",
  "analysisRunId": "ANL-20260511-0001",
  "operatorNote": "Optional context"
}
```
- Response:
```json
{
  "ok": true,
  "case": {
    "caseId": "CASE-...",
    "patronId": "P-000001",
    "status": "AwaitingAdmin",
    "riskLevel": "High",
    "escalationTier": "Senior"
  },
  "nodeStates": []
}
```

### `GET /api/patrons/[patronId]/risk-case/latest`
- Returns latest case snapshot for modal rendering.

### `POST /api/risk-cases/[caseId]/admin-decision`
- Request body:
```json
{
  "decision": "Approve",
  "rationale": "Signals reviewed and acceptable",
  "requestedActions": []
}
```
- Response includes updated case and next node statuses.

### `GET /api/risk-cases/queue`
- Returns admin work queue grouped by `escalationTier`.

### `GET /api/pr-assignments/queue`
- Returns PR follow-up tasks for assigned cases.

## Frontend UX Design

### 1) Table Drill-Down Enhancements
- Existing trigger `Start Loss Potential Agent` remains table-level analysis entry.
- Each patron row/card gains `Start Risk Review` button.
- Button action:
  - creates new case (or re-opens latest active case),
  - opens process modal immediately.

### 2) Risk Process Modal
- Primary sections:
  - Header: patron ID, tier, case status badge, escalation chip.
  - Stepper: `Loss` -> `AML/Credit` -> `Admin` -> `PR Assignment`.
  - Agent cards:
    - Loss score bar + confidence + drivers.
    - AML checklist with pass/fail badges and analyst notes.
  - Timeline panel with immutable event feed.

### 3) Admin Approval Dialog
- Triggered when case is `AwaitingAdmin`.
- Inputs:
  - decision segmented control (`Approve`, `Reject`, `RequestMoreInfo`),
  - required rationale text area.
- Visual cues:
  - risk-level color coding,
  - prominent escalation banner for senior review cases.

### 4) PR Match Panel
- Shows ranked PR candidates with:
  - fit score,
  - available slots (`maxActivePatrons - currentActivePatrons`),
  - matching preference tags.
- On approval completion, shows final selected PR and assignment timestamp.

### 5) Modern Visual Language
- Keep existing dark console style, add:
  - glass-like cards for process nodes,
  - subtle neon gradient accents for active nodes,
  - shimmer animation while node status is `Running`,
  - clear iconography for pass/fail/completed states.
- Accessibility:
  - maintain keyboard focus ring on all dialog actions,
  - keep sufficient color contrast for risk badges and text.

## Acceptance Criteria (Design Level)

- Data model supports end-to-end case lifecycle and audit trail.
- Graph supports both straight-through and human-gated paths.
- API contracts support case creation, review, and queue retrieval.
- UI spec covers per-patron action, process visualization, admin gate, and PR handoff.
