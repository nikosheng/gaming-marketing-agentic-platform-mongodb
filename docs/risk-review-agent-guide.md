# Risk Review Agentic Flow: Comprehensive Technical Guidance

This guide provides an in-depth explanation of the **Risk Review Agentic Flow**, a sophisticated multi-agent system designed to evaluate patron risk profiles. It details the scoring algorithms, behavioral proxies for financial health, and the logic used to identify regulatory risks without direct access to patron financial records.

---

## 1. Workflow Architecture & Node Responsibilities
The workflow is implemented as a state-managed graph in [risk-case-agent.ts](file:///Users/nikofeng/Documents/Github/macau-gaming-marketing-ai-project/src/web/risk-case-agent.ts). It ensures every high-potential patron undergoes a rigorous compliance check before being assigned to a Public Relations (PR) agent.

### **The Graph Nodes:**
1.  **`initialize_case`**: Creates the initial [PatronRiskCase](file:///Users/nikofeng/Documents/Github/macau-gaming-marketing-ai-project/src/types.ts#L187-L205) record. It snapshots the patron's current profile (tier, ADT) and active session data to ensure the audit trail reflects the state of the world at the moment of review.
2.  **`evaluate_loss_chasing`**: The "Heat" detection node. It analyzes real-time betting velocity to determine if a patron is exhibiting "tilting" behavior or chasing losses.
3.  **`evaluate_financial_credit_aml`**: The financial stability node. It uses historical activity data to infer the patron's current wealth capacity and identifies red flags like money laundering (AML) signals.
4.  **`risk_escalation_router`**: A logic gate that derives the final [RiskLevel](file:///Users/nikofeng/Documents/Github/macau-gaming-marketing-ai-project/src/types.ts#L25) and [EscalationTier](file:///Users/nikofeng/Documents/Github/macau-gaming-marketing-ai-project/src/types.ts#L28).
    *   **Senior Admin**: Required for `Critical` risk or high AML scores.
    *   **Standard Admin**: For routine approvals.
5.  **`await_admin_review`**: A **Human-in-the-Loop** gate. The process halts here until an admin provides a manual rationale and decision (`Approve`, `Reject`, or `RequestMoreInfo`).
6.  **`assign_pr_agent`**: Post-approval, this node executes a matching algorithm. It selects the best-fit PR host based on current capacity, language preferences, and patron tier specialty.
7.  **`finalize_case`**: Records the final terminal status (`Assigned` or `Rejected`) and closes the case.

---

## 2. Loss Chasing Agent: "Heat" Detection Logic
The [LossChasingAssessment](file:///Users/nikofeng/Documents/Github/macau-gaming-marketing-ai-project/src/types.ts#L119-L125) measures behavioral volatility. The score (0.0 - 1.0) is calculated using a weighted formula:
- **Session Intensity (45%)**: Normalized against a $40,000 threshold.
- **ADT Signal (30%)**: Normalized against a $35,000 peak history.
- **Behavior Pattern (25%)**: Aggressive (0.9), PromoSeeker (0.65), Neutral (0.35).

### **Score Ranges & Meaning**
| Range (%) | Label | Business Description |
| :--- | :--- | :--- |
| **72% - 100%** | **Likely** | **Critical Concern**. High-intensity betting and aggressive behavior markers indicate a strong probability of "tilting" or loss-chasing. Immediate intervention is required. |
| **50% - 71%** | **Borderline** | **Moderate Concern**. Mixed signals; the patron is playing significantly above their baseline but hasn't reached a breaking point. Requires cross-referencing with AML findings. |
| **0% - 49%** | **Unlikely** | **Low Concern**. Betting patterns are consistent with leisure play and historical behavior. No immediate signs of behavioral distress. |

---

## 3. Financial AML Agent: Risk Identification Logic
The [FinancialAssessment](file:///Users/nikofeng/Documents/Github/macau-gaming-marketing-ai-project/src/types.ts#L138-L145) identifies financial distress and potential money laundering (AML) using behavioral red flags.

### **The AML Risk Score (0.0 - 1.0)**
The score is accumulated based on the presence of specific risk triggers:
- **High Variance (+0.25)**: Significant spend spikes vs historical baseline.
- **Frequent Cashout (+0.28)**: Potential indicator of money laundering or chip-washing.
- **Promo Sensitivity (+0.12)**: Behavior primarily driven by incentives rather than leisure.
- **Points Balance (+0.18)**: High volume of unredeemed loyalty points (over 80,000).

### **Risk Ranges & Meaning (Source of Funds)**
| Range (%) | Risk Label | Business Description |
| :--- | :--- | :--- |
| **68% - 100%** | **High** | **Severe Anomaly**. Highly suspicious financial patterns. Indicates a potential mismatch between spend and legitimate income. **Mandatory escalation to Senior Admin.** |
| **40% - 67%** | **Medium** | **Notable Variance**. Patterns deviate from the historical norm. Requires manual validation of "Source of Funds" before PR host engagement. |
| **0% - 39%** | **Low** | **Stable Profile**. Financial patterns are within expected leisure variance. No significant AML red flags detected. |

---

## 4. Deep Dive: Income Consistency Logic

### **The Problem: Direct Income Gap**
Casinos rarely have access to a patron's bank statements or tax returns. Therefore, the platform cannot calculate a "Debt-to-Income" ratio directly.

### **The Solution: The Behavioral Proxy Model**
Instead of looking at a paycheck, the agent looks at the **Volatility of Theoretical Spend**. It uses the patron's own history as the benchmark for their "Income Level." This is known as the **"In-System Income Model."**

### **The Calculation: Historical Max Buy-in**
The system identifies the **Historical Max Buy-in** to create a personalized financial ceiling for every patron.

1.  **Data Source**: The agent scans the `activities` array in the [patron_profiles](file:///Users/nikofeng/Documents/Github/macau-gaming-marketing-ai-project/src/types.ts#L32) collection for [ChipExchange](file:///Users/nikofeng/Documents/Github/macau-gaming-marketing-ai-project/src/types.ts#L7) events.
2.  **Aggregation**: It finds the `MAX(amount)` across all Buy-in events in the last 12 months.
3.  **Multiplier (The "Gaming Wallet")**: The system sets a threshold, typically **2.0x** the Historical Max. This allows for natural growth in a patron's wealth while flagging suspicious spikes.
4.  **Identification**: If the current session's buy-in exceeds this `2.0x` ceiling, the `incomePatternConsistent` check is marked as **FAILED**.

### **Why this identifies Financial Risk:**
*   **Money Laundering**: If a patron who usually plays for $500 suddenly buys in for $50,000, where did the money come from? This "Wealth Injection" is a primary AML red flag.
*   **Financial Distress**: Spending 10x more than their established "comfort zone" is a leading indicator of problem gambling and potential credit default.

### **Enriched Sample Coding Implementation**
This logic, used to derive the `highVariance` flag in the [scoreFinancialRisk](file:///Users/nikofeng/Documents/Github/macau-gaming-marketing-ai-project/src/web/risk-case-agent.ts#L39) function:

```typescript
/**
 * Core Logic to derive 'highVariance' (Income Inconsistency)
 */
function calculateIncomeConsistency(patron: PatronProfile, currentSessionBuyIn: number) {
  // 1. Filter only ChipExchange (Buy-in) events from the rolling 12 months
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  const buyInHistory = patron.activities.filter(act => 
    act.activityType === "ChipExchange" && 
    new Date(act.eventTime) >= oneYearAgo
  );

  // 2. Identify the Historical Max Buy-in (The Baseline)
  const historicalMax = buyInHistory.length > 0 
    ? Math.max(...buyInHistory.map(a => a.amount)) 
    : 0;

  // 3. Define the Variance Threshold (The Personalized Ceiling)
  const threshold = historicalMax * 2.0;

  // 4. Trigger the Flag if current spend > 2x historical max
  const isHighVariance = currentSessionBuyIn > threshold;

  return {
    baseline: historicalMax,
    ceiling: threshold,
    isHighVariance, // Maps to the !passed state in the compliance checklist
    riskNotes: isHighVariance 
      ? `FLAG: Patron is spending ${ (currentSessionBuyIn/historicalMax).toFixed(1) }x their historical max.` 
      : "Spend is consistent with wealth profile."
  };
}
```

---

## 5. Detailed Patron Profile Case Studies

### **Scenario A: The Consistent VIP (System: PASSED)**
*   **Patron**: [P-000888](file:///Users/nikofeng/Documents/Github/macau-gaming-marketing-ai-project/src/types.ts#L32) - "John Doe" (Diamond Tier)
*   **Historical Profile**: Regularly buys in for $30,000 - $50,000.
*   **Historical Max Buy-in**: $50,000.
*   **Current Session Buy-in**: $65,000.
*   **The Calculation**: `Threshold = $50,000 * 2.0 = $100,000`.
*   **Outcome**: **PASSED**. Even though $65,000 is a large sum, it is **consistent** with John's known financial capacity. He is categorized as a "Stable High Roller."

### **Scenario B: The High-Risk Spike (System: FAILED)**
*   **Patron**: [P-000123](file:///Users/nikofeng/Documents/Github/macau-gaming-marketing-ai-project/src/types.ts#L32) - "Jane Smith" (Silver Tier)
*   **Historical Profile**: Average buy-in of $200. Highest ever seen is $2,000.
*   **Historical Max Buy-in**: $2,000.
*   **Current Session Buy-in**: $15,000.
*   **The Calculation**: `Threshold = $2,000 * 2.0 = $4,000`.
*   **Outcome**: **FAILED (Critical Risk)**. Jane is spending **7.5x** her historical max.
*   **Risk Rationale**: The agent identifies this as a "Sudden Wealth Injection." It flags the case for the **Senior Admin** queue to verify the source of these funds before Jane is allowed to continue or receive PR attention.

---

## 6. Audit & Regulatory Value
This agentic flow ensures that every PR assignment is backed by a deterministic risk assessment. The [RiskCaseTimelineEvent](file:///Users/nikofeng/Documents/Github/macau-gaming-marketing-ai-project/src/types.ts#L172-L185) creates an immutable audit trail. In the event of a regulatory audit, the casino can prove that it evaluated both **Play Intensity** and **Financial Consistency** using automated agents and human oversight.
