/**
 * seed-interactions.ts
 *
 * Generates realistic simulated interaction records for PR agents.
 * This script is ADDITIVE — it does NOT clear any existing collections.
 *
 * Usage:
 *   npm run seed:interactions          # seed ~300 records
 *   npm run seed:interactions --dry-run # preview counts only
 *
 * After seeding, run:
 *   npm run backfill:interactions      # fill interactionEmbedding via Voyage AI
 */

import dotenv from "dotenv";
dotenv.config();

import { getDb, closeClient } from "../db.js";
import { collections } from "../modeling/indexes.js";
import { buildInteractionEmbeddingText } from "../web/embedding.js";
import type {
  PatronInteractionRecord,
  InteractionType,
  PatronTier,
} from "../types.js";

// ---------- Config ----------

const isDryRun = process.argv.includes("--dry-run");

// Min/max interactions per PR agent
const MIN_PER_PR = 8;
const MAX_PER_PR = 20;

// How far back (days) to scatter interaction dates
const HISTORY_DAYS = 180;

// Cosine similarity threshold we want to pass for KPI searches — we engineer
// the detail fields so that the embedding text is semantically rich and
// distinct per group, giving realistic vector search results after backfill.

// ---------- Types ----------

type PatronStub = { patronId: string; tier: PatronTier; adt: number };
type PRStub    = { prAgentId: string; name: string; active: boolean; preferredTiers: PatronTier[] };

// ---------- Interaction type distribution per PR group ----------
// Groups are based on position in the sorted prAgentId list.
// This creates realistic variation so the KPI vector search shows
// clear differences between agents.

type TypeWeight = { type: InteractionType; weight: number };

function getTypeWeights(groupIndex: number, totalGroups: number): TypeWeight[] {
  const quarter = Math.floor((groupIndex / totalGroups) * 4);
  switch (quarter) {
    case 0:
      // Group A — Room & Transfer specialists (high-roller hosting)
      return [
        { type: "ROOM_COMP",    weight: 40 },
        { type: "TRANSFER",     weight: 30 },
        { type: "FB_COMP",      weight: 10 },
        { type: "OUTREACH",     weight: 10 },
        { type: "EVENT_INVITE", weight: 5  },
        { type: "REBATE",       weight: 5  },
      ];
    case 1:
      // Group B — Outreach & Event specialists (patron retention)
      return [
        { type: "OUTREACH",     weight: 40 },
        { type: "EVENT_INVITE", weight: 30 },
        { type: "FB_COMP",      weight: 10 },
        { type: "TRANSFER",     weight: 10 },
        { type: "ROOM_COMP",    weight: 5  },
        { type: "REBATE",       weight: 5  },
      ];
    case 2:
      // Group C — Rebate & F&B specialists (volume reward)
      return [
        { type: "REBATE",       weight: 35 },
        { type: "FB_COMP",      weight: 30 },
        { type: "OUTREACH",     weight: 15 },
        { type: "EVENT_INVITE", weight: 10 },
        { type: "ROOM_COMP",    weight: 5  },
        { type: "TRANSFER",     weight: 5  },
      ];
    default:
      // Group D — Generalist (balanced across all types)
      return [
        { type: "ROOM_COMP",    weight: 17 },
        { type: "FB_COMP",      weight: 17 },
        { type: "REBATE",       weight: 17 },
        { type: "EVENT_INVITE", weight: 17 },
        { type: "OUTREACH",     weight: 16 },
        { type: "TRANSFER",     weight: 16 },
      ];
  }
}

function pickWeightedType(weights: TypeWeight[]): InteractionType {
  const total = weights.reduce((s, w) => s + w.weight, 0);
  let r = Math.random() * total;
  for (const w of weights) {
    r -= w.weight;
    if (r <= 0) return w.type;
  }
  return weights[weights.length - 1].type;
}

// ---------- Value ranges by type ----------

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFrom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomDate(daysBack: number): Date {
  const ms = Math.random() * daysBack * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - ms);
}

function buildDetail(
  type: InteractionType,
  tier: PatronTier
): { detail: PatronInteractionRecord["detail"]; totalValueHKD: number } {
  switch (type) {
    case "ROOM_COMP": {
      const isPlatDiamond = tier === "Platinum" || tier === "Diamond";
      const roomTypes = isPlatDiamond
        ? ["Grand Suite", "Presidential Suite", "VIP Harbour Suite"]
        : ["Superior Room", "Deluxe Room", "Premier Room"];
      const roomType  = randomFrom(roomTypes);
      const roomNights = randomInt(1, isPlatDiamond ? 3 : 2);
      const nightRate  = isPlatDiamond ? randomInt(6000, 15000) : randomInt(2000, 6000);
      const roomValue  = roomNights * nightRate;
      return {
        detail: { roomType, roomNights, roomValue },
        totalValueHKD: roomValue,
      };
    }
    case "FB_COMP": {
      const venues = ["The Starlight Restaurant", "Dynasty Cantonese", "La Maison Brasserie", "Jade Garden", "Skyview Lounge"];
      const venue    = randomFrom(venues);
      const fbAmount = randomInt(800, 6000);
      return { detail: { venue, fbAmount }, totalValueHKD: fbAmount };
    }
    case "REBATE": {
      const rebateRate   = randomFrom([0.005, 0.008, 0.010, 0.012, 0.015, 0.018, 0.020]);
      const rebateAmount = randomInt(3000, 25000);
      return { detail: { rebateRate, rebateAmount }, totalValueHKD: rebateAmount };
    }
    case "EVENT_INVITE": {
      const events = [
        "8月 Diamond VIP 晚宴",
        "中秋貴賓品酒會",
        "新年 Platinum 專屬招待",
        "週年慶 VIP 音樂盛典",
        "高爾夫球友誼賽",
        "私人藝術品鑑會",
      ];
      const eventName = randomFrom(events);
      const attended  = Math.random() > 0.25;
      return { detail: { eventName, attended }, totalValueHKD: randomInt(500, 3000) };
    }
    case "OUTREACH": {
      const channels: Array<"Phone" | "In-Person" | "WeChat" | "WhatsApp"> = [
        "Phone", "WeChat", "WhatsApp", "In-Person",
      ];
      const outcomes: Array<"Positive" | "Neutral" | "No Answer" | "Declined"> = [
        "Positive", "Positive", "Positive", "Neutral", "No Answer", "Declined",
      ];
      const channel = randomFrom(channels);
      const outcome = randomFrom(outcomes);
      const noteOptions = [
        "確認下月回訪計劃",
        "賭客表示近期會帶朋友前來",
        "已安排下次桌位預留",
        "詢問最新優惠詳情",
        "賭客對本次服務表示滿意",
        "跟進上次 VIP 活動反饋",
      ];
      const notes = outcome !== "No Answer" ? randomFrom(noteOptions) : undefined;
      return { detail: { channel, outcome, notes }, totalValueHKD: 0 };
    }
    case "TRANSFER": {
      const transferTypes: Array<"Airport" | "Hotel" | "Venue"> = ["Airport", "Hotel", "Venue"];
      const vehicleClasses: Array<"Standard" | "Luxury"> =
        tier === "Platinum" || tier === "Diamond" ? ["Luxury"] : ["Standard", "Luxury"];
      const transferType  = randomFrom(transferTypes);
      const vehicleClass  = randomFrom(vehicleClasses);
      const value = vehicleClass === "Luxury" ? randomInt(800, 2500) : randomInt(300, 800);
      return { detail: { transferType, vehicleClass }, totalValueHKD: value };
    }
  }
}

// ---------- Build interaction record ----------

function buildRecord(
  prAgentId: string,
  patron: PatronStub,
  type: InteractionType,
  now: Date
): PatronInteractionRecord {
  const occurredAt = randomDate(HISTORY_DAYS);
  const { detail, totalValueHKD } = buildDetail(type, patron.tier);

  // Build the embedding text now (stored as a plain field so backfill can
  // regenerate without recomputing) — embedding vector itself is NOT stored here
  const interactionId = `INT-${now.getTime()}-${prAgentId}-${patron.patronId}-${Math.random().toString(36).slice(2, 7)}`
    .replace(/[^A-Z0-9-]/gi, "-")
    .toUpperCase();

  return {
    interactionId,
    patronId:         patron.patronId,
    type,
    detail,
    totalValueHKD,
    occurredAt,
    recordedBy:       prAgentId,
    recordedAt:       now,
    patronTierAtTime: patron.tier,
    patronAdtAtTime:  patron.adt,
    // interactionEmbedding is intentionally omitted — run backfill:interactions to fill
  };
}

// ---------- Patron pool helpers ----------

function buildTierPatronMap(patrons: PatronStub[]): Map<PatronTier, PatronStub[]> {
  const map = new Map<PatronTier, PatronStub[]>();
  for (const p of patrons) {
    if (!map.has(p.tier)) map.set(p.tier, []);
    map.get(p.tier)!.push(p);
  }
  return map;
}

/**
 * Pick a patron for a PR, biased toward tiers that PR prefers.
 * Falls back to any patron if preferred tier pool is empty.
 */
function pickPatron(
  preferredTiers: PatronTier[],
  tierMap: Map<PatronTier, PatronStub[]>,
  allPatrons: PatronStub[]
): PatronStub {
  // 70% chance to pick from preferred tier
  if (Math.random() < 0.7 && preferredTiers.length > 0) {
    const tier = randomFrom(preferredTiers);
    const pool = tierMap.get(tier);
    if (pool && pool.length > 0) return randomFrom(pool);
  }
  return randomFrom(allPatrons);
}

// ---------- Main ----------

async function seedInteractions() {
  const db  = await getDb();
  const now = new Date();

  // 1. Load existing PR agents
  const prDocs = await db
    .collection(collections.prAgents)
    .find({}, { projection: { prAgentId: 1, name: 1, active: 1, preferredTiers: 1 } })
    .sort({ prAgentId: 1 })
    .toArray() as unknown as PRStub[];

  if (prDocs.length === 0) {
    console.error("No PR agents found. Run `npm run seed` first.");
    process.exitCode = 1;
    return;
  }

  // 2. Load existing patrons (take up to 300 for performance)
  const patronDocs = await db
    .collection(collections.patrons)
    .find({}, { projection: { patronId: 1, tier: 1, adt: 1 } })
    .limit(300)
    .toArray() as unknown as PatronStub[];

  if (patronDocs.length === 0) {
    console.error("No patrons found. Run `npm run seed` first.");
    process.exitCode = 1;
    return;
  }

  const tierMap = buildTierPatronMap(patronDocs);

  // 3. Generate records for each PR
  const allRecords: PatronInteractionRecord[] = [];

  prDocs.forEach((pr, idx) => {
    const count      = randomInt(MIN_PER_PR, MAX_PER_PR);
    const typeWeights = getTypeWeights(idx, prDocs.length);

    for (let i = 0; i < count; i++) {
      const type   = pickWeightedType(typeWeights);
      const patron = pickPatron(pr.preferredTiers ?? [], tierMap, patronDocs);
      allRecords.push(buildRecord(pr.prAgentId, patron, type, now));
    }
  });

  // 4. Preview or insert
  if (isDryRun) {
    // Summarise by PR
    const byPr: Record<string, Record<string, number>> = {};
    for (const r of allRecords) {
      if (!byPr[r.recordedBy]) byPr[r.recordedBy] = {};
      byPr[r.recordedBy][r.type] = (byPr[r.recordedBy][r.type] ?? 0) + 1;
    }
    console.log(JSON.stringify({ dryRun: true, totalRecords: allRecords.length, byPr }, null, 2));
    return;
  }

  await db
    .collection(collections.patronInteractions)
    .insertMany(allRecords as never[]);

  // 5. Summary
  const typeBreakdown: Record<string, number> = {};
  for (const r of allRecords) {
    typeBreakdown[r.type] = (typeBreakdown[r.type] ?? 0) + 1;
  }
  console.log(`\n✓ Inserted ${allRecords.length} interaction records across ${prDocs.length} PR agents.`);
  console.log(`  Type breakdown:`, typeBreakdown);
  console.log(`  Date range: past ${HISTORY_DAYS} days`);
  console.log(`\nNext step: run \`npm run backfill:interactions\` to generate embeddings for KPI vector search.\n`);
}

seedInteractions()
  .catch((err) => {
    console.error("seed-interactions failed:", err);
    process.exitCode = 1;
  })
  .finally(closeClient);
