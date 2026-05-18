import { NextResponse } from "next/server";
import { getWebDb } from "../../../../../../src/web/mongo";
import { getLatestRiskCase } from "../../../../../../src/web/risk-case-agent";
import { webCollections } from "../../../../../../src/web/collections";

type Params = {
  params: Promise<{ patronId: string }>;
};

export async function GET(_request: Request, { params }: Params) {
  try {
    const { patronId } = await params;
    if (!patronId) {
      return NextResponse.json({ ok: false, error: "patronId is required" }, { status: 400 });
    }
    const db = await getWebDb();
    const riskCase = await getLatestRiskCase(db, patronId);
    if (!riskCase) {
      return NextResponse.json({ ok: false, error: "No risk case found" }, { status: 404 });
    }
    const assignment = await db
      .collection(webCollections.prAssignments)
      .findOne({ caseId: riskCase.caseId }, { projection: { _id: 0 }, sort: { assignedAt: -1 } });

    let prAgentProfile = null;
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

    return NextResponse.json({
      ok: true,
      case: riskCase,
      assignment,
      prAgentProfile,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}
