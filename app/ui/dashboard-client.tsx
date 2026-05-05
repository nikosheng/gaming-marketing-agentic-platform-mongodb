"use client";

import { CSSProperties, useEffect, useMemo, useState } from "react";

type HeatmapTable = {
  tableId: string;
  tableName: string;
  zone: string;
  gameType: string;
  status: string;
  patronCount: number;
  avgBetAmount: number;
  occupancyRate: number;
};

type HeatmapResponse = {
  ok: boolean;
  metrics: {
    totalTables: number;
    totalPatrons: number;
    hotTables: number;
    openOrBusyTables: number;
  };
  tables: HeatmapTable[];
};

type PatronRow = {
  patronId: string;
  maskedName: string;
  tier: string;
  adt: number;
  pointsBalance: number;
  sessionBetAmount: number;
  currentStackEstimate: number;
  behaviorTags: string[];
  lastActionAt: string;
};

type PatronResponse = {
  ok: boolean;
  tableId: string;
  patronCount: number;
  patrons: PatronRow[];
};

type OfferDashboardResponse = {
  ok: boolean;
  summary: {
    offerCount: number;
    recommendationCount: number;
    recentActivityCount: number;
    recommendationStatusCounts: Record<string, number>;
  };
  offers: Array<{
    offerId: string;
    offerType: string;
    title: string;
    status: string;
    priority: number;
    estimatedCost: number;
  }>;
  recommendations: Array<{
    recommendationId: string;
    patronId: string;
    offerId: string;
    relevanceScore: number;
    confidence: number;
    status: string;
    generatedAt: string;
    nextBestAction: string;
  }>;
  recentActivities: Array<{
    eventId: string;
    patronId: string;
    activityType: string;
    source: string;
    amount: number;
    pointsDelta: number;
    eventTime: string;
  }>;
};

type AgentMessage = {
  role: "user" | "assistant";
  content: string;
};

type GuidanceQuestion = {
  id: string;
  question: string;
  example: string;
};

type OfferGenerationStats = {
  totalPatrons: number;
  matchedPatrons: number;
  matchRate: number;
  avgMatchedAdt: number;
  tierBreakdown: Array<{ label: string; value: number }>;
  gameBreakdown: Array<{ label: string; value: number }>;
};

const promptTemplates = [
  "Create a premium hotel offer for Platinum baccarat patrons with ADT >= 10000 active within 7 days.",
  "Offer: Weekend Show Bundle. Build a show ticket offer for Diamond patrons with table bet activity in last 14 days.",
  "Create a points limited-time offer for Gold and Platinum patrons with points >= 20000 and chip exchange >= 8000.",
];

export default function DashboardClient() {
  const [heatmap, setHeatmap] = useState<HeatmapResponse | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<string>("");
  const [patrons, setPatrons] = useState<PatronResponse | null>(null);
  const [offerDashboard, setOfferDashboard] = useState<OfferDashboardResponse | null>(null);
  const [generatePatronId, setGeneratePatronId] = useState<string>("");
  const [generatedOffers, setGeneratedOffers] = useState<
    Array<{ offerId: string; title: string; offerType: string; score: number }>
  >([]);
  const [agentInput, setAgentInput] = useState<string>("");
  const [agentLoading, setAgentLoading] = useState<boolean>(false);
  const [agentQuestions, setAgentQuestions] = useState<GuidanceQuestion[]>([]);
  const [agentStats, setAgentStats] = useState<OfferGenerationStats | null>(null);
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([
    {
      role: "assistant",
      content:
        "Tell me the offer and patron criteria. Example: Create a hotel offer for Gold/Platinum baccarat patrons with ADT >= 5000 active within 7 days.",
    },
  ]);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    async function fetchHeatmap() {
      const res = await fetch("/api/tables/heatmap", { cache: "no-store" });
      const data = (await res.json()) as HeatmapResponse;
      if (!data.ok) return;
      setHeatmap(data);
      if (!selectedTableId && data.tables.length > 0) {
        setSelectedTableId(data.tables[0].tableId);
      }
    }

    async function fetchOffers() {
      const res = await fetch("/api/offers/dashboard", { cache: "no-store" });
      const data = (await res.json()) as OfferDashboardResponse;
      if (!data.ok) return;
      setOfferDashboard(data);
    }

    fetchHeatmap().catch((err) => setError((err as Error).message));
    fetchOffers().catch((err) => setError((err as Error).message));
    const interval = window.setInterval(fetchHeatmap, 60000);
    return () => window.clearInterval(interval);
  }, [selectedTableId]);

  useEffect(() => {
    if (!selectedTableId) return;
    async function fetchPatrons() {
      const res = await fetch(`/api/tables/${selectedTableId}/patrons`, { cache: "no-store" });
      const data = (await res.json()) as PatronResponse;
      if (!data.ok) return;
      setPatrons(data);
      setGeneratePatronId((current) => current || data.patrons[0]?.patronId || "");
    }
    fetchPatrons().catch((err) => setError((err as Error).message));
  }, [selectedTableId]);

  const topRecommendations = useMemo(
    () => offerDashboard?.recommendations.slice(0, 8) ?? [],
    [offerDashboard]
  );

  function formatAmount(value: number) {
    return value.toLocaleString();
  }

  async function onGenerateOffers() {
    if (!generatePatronId) return;
    const res = await fetch("/api/offers/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patronId: generatePatronId }),
    });
    const data = (await res.json()) as {
      ok: boolean;
      generatedOffers: Array<{ offerId: string; title: string; offerType: string; score: number }>;
      error?: string;
    };
    if (!data.ok) {
      setError(data.error ?? "Failed to generate offers");
      return;
    }
    setGeneratedOffers(data.generatedOffers);
  }

  async function onSubmitAgentPrompt() {
    const message = agentInput.trim();
    if (!message || agentLoading) return;
    setAgentMessages((current) => [...current, { role: "user", content: message }]);
    setAgentInput("");
    setAgentLoading(true);
    try {
      const res = await fetch("/api/offers/agent-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        reply?: string;
        error?: string;
        stats?: OfferGenerationStats | null;
        guidanceQuestions?: GuidanceQuestion[];
        requiresClarification?: boolean;
      };
      if (!data.ok) {
        setAgentMessages((current) => [
          ...current,
          { role: "assistant", content: data.error ?? "Failed to process request." },
        ]);
        return;
      }
      setAgentMessages((current) => [
        ...current,
        { role: "assistant", content: data.reply ?? "Offer created." },
      ]);
      setAgentQuestions(data.guidanceQuestions ?? []);
      setAgentStats(data.requiresClarification ? null : (data.stats ?? null));

      const offersRes = await fetch("/api/offers/dashboard", { cache: "no-store" });
      const offersData = (await offersRes.json()) as OfferDashboardResponse;
      if (offersData.ok) setOfferDashboard(offersData);
    } catch (err) {
      setAgentMessages((current) => [
        ...current,
        { role: "assistant", content: (err as Error).message },
      ]);
    } finally {
      setAgentLoading(false);
    }
  }

  return (
    <main className="modern-page">
      <header className="hero">
        <div>
          <h1 className="hero-title">Casino Patron Marketing Workspace</h1>
          <p className="hero-subtitle">
            Real-time floor intelligence with a modern offer agent that builds and validates offers from
            natural-language strategy prompts.
          </p>
        </div>
        <div className="hero-metrics">
          <span className="hero-chip">Tables {heatmap?.metrics.totalTables ?? "-"}</span>
          <span className="hero-chip">Patrons {heatmap?.metrics.totalPatrons ?? "-"}</span>
          <span className="hero-chip">Offers {offerDashboard?.summary.offerCount ?? "-"}</span>
        </div>
      </header>
      {error ? <p className="error-banner">{error}</p> : null}
      <div className="workspace-grid">
        <section className="ops-column">
          <article className="panel-card">
            <h2 className="panel-title">Table Heatmap</h2>
            <div className="metric-row">
              <span className="metric-chip">Hot {heatmap?.metrics.hotTables ?? "-"}</span>
              <span className="metric-chip">Open/Busy {heatmap?.metrics.openOrBusyTables ?? "-"}</span>
              <span className="metric-chip">Refresh 1m</span>
            </div>
            <div className="tables">
              {(heatmap?.tables ?? []).map((table) => (
                <button
                  key={table.tableId}
                  className={`table-btn ${selectedTableId === table.tableId ? "active" : ""}`}
                  onClick={() => setSelectedTableId(table.tableId)}
                >
                  <div className="table-head">{table.tableName}</div>
                  <div className="muted">{table.gameType}</div>
                  <div className="muted">Zone {table.zone}</div>
                  <div className={table.occupancyRate > 0.8 ? "hot" : "muted"}>
                    Occupancy {Math.round(table.occupancyRate * 100)}%
                  </div>
                  <div className="muted">Patrons {table.patronCount}</div>
                </button>
              ))}
            </div>
          </article>
          <article className="panel-card">
            <h2 className="panel-title">Table Drill-Down: {selectedTableId || "-"}</h2>
            <div className="patron-list">
              {(patrons?.patrons ?? []).map((patron) => (
                <div className="patron-row" key={patron.patronId}>
                  <div className="patron-head">
                    <strong>{patron.patronId}</strong>
                    <span className="small">{patron.tier}</span>
                  </div>
                  <div className="split small">
                    <span>Bet {formatAmount(patron.sessionBetAmount)}</span>
                    <span>ADT {formatAmount(patron.adt)}</span>
                    <span>Points {formatAmount(patron.pointsBalance)}</span>
                    <span>Stack {formatAmount(patron.currentStackEstimate)}</span>
                  </div>
                </div>
              ))}
            </div>
          </article>
          <article className="panel-card">
            <h2 className="panel-title">Offer Dashboard</h2>
            <div className="metric-row">
              <span className="metric-chip">
                Recommendations {offerDashboard?.summary.recommendationCount ?? "-"}
              </span>
              <span className="metric-chip">
                Activities {offerDashboard?.summary.recentActivityCount ?? "-"}
              </span>
            </div>
            <div className="offer-list">
              {(offerDashboard?.offers ?? []).slice(0, 8).map((offer) => (
                <div className="offer-row" key={offer.offerId}>
                  <strong>{offer.title}</strong>
                  <div className="small">
                    {offer.offerType} | {offer.status} | Priority {offer.priority}
                  </div>
                </div>
              ))}
            </div>
          </article>
          <article className="panel-card">
            <h2 className="panel-title">Quick Offer Lookup</h2>
            <p className="small">Generate top matches for one patron profile.</p>
            <div className="actions">
              <input
                className="input"
                value={generatePatronId}
                onChange={(e) => setGeneratePatronId(e.target.value)}
                placeholder="Patron ID (e.g. P-000001)"
              />
              <button className="button" onClick={onGenerateOffers}>
                Generate
              </button>
            </div>
            {generatedOffers.map((item) => (
              <div className="offer-row" key={`${item.offerId}-${item.title}`}>
                <strong>{item.title}</strong>
                <div className="small">
                  {item.offerId} | {item.offerType} | score {item.score.toFixed(4)}
                </div>
              </div>
            ))}
          </article>
        </section>
        <section className="agent-column">
          <article className="agent-shell">
            <div className="agent-topbar">
              <div>
                <h2 className="panel-title">Offer Agent</h2>
                <p className="small">
                  Describe campaign goals and patron criteria. The agent creates draft offers and reports
                  match volume instantly.
                </p>
              </div>
              <div className="status-badge">{agentLoading ? "Processing..." : "LangGraph Online"}</div>
            </div>
            <div className="suggestion-row">
              {promptTemplates.map((prompt) => (
                <button
                  key={prompt}
                  className="suggestion-chip"
                  onClick={() => setAgentInput(prompt)}
                  type="button"
                >
                  Use Template
                </button>
              ))}
            </div>
            <div className="chat-canvas">
              {agentMessages.map((msg, index) => (
                <div
                  key={`${msg.role}-${index}`}
                  className={`chat-bubble ${msg.role === "assistant" ? "assistant-bubble" : "user-bubble"}`}
                >
                  {msg.content}
                </div>
              ))}
            </div>
            <div className="composer">
              <textarea
                className="agent-textarea"
                value={agentInput}
                onChange={(e) => setAgentInput(e.target.value)}
                placeholder="Example: Create a music show offer for Diamond and Platinum patrons with ADT >= 12000 and table bet activity within 14 days."
                rows={4}
              />
              <div className="composer-actions">
                <button className="button ghost-button" onClick={() => setAgentInput("")} type="button">
                  Clear
                </button>
                <button
                  className="button"
                  onClick={() => onSubmitAgentPrompt().catch(() => undefined)}
                  type="button"
                >
                  {agentLoading ? "Working..." : "Send To Agent"}
                </button>
              </div>
            </div>
            {agentQuestions.length > 0 ? (
              <div className="guidance-panel">
                <h3>Guided Questions</h3>
                <div className="guidance-list">
                  {agentQuestions.map((q) => (
                    <button
                      key={q.id}
                      className="guidance-card"
                      type="button"
                      onClick={() =>
                        setAgentInput(
                          `Create a ${q.example}. Target segment: ${q.example}. Criteria: `
                        )
                      }
                    >
                      <strong>{q.question}</strong>
                      <span>{q.example}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {agentStats ? (
              <div className="impact-panel">
                <div className="impact-head">
                  <h3>Offer Impact Graph</h3>
                  <span>{Math.round(agentStats.matchRate * 100)}% match rate</span>
                </div>
                <div className="impact-grid">
                  <div className="donut-wrap">
                    <div
                      className="donut"
                      style={
                        {
                          "--pct": `${Math.max(0, Math.min(100, Math.round(agentStats.matchRate * 100)))}%`,
                        } as CSSProperties
                      }
                    >
                      <div className="donut-inner">
                        <strong>{agentStats.matchedPatrons}</strong>
                        <span>Matched Patrons</span>
                      </div>
                    </div>
                    <p className="small">Total patrons: {agentStats.totalPatrons}</p>
                  </div>
                  <div className="bars-wrap">
                    <h4>Tier Distribution</h4>
                    {agentStats.tierBreakdown.map((row) => {
                      const max = agentStats.tierBreakdown[0]?.value || 1;
                      const width = Math.round((row.value / max) * 100);
                      return (
                        <div className="bar-row" key={`tier-${row.label}`}>
                          <span>{row.label}</span>
                          <div className="bar-track">
                            <div className="bar-fill tier" style={{ width: `${width}%` }} />
                          </div>
                          <em>{row.value}</em>
                        </div>
                      );
                    })}
                    <h4>Game Preference</h4>
                    {agentStats.gameBreakdown.map((row) => {
                      const max = agentStats.gameBreakdown[0]?.value || 1;
                      const width = Math.round((row.value / max) * 100);
                      return (
                        <div className="bar-row" key={`game-${row.label}`}>
                          <span>{row.label}</span>
                          <div className="bar-track">
                            <div className="bar-fill game" style={{ width: `${width}%` }} />
                          </div>
                          <em>{row.value}</em>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="impact-foot">
                  <span className="metric-chip">Avg ADT {formatAmount(agentStats.avgMatchedAdt)}</span>
                  <span className="metric-chip">Matched {formatAmount(agentStats.matchedPatrons)}</span>
                </div>
              </div>
            ) : null}
            <div className="recommendation-strip">
              <h3>Latest Recommendations</h3>
              <div className="recommendation-list">
                {topRecommendations.map((rec) => (
                  <div className="recommendation-card" key={rec.recommendationId}>
                    <strong>
                      {rec.patronId} - {rec.offerId}
                    </strong>
                    <span>
                      {rec.status} | score {rec.relevanceScore.toFixed(3)} | conf {rec.confidence.toFixed(3)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </article>
        </section>
      </div>
    </main>
  );
}
