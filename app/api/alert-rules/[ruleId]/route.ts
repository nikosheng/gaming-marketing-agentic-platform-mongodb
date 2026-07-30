import { NextRequest, NextResponse } from "next/server";
import { getWebDb } from "../../../../src/web/mongo";
import { webCollections } from "../../../../src/web/collections";

type Params = {
  params: Promise<{ ruleId: string }>;
};

type PatchBody = {
  status?: "Active" | "Paused";
};

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { ruleId } = await params;
    const body = (await request.json()) as PatchBody;
    const { status } = body;

    if (!status || !["Active", "Paused"].includes(status)) {
      return NextResponse.json(
        { ok: false, error: "status must be 'Active' or 'Paused'" },
        { status: 400 }
      );
    }

    const db = await getWebDb();
    const result = await db
      .collection(webCollections.alertRules)
      .updateOne({ ruleId }, { $set: { status } });

    if (result.matchedCount === 0) {
      return NextResponse.json(
        { ok: false, error: `Rule ${ruleId} not found` },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true, ruleId, status });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
