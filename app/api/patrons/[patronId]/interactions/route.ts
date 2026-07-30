import { NextRequest, NextResponse } from "next/server";
import { getWebDb } from "../../../../../src/web/mongo";
import { webCollections } from "../../../../../src/web/collections";
import type { PatronInteractionRecord, InteractionType } from "../../../../../src/types";

type Params = { params: Promise<{ patronId: string }> };

/**
 * GET /api/patrons/[patronId]/interactions
 * Returns the most recent 50 interaction records for a patron.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { patronId } = await params;
    const db = await getWebDb();

    const records = await db
      .collection<PatronInteractionRecord>(webCollections.patronInteractions)
      .find({ patronId })
      .sort({ occurredAt: -1 })
      .limit(50)
      .toArray();

    const totalValue = records.reduce((s, r) => s + r.totalValueHKD, 0);

    return NextResponse.json({ ok: true, patronId, records, totalValue });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/patrons/[patronId]/interactions
 * Creates a new interaction record (manual entry by PR agent).
 *
 * Body:
 *   type: InteractionType
 *   totalValueHKD: number
 *   occurredAt: string (ISO date)
 *   recordedBy: string  (prAgentId, default "system")
 *   linkedAlertId?: string
 *   detail: object      (type-specific fields)
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { patronId } = await params;
    const body = (await req.json()) as {
      type: InteractionType;
      totalValueHKD: number;
      occurredAt: string;
      recordedBy?: string;
      linkedAlertId?: string;
      detail?: Record<string, unknown>;
    };

    if (!body.type || body.totalValueHKD === undefined || !body.occurredAt) {
      return NextResponse.json(
        { ok: false, error: "type, totalValueHKD, and occurredAt are required" },
        { status: 400 }
      );
    }

    const db = await getWebDb();
    const now = new Date();

    // Fetch patron tier/adt snapshot at time of recording
    const patron = await db
      .collection(webCollections.patrons)
      .findOne({ patronId }, { projection: { tier: 1, adt: 1 } }) as
      | { tier?: string; adt?: number }
      | null;

    const record: PatronInteractionRecord = {
      interactionId: `INT-${now.getTime()}-${patronId}`.replace(/[^A-Z0-9-]/gi, "-"),
      patronId,
      type: body.type,
      detail: (body.detail ?? {}) as PatronInteractionRecord["detail"],
      totalValueHKD: Number(body.totalValueHKD),
      occurredAt: new Date(body.occurredAt),
      recordedBy: body.recordedBy ?? "system",
      recordedAt: now,
      linkedAlertId: body.linkedAlertId,
      patronTierAtTime: patron?.tier as PatronInteractionRecord["patronTierAtTime"],
      patronAdtAtTime: patron?.adt,
    };

    await db
      .collection(webCollections.patronInteractions)
      .insertOne(record as never);

    return NextResponse.json({ ok: true, record }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
