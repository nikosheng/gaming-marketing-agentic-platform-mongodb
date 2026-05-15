import { NextRequest, NextResponse } from "next/server";
import { getWebDb } from "../../../../../src/web/mongo";
import { analyzeTablePatrons } from "../../../../../src/web/table-drilldown-agent";

type Params = {
  params: Promise<{ tableId: string }>;
};

export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const { tableId } = await params;
    if (!tableId) {
      return NextResponse.json(
        {
          ok: false,
          error: "tableId is required",
        },
        { status: 400 }
      );
    }

    const db = await getWebDb();
    const analysis = await analyzeTablePatrons(db, tableId);

    return NextResponse.json({
      ok: true,
      ...analysis,
      engine: "langgraph",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
