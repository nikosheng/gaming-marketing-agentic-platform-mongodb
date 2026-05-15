# Min-Bet Optimizer — Decision Logic Reference

This document explains how the LangGraph optimizer agent in
`src/web/minbet-optimizer-agent.ts` decides whether to **raise**, **hold**,
or **lower** a table's minimum bet.

The agent makes the decision in **5 sequential steps**, each implemented as
a LangGraph node.

---

## Step 1 — Trend Signal (`compute_trend`)

Reads the last 20 snapshots from `table_state_history` and runs a
**least-squares slope** on `patronCount`.

```
slope     = linearSlope(patronCounts[])
velocity  = clamp(slope / 1.5, -1, +1)

label     = velocity > +0.15  → "Rising"
            velocity < -0.15  → "Falling"
            otherwise         → "Stable"
```

Why divide by 1.5? Typical Baccarat seats ≈ 9; ±1.5 patrons per minute is a
strong shift → normalizes to ±1.

---

## Step 2 — Bet Distribution (`compute_distribution`)

From active sessions on the table:

```
p50, p75, p90  = percentiles of sessionBetAmount
betHeadroom    = avgBet / currentMinBet                       // room above floor
lowBetShare    = count(sessionBet ≤ minBet × 1.2) / total     // price sensitivity
tierMix        = { Diamond: 2, Gold: 3, ... }
```

- **`betHeadroom`** is the single most important signal. If avg bet is 5× the
  min, the floor is leaving money on the table.
- **`lowBetShare`** estimates how many patrons would walk if you raised the floor.

---

## Step 3 — Demand Signal & Candidate Scoring (`score_elasticity`)

Combines the two into one composite:

```
occupancyScore = occupancyRate                         // 0..1
velocityPos    = (velocity + 1) / 2                    // 0..1, rising = high
stickiness     = 1 - lowBetShare                       // 0..1, less price-sensitive = high

demandSignal   = 0.5 × occupancyScore
               + 0.3 × velocityPos
               + 0.2 × stickiness                      // 0..1
```

Then it scores **5 candidate min-bets** `{−25%, −10%, 0, +10%, +25%}`:

```
For each candidate delta:
  if delta > 0:    retention = 1 - clamp(delta × (lowBetShare + 0.2) × 2, 0, 0.7)
  if delta < 0:    retention = 1 + clamp(|delta| × 0.4 × (1 - occupancy), 0, 0.25)

  estimatedAvgBet  = max(newMinBet × 1.15, p50, currentAvgBet × adjustment)
  estimatedRevenue = patronCount × retention × estimatedAvgBet

  expectedRevenuePct = (estimatedRevenue - baseline) / baseline
```

### Direction filter (this decides RAISE vs LOWER)

```
demandSignal ≥ 0.65   →  only consider candidates with delta ≥ 0   (HOLD or RAISE)
demandSignal ≤ 0.35   →  only consider candidates with delta ≤ 0   (HOLD or LOWER)
0.35 < signal < 0.65  →  all candidates considered
```

Then pick the candidate with **highest `expectedRevenuePct`**.

---

## Step 4 — Guardrails (`apply_guardrails`)

```
maxDelta       = 25% (10% for High Roller zones)
gameFloor      = { Baccarat: 100, Blackjack: 50, Roulette: 25, ... }
allowedSteps   = { Baccarat: [100, 200, 300, 500, 1000, 2000, ...], ... }

newMinBet = snapToStep(candidate, allowedSteps)
newMinBet = max(newMinBet, gameFloor)
if |realizedDelta| > maxDelta:  pick nearest in-range step
```

---

## Step 5 — Cooldown (`check_cooldown`)

If `table_minbet_audit` shows any change within the last **20 minutes**, force
`delta = 0` and mark `skipped`.

---

## Worked Sample: Baccarat Table "BAC-12"

**Inputs collected by the agent:**

| Field | Value |
|---|---|
| `currentMinBet` | 200 |
| `patronCount` / capacity | 8 / 9 |
| `occupancyRate` | 0.89 |
| Last 20 snapshots `patronCount` | `[3, 4, 4, 5, 6, 6, 7, 7, 8, 8]` |
| Active session bets | `[300, 400, 800, 800, 1200, 1500, 2000, 3500]` |
| `avgBetAmount` | 1313 |
| zone | "Main Floor" |
| gameType | "Baccarat" |

### Step 1 — Trend

- `slope ≈ 0.58` → `velocity = 0.58 / 1.5 ≈ 0.39`
- `0.39 > 0.15` → **`Rising`**

### Step 2 — Distribution

- `p50 = 1000`, `p75 = 1750`, `p90 = 3200`
- `betHeadroom = 1313 / 200 = 6.57x`  ← huge headroom
- `1.2 × 200 = 240` → 1 of 8 sessions ≤ 240 → `lowBetShare = 0.125`
- `tierMix = { Diamond: 1, Platinum: 2, Gold: 3, Silver: 2 }`

### Step 3 — Demand Signal & Candidates

```
occupancyScore = 0.89
velocityPos    = (0.39 + 1) / 2 = 0.695
stickiness     = 1 - 0.125 = 0.875

demandSignal   = 0.5×0.89 + 0.3×0.695 + 0.2×0.875
               = 0.445 + 0.209 + 0.175
               = 0.829                                  ← strong demand
```

Since `0.829 ≥ 0.65`, **only `delta ≥ 0` candidates survive**:
`{0, +10%, +25%}`.

Candidate scoring (baseline revenue = 8 × 1313 = 10,504):

| Δ    | newMinBet | retention | estimatedAvgBet | estimatedRevenue | revenue Δ |
|------|-----------|-----------|-----------------|------------------|-----------|
| 0%   | 200       | 1.000     | 1313            | 10,504           | 0.0%      |
| +10% | 220       | 0.935 (1 − 0.1×0.325×2) | max(253, 1000, 1378) = **1378** | 8×0.935×1378 = **10,308** | **−1.9%** |
| +25% | 250       | 0.838 (1 − 0.25×0.325×2) | max(287, 1000, 1477) = **1477** | 8×0.838×1477 = **9,901** | −5.7% |

In this example the math says **HOLD** because the small low-bet share still
costs more retention than the higher floor gains.

### Variant: assume `lowBetShare = 0.05`

| Δ    | retention | estimatedAvgBet | revenue | Δ %   |
|------|-----------|-----------------|---------|-------|
| 0%   | 1.000     | 1313            | 10,504  | 0.0%  |
| +10% | 1 − (0.1 × 0.25 × 2) = **0.95** | max(253, 1200, 1378) = **1378** | 8×0.95×1378 = **10,473** | −0.3% |
| +25% | 1 − (0.25 × 0.25 × 2) = **0.875** | max(287, 1200, 1477) = **1477** | 8×0.875×1477 = **10,339** | −1.6% |

The model is intentionally **conservative**: it only raises when *all three*
hold — high demand AND very high bet headroom AND small low-bet share.

### Stronger case: VIP-style — high stakes, high headroom

| Field | Value |
|---|---|
| `currentMinBet` | 500 |
| `patronCount` | 7/9 |
| `occupancyRate` | 0.78 |
| Trend (slope) | `+0.5`, label = `Rising` |
| Session bets | `[800, 1500, 3000, 4000, 5000, 8000, 12000]` |
| `avgBet` | 4900 |
| `betHeadroom` | 9.8x |
| `lowBetShare` | 0.14 (1/7 ≤ 600) |

`demandSignal = 0.5×0.78 + 0.3×0.83 + 0.2×0.86 = 0.811`

Candidates (baseline 7×4900 = 34,300):

| Δ    | newMinBet | retention | est. avgBet | revenue | Δ %   |
|------|-----------|-----------|-------------|---------|-------|
| 0%   | 500       | 1.000     | 4900        | 34,300  | 0.0%  |
| +10% | 550       | 1−(0.1×0.34×2)=**0.932**  | max(632, 4000, 5145) = **5145** | 7×0.932×5145 = **33,560** | −2.2% |
| +25% | 625       | 1−(0.25×0.34×2)=**0.83**  | max(719, 4000, 5512) = **5512** | 7×0.83×5512 = **32,025** | −6.6% |

Even in VIP, the elasticity model **defends current** because raising churns
out 1+ patrons whose contribution exceeds the avg-bet lift.

---

## Summary of Decision Behavior

The model is a **conservative, retention-weighted** policy. It will
recommend a **raise** only when:

1. `lowBetShare` is very small (≤ ~0.05), **AND**
2. `betHeadroom` is high (≥ ~5x), **AND**
3. `occupancyRate` is high enough that losing 1 patron still leaves the
   table profitable per seat-minute.

It will recommend a **lower** when:

1. `demandSignal ≤ 0.35` (low occupancy, falling trend, many low-bet
   patrons), **AND**
2. The extra patron attraction × kept avg-bet > current revenue.

In practice the math frequently picks **HOLD**, which is desirable for an
MVP — better to under-act than to drive away patrons mid-shoe.

---

## Tuning Knobs for More Aggressive Behavior

If on demo data it always recommends HOLD, tune these constants in
`src/web/minbet-optimizer-agent.ts`:

```ts
// In elasticityNode — make retention loss less punishing:
retention = 1 - clamp(delta * (lowBetShare + 0.2) * 2, 0, 0.7);
//                                                 ^ change 2 → 1.2
//                                  ^ change 0.2 → 0.05

// In elasticityNode — make estimatedAvgBet lift faster:
baselineAvgBet * (1 + 0.5 * delta)
//                    ^ change 0.5 → 1.0

// In demand-filter thresholds:
if (demandSignal >= 0.65) return c.deltaPct >= 0;
//                  ^ change 0.65 → 0.55 (raise more often)
```

---

## Quick Reference — Inputs the Agent Reads

| Input | Source collection | Field |
|---|---|---|
| Current table snapshot | `table_state_snapshots` | `minBet`, `maxBet`, `patronCount`, `avgBetAmount`, `occupancyRate`, `zone`, `gameType` |
| Live sessions | `patron_table_sessions` (joined to `patron_profiles`) | `sessionBetAmount`, `tier`, `behaviorTags` |
| Trend history | `table_state_history` | Last 20 snapshots ordered by `refreshedAt` |
| Cooldown check | `table_minbet_audit` | Most recent `at` per table |

## Quick Reference — Outputs Persisted

| Output | Collection | Notes |
|---|---|---|
| Recommendation | `table_minbet_recommendations` | `status: "Proposed"`, TTL 30 min |
| Applied change | `table_state_snapshots.minBet` | Updated on approve |
| Audit log | `table_minbet_audit` | Immutable, drives cooldown |
