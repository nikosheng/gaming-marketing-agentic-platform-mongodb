import { faker } from "@faker-js/faker";
import { config } from "../config.js";
import type {
  CampaignRun,
  ChatMessage,
  ChatSession,
  OfferCatalog,
  OfferRecommendation,
  PatronActivityEvent,
  PatronProfile,
  PatronTableSession,
  TableGameType,
  TableStateSnapshot,
} from "../types.js";

const gameTypes: TableGameType[] = ["Baccarat", "Blackjack", "Roulette", "SicBo", "Poker"];
const zones = ["A", "B", "C", "VIP"];

function randomEmbedding() {
  return Array.from({ length: config.vectorEmbeddingDim }, () =>
    Number(faker.number.float({ min: -1, max: 1, fractionDigits: 6 }))
  );
}

function buildPatronId(index: number): string {
  return `P-${String(index + 1).padStart(6, "0")}`;
}

function buildTableId(index: number): string {
  return `T-${String(index + 1).padStart(4, "0")}`;
}

export function generatePatrons(count: number): PatronProfile[] {
  const tiers: PatronProfile["tier"][] = ["Bronze", "Silver", "Gold", "Platinum", "Diamond"];
  return Array.from({ length: count }, (_, i) => {
    const name = faker.person.fullName();
    const first = name.slice(0, 1);
    return {
      patronId: buildPatronId(i),
      name,
      maskedName: `${first}***${faker.string.alphanumeric({ length: 2, casing: "upper" })}`,
      tier: faker.helpers.arrayElement(tiers),
      adt: faker.number.int({ min: 800, max: 35000 }),
      preferredGames: faker.helpers.arrayElements(gameTypes, { min: 1, max: 3 }),
      riskFlags: faker.helpers.arrayElements(
        ["None", "HighVariance", "FrequentCashout", "NightOnly", "PromoSensitive"],
        { min: 1, max: 2 }
      ),
      pointsBalance: faker.number.int({ min: 200, max: 120000 }),
      lastActiveAt: faker.date.recent({ days: 7 }),
      preferenceEmbedding: randomEmbedding(),
      createdAt: faker.date.past({ years: 2 }),
      updatedAt: new Date(),
    };
  });
}

export function generateTables(count: number): TableStateSnapshot[] {
  return Array.from({ length: count }, (_, i) => {
    const minBet = faker.number.int({ min: 100, max: 2000 });
    return {
      tableId: buildTableId(i),
      tableName: `Table ${i + 1}`,
      zone: faker.helpers.arrayElement(zones),
      gameType: faker.helpers.arrayElement(gameTypes),
      minBet,
      maxBet: minBet * faker.number.int({ min: 20, max: 100 }),
      status: faker.helpers.arrayElement(["Open", "Busy", "Closed"] as const),
      patronCount: faker.number.int({ min: 0, max: 9 }),
      avgBetAmount: faker.number.int({ min: 100, max: 20000 }),
      occupancyRate: faker.number.float({ min: 0, max: 1, fractionDigits: 3 }),
      refreshedAt: new Date(),
    };
  });
}

export function generateSessions(
  patrons: PatronProfile[],
  tables: TableStateSnapshot[]
): PatronTableSession[] {
  const sessions: PatronTableSession[] = [];
  for (const patron of patrons) {
    if (faker.datatype.boolean(0.62)) {
      const table = faker.helpers.arrayElement(tables);
      const seatedAt = faker.date.recent({ days: 1 });
      sessions.push({
        patronId: patron.patronId,
        tableId: table.tableId,
        seatedAt,
        lastActionAt: faker.date.between({ from: seatedAt, to: new Date() }),
        sessionBetAmount: faker.number.int({ min: 200, max: 40000 }),
        currentStackEstimate: faker.number.int({ min: 100, max: 100000 }),
        behaviorTags: faker.helpers.arrayElements(
          ["Aggressive", "Conservative", "LateNight", "CardCounterWatch", "PromoSeeker"],
          { min: 1, max: 2 }
        ),
        isActive: true,
      });
    }
  }
  return sessions;
}

export function generateActivities(patrons: PatronProfile[], countPerPatron = 12): PatronActivityEvent[] {
  const events: PatronActivityEvent[] = [];
  const activityTypes = [
    "ChipExchange",
    "TableBet",
    "PointsRedeem",
    "ShowPurchase",
    "HotelBooking",
    "DrinkRedeem",
  ] as const;
  for (const patron of patrons) {
    for (let i = 0; i < countPerPatron; i += 1) {
      const type = faker.helpers.arrayElement(activityTypes);
      const source =
        type === "ChipExchange"
          ? "Cage"
          : type === "DrinkRedeem"
            ? "POS"
            : type === "PointsRedeem"
              ? "Loyalty"
              : "TableSystem";
      events.push({
        eventId: faker.string.uuid(),
        patronId: patron.patronId,
        activityType: type,
        source,
        amount: faker.number.int({ min: 50, max: 50000 }),
        pointsDelta:
          type === "PointsRedeem"
            ? -faker.number.int({ min: 200, max: 2000 })
            : faker.number.int({ min: 20, max: 1500 }),
        metadata: {
          venue: faker.helpers.arrayElement(["MainFloor", "VIPLounge", "Theater", "Hotel"]),
          channel: faker.helpers.arrayElement(["InPerson", "Mobile", "HostDesk"]),
          isVip: patron.tier === "Platinum" || patron.tier === "Diamond",
        },
        activityEmbedding: randomEmbedding(),
        eventTime: faker.date.recent({ days: 14 }),
      });
    }
  }
  return events.sort((a, b) => b.eventTime.getTime() - a.eventTime.getTime());
}

export function generateOfferCatalog(): OfferCatalog[] {
  const now = new Date();
  const items: Array<{ title: string; offerType: OfferCatalog["offerType"]; description: string }> = [
    {
      title: "Premium Hotel Suite - 1 Night",
      offerType: "HotelRoom",
      description: "Complimentary one-night stay in premium suite for high-value patrons.",
    },
    {
      title: "Music Show VIP Ticket Pair",
      offerType: "MusicShowTicket",
      description: "Two VIP tickets for partner entertainment events.",
    },
    {
      title: "2x Limited-Time Point Redemption",
      offerType: "PointsLimitedTime",
      description: "Short-window 2x value for loyalty point redemption.",
    },
    {
      title: "Lounge Beverage Voucher",
      offerType: "FNBVoucher",
      description: "Lounge drink package for active table patrons.",
    },
  ];

  return items.map((item, index) => ({
    offerId: `OFFER-${String(index + 1).padStart(4, "0")}`,
    offerType: item.offerType,
    title: item.title,
    description: item.description,
    eligibilityRules: [
      "adt >= 1000",
      "lastActiveAt <= 7 days",
      "riskFlags does not include ResponsibleGamingHold",
    ],
    estimatedCost: faker.number.int({ min: 80, max: 1500 }),
    targetGameTypes: faker.helpers.arrayElements(gameTypes, { min: 1, max: 3 }),
    priority: 100 - index * 10,
    status: "Active",
    offerEmbedding: randomEmbedding(),
    createdAt: now,
    updatedAt: now,
  }));
}

export function generateRecommendations(
  patrons: PatronProfile[],
  offers: OfferCatalog[],
  countPerPatron = 2
): OfferRecommendation[] {
  const output: OfferRecommendation[] = [];
  for (const patron of patrons) {
    const chosen = faker.helpers.arrayElements(offers, countPerPatron);
    for (const offer of chosen) {
      output.push({
        recommendationId: faker.string.uuid(),
        patronId: patron.patronId,
        offerId: offer.offerId,
        reasonSummary: `${patron.tier} patron with ADT ${patron.adt} and recent activity match.`,
        relevanceScore: faker.number.float({ min: 0.6, max: 0.99, fractionDigits: 3 }),
        confidence: faker.number.float({ min: 0.55, max: 0.98, fractionDigits: 3 }),
        nextBestAction: faker.helpers.arrayElement([
          "Send offer now",
          "Let host call patron",
          "Bundle with hotel package",
        ]),
        status: faker.helpers.arrayElement(["Proposed", "Approved", "Sent"] as const),
        generatedBy: faker.helpers.arrayElement(["RuleEngine", "LLM"] as const),
        generatedAt: faker.date.recent({ days: 2 }),
        expiresAt: faker.date.soon({ days: 7 }),
      });
    }
  }
  return output;
}

export function generateCampaigns(
  offers: OfferCatalog[],
  patrons: PatronProfile[],
  count = 3
): CampaignRun[] {
  return Array.from({ length: count }, (_, i) => {
    const targetPatrons = faker.helpers.arrayElements(
      patrons.map((p) => p.patronId),
      faker.number.int({ min: 20, max: 80 })
    );
    const selectedOffers = faker.helpers.arrayElements(
      offers.map((o) => o.offerId),
      faker.number.int({ min: 1, max: 3 })
    );
    const startAt = faker.date.recent({ days: 3 });
    return {
      campaignId: `CMP-${String(i + 1).padStart(4, "0")}`,
      name: faker.helpers.arrayElement([
        "Weekend VIP Reactivation",
        "High Roller Night Push",
        "Theater Bundle Upsell",
      ]),
      goal: faker.helpers.arrayElement(["Retention", "Upsell", "CrossSell", "Reactivation"] as const),
      segmentCriteria: ["tier in [Gold, Platinum, Diamond]", "adt >= 3000", "active in past 7 days"],
      includedOfferIds: selectedOffers,
      targetPatronIds: targetPatrons,
      startAt,
      endAt: faker.date.soon({ days: 10, refDate: startAt }),
      status: faker.helpers.arrayElement(["Planned", "Running", "Completed"] as const),
      metrics: {
        sent: targetPatrons.length,
        accepted: faker.number.int({ min: 0, max: Math.floor(targetPatrons.length * 0.45) }),
        redemptionValue: faker.number.int({ min: 10000, max: 200000 }),
      },
    };
  });
}

export function generateChatData(
  patrons: PatronProfile[],
  recommendationCount = 60
): { sessions: ChatSession[]; messages: ChatMessage[] } {
  const sessions: ChatSession[] = [];
  const messages: ChatMessage[] = [];

  for (let i = 0; i < recommendationCount; i += 1) {
    const sessionId = faker.string.uuid();
    const patron = faker.helpers.arrayElement(patrons);
    const startedAt = faker.date.recent({ days: 2 });
    sessions.push({
      sessionId,
      channel: "WebAdmin",
      marketingUserId: `MKT-${faker.number.int({ min: 1, max: 25 })}`,
      patronContextIds: [patron.patronId],
      startedAt,
      lastMessageAt: faker.date.between({ from: startedAt, to: new Date() }),
      state: faker.helpers.arrayElement(["Open", "Closed"] as const),
    });

    const userPromptId = faker.string.uuid();
    messages.push({
      sessionId,
      messageId: userPromptId,
      role: "user",
      content: `Summarize ${patron.patronId} and recommend next offer.`,
      model: "n/a",
      agentName: "marketing_user",
      references: [patron.patronId],
      createdAt: startedAt,
    });

    messages.push({
      sessionId,
      messageId: faker.string.uuid(),
      role: "assistant",
      content:
        "Patron is active on baccarat and table bet volume is high. Recommend hotel+ticket bundle and host outreach.",
      model: "gpt-5.1-mini",
      agentName: "offer_strategist_agent",
      references: [patron.patronId, userPromptId],
      createdAt: faker.date.between({ from: startedAt, to: new Date() }),
    });
  }

  return { sessions, messages };
}
