import { NextRequest, NextResponse } from "next/server";
import { getWebDb } from "../../../../../src/web/mongo";
import { createOrReuseRiskCase } from "../../../../../src/web/risk-case-agent";

type Params = {
  params: Promise<{ patronId: string }>;
};

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { patronId } = await params;
    if (!patronId) {
      return NextResponse.json({ ok: false, error: "patronId is required" }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      tableId?: string;
      analysisRunId?: string;
    };
    if (!body.tableId) {
      return NextResponse.json({ ok: false, error: "tableId is required" }, { status: 400 });
    }

    const db = await getWebDb();
    const result = await createOrReuseRiskCase({
      db,
      patronId,
      tableId: body.tableId,
      analysisRunId: body.analysisRunId,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}
