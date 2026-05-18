/**
 * Inspect why a specific patron gets "Light/Moderate/Strong" match labels.
 *
 * Usage:
 *   npx tsx src/scripts/inspect-patron-offers.ts P-000050
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

function strengthLabel(score: number): string {
  if (score >= 0.75) return "Strong";
  if (score >= 0.5) return "Moderate";
  return "Light";
}

async function main() {
  const patronId = process.argv[2] ?? "P-000050";
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
    const patron = await db
      .collection("patron_profiles")
      .findOne(
        { patronId },
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

    if (!patron) {
      console.error(`Patron ${patronId} not found`);
      return;
    }

    const embedding = (patron.preferenceEmbedding ?? []) as number[];
    const nonZero = embedding.filter((x) => x !== 0).length;
    const norm = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0));

    console.log("=".repeat(70));
    console.log(`Patron: ${patron.patronId}`);
    console.log(`  tier:           ${patron.tier}`);
    console.log(`  adt:            ${patron.adt}`);
    console.log(`  preferredGames: ${JSON.stringify(patron.preferredGames)}`);
    console.log(`  pointsBalance:  ${patron.pointsBalance}`);
    console.log(
      `  embedding:      dim=${embedding.length}, nonZero=${nonZero}, norm=${norm.toFixed(4)}`
    );
    if (norm < 1e-6) {
      console.log(
        "  ⚠ Embedding is effectively zero — scores will all be ~0 ⇒ all 'Light'."
      );
      console.log("    Run `npm run backfill` to generate real Voyage embeddings.");
    }

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
            estimatedCost: 1,
            offerEmbedding: 1,
          },
        }
      )
      .toArray();

    const scored = offers
      .map((offer) => {
        const oEmb = (offer.offerEmbedding ?? []) as number[];
        const score = cosineSimilarity(embedding, oEmb);
        const oNonZero = oEmb.filter((x) => x !== 0).length;
        return {
          offerId: offer.offerId,
          title: offer.title,
          offerType: offer.offerType,
          targetGameTypes: offer.targetGameTypes,
          score,
          oNonZero,
        };
      })
      .sort((a, b) => b.score - a.score);

    console.log("\nTop 5 offers (by cosine similarity):");
    console.log("-".repeat(70));
    scored.slice(0, 5).forEach((row, i) => {
      console.log(
        `${i + 1}. ${row.offerId.padEnd(10)} ${strengthLabel(row.score).padEnd(8)} ` +
          `score=${row.score.toFixed(4)}  ${row.offerType.padEnd(20)} ${row.title}`
      );
      console.log(
        `   targetGames=${JSON.stringify(row.targetGameTypes)}  offerEmbedNonZero=${row.oNonZero}`
      );
    });

    const dist = {
      strong: scored.filter((s) => s.score >= 0.75).length,
      moderate: scored.filter((s) => s.score >= 0.5 && s.score < 0.75).length,
      light: scored.filter((s) => s.score < 0.5).length,
    };

    console.log("\nOverall match distribution across the catalog:");
    console.log(`  Strong   (≥0.75): ${dist.strong}`);
    console.log(`  Moderate (≥0.50): ${dist.moderate}`);
    console.log(`  Light    (<0.50): ${dist.light}`);
    console.log(`  Total offers:     ${scored.length}`);
    console.log("=".repeat(70));
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
