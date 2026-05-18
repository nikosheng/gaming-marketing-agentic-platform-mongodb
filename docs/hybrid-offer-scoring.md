# Hybrid Offer Scoring — Design & Rationale

This document explains why the Quick Offer Lookup combines MongoDB Atlas
`$vectorSearch` with a rule-based re-rank, and how the final displayed score
is computed.

Implementation lives in `app/api/offers/generate/route.ts`.

---

## 1. The Problem with Raw Atlas Scores

MongoDB Atlas `$vectorSearch` configured with `similarity: "cosine"` returns
a score in `[0, 1]` using the formula:

```
score = (1 + cos(theta)) / 2
```

Where `theta` is the angle between the query vector (a patron's
`preferenceEmbedding`) and a candidate vector (an offer's `offerEmbedding`).

| Vector relationship | `cos(theta)` | Atlas score |
|---|---|---|
| Identical             | `+1.0` | **1.00** |
| Strong semantic match | `+0.55` | **0.775** |
| Weak match            | `+0.10` | **0.55** |
| Orthogonal / unrelated| `0.0`  | **0.50** |
| Opposite              | `-1.0` | **0.00** |

In practice, with real text embeddings (Voyage, OpenAI, etc.), most
patron-offer pairs land between `cos(theta) = 0` and `cos(theta) = 0.6`.
After Atlas normalization that compresses to a **0.50 – 0.80 window**.

That means a "great match" and a "poor match" can appear as `0.78` vs `0.65`
in the UI — a spread of only ~13 percentage points. Operators looking at the
dashboard cannot easily distinguish a confident recommendation from a
desperate one.

We call this the **score compression problem**.

---

## 2. Why Vector Search Alone Is Not Enough

Even with high-quality embeddings, two issues remain:

1. **Compressed dynamic range** (above).
2. **Embedding-only scoring is opaque.** When the model says
   "this hotel offer matches this patron 0.74", operators cannot see why.
   Was it the tier? The preferred game? The historical hotel bookings?
   The embedding fuses all those signals into a single number with no
   breakdown.

For a business workflow where a marketing operator needs to **justify**
sending an offer to a Diamond patron, opacity is a real problem. We need
the score to be both **well-spread** and **explainable**.

---

## 3. The Hybrid Approach

The hybrid pipeline addresses both issues by combining two complementary
signals:

```
final_score = 0.6 * vector_part + 0.4 * rule_part
```

- **`vector_part`** — the embedding similarity, stretched to a wider range.
  Provides *recall*: it surfaces semantically relevant candidates from a
  large catalog, including offers that the rule set doesn't explicitly
  recognize.
- **`rule_part`** — explicit business signals (tier, game overlap, points
  balance, ADT). Provides *precision* and *explainability*: it pushes
  business-fit candidates to the top and gives operators something
  concrete to point at.

This is the standard architecture used by virtually every production
recommendation system (e.g., YouTube, Spotify, Pinterest): a learned
embedding model handles wide-net recall, a hand-crafted rule layer
handles final ranking and explanation.

---

## 4. The Pipeline

```
patron preferenceEmbedding
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│ 1. Atlas $vectorSearch                                  │
│      index: offer_vector_idx                            │
│      similarity: cosine                                 │
│      numCandidates: 100                                 │
│      limit: 10                                          │
│      (fallback: client-side cosine on 100 offers)       │
└─────────────────────────────────────────────────────────┘
        │
        ▼  10 candidates with atlasScore in [0, 1]
┌─────────────────────────────────────────────────────────┐
│ 2. Stretch vector score                                 │
│      vector_part = clamp01(2 * (atlasScore - 0.5))      │
│      orthogonal  -> 0                                   │
│      identical   -> 1                                   │
└─────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│ 3. Compute rule score                                   │
│      rule_part = 0.4 * game_overlap                     │
│                + 0.3 * tier_fit                         │
│                + 0.2 * points_fit                       │
│                + 0.1 * adt_fit                          │
└─────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│ 4. Blend                                                │
│      final = 0.6 * vector_part + 0.4 * rule_part        │
└─────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│ 5. Re-rank by `final`, take top 3                       │
└─────────────────────────────────────────────────────────┘
        │
        ▼
   UI shows blended score + breakdown tooltip + signals
```

### 4.1 Stretch step explained

The `vector_part` formula `2 * (atlasScore - 0.5)` is intentionally simple:

| Atlas score | `vector_part` |
|---|---|
| 1.00 | **1.00** |
| 0.85 | **0.70** |
| 0.75 | **0.50** |
| 0.60 | **0.20** |
| 0.50 | **0.00** |
| 0.40 | **0.00** (clamped) |

Treating "orthogonal" as zero gives the UI a meaningful floor. Negative
correlations (rare for text-based embeddings) clamp to zero rather than
producing negative percentages, which would confuse operators.

### 4.2 Rule signals explained

The four rule signals are weighted by business importance:

| Signal | Weight | Source |
|---|---|---|
| `game_overlap` | 0.4 | `offer.targetGameTypes` ∩ `patron.preferredGames` |
| `tier_fit`     | 0.3 | Premium tier (Diamond/Platinum/Gold) gets boosted for HotelRoom + MusicShowTicket. FNB/Points offers reward any tier with a 0.7 floor, premium with 1.0. |
| `points_fit`   | 0.2 | Only meaningful for `PointsLimitedTime` offers: ≥10k = 1.0, ≥3k = 0.5, else 0.2. Other offer types get 0.5 neutral. |
| `adt_fit`      | 0.1 | Only meaningful for HotelRoom/MusicShowTicket: ≥HK$8k ADT = 1.0, ≥3k = 0.5, else 0.2. Other types get 0.5 neutral. |

Each signal is bounded `[0, 1]`. The weighted sum is clamped to `[0, 1]`.

### 4.3 Why 0.6 / 0.4 blend?

- **Embedding-heavy (0.8 / 0.2)** is dangerous when embedding quality is
  poor. If you have not yet run `npm run backfill` with a Voyage API key,
  embeddings are random fallback vectors and the score becomes noise.
- **Rule-heavy (0.4 / 0.6)** would override valid embedding signals; an
  offer the model strongly recommends could be down-ranked just because
  the rule signals were lukewarm.
- **0.6 / 0.4** keeps the embedding as the primary driver but gives rules
  enough influence to (a) widen the score distribution and (b) explain
  why a specific offer surfaced. This is consistent with industry
  practice for hybrid recall + re-rank systems.

---

## 5. Thresholds and Labels

The blended `final` score maps to a strength label and a UI tone color:

| `final` score | Label    | Bar tone | Meaning |
|---|---|---|---|
| `>= 0.70` | **Strong**   | green  | High-confidence offer worth campaigning on |
| `>= 0.45` | **Moderate** | amber  | Reasonable candidate, often improved by a small nudge (different time, channel, or bundling) |
| `< 0.45`  | **Weak**     | red    | Best available but unlikely to convert — consider catalog expansion |

These cutoffs were chosen to keep ~10-20% of candidates as Strong and ~30%
as Moderate in a well-calibrated catalog, leaving the long tail in Weak.
Tune in `app/api/offers/generate/route.ts` if your distribution shifts.

---

## 6. Score Distribution Comparison

The hybrid pipeline produces a visibly wider distribution than raw Atlas.
Conceptual example for a patron whose true best match is "Premium Hotel
Suite" (HotelRoom, Diamond tier, Baccarat overlap):

| Offer | Atlas raw | Vector part | Rule part | Final | Label |
|---|---|---|---|---|---|
| Premium Hotel Suite     | 0.84 | 0.68 | 1.00 | **0.81** | Strong |
| Music Show VIP Ticket   | 0.79 | 0.58 | 0.90 | **0.71** | Strong |
| 2x Points Redemption    | 0.66 | 0.32 | 0.55 | **0.41** | Weak |
| Lounge Beverage Voucher | 0.61 | 0.22 | 0.35 | **0.27** | Weak |

Same patron with **only** raw Atlas scores: `0.84, 0.79, 0.66, 0.61`
— a 23-point spread that hides the real ranking.
With hybrid scoring: `0.81, 0.71, 0.41, 0.27` — a 54-point spread that
clearly separates the two viable offers from the two unsuitable ones.

---

## 7. Explainability via UI Breakdown

The Quick Offer Lookup card shows the blended score as the primary number,
plus an `i` indicator that reveals (on hover) the breakdown:

```
Atlas raw:          84%
Vector contribution: 68%
Rule contribution:  100%
Blended (0.6 vec + 0.4 rule): 81%
```

Plus `matchSignals` chips like `game-fit:Baccarat`, `tier-diamond`,
`high-adt`. An operator can now see exactly why a given offer ranked high
and adjust the campaign accordingly.

---

## 8. Failure Modes & Fallbacks

The route tries Atlas `$vectorSearch` first. If the index is missing
(typical in local development), the index is still building, or the Atlas
tier doesn't include vector search, the route falls back to client-side
cosine similarity. The fallback converts raw cosine `cos in [-1, +1]` to
Atlas-equivalent via `(1 + cos) / 2` **before** the stretch step, so the
downstream math is identical regardless of source.

The response includes a `generator` field for debugging:

- `"vector-search-rerank"` — Atlas vector search succeeded.
- `"cosine-fallback-rerank"` — fell back to client-side cosine.

---

## 9. Pre-conditions for Strong Matches

The hybrid scoring helps with **score visibility**, not embedding quality.
For Strong matches to appear:

1. `patron.preferenceEmbedding` must be a real semantic vector (Voyage 4,
   1024-dim).
2. `offer.offerEmbedding` must be a real semantic vector from the same
   model.

If you seeded the database without `VOYAGE_API_KEY`, both vectors are
random fallback values and `vector_part` will hover near zero. The rule
component will still produce a wider spread (you'll see Strong/Moderate
labels driven entirely by tier and game overlap), but the embedding
contribution will be missing.

To enable full semantic scoring:

```bash
# in .env
VOYAGE_API_KEY=pa-...your-key...

# then
npm run backfill
```

This rewrites all `offerEmbedding` and `preferenceEmbedding` fields using
Voyage 4 over the existing data.

---

## 10. API Surface

`POST /api/offers/generate`

Request:
```json
{ "patronId": "P-000050" }
```

Response:
```json
{
  "ok": true,
  "patron": {
    "patronId": "P-000050",
    "tier": "Diamond",
    "adt": 12500,
    "preferredGames": ["Baccarat"],
    "pointsBalance": 18000
  },
  "generatedOffers": [
    {
      "offerId": "OFFER-0001",
      "title": "Premium Hotel Suite - 1 Night",
      "offerType": "HotelRoom",
      "estimatedCost": 4800,
      "score": 0.81,
      "strength": "Strong",
      "reason": "Strong match — vector similarity 68% reinforced by game-fit:Baccarat + tier-diamond.",
      "matchSignals": ["game-fit:Baccarat", "tier-diamond", "high-adt"],
      "breakdown": {
        "atlasScore": 0.84,
        "vectorPart": 0.68,
        "rulePart": 1.0
      }
    }
  ],
  "generator": "vector-search-rerank"
}
```

---

## 11. Future Extensions

- **Re-rank with a learned ML model** (replace the heuristic rule weights
  with a small LightGBM or logistic regression trained on historical
  offer acceptance data).
- **Apply the same pipeline to Table Drill-Down** suggested-offers so the
  drilldown agent uses the same scoring as the operator console.
- **Per-segment thresholds** — different `Strong/Moderate` cutoffs for
  VIP vs mass-market campaigns.
- **Diversity penalty** — down-rank multiple offers of the same `offerType`
  in the top-K to encourage variety.

---

## 12. Related Files

- `app/api/offers/generate/route.ts` — implementation.
- `src/web/minbet-optimizer-agent.ts` — different agent, uses similar
  blended scoring pattern for min-bet decisions.
- `src/web/table-drilldown-agent.ts` — pure Atlas vector search; could be
  upgraded to this hybrid in a follow-up.
- `src/modeling/indexes.ts` — defines `offer_vector_idx` and
  `patron_preference_vector_idx`.
