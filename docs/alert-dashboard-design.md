# Alert Dashboard — 設計文檔

> 高價值用戶自然語言搜索 + 即時 Alert 系統

---

## 功能概覽

用戶在 **Alert Dashboard** 用自然語言描述「目標賭客畫像」，AI 自動識別描述中的條件類型並提取數值參數，生成一條可執行的 Alert 規則。每次在任一 Table 的 Drill-down 點擊 **Simulate Round**，後端注入一輪確定性測試下注資料，並對所有 Active 規則執行 MongoDB 聚合分析（MQL）。命中的賭客即時推入 Alert Dashboard 的 Alert Feed。

---

## 架構圖

```
用戶輸入 NL 描述
        ↓
POST /api/alert-rules { action: "preview" }
        ↓
[LangGraph: alert-rule-agent.ts]
  parse_intent → LLM (Azure OpenAI fetch)
    • System prompt 注入 CONDITION_CATALOG
    • LLM 識別條件類型 + 提取數值參數
    • 返回 JSON: { matchedConditions, ruleName, needsClarification }
  map_conditions → 校驗類型、補全默認值、clamp 範圍
  validate → 生成 AlertRulePreview（不寫 DB）
        ↓
前端顯示 Preview 卡（條件 + 信心度條）
        ↓ 用戶確認
POST /api/alert-rules { action: "confirm", preview }
        ↓ 寫入 alert_rules collection
        ↓
[Drill-down Drawer → Simulate Round 按鈕]
POST /api/tables/[tableId]/simulate-round
  1. 遞增 table_round_counters.roundNumber
  2. Upsert 5 個測試 patron 到 patron_profiles
  3. 注入確定性 + 隨機 sessions
  4. 寫入 table_round_history（含 adt/tier 快照）
  5. 讀取所有 Active alert_rules
  6. Promise.all 並行對每條規則執行 MQL Executor
     (OR 邏輯：任一條件命中即觸發)
  7. JOIN patron_profiles 取完整快照
  8. （Optional）Azure OpenAI 生成 llmRationale
  9. 批量寫入 patron_alerts
  10. 更新 alert_rules.totalTriggered
        ↓
GET /api/alerts → Alert Dashboard 展示
```

---

## 核心設計決策

| 決策 | 原因 |
|------|------|
| NL → LLM → 預設條件庫映射（不做自由 MQL 生成） | 安全可控；LLM 只能選用後台預設的 6 種條件類型，不會生成任意查詢 |
| 多條件 **OR 邏輯** | 廣撒網，任一條件命中即提醒，不漏掉高價值賭客 |
| 兩步流程：preview → confirm | 用戶確認 LLM 解析結果後才寫 DB，避免誤操作 |
| `table_round_history` 快照 adt/tier/behaviorTags | 分析時無需 $lookup patron_profiles，查詢更快 |
| 測試 patron 確定性 bet 序列 | Demo 完全可重現，第1輪觸發 ADT spike，第3輪觸發連續下注，第5輪觸發累計 |
| LLM rationale 為 Optional | 無 Azure OpenAI key 時系統正常運行，rationale 欄位留空 |
| LLM fallback：503 錯誤（不降級 regex） | 明確告知用戶需配置 LLM，避免靜默失敗 |

---

## 預設條件目錄（CONDITION_CATALOG）

後台固定 6 種原子條件，LLM 只能從這 6 種中選擇，不能發明新類型。

| ConditionType | 中文名 | 參數 | 示例 NL |
|---|---|---|---|
| `CONSECUTIVE_ROUNDS_BET_THRESHOLD` | 連續N輪下注超閾值 | `rounds`(2-10), `threshold`(港幣) | "連續3輪每輪超過10000" |
| `CUMULATIVE_ROUNDS_BET_THRESHOLD` | N輪累計下注超閾值 | `rounds`(2-20), `totalThreshold`(港幣) | "5輪累計超5萬" |
| `SINGLE_ROUND_ADT_MULTIPLIER` | 單輪下注超ADT倍數 | `multiplier`(1.5-50) | "超個人ADT 5倍" |
| `SESSION_BET_ABOVE` | 本場累計下注超閾值 | `threshold`(港幣) | "本場超3萬" |
| `TIER_MATCH` | Tier 級別篩選 | `tiers`(string[]) | "Gold以上賭客" |
| `BEHAVIOR_TAG_MATCH` | 行為標籤篩選 | `tags`(string[]) | "激進下注行為" |

### LLM 動態參數提取示例

```
輸入: "找到連續下注3輪每輪超過20000港幣的賭客"

LLM 輸出:
{
  "matchedConditions": [{
    "type": "CONSECUTIVE_ROUNDS_BET_THRESHOLD",
    "confidence": 0.96,
    "extractedParams": { "rounds": 3, "threshold": 20000 }
  }],
  "ruleName": "連續3輪高額下注-20K"
}

→ MQL 查詢使用 threshold: 20000（而非預設 10000）
```

```
輸入: "找5輪累計超過10萬的白金以上賭客"

LLM 輸出:
{
  "matchedConditions": [
    { "type": "CUMULATIVE_ROUNDS_BET_THRESHOLD",
      "extractedParams": { "rounds": 5, "totalThreshold": 100000 } },
    { "type": "TIER_MATCH",
      "extractedParams": { "tiers": ["Platinum", "Diamond"] } }
  ]
}
→ OR 邏輯：任一條件命中即觸發
```

---

## MongoDB Collections

### `alert_rules`
```typescript
{
  ruleId: string,          // "RULE-1748521234567"
  name: string,            // LLM 生成（繁中，≤15字）
  nlDescription: string,   // 用戶原始 NL 輸入
  conditions: ParsedCondition[],
  conditionLogic: "OR",
  status: "Active" | "Paused",
  totalTriggered: number,
  lastTriggeredAt?: Date,
  createdAt: Date
}
```

### `table_round_history`（TTL: 7天）
```typescript
{
  tableId: string,
  roundNumber: number,     // 每張 table 獨立遞增
  patronId: string,
  betAmount: number,
  adt: number,             // 快照自 patron_profiles
  tier: string,            // 快照
  behaviorTags: string[],  // 快照
  maskedName: string,      // 快照
  recordedAt: Date
}
```

### `patron_alerts`（TTL: 30天）
```typescript
{
  alertId: string,
  ruleId: string,
  ruleName: string,
  patronId: string,
  tableId: string,
  triggeredConditions: Array<{
    type: ConditionType,
    evidence: Record<string, unknown>  // 具體觸發數值
  }>,
  patronSnapshot: {
    maskedName, tier, adt, behaviorTags, riskFlags, preferredGames
  },
  tableSnapshot: { tableName, gameType, zone },
  llmRationale?: string,
  status: "New" | "Acknowledged",
  triggeredAt: Date
}
```

### `table_round_counters`
```typescript
{ tableId: string, roundNumber: number }
```

---

## API 路由

| Method | Route | 說明 |
|---|---|---|
| `GET` | `/api/alert-rules` | 獲取所有規則（首次自動 seed 3 條模板）|
| `POST` | `/api/alert-rules` `{action:"preview"}` | NL → LLM 解析 → 返回 Preview（不寫 DB）|
| `POST` | `/api/alert-rules` `{action:"confirm"}` | 確認 Preview → 寫入 alert_rules |
| `PATCH` | `/api/alert-rules/[ruleId]` | 切換 Active/Paused |
| `GET` | `/api/alerts` | 獲取 Alert Feed（最新 50 條）|
| `POST` | `/api/tables/[tableId]/simulate-round` | 注入本輪 sessions + 並行 MQL 分析 |
| `GET` | `/api/tables/[tableId]/simulate-round` | 獲取當前輪次號 |

---

## 測試 Patron 設計

系統自動 upsert 5 個測試 patron，每次 simulate-round 均注入**確定性 bet 序列**：

| PatronId | Tier | ADT | 用途 | 觸發輪次 |
|---|---|---|---|---|
| `TEST-S1-P1` | Gold | 8,500 | 連續3輪高額下注（CONSECUTIVE） | Round 3+ |
| `TEST-S1-P2` | Bronze | 2,000 | 對照組（不觸發） | 永不觸發 |
| `TEST-S2-P1` | Silver | 5,200 | 5輪累計超5萬（CUMULATIVE） | Round 5+ |
| `TEST-S3-P1` | Bronze | 3,000 | ADT spike（每輪 bet=18,000 > 3,000×5=15,000）| Round 1+ |
| `TEST-S3-P2` | Silver | 3,000 | 對照組（bet=10,000 < 15,000，不觸發）| 永不觸發 |

**bet 序列（以 roundNumber % 10 取值）：**

```typescript
TEST-S1-P1: [12000, 15500, 11200, 5000, 8000, 12000, 15500, 11200, 5000, 8000]
// Rounds 1-3: 每輪 > 10000 → Round 3 觸發 CONSECUTIVE
// Rounds 4-5: 低於 10000 → 重設連續計數

TEST-S2-P1: [8000, 9500, 12000, 14000, 11000, 8000, 9500, 12000, 14000, 11000]
// 5 輪累計 = 54,500 > 50,000 → Round 5 觸發 CUMULATIVE

TEST-S3-P1: [18000, ×10] → 每輪 18,000 > ADT(3,000) × 5 = 15,000 → Round 1 即觸發
```

---

## Demo 操作路徑

```
Step 1: 進入 Alert Dashboard（左側 sidebar）
        → 看到 3 條模板（點擊「使用此模板」填入輸入框）

Step 2: 輸入 NL 描述，點「AI 解析並預覽」
        → 看到 Preview 卡：條件類型 + 提取的數值 + 信心度條
        → 點「確認創建規則」→ 規則出現在 Active Rules 列表

Step 3: 切換到 Patron Eyes，打開任一 table

Step 4: 在 Drawer 底部找到「輪次模擬 & Alert 分析」區塊
        → 顯示 Round #0
        → 點「▶ Simulate Round」

Step 5: Round #1 執行後
        → TEST-S3-P1（ADT spike）立即觸發
        → 看到「觸發 1 條 Alert」 + 「查看 Alert Dashboard →」按鈕

Step 6: 繼續點擊至 Round #3
        → TEST-S1-P1 觸發（連續3輪高額下注）

Step 7: 繼續點擊至 Round #5
        → TEST-S2-P1 觸發（5輪累計超5萬）

Step 8: Alert Dashboard 顯示所有觸發的 Alert Card，包含：
        - 賭客完整信息（姓名、Tier、ADT、行為標籤）
        - 觸發的具體下注記錄（每輪金額）
        - LLM 生成的中文服務建議（需配置 Azure OpenAI）
        - 當前所在桌台信息（方便安排服務人員）
```

---

## 環境變量配置

```bash
# 必須（MongoDB）
MONGODB_URI=mongodb+srv://...
MONGODB_DB=casino_marketing_demo

# LLM NL 解析（必須配置才能使用 NL → 條件映射功能）
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_API_KEY=your-key
AZURE_OPENAI_DEPLOYMENT=gpt-4o-mini       # 推薦：成本低且效果好
AZURE_OPENAI_API_VERSION=2024-08-01-preview

# LangSmith 追蹤（可選）
LANGCHAIN_TRACING_V2=true
LANGCHAIN_API_KEY=...
LANGCHAIN_PROJECT=macau-gaming-marketing
```

> ⚠️ 若未配置 `AZURE_OPENAI_ENDPOINT`/`AZURE_OPENAI_API_KEY`，點擊「AI 解析並預覽」時前端會顯示配置提示（503 錯誤）。三條預設模板規則不受影響，可直接 seed 並使用。

---

## 新增文件清單

| 文件 | 說明 |
|---|---|
| `src/types.ts` | 新增 `ConditionType`, `ParsedCondition`, `AlertRule`, `TableRoundSnapshot`, `PatronAlert`, `AlertRulePreview` |
| `src/web/collections.ts` | 新增 `alertRules`, `patronAlerts`, `tableRoundHistory`, `tableRoundCounters` |
| `src/modeling/indexes.ts` | 新增 indexes + TTL（patronAlerts 30天，tableRoundHistory 7天）|
| `src/web/condition-catalog.ts` | 6 種原子條件定義 + LLM system prompt builder + 3 條 seed 模板 |
| `src/web/alert-rule-agent.ts` | 4 節點 LangGraph：parse_intent → map_conditions → validate → persist_rule |
| `src/web/alert-analyzer.ts` | 6 個 MQL Executor + OR 邏輯聚合 + LLM rationale 生成 |
| `app/api/alert-rules/route.ts` | GET（rules list）+ POST（preview / confirm）|
| `app/api/alert-rules/[ruleId]/route.ts` | PATCH（切換 Active/Paused）|
| `app/api/alerts/route.ts` | GET（alert feed + stats）|
| `app/api/tables/[tableId]/simulate-round/route.ts` | POST（inject + MQL analysis）+ GET（roundNumber）|
| `app/globals.css` | Alert 色系 CSS classes（~400 行）|
| `app/ui/dashboard-client.tsx` | Alert Dashboard section + Simulate Round UI |

---

## MQL Executor 邏輯

每個條件類型對應一個 MongoDB Aggregation Pipeline：

### CONSECUTIVE_ROUNDS_BET_THRESHOLD
```javascript
// 找 [roundNumber-rounds+1, roundNumber] 輪次中
// 每輪都有記錄且 min(betAmount) > threshold 的 patron
{ $match: { tableId, roundNumber: { $gte: from, $lte: to } } },
{ $group: { _id: "$patronId", count: {$sum:1}, minBet: {$min:"$betAmount"}, bets: {$push:...} } },
{ $match: { count: { $gte: rounds }, minBet: { $gt: threshold } } }
```

### CUMULATIVE_ROUNDS_BET_THRESHOLD
```javascript
{ $match: { tableId, roundNumber: { $gte: from, $lte: to } } },
{ $group: { _id: "$patronId", count: {$sum:1}, total: {$sum:"$betAmount"} } },
{ $match: { count: { $gte: rounds }, total: { $gt: totalThreshold } } }
```

### SINGLE_ROUND_ADT_MULTIPLIER
```javascript
// 利用 round_history 中的 adt 快照，無需 $lookup
{ $match: { tableId, roundNumber } },
{ $match: { $expr: { $gt: ["$betAmount", { $multiply: ["$adt", multiplier] }] } } }
```

---

*文檔最後更新：2026-07-29*
