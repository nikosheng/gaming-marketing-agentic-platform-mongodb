import { NextRequest, NextResponse } from "next/server";
import { getWebDb } from "../../../src/web/mongo";
import { webCollections } from "../../../src/web/collections";
import {
  previewAlertRule,
  persistAlertRule,
  seedTemplateRulesIfEmpty,
} from "../../../src/web/alert-rule-agent";
import type { AlertRule, AlertRulePreview } from "../../../src/types";

type PostBody =
  | { action: "preview"; nlDescription: string }
  | { action: "confirm"; preview: AlertRulePreview };

export async function GET() {
  try {
    const db = await getWebDb();
    const rules = await seedTemplateRulesIfEmpty(db);
    return NextResponse.json({ ok: true, rules });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as PostBody;
    const db = await getWebDb();

    // ---------- preview ----------
    if (body.action === "preview") {
      const { nlDescription } = body;
      if (!nlDescription?.trim()) {
        return NextResponse.json(
          { ok: false, error: "nlDescription is required" },
          { status: 400 }
        );
      }

      const { preview, error } = await previewAlertRule(db, nlDescription.trim());

      if (error) {
        // Surface AI_NOT_CONFIGURED as a 503 so the UI can show a specific message
        const status = error.startsWith("AI_NOT_CONFIGURED") ? 503 : 500;
        return NextResponse.json({ ok: false, error }, { status });
      }

      return NextResponse.json({ ok: true, preview });
    }

    // ---------- confirm ----------
    if (body.action === "confirm") {
      const { preview } = body;
      if (!preview) {
        return NextResponse.json(
          { ok: false, error: "preview is required for confirm action" },
          { status: 400 }
        );
      }

      const { ruleId, error } = await persistAlertRule(db, preview);
      if (error) {
        return NextResponse.json({ ok: false, error }, { status: 400 });
      }

      // Return the newly created rule for the UI to display immediately
      const rule = await db
        .collection<AlertRule>(webCollections.alertRules)
        .findOne({ ruleId: ruleId! });

      return NextResponse.json({ ok: true, ruleId, rule });
    }

    return NextResponse.json(
      { ok: false, error: "action must be 'preview' or 'confirm'" },
      { status: 400 }
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
