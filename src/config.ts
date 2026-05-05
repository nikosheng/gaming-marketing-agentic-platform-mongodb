import dotenv from "dotenv";

dotenv.config();

function numeric(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid numeric env var: ${name}`);
  }
  return parsed;
}

export const config = {
  mongodbUri: process.env.MONGODB_URI,
  databaseName: process.env.MONGODB_DB ?? "casino_marketing_demo",
  vectorEmbeddingDim: numeric("VECTOR_EMBEDDING_DIM", 1024),
  seedPatronCount: numeric("SEED_PATRON_COUNT", 300),
  seedTableCount: numeric("SEED_TABLE_COUNT", 30),
  voyageApiKey: process.env.VOYAGE_API_KEY,
};
