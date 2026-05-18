import { NextRequest, NextResponse } from "next/server";
import { getWebDb } from "../../../../../src/web/mongo";
import { submitAdminDecision } from "../../../../../src/web/risk-case-agent";
import { webCollections } from "../../../../../src/web/collections";

type Params = {
  params: Promise<{ caseId: string }>;
};

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { caseId } = await params;
    if (!caseId) {
      return NextResponse.json({ ok: false, error: "caseId is required" }, { status: 400 });
    }

    const body = (await request.json()) as {
      decision?: "Approve" | "Reject" | "RequestMoreInfo";
      rationale?: string;
    };

    if (!body.decision || !["Approve", "Reject", "RequestMoreInfo"].includes(body.decision)) {
      return NextResponse.json({ ok: false, error: "valid decision is required" }, { status: 400 });
    }

    const rationale = body.rationale?.trim();
    if (!rationale) {
      return NextResponse.json({ ok: false, error: "rationale is required" }, { status: 400 });
    }

    const db = await getWebDb();
    const result = await submitAdminDecision({
      db,
      caseId,
      decision: body.decision,
      rationale,
    });

    let prAgentProfile = null;
    const assignment = (result as { assignment?: { prAgentId?: string } }).assignment;
    if (assignment?.prAgentId) {
      prAgentProfile = await db.collection(webCollections.prAgents).findOne(
        { prAgentId: assignment.prAgentId },
        {
          projection: {
            _id: 0,
            prAgentId: 1,
            name: 1,
            active: 1,
            maxActivePatrons: 1,
            currentActivePatrons: 1,
            preferredTiers: 1,
            preferredGames: 1,
            preferredLanguages: 1,
            specialtyTags: 1,
            lastAssignedAt: 1,
          },
        }
      );
    }

    return NextResponse.json({ ok: true, ...result, prAgentProfile });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}
