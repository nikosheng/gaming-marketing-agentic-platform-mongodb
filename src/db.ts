import { MongoClient } from "mongodb";
import { config } from "./config.js";

let client: MongoClient | null = null;

export async function getClient(): Promise<MongoClient> {
  if (client) return client;
  if (!config.mongodbUri) {
    throw new Error("Missing required env var: MONGODB_URI");
  }
  client = new MongoClient(config.mongodbUri);
  await client.connect();
  return client;
}

export async function getDb() {
  const dbClient = await getClient();
  return dbClient.db(config.databaseName);
}

export async function closeClient() {
  if (!client) return;
  await client.close();
  client = null;
}
