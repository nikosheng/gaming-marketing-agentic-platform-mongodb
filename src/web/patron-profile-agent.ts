import { Db } from "mongodb";
import type {
  PatronProfile,
  PatronInteractionRecord,
  PatronAlert,
  PatronAnalysisReport,
  NextActionRecommendation,
  PRAgentProfile,
  InteractionType,
} from "../types";
import { webCollections } from "./collections";
import { chatJson } from "./llm/gateway";
import { config } from "../config";

// ---------- Helpers ----------

function interactionTypeLabel(type: InteractionType): string {
  switch (type) {
    case "ROOM_COMP":    return "免費房間";
    case "FB_COMP":      return "餐飲優惠";
    case "REBATE":       return "現金/籌碼回贈";
    case "EVENT_INVITE": return "活動邀請";
    case "OUTREACH":     return "電話/親身接觸";
    case "TRANSFER":     return "交通接送";
    default:             return type;
  }
}

function formatInteractionForPrompt(rec: PatronInteractionRecord): string {
  const date = new Date(rec.occurredAt).toLocaleDateString("zh-HK");
  const typeLabel = interactionTypeLabel(rec.type);
  const value = rec.totalValueHKD > 0 ? `（HKD ${rec.totalValueHKD.toLocaleString()}）` : "";

  let detail = "";
  switch (rec.type) {
    case "ROOM_COMP":
      detail = rec.detail.roomType
        ? `${rec.detail.roomType}${rec.detail.roomNights ? ` ${rec.detail.roomNights}晚` : ""}`
        : "";
      break;
    case "FB_COMP":
      detail = rec.detail.venue ?? "";
      break;
    case "REBATE":
      detail = rec.detail.rebateRate
        ? `回贈率 ${(rec.detail.rebateRate * 100).toFixed(1)}%`
        : `HKD ${rec.detail.rebateAmount?.toLocaleString() ?? 0}`;
      break;
    case "EVENT_INVITE":
      detail = rec.detail.eventName
        ? `${rec.detail.eventName}${rec.detail.attended !== undefined ? (rec.detail.attended ? "（出席）" : "（未出席）") : ""}`
        : "";
      break;
    case "OUTREACH":
      detail = [rec.detail.channel, rec.detail.outcome].filter(Boolean).join("，");
      if (rec.detail.notes) detail += `：${rec.detail.notes}`;
      break;
    case "TRANSFER":
      detail = [rec.detail.transferType, rec.detail.vehicleClass].filter(Boolean).join(" · ");
      break;
  }

  return `• ${date} [${typeLabel}]${value}${detail ? ` — ${detail}` : ""}`;
}

// ---------- Main Export ----------

export async function runPatronProfileAnalysis(
  db: Db,
  patronId: string,
  alertId: string
): Promise<PatronAnalysisReport> {
  // 1. Parallel data fetch
  const [patronDoc, interactions, alertDoc, prAgentDocs] = await Promise.all([
    db
      .collection<PatronProfile>(webCollections.patrons)
      .findOne({ patronId }, { projection: { _id: 0, preferenceEmbedding: 0, activities: 0 } }),

    db
      .collection<PatronInteractionRecord>(webCollections.patronInteractions)
      .find({ patronId })
      .sort({ occurredAt: -1 })
      .limit(20)
      .toArray(),

    db
      .collection<PatronAlert>(webCollections.patronAlerts)
      .findOne({ alertId }, { projection: { _id: 0 } }),

    db
      .collection<PRAgentProfile>(webCollections.prAgents)
      .find({ active: true })
      .limit(5)
      .toArray(),
  ]);

  // 2. Build interaction history text
  const interactionLines =
    interactions.length > 0
      ? interactions.map(formatInteractionForPrompt).join("\n")
      : "（暫無歷史互動記錄）";

  const totalCompValue = interactions.reduce((s, r) => s + r.totalValueHKD, 0);

  // 3. Build alert context text
  let alertContext = "（未能獲取告警詳情）";
  if (alertDoc) {
    const condSummary = alertDoc.triggeredConditions
      .map((tc) => {
        const ev = tc.evidence as Record<string, unknown>;
        switch (tc.type) {
          case "CONSECUTIVE_ROUNDS_BET_THRESHOLD":
            return `連續 ${ev.consecutiveRounds} 輪下注均超 HKD ${Number(ev.threshold ?? 0).toLocaleString()}`;
          case "CUMULATIVE_ROUNDS_BET_THRESHOLD":
            return `${ev.actualRounds} 輪累計下注 HKD ${Number(ev.totalBet ?? 0).toLocaleString()}`;
          case "SINGLE_ROUND_ADT_MULTIPLIER":
            return `本輪下注 HKD ${Number(ev.betAmount ?? 0).toLocaleString()}（ADT 的 ${ev.adtRatio} 倍）`;
          case "SESSION_BET_ABOVE":
            return `本場累計 HKD ${Number(ev.sessionBetAmount ?? 0).toLocaleString()}`;
          default:
            return tc.type;
        }
      })
      .join("；");
    alertContext = `規則「${alertDoc.ruleName}」觸發：${condSummary}。桌台：${alertDoc.tableSnapshot.tableName}（${alertDoc.tableSnapshot.gameType}，${alertDoc.tableSnapshot.zone}）`;
  }

  // 4. Build PR agents list for LLM
  const prListText =
    prAgentDocs.length > 0
      ? prAgentDocs
          .map(
            (p) =>
              `  - prAgentId: "${p.prAgentId}", name: "${p.name}", tiers: [${p.preferredTiers.join(", ")}], languages: [${p.preferredLanguages.join(", ")}], tags: [${p.specialtyTags.join(", ")}]`
          )
          .join("\n")
      : "  （暫無可用公關）";

  // 5. Compose user prompt
  const patronInfo = patronDoc
    ? `tier: ${patronDoc.tier}, ADT: HKD ${patronDoc.adt.toLocaleString()}, pointsBalance: ${patronDoc.pointsBalance}, preferredGames: [${patronDoc.preferredGames.join(", ")}], riskFlags: [${patronDoc.riskFlags.join(", ") || "無"}]`
    : `patronId: ${patronId}（無詳細資料）`;

  const userPrompt = `
請根據以下資料，用繁體中文分析此賭客並輸出 JSON。

【賭客基本資料】
patronId: ${patronId}
${patronInfo}

【觸發告警】
${alertContext}

【歷史互動記錄（最近20筆）】
${interactionLines}
歷史累計優惠總值：HKD ${totalCompValue.toLocaleString()}

【可用公關人員】
${prListText}

請輸出以下 JSON 格式（所有文字使用繁體中文）：
{
  "profileSummary": "（80字以內，包含tier、ADT、主要遊戲偏好、回訪習慣等）",
  "interactionHistory": "（條列式摘要歷史互動重點，著重已給予的優惠價值和效果）",
  "behaviorPattern": "（分析賭博行為規律、下注模式、回訪頻率等）",
  "riskAssessment": "（此時機的商業機會點或潛在風險，50字以內）",
  "recommendations": [
    {
      "priority": 1,
      "actionType": "ROOM_COMP",
      "title": "（簡短動作標題，15字以內）",
      "rationale": "（建議理由，40字以內）",
      "urgency": "Immediate",
      "estimatedValue": 50000
    }
  ],
  "suggestedPrId": "（從可用公關列表中選最合適的 prAgentId，若無合適則填 null）"
}

recommendations 請提供 2-3 條，按 priority 排列。
urgency 只能為 "Immediate"、"Within48h"、"ThisWeek" 之一。
actionType 只能為 "ROOM_COMP"、"FB_COMP"、"REBATE"、"EVENT_INVITE"、"OUTREACH"、"TRANSFER"、"TIER_UPGRADE"、"CUSTOM" 之一。
`.trim();

  const systemPrompt =
    "你是澳門貴賓廳行銷分析師，專責分析高價值賭客的歷史行為並給出銷售行動建議。請嚴格按照指定 JSON 格式輸出，不要添加任何額外說明文字。";

  // 6. Call LLM (via LiteLLM gateway)
  const llmRaw = await chatJson({
    system: systemPrompt,
    user: userPrompt,
    temperature: 0.5,
    maxTokens: 800,
  });

  // 7. Parse LLM output or fallback
  let parsed: {
    profileSummary: string;
    interactionHistory: string;
    behaviorPattern: string;
    riskAssessment: string;
    recommendations: NextActionRecommendation[];
    suggestedPrId?: string | null;
  } = {
    profileSummary: `${patronDoc?.tier ?? "未知"} 會員，ADT HKD ${patronDoc?.adt?.toLocaleString() ?? 0}。`,
    interactionHistory: interactionLines,
    behaviorPattern: "行為資料分析中。",
    riskAssessment: "請聯繫公關跟進。",
    recommendations: [
      {
        priority: 1,
        actionType: "OUTREACH",
        title: "主動聯繫確認需求",
        rationale: "賭客正在高活躍期，及時聯繫可提升轉化機會。",
        urgency: "Immediate",
      },
    ],
    suggestedPrId: null,
  };

  if (llmRaw) {
    try {
      const raw = JSON.parse(llmRaw) as typeof parsed;
      // Validate recommendations array
      if (Array.isArray(raw.recommendations) && raw.recommendations.length > 0) {
        parsed = raw;
      }
    } catch {
      // keep fallback
    }
  }

  // 8. Resolve suggested PR name
  let suggestedPrName: string | undefined;
  if (parsed.suggestedPrId) {
    const pr = prAgentDocs.find((p) => p.prAgentId === parsed.suggestedPrId);
    if (pr) suggestedPrName = pr.name;
  }

  // 9. Build report document
  const now = new Date();

  const report: PatronAnalysisReport = {
    reportId: `RPT-${now.getTime()}-${patronId}`.replace(/[^A-Z0-9-]/gi, "-"),
    patronId,
    triggeredByAlertId: alertId,
    profileSummary: parsed.profileSummary,
    interactionHistory: parsed.interactionHistory,
    behaviorPattern: parsed.behaviorPattern,
    riskAssessment: parsed.riskAssessment,
    recommendations: parsed.recommendations,
    suggestedPrId: parsed.suggestedPrId ?? undefined,
    suggestedPrName,
    generatedAt: now,
    // modelUsed records the gateway alias; the actual physical deployment is
    // resolved by LiteLLM's routing rules and can change without a code update.
    modelUsed: config.llm.chatModel,
    status: "Draft",
  };

  // 10. Insert into DB
  await db
    .collection(webCollections.patronAnalysisReports)
    .insertOne(report as never);

  return report;
}
