import { ObjectId } from "mongodb";

export type TableGameType = "Baccarat" | "Blackjack" | "Roulette" | "SicBo" | "Poker";
export type TableStatus = "Open" | "Busy" | "Closed";
export type PatronTier = "Bronze" | "Silver" | "Gold" | "Platinum" | "Diamond";
export type ActivityType =
  | "ChipExchange"
  | "TableBet"
  | "PointsRedeem"
  | "ShowPurchase"
  | "HotelBooking"
  | "DrinkRedeem";
export type OfferType = "HotelRoom" | "MusicShowTicket" | "PointsLimitedTime" | "FNBVoucher";
export type OfferStatus = "Draft" | "Active" | "Expired";
export type RecommendationStatus = "Proposed" | "Approved" | "Sent" | "Accepted" | "Rejected";
export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface PatronProfile {
  _id?: ObjectId;
  patronId: string;
  name: string;
  maskedName: string;
  tier: PatronTier;
  adt: number;
  preferredGames: TableGameType[];
  riskFlags: string[];
  pointsBalance: number;
  lastActiveAt: Date;
  preferenceEmbedding: number[];
  createdAt: Date;
  updatedAt: Date;
}

export interface TableStateSnapshot {
  _id?: ObjectId;
  tableId: string;
  tableName: string;
  zone: string;
  gameType: TableGameType;
  minBet: number;
  maxBet: number;
  status: TableStatus;
  patronCount: number;
  avgBetAmount: number;
  occupancyRate: number;
  refreshedAt: Date;
}

export interface PatronTableSession {
  _id?: ObjectId;
  patronId: string;
  tableId: string;
  seatedAt: Date;
  lastActionAt: Date;
  sessionBetAmount: number;
  currentStackEstimate: number;
  behaviorTags: string[];
  isActive: boolean;
}

export interface PatronActivityEvent {
  _id?: ObjectId;
  eventId: string;
  patronId: string;
  activityType: ActivityType;
  source: "TableSystem" | "Cage" | "Loyalty" | "POS";
  amount: number;
  pointsDelta: number;
  metadata: Record<string, string | number | boolean>;
  activityEmbedding: number[];
  eventTime: Date;
}

export interface OfferCatalog {
  _id?: ObjectId;
  offerId: string;
  offerType: OfferType;
  title: string;
  description: string;
  eligibilityRules: string[];
  estimatedCost: number;
  targetGameTypes: TableGameType[];
  priority: number;
  status: OfferStatus;
  offerEmbedding: number[];
  createdAt: Date;
  updatedAt: Date;
}

export interface OfferRecommendation {
  _id?: ObjectId;
  recommendationId: string;
  patronId: string;
  offerId: string;
  reasonSummary: string;
  relevanceScore: number;
  confidence: number;
  nextBestAction: string;
  status: RecommendationStatus;
  generatedBy: "RuleEngine" | "LLM";
  generatedAt: Date;
  expiresAt: Date;
}

export interface CampaignRun {
  _id?: ObjectId;
  campaignId: string;
  name: string;
  goal: "Retention" | "Upsell" | "CrossSell" | "Reactivation";
  segmentCriteria: string[];
  includedOfferIds: string[];
  targetPatronIds: string[];
  startAt: Date;
  endAt: Date;
  status: "Planned" | "Running" | "Completed";
  metrics: {
    sent: number;
    accepted: number;
    redemptionValue: number;
  };
}

export interface ChatSession {
  _id?: ObjectId;
  sessionId: string;
  channel: "WebAdmin";
  marketingUserId: string;
  patronContextIds: string[];
  startedAt: Date;
  lastMessageAt: Date;
  state: "Open" | "Closed";
}

export interface ChatMessage {
  _id?: ObjectId;
  sessionId: string;
  messageId: string;
  role: ChatRole;
  content: string;
  model: string;
  agentName: string;
  references: string[];
  createdAt: Date;
}
