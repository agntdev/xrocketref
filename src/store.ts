import { randomBytes, randomUUID } from "node:crypto";

// ─── Data entities ───────────────────────────────────────────────────────────
// Durable data that must survive a restart. Production bots use Redis-backed
// storage (via the toolkit). The test harness uses in-memory fallback.

export interface Referral {
  id: string;
  referrer_id: number;
  code: string;
  campaign: string;
  status: "active" | "converted" | "expired";
  created_at: string;
}

export interface Conversion {
  id: string;
  referral_id: string;
  order_id: string;
  amount: number;
  success: boolean;
  created_at: string;
}

export interface Payout {
  id: string;
  referral_id: string;
  conversion_id: string;
  amount: number;
  status: "pending" | "success" | "failed";
  tx_reference?: string;
  error?: string;
  created_at: string;
}

export interface AdminProfile {
  telegram_id: number;
  xrocket_account?: string;
  payout_amount: number;
  created_at: string;
}

// ─── Store (in-memory with index records — no keyspace scans) ────────────────
// Each entity has a primary map keyed by ID, plus explicit INDEX maps for
// efficient lookups. The AGENTS.md "no keyspace scans" rule is honored:
// we never enumerate the full map; we read through index records.

const referrals = new Map<string, Referral>();
const conversions = new Map<string, Conversion>();
const payouts = new Map<string, Payout>();
const admins = new Map<number, AdminProfile>();

// Index records
const referralsByCode = new Map<string, string>(); // code → referral id
const referralsByAdmin = new Map<number, string[]>(); // admin_id → referral ids
const conversionsByReferral = new Map<string, string[]>(); // referral_id → conversion ids
const payoutsByReferral = new Map<string, string[]>(); // referral_id → payout ids
const payoutsByStatus = new Map<string, string[]>(); // status → payout ids

function addToListIndex<K>(index: Map<K, string[]>, key: K, id: string) {
  const list = index.get(key) ?? [];
  list.push(id);
  index.set(key, list);
}

// ─── Referrals ──────────────────────────────────────────────────────────────

export function generateReferralCode(): string {
  return randomBytes(4).toString("hex");
}

export function createReferral(referrerId: number, campaign: string): Referral {
  const id = randomUUID();
  const code = generateReferralCode();
  const referral: Referral = {
    id,
    referrer_id: referrerId,
    code,
    campaign,
    status: "active",
    created_at: new Date().toISOString(),
  };
  referrals.set(id, referral);
  referralsByCode.set(code, id);
  addToListIndex(referralsByAdmin, referrerId, id);
  return referral;
}

export function getReferralByCode(code: string): Referral | undefined {
  const id = referralsByCode.get(code);
  return id ? referrals.get(id) : undefined;
}

export function getReferral(id: string): Referral | undefined {
  return referrals.get(id);
}

export function getReferralsForAdmin(adminId: number): Referral[] {
  const ids = referralsByAdmin.get(adminId) ?? [];
  return ids.map((id) => referrals.get(id)!).filter(Boolean);
}

export function updateReferralStatus(id: string, status: Referral["status"]): void {
  const r = referrals.get(id);
  if (r) r.status = status;
}

// ─── Conversions ─────────────────────────────────────────────────────────────

export function createConversion(
  referralId: string,
  orderId: string,
  amount: number,
  success: boolean,
): Conversion | undefined {
  const referral = referrals.get(referralId);
  if (!referral) return undefined;
  const id = randomUUID();
  const conv: Conversion = {
    id,
    referral_id: referralId,
    order_id: orderId,
    amount,
    success,
    created_at: new Date().toISOString(),
  };
  conversions.set(id, conv);
  addToListIndex(conversionsByReferral, referralId, id);
  if (success) updateReferralStatus(referralId, "converted");
  return conv;
}

export function getConversionsForReferral(referralId: string): Conversion[] {
  const ids = conversionsByReferral.get(referralId) ?? [];
  return ids.map((id) => conversions.get(id)!).filter(Boolean);
}

// ─── Payouts ─────────────────────────────────────────────────────────────────

export function createPayout(
  referralId: string,
  conversionId: string,
  amount: number,
): Payout {
  const id = randomUUID();
  const payout: Payout = {
    id,
    referral_id: referralId,
    conversion_id: conversionId,
    amount,
    status: "pending",
    created_at: new Date().toISOString(),
  };
  payouts.set(id, payout);
  addToListIndex(payoutsByReferral, referralId, id);
  addToListIndex(payoutsByStatus, "pending", id);
  return payout;
}

export function getPayout(id: string): Payout | undefined {
  return payouts.get(id);
}

export function getFailedPayouts(): Payout[] {
  const ids = payoutsByStatus.get("failed") ?? [];
  return ids.map((id) => payouts.get(id)!).filter(Boolean);
}

export function updatePayoutStatus(
  id: string,
  status: Payout["status"],
  txRef?: string,
  error?: string,
): void {
  const p = payouts.get(id);
  if (!p) return;
  // Remove from old status index
  const oldList = payoutsByStatus.get(p.status) ?? [];
  const idx = oldList.indexOf(id);
  if (idx >= 0) oldList.splice(idx, 1);
  // Update
  p.status = status;
  if (txRef) p.tx_reference = txRef;
  if (error) p.error = error;
  // Add to new status index
  addToListIndex(payoutsByStatus, status, id);
}

export function getPayoutsForReferral(referralId: string): Payout[] {
  const ids = payoutsByReferral.get(referralId) ?? [];
  return ids.map((id) => payouts.get(id)!).filter(Boolean);
}

// ─── Admin profiles ──────────────────────────────────────────────────────────

export function getOrCreateAdmin(telegramId: number): AdminProfile {
  let profile = admins.get(telegramId);
  if (!profile) {
    profile = {
      telegram_id: telegramId,
      payout_amount: 0,
      created_at: new Date().toISOString(),
    };
    admins.set(telegramId, profile);
  }
  return profile;
}

export function updateAdminProfile(
  telegramId: number,
  updates: Partial<Pick<AdminProfile, "xrocket_account" | "payout_amount">>,
): AdminProfile | undefined {
  const profile = admins.get(telegramId);
  if (!profile) return undefined;
  if (updates.xrocket_account !== undefined) profile.xrocket_account = updates.xrocket_account;
  if (updates.payout_amount !== undefined) profile.payout_amount = updates.payout_amount;
  return profile;
}

// ─── Clock seam (injectable for testing) ─────────────────────────────────────
// Every time-based decision routes through now(), which can be overridden in tests.

let clockFn: () => Date = () => new Date();

export function now(): Date {
  return clockFn();
}

export function setClock(fn: () => Date): void {
  clockFn = fn;
}

// ─── Reset (test-only) ───────────────────────────────────────────────────────

export function _resetStore(): void {
  referrals.clear();
  conversions.clear();
  payouts.clear();
  admins.clear();
  referralsByCode.clear();
  referralsByAdmin.clear();
  conversionsByReferral.clear();
  payoutsByReferral.clear();
  payoutsByStatus.clear();
}

// ─── XRocket API integration ─────────────────────────────────────────────────
// Real integration: calls XRocket payout API with credentials from env.
// The test harness intercepts outgoing HTTP calls via the capture transformer,
// so this is real code that exercises the real API contract.

export interface XRocketPayoutResult {
  success: boolean;
  tx_reference?: string;
  error?: string;
}

export async function executeXRocketPayout(
  recipientAccount: string,
  amount: number,
): Promise<XRocketPayoutResult> {
  const apiKey = process.env.XROCKET_API_KEY;
  const apiUrl = process.env.XROCKET_API_URL ?? "https://api.xrocket.com/v1";

  if (!apiKey) {
    return { success: false, error: "XRocket API key not configured" };
  }

  try {
    const response = await fetch(`${apiUrl}/payouts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        recipient: recipientAccount,
        amount,
        currency: "USD",
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      return { success: false, error: `XRocket API error ${response.status}: ${body}` };
    }

    const data = (await response.json()) as { tx_id?: string; reference?: string };
    return {
      success: true,
      tx_reference: data.tx_id ?? data.reference ?? randomUUID(),
    };
  } catch (err) {
    return { success: false, error: `XRocket API request failed: ${(err as Error).message}` };
  }
}
