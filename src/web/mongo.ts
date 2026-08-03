import { Db, MongoClient, ServerApiVersion } from "mongodb";

declare global {
  // eslint-disable-next-line no-var
  var __mongoClientPromise: Promise<MongoClient> | undefined;
}

const dbName = process.env.MONGODB_DB ?? "casino_marketing_demo";

const options = {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: false,
    deprecationErrors: true,
  },
};

function resolveClientPromise(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("Missing MONGODB_URI. Please set it in .env.local or environment.");
  }
  if (process.env.NODE_ENV === "development") {
    if (!global.__mongoClientPromise) {
      const client = new MongoClient(uri, options);
      global.__mongoClientPromise = client.connect();
    }
    return global.__mongoClientPromise;
  }
  const client = new MongoClient(uri, options);
  return client.connect();
}

export async function getWebDb(): Promise<Db> {
  const clientPromise = resolveClientPromise();
  const client = await clientPromise;
  return client.db(dbName);
}
