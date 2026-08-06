"use client";

import { useEffect, useState } from "react";

// ---------- Types ----------

type PatronProfile = {
  patronId: string;
  name?: string;
  maskedName: string;
  tier: string;
  adt: number;
  preferredGames: string[];
  riskFlags: string[];
  pointsBalance: number;
  lastActiveAt: string;
};

type InteractionType =
  | "ROOM_COMP"
  | "FB_COMP"
  | "REBATE"
  | "EVENT_INVITE"
  | "OUTREACH"
  | "TRANSFER";

const INTERACTION_TYPE_LABELS: Record<InteractionType, string> = {
  ROOM_COMP:    "免費房間",
  FB_COMP:      "餐飲優惠",
  REBATE:       "現金/籌碼回贈",
  EVENT_INVITE: "活動邀請",
  OUTREACH:     "電話/親身接觸",
  TRANSFER:     "交通接送",
};

const INTERACTION_TYPE_ICONS: Record<InteractionType, string> = {
  ROOM_COMP:    "🏨",
  FB_COMP:      "🍽️",
  REBATE:       "💰",
  EVENT_INVITE: "🎟️",
  OUTREACH:     "📞",
  TRANSFER:     "🚗",
};

type InteractionRecord = {
  interactionId: string;
  patronId: string;
  type: InteractionType;
  detail: Record<string, unknown>;
  totalValueHKD: number;
  occurredAt: string;
  recordedBy: string;
  recordedAt: string;
  linkedAlertId?: string;
  patronTierAtTime?: string;
};

type NextActionRecommendation = {
  priority: 1 | 2 | 3;
  actionType: string;
  title: string;
  rationale: string;
  urgency: "Immediate" | "Within48h" | "ThisWeek";
  estimatedValue?: number;
};

type PatronAnalysisReport = {
  reportId: string;
  patronId: string;
  triggeredByAlertId: string;
  profileSummary: string;
  interactionHistory: string;
  behaviorPattern: string;
  riskAssessment: string;
  recommendations: NextActionRecommendation[];
  suggestedPrId?: string;
  suggestedPrName?: string;
  generatedAt: string;
  modelUsed: string;
  status: "Draft" | "Acknowledged" | "Actioned";
};

type InteractionFormState = {
  type: InteractionType;
  totalValueHKD: string;
  occurredAt: string;
  notes: string;
  roomType: string;
  roomNights: string;
  venue: string;
  rebateRate: string;
  eventName: string;
  channel: string;
  outcome: string;
  transferType: string;
};

const DEFAULT_FORM: InteractionFormState = {
  type: "OUTREACH",
  totalValueHKD: "0",
  occurredAt: new Date().toISOString().slice(0, 10),
  notes: "",
  roomType: "",
  roomNights: "",
  venue: "",
  rebateRate: "",
  eventName: "",
  channel: "Phone",
  outcome: "Positive",
  transferType: "Airport",
};

// ---------- Helpers ----------

function urgencyLabel(u: string) {
  if (u === "Immediate") return "立即";
  if (u === "Within48h") return "48小時內";
  return "本週";
}

function urgencyClass(u: string) {
  if (u === "Immediate") return "urgency-immediate";
  if (u === "Within48h") return "urgency-48h";
  return "urgency-week";
}

function reportStatusLabel(s: string) {
  if (s === "Acknowledged") return "已閱讀";
  if (s === "Actioned")     return "已執行";
  return "草稿";
}

function interactionDetailText(rec: InteractionRecord): string {
  const d = rec.detail;
  switch (rec.type) {
    case "ROOM_COMP":
      return [d.roomType, d.roomNights ? `${d.roomNights}晚` : ""].filter(Boolean).join(" · ");
    case "FB_COMP":
      return String(d.venue ?? "");
    case "REBATE":
      return d.rebateRate ? `回贈率 ${(Number(d.rebateRate) * 100).toFixed(1)}%` : "";
    case "EVENT_INVITE":
      return [d.eventName, d.attended !== undefined ? (d.attended ? "出席" : "未出席") : ""].filter(Boolean).join(" · ");
    case "OUTREACH":
      return [d.channel, d.outcome, d.notes].filter(Boolean).join(" · ");
    case "TRANSFER":
      return [d.transferType, d.vehicleClass].filter(Boolean).join(" · ");
    default:
      return "";
  }
}

// ---------- Component ----------

export default function PatronDetailClient({ patronId }: { patronId: string }) {
  const [patron, setPatron] = useState<PatronProfile | null>(null);
  const [interactions, setInteractions] = useState<InteractionRecord[]>([]);
  const [totalValue, setTotalValue] = useState<number>(0);
  const [reports, setReports] = useState<PatronAnalysisReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Interaction form
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<InteractionFormState>(DEFAULT_FORM);
  const [submitting, setSubmitting] = useState(false);

  // Report status update
  const [updatingReportId, setUpdatingReportId] = useState<string | null>(null);

  useEffect(() => {
    async function loadAll() {
      setLoading(true);
      try {
        const [patronRes, interRes, rptRes] = await Promise.all([
          fetch(`/api/patrons/${patronId}/interactions`, { cache: "no-store" }),
          fetch(`/api/patrons/${patronId}/interactions`, { cache: "no-store" }),
          fetch(`/api/patrons/${patronId}/analysis-reports`, { cache: "no-store" }),
        ]);

        // patron profile comes from heatmap or we'll fetch via interactions
        const interData = (await interRes.json()) as {
          ok: boolean;
          records?: InteractionRecord[];
          totalValue?: number;
        };
        if (interData.ok) {
          setInteractions(interData.records ?? []);
          setTotalValue(interData.totalValue ?? 0);
        }

        const rptData = (await rptRes.json()) as {
          ok: boolean;
          reports?: PatronAnalysisReport[];
        };
        if (rptData.ok) setReports(rptData.reports ?? []);

        // Fetch patron profile from heatmap patrons listing
        const heatRes = await fetch("/api/tables/heatmap", { cache: "no-store" });
        if (heatRes.ok) {
          // We don't have a direct patron profile API, so build from interactions snapshot
          if (interData.records && interData.records.length > 0) {
            const first = interData.records[0];
            setPatron({
              patronId,
              maskedName: patronId,
              tier: first.patronTierAtTime ?? "—",
              adt: 0,
              preferredGames: [],
              riskFlags: [],
              pointsBalance: 0,
              lastActiveAt: first.occurredAt,
            });
          } else {
            setPatron({
              patronId,
              maskedName: patronId,
              tier: "—",
              adt: 0,
              preferredGames: [],
              riskFlags: [],
              pointsBalance: 0,
              lastActiveAt: "",
            });
          }
        }
        void patronRes;
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }
    loadAll().catch((e) => setError((e as Error).message));
  }, [patronId]);

  async function handleSubmitInteraction() {
    if (submitting) return;
    setSubmitting(true);
    try {
      const detail: Record<string, unknown> = { notes: form.notes };
      switch (form.type) {
        case "ROOM_COMP":
          detail.roomType = form.roomType;
          detail.roomNights = form.roomNights ? Number(form.roomNights) : undefined;
          break;
        case "FB_COMP":
          detail.venue = form.venue;
          break;
        case "REBATE":
          detail.rebateRate = form.rebateRate ? Number(form.rebateRate) / 100 : undefined;
          break;
        case "EVENT_INVITE":
          detail.eventName = form.eventName;
          break;
        case "OUTREACH":
          detail.channel = form.channel;
          detail.outcome = form.outcome;
          break;
        case "TRANSFER":
          detail.transferType = form.transferType;
          break;
      }
      const res = await fetch(`/api/patrons/${patronId}/interactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: form.type,
          totalValueHKD: Number(form.totalValueHKD),
          occurredAt: form.occurredAt,
          recordedBy: "system",
          detail,
        }),
      });
      const data = (await res.json()) as { ok: boolean; record?: InteractionRecord };
      if (data.ok && data.record) {
        setInteractions((prev) => [data.record!, ...prev]);
        setTotalValue((prev) => prev + Number(form.totalValueHKD));
        setForm(DEFAULT_FORM);
        setShowForm(false);
      }
    } catch {
      // silent
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdateReportStatus(reportId: string, status: "Acknowledged" | "Actioned") {
    setUpdatingReportId(reportId);
    try {
      const res = await fetch(`/api/analysis-reports/${reportId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = (await res.json()) as { ok: boolean; report?: PatronAnalysisReport };
      if (data.ok && data.report) {
        setReports((prev) =>
          prev.map((r) => (r.reportId === reportId ? { ...r, status: data.report!.status } : r))
        );
      }
    } catch {
      // silent
    } finally {
      setUpdatingReportId(null);
    }
  }

  if (loading) {
    return (
      <div className="patron-detail-page">
        <div className="patron-detail-loading">載入資料中…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="patron-detail-page">
        <div className="patron-detail-error">錯誤：{error}</div>
      </div>
    );
  }

  return (
    <main className="patron-detail-page">
      {/* ── Header ── */}
      <div className="patron-detail-header">
        <button className="patron-detail-back" onClick={() => window.close()}>
          ← 關閉
        </button>
        <div className="patron-detail-header-info">
          <span className="patron-detail-name">{patron?.maskedName ?? patronId}</span>
          {patron?.tier && patron.tier !== "—" ? (
            <span className="tier-pill patron-detail-tier">{patron.tier}</span>
          ) : null}
          {patron?.adt ? (
            <span className="patron-detail-adt">ADT HKD {patron.adt.toLocaleString()}</span>
          ) : null}
        </div>
        <div className="patron-detail-header-meta">
          <span className="patron-detail-id">{patronId}</span>
        </div>
      </div>

      {/* ── Two-column layout ── */}
      <div className="patron-detail-grid">
        {/* ── Left column: profile + interactions ── */}
        <div className="patron-detail-left">

          {/* Basic Info Card */}
          {patron ? (
            <div className="patron-detail-card">
              <div className="patron-detail-card-title">基本資料</div>
              <div className="patron-detail-kv">
                <span className="patron-detail-key">Tier</span>
                <span className="patron-detail-val">{patron.tier}</span>
              </div>
              <div className="patron-detail-kv">
                <span className="patron-detail-key">ADT</span>
                <span className="patron-detail-val">HKD {patron.adt.toLocaleString()}</span>
              </div>
              {patron.preferredGames.length > 0 ? (
                <div className="patron-detail-kv">
                  <span className="patron-detail-key">偏好遊戲</span>
                  <span className="patron-detail-val">{patron.preferredGames.join(", ")}</span>
                </div>
              ) : null}
              {patron.riskFlags.filter((f) => f !== "None").length > 0 ? (
                <div className="patron-detail-kv">
                  <span className="patron-detail-key">風險標籤</span>
                  <span className="patron-detail-val patron-detail-risk">{patron.riskFlags.join(", ")}</span>
                </div>
              ) : null}
              <div className="patron-detail-kv">
                <span className="patron-detail-key">積分餘額</span>
                <span className="patron-detail-val">{patron.pointsBalance.toLocaleString()}</span>
              </div>
              <div className="patron-detail-comp-total">
                <span>歷史優惠總值</span>
                <span className="patron-detail-comp-value">HKD {totalValue.toLocaleString()}</span>
              </div>
            </div>
          ) : null}

          {/* Interaction History */}
          <div className="patron-detail-card">
            <div className="patron-detail-card-title-row">
              <span className="patron-detail-card-title">互動歷史記錄</span>
              <button
                className="patron-add-interaction-btn"
                onClick={() => setShowForm((v) => !v)}
              >
                {showForm ? "收起" : "+ 新增記錄"}
              </button>
            </div>

            {/* Add interaction form */}
            {showForm ? (
              <div className="interaction-form-panel">
                <div className="interaction-form-row">
                  <label className="interaction-form-label">互動類型</label>
                  <select
                    className="interaction-form-select"
                    value={form.type}
                    onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as InteractionType }))}
                  >
                    {(Object.keys(INTERACTION_TYPE_LABELS) as InteractionType[]).map((t) => (
                      <option key={t} value={t}>{INTERACTION_TYPE_LABELS[t]}</option>
                    ))}
                  </select>
                </div>
                <div className="interaction-form-row">
                  <label className="interaction-form-label">優惠總值 (HKD)</label>
                  <input
                    className="interaction-form-input"
                    type="number"
                    min="0"
                    value={form.totalValueHKD}
                    onChange={(e) => setForm((f) => ({ ...f, totalValueHKD: e.target.value }))}
                  />
                </div>
                <div className="interaction-form-row">
                  <label className="interaction-form-label">發生日期</label>
                  <input
                    className="interaction-form-input"
                    type="date"
                    value={form.occurredAt}
                    onChange={(e) => setForm((f) => ({ ...f, occurredAt: e.target.value }))}
                  />
                </div>
                {form.type === "ROOM_COMP" && (
                  <>
                    <div className="interaction-form-row">
                      <label className="interaction-form-label">房型</label>
                      <input className="interaction-form-input" type="text" value={form.roomType}
                        onChange={(e) => setForm((f) => ({ ...f, roomType: e.target.value }))} />
                    </div>
                    <div className="interaction-form-row">
                      <label className="interaction-form-label">晚數</label>
                      <input className="interaction-form-input" type="number" min="1" value={form.roomNights}
                        onChange={(e) => setForm((f) => ({ ...f, roomNights: e.target.value }))} />
                    </div>
                  </>
                )}
                {form.type === "FB_COMP" && (
                  <div className="interaction-form-row">
                    <label className="interaction-form-label">餐廳名稱</label>
                    <input className="interaction-form-input" type="text" value={form.venue}
                      onChange={(e) => setForm((f) => ({ ...f, venue: e.target.value }))} />
                  </div>
                )}
                {form.type === "REBATE" && (
                  <div className="interaction-form-row">
                    <label className="interaction-form-label">回贈率 (%)</label>
                    <input className="interaction-form-input" type="number" step="0.1" min="0" value={form.rebateRate}
                      onChange={(e) => setForm((f) => ({ ...f, rebateRate: e.target.value }))} />
                  </div>
                )}
                {form.type === "EVENT_INVITE" && (
                  <div className="interaction-form-row">
                    <label className="interaction-form-label">活動名稱</label>
                    <input className="interaction-form-input" type="text" value={form.eventName}
                      onChange={(e) => setForm((f) => ({ ...f, eventName: e.target.value }))} />
                  </div>
                )}
                {form.type === "OUTREACH" && (
                  <>
                    <div className="interaction-form-row">
                      <label className="interaction-form-label">聯繫渠道</label>
                      <select className="interaction-form-select" value={form.channel}
                        onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value }))}>
                        {["Phone", "In-Person", "WeChat", "WhatsApp"].map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                    <div className="interaction-form-row">
                      <label className="interaction-form-label">回應結果</label>
                      <select className="interaction-form-select" value={form.outcome}
                        onChange={(e) => setForm((f) => ({ ...f, outcome: e.target.value }))}>
                        {["Positive", "Neutral", "No Answer", "Declined"].map((o) => (
                          <option key={o} value={o}>{o}</option>
                        ))}
                      </select>
                    </div>
                  </>
                )}
                {form.type === "TRANSFER" && (
                  <div className="interaction-form-row">
                    <label className="interaction-form-label">接送類型</label>
                    <select className="interaction-form-select" value={form.transferType}
                      onChange={(e) => setForm((f) => ({ ...f, transferType: e.target.value }))}>
                      {["Airport", "Hotel", "Venue"].map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="interaction-form-row">
                  <label className="interaction-form-label">備注</label>
                  <textarea className="interaction-form-textarea" rows={2}
                    value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
                </div>
                <div className="interaction-form-footer">
                  <button className="interaction-form-submit" disabled={submitting} onClick={handleSubmitInteraction}>
                    {submitting ? "提交中…" : "提交記錄"}
                  </button>
                </div>
              </div>
            ) : null}

            {/* Timeline */}
            {interactions.length === 0 ? (
              <div className="patron-timeline-empty">暫無互動記錄</div>
            ) : (
              <div className="patron-timeline">
                {interactions.map((rec) => (
                  <div className="patron-timeline-item" key={rec.interactionId}>
                    <div className="patron-timeline-icon">
                      {INTERACTION_TYPE_ICONS[rec.type]}
                    </div>
                    <div className="patron-timeline-body">
                      <div className="patron-timeline-header">
                        <span className="patron-timeline-type">{INTERACTION_TYPE_LABELS[rec.type]}</span>
                        {rec.totalValueHKD > 0 ? (
                          <span className="patron-timeline-value">HKD {rec.totalValueHKD.toLocaleString()}</span>
                        ) : null}
                        <span className="patron-timeline-date">
                          {new Date(rec.occurredAt).toLocaleDateString("zh-HK")}
                        </span>
                      </div>
                      {interactionDetailText(rec) ? (
                        <div className="patron-timeline-detail">{interactionDetailText(rec)}</div>
                      ) : null}
                      {rec.linkedAlertId ? (
                        <div className="patron-timeline-alert-link">關聯 Alert: {rec.linkedAlertId}</div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Right column: analysis reports ── */}
        <div className="patron-detail-right">
          <div className="patron-detail-card">
            <div className="patron-detail-card-title">AI 分析報告</div>
            {reports.length === 0 ? (
              <div className="patron-timeline-empty">
                尚無分析報告。在 Alert Feed 中點擊「分析賭客」按鈕以生成。
              </div>
            ) : (
              reports.map((rpt) => (
                <div
                  className={`patron-report-card report-status-${rpt.status.toLowerCase()}`}
                  key={rpt.reportId}
                >
                  {/* Report header */}
                  <div className="patron-report-header">
                    <span className="patron-report-date">
                      {new Date(rpt.generatedAt).toLocaleString("zh-HK")}
                    </span>
                    <span className={`patron-report-status status-${rpt.status.toLowerCase()}`}>
                      {reportStatusLabel(rpt.status)}
                    </span>
                    <span className="patron-report-model">{rpt.modelUsed}</span>
                  </div>

                  {/* Profile summary */}
                  <div className="patron-analysis-section">
                    <div className="patron-analysis-section-title">個人 Profile</div>
                    <div className="patron-analysis-text">{rpt.profileSummary}</div>
                  </div>

                  {/* Interaction history */}
                  <div className="patron-analysis-section">
                    <div className="patron-analysis-section-title">歷史互動摘要</div>
                    <div className="patron-analysis-text" style={{ whiteSpace: "pre-line" }}>
                      {rpt.interactionHistory}
                    </div>
                  </div>

                  {/* Behavior pattern */}
                  <div className="patron-analysis-section">
                    <div className="patron-analysis-section-title">行為規律</div>
                    <div className="patron-analysis-text">{rpt.behaviorPattern}</div>
                  </div>

                  {/* Risk assessment */}
                  <div className="patron-analysis-section">
                    <div className="patron-analysis-section-title">機會 / 風險評估</div>
                    <div className="patron-analysis-text">{rpt.riskAssessment}</div>
                  </div>

                  {/* Recommendations */}
                  <div className="patron-analysis-section">
                    <div className="patron-analysis-section-title">下一步銷售建議</div>
                    <div className="patron-recommendation-list">
                      {rpt.recommendations.map((rec, ri) => (
                        <div className="patron-recommendation-item" key={`${rpt.reportId}-rec-${ri}`}>
                          <div className="patron-recommendation-header">
                            <span className="patron-rec-priority">P{rec.priority}</span>
                            <span className={`patron-rec-urgency ${urgencyClass(rec.urgency)}`}>
                              {urgencyLabel(rec.urgency)}
                            </span>
                            <span className="patron-rec-title">{rec.title}</span>
                            {rec.estimatedValue ? (
                              <span className="patron-rec-value">
                                ~HKD {rec.estimatedValue.toLocaleString()}
                              </span>
                            ) : null}
                          </div>
                          <div className="patron-rec-rationale">{rec.rationale}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Suggested PR */}
                  {rpt.suggestedPrName ? (
                    <div className="patron-analysis-section">
                      <div className="patron-analysis-section-title">建議公關</div>
                      <div className="patron-analysis-pr-row">
                        <span className="patron-analysis-pr-name">{rpt.suggestedPrName}</span>
                        {rpt.suggestedPrId ? (
                          <span className="patron-analysis-pr-id">{rpt.suggestedPrId}</span>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  {/* Status actions */}
                  <div className="patron-report-actions">
                    {rpt.status === "Draft" ? (
                      <button
                        className="patron-report-action-btn acknowledge"
                        disabled={updatingReportId === rpt.reportId}
                        onClick={() => handleUpdateReportStatus(rpt.reportId, "Acknowledged")}
                      >
                        標記已閱讀
                      </button>
                    ) : null}
                    {rpt.status !== "Actioned" ? (
                      <button
                        className="patron-report-action-btn action"
                        disabled={updatingReportId === rpt.reportId}
                        onClick={() => handleUpdateReportStatus(rpt.reportId, "Actioned")}
                      >
                        標記已執行
                      </button>
                    ) : null}
                    <span className="patron-report-alert-ref">
                      Alert: {rpt.triggeredByAlertId}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
