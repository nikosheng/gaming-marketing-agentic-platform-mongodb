"""MongoDB collection name constants (mirrors ``src/web/collections.ts``)."""

from __future__ import annotations

from typing import Final


class WebCollections:
    """Collection names used across the application."""

    patrons: Final[str] = "patron_profiles"
    tables: Final[str] = "table_state_snapshots"
    sessions: Final[str] = "patron_table_sessions"
    offers: Final[str] = "offer_catalog"
    recommendations: Final[str] = "offer_recommendations"
    risk_cases: Final[str] = "patron_risk_cases"
    pr_agents: Final[str] = "pr_agent_profiles"
    pr_assignments: Final[str] = "pr_assignments"
    table_state_history: Final[str] = "table_state_history"
    min_bet_recommendations: Final[str] = "table_minbet_recommendations"
    min_bet_audit: Final[str] = "table_minbet_audit"
    offer_approval_audit: Final[str] = "offer_approval_audit"
    # Alert Dashboard
    alert_rules: Final[str] = "alert_rules"
    patron_alerts: Final[str] = "patron_alerts"
    table_round_history: Final[str] = "table_round_history"
    table_round_counters: Final[str] = "table_round_counters"
    # Patron History Analysis
    patron_interactions: Final[str] = "patron_interaction_history"
    patron_analysis_reports: Final[str] = "patron_analysis_reports"
    # PR Efficiency
    pr_kpi_searches: Final[str] = "pr_kpi_searches"


web_collections = WebCollections()
