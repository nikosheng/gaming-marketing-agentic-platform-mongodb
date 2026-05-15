import { NextRequest, NextResponse } from "next/server";
import { getWebDb } from "../../../../../src/web/mongo";
import { runMinBetOptimizer } from "../../../../../src/web/minbet-optimizer-agent";

type Params = {
  params: Promise<{ tableId: string }>;
};

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { tableId } = await params;
    if (!tableId) {
      return NextResponse.json(
        { ok: false, error: "tableId is required" },
        { status: 400 }
      );
    }

    let actorId = "console-user";
    try {
      const body = (await request.json()) as { actorId?: string };
      if (body?.actorId) actorId = body.actorId;
    } catch {
      // body is optional
    }

    const db = await getWebDb();
    const recommendation = await runMinBetOptimizer(db, tableId, actorId);

    if (!recommendation) {
      return NextResponse.json(
        {
          ok: false,
          error: `Unable to compute min-bet recommendation for ${tableId}.`,
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      recommendation,
      engine: "langgraph",
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
