/**
 * Find patrons whose top offer match is "Strong" (cosine similarity >= 0.75).
 *
 * Usage:
 *   npx tsx src/scripts/find-strong-match-patrons.ts          # default: top 3
 *   npx tsx src/scripts/find-strong-match-patrons.ts 5        # top 5
 */
import dotenv from "dotenv";
import { MongoClient } from "mongodb";

dotenv.config();

function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  if (length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function main() {
  const wanted = Number(process.argv[2] ?? 3);
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB ?? "casino_marketing_demo";
  if (!uri) {
    console.error("MONGODB_URI is not set");
    process.exit(1);
  }

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(dbName);

    const offers = await db
      .collection("offer_catalog")
      .find(
        {},
        {
          projection: {
            _id: 0,
            offerId: 1,
            title: 1,
            offerType: 1,
            targetGameTypes: 1,
            offerEmbedding: 1,
          },
        }
      )
      .toArray();

    if (offers.length === 0) {
      console.error("No offers found");
      return;
    }

    console.log(`Loaded ${offers.length} offers. Scanning patrons...`);

    const patronCursor = db.collection("patron_profiles").find(
      {},
      {
        projection: {
          _id: 0,
          patronId: 1,
          tier: 1,
          adt: 1,
          preferredGames: 1,
          pointsBalance: 1,
          preferenceEmbedding: 1,
        },
      }
    );

    type Strong = {
      patronId: string;
      tier: string;
      adt: number;
      preferredGames: string[];
      pointsBalance: number;
      topMatches: Array<{
        offerId: string;
        title: string;
        offerType: string;
        score: number;
      }>;
    };

    const allRanked: Strong[] = [];
    let scanned = 0;
    let zeroEmbedding = 0;

    while (await patronCursor.hasNext()) {
      const patron = await patronCursor.next();
      if (!patron) break;
      scanned += 1;

      const embedding = (patron.preferenceEmbedding ?? []) as number[];
      const norm = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0));
      if (norm < 1e-6) {
        zeroEmbedding += 1;
        continue;
      }

      const scored = offers
        .map((offer) => ({
          offerId: String(offer.offerId),
          title: String(offer.title),
          offerType: String(offer.offerType),
          score: cosineSimilarity(embedding, (offer.offerEmbedding as number[]) ?? []),
        }))
        .sort((a, b) => b.score - a.score);

      allRanked.push({
        patronId: String(patron.patronId),
        tier: String(patron.tier),
        adt: Number(patron.adt ?? 0),
        preferredGames: (patron.preferredGames ?? []) as string[],
        pointsBalance: Number(patron.pointsBalance ?? 0),
        topMatches: scored.slice(0, 3).map((s) => ({
          offerId: s.offerId,
          title: s.title,
          offerType: s.offerType,
          score: Number(s.score.toFixed(4)),
        })),
      });
    }

    allRanked.sort((a, b) => (b.topMatches[0]?.score ?? 0) - (a.topMatches[0]?.score ?? 0));
    const strongPatrons = allRanked.filter((p) => (p.topMatches[0]?.score ?? 0) >= 0.75);

    // Score distribution
    const dist = { strong: 0, moderate: 0, weak: 0 };
    allRanked.forEach((p) => {
      const top = p.topMatches[0]?.score ?? 0;
      if (top >= 0.75) dist.strong += 1;
      else if (top >= 0.5) dist.moderate += 1;
      else dist.weak += 1;
    });
    console.log(
      `\nDistribution of top-match scores: Strong=${dist.strong}  Moderate=${dist.moderate}  Weak=${dist.weak}`
    );

    console.log("=".repeat(72));
    console.log(`Scanned ${scanned} patrons.`);
    if (zeroEmbedding > 0) {
      console.log(
        `⚠ Skipped ${zeroEmbedding} patrons with zero-norm embeddings (no Voyage backfill).`
      );
    }
    console.log(`Found ${strongPatrons.length} patrons with a Strong top match (≥0.75).`);
    console.log("=".repeat(72));

    if (strongPatrons.length === 0) {
      console.log("\nNo Strong-match patrons (≥0.75). Showing closest available instead:");
    }

    const list = strongPatrons.length > 0 ? strongPatrons : allRanked;
    console.log(`\nTop ${Math.min(wanted, list.length)} patrons:\n`);
    list.slice(0, wanted).forEach((p, i) => {
      console.log(`#${i + 1}  ${p.patronId}`);
      console.log(`     tier=${p.tier}  adt=${p.adt}  points=${p.pointsBalance}`);
      console.log(`     preferredGames=${JSON.stringify(p.preferredGames)}`);
      p.topMatches.forEach((m, j) => {
        const label = m.score >= 0.75 ? "Strong" : m.score >= 0.5 ? "Moderate" : "Weak";
        console.log(
          `       ${j + 1}. ${m.offerId.padEnd(10)} ${label.padEnd(8)} ` +
            `${(m.score * 100).toFixed(1)}%  ${m.offerType.padEnd(20)} ${m.title}`
        );
      });
      console.log("");
    });
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
