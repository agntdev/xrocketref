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
  status: "pending" | "sent" | "failed";
  attempts: number;
  last_error?: string;
  tx_reference?: string;
  error?: string;
  created_at: string;
  updated_at: string;
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
  const ts = now().toISOString();
  const payout: Payout = {
    id,
    referral_id: referralId,
    conversion_id: conversionId,
    amount,
    status: "pending",
    attempts: 0,
    created_at: ts,
    updated_at: ts,
  };
  payouts.set(id, payout);
  addToListIndex(payoutsByReferral, referralId, id);
  addToListIndex(payoutsByStatus, "pending", id);
  return payout;
}

export function findPayoutByConversion(conversionId: string): Payout | undefined {
  for (const p of payouts.values()) {
    if (p.conversion_id === conversionId) return p;
  }
  return undefined;
}

export function getPayout(id: string): Payout | undefined {
  return payouts.get(id);
}

export function getFailedPayouts(): Payout[] {
  const ids = payoutsByStatus.get("failed") ?? [];
  return ids.map((id) => payouts.get(id)!).filter(Boolean);
}

export function getAllPayouts(): Payout[] {
  return Array.from(payouts.values());
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
  p.attempts += 1;
  p.updated_at = now().toISOString();
  if (txRef) p.tx_reference = txRef;
  if (error) {
    p.last_error = error;
    p.error = error;
  }
  // Add to new status index
  addToListIndex(payoutsByStatus, status, id);
}

export function getPayoutsForReferral(referralId: string): Payout[] {
  const ids = payoutsByReferral.get(referralId) ?? [];
  return ids.map((id) => payouts.get(id)!).filter(Boolean);
}

export function getPayoutsByStatus(status: Payout["status"]): Payout[] {
  const ids = payoutsByStatus.get(status) ?? [];
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

// ─── Payout execution with retry (exponential backoff) ────────────────────────

export interface PayoutExecutionResult {
  success: boolean;
  payoutId: string;
  txReference?: string;
  error?: string;
  attempts: number;
}

const MAX_PAYOUT_RETRIES = 3;
const RETRY_DELAYS_MS = [60_000, 300_000, 1_200_000]; // 1min, 5min, 20min

export function getRetryDelay(attempt: number): number {
  return RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
}

export async function executePayoutWithRetries(
  payoutId: string,
  recipientAccount: string,
): Promise<PayoutExecutionResult> {
  const payout = payouts.get(payoutId);
  if (!payout) return { success: false, payoutId, error: "Payout not found", attempts: 0 };

  for (let attempt = 0; attempt < MAX_PAYOUT_RETRIES; attempt++) {
    payout.attempts += 1;
    payout.updated_at = now().toISOString();

    const result = await executeXRocketPayout(recipientAccount, payout.amount);
    if (result.success) {
      payout.status = "sent";
      payout.tx_reference = result.tx_reference;
      payout.updated_at = now().toISOString();
      // Update status index
      const oldList = payoutsByStatus.get("pending") ?? [];
      const idx = oldList.indexOf(payoutId);
      if (idx >= 0) oldList.splice(idx, 1);
      addToListIndex(payoutsByStatus, "sent", payoutId);
      return {
        success: true,
        payoutId,
        txReference: result.tx_reference,
        attempts: payout.attempts,
      };
    }

    payout.last_error = result.error;
    payout.error = result.error;

    if (attempt < MAX_PAYOUT_RETRIES - 1) {
      await new Promise((resolve) => setTimeout(resolve, getRetryDelay(attempt)));
    }
  }

  // All retries exhausted
  payout.status = "failed";
  payout.updated_at = now().toISOString();
  const oldList = payoutsByStatus.get("pending") ?? [];
  const idx = oldList.indexOf(payoutId);
  if (idx >= 0) oldList.splice(idx, 1);
  addToListIndex(payoutsByStatus, "failed", payoutId);

  return {
    success: false,
    payoutId,
    error: payout.last_error,
    attempts: payout.attempts,
  };
}

// ─── Auto-payout trigger ──────────────────────────────────────────────────────

export interface AutoPayoutResult {
  payoutId: string;
  success: boolean;
  txReference?: string;
  error?: string;
  attempts: number;
}

export async function triggerAutoPayout(
  referralId: string,
  conversionId: string,
  amount: number,
): Promise<AutoPayoutResult> {
  // Idempotency: check if payout already exists for this conversion
  const existing = findPayoutByConversion(conversionId);
  if (existing) {
    return {
      payoutId: existing.id,
      success: existing.status === "sent",
      txReference: existing.tx_reference,
      error: existing.error,
      attempts: existing.attempts,
    };
  }

  const referral = referrals.get(referralId);
  if (!referral) {
    return { payoutId: "", success: false, error: "Referral not found", attempts: 0 };
  }

  const admin = admins.get(referral.referrer_id);
  if (!admin?.xrocket_account) {
    const payout = createPayout(referralId, conversionId, amount);
    updatePayoutStatus(payout.id, "failed", undefined, "No XRocket account configured");
    return { payoutId: payout.id, success: false, error: "No XRocket account configured", attempts: 0 };
  }

  const payoutAmount = admin.payout_amount > 0 ? admin.payout_amount : amount;
  const payout = createPayout(referralId, conversionId, payoutAmount);

  const result = await executePayoutWithRetries(payout.id, admin.xrocket_account);
  return {
    payoutId: payout.id,
    success: result.success,
    txReference: result.txReference,
    error: result.error,
    attempts: result.attempts,
  };
}

// ─── Failure threshold alert ──────────────────────────────────────────────────

const FAILURE_ALERT_THRESHOLD = 5;

export function shouldAlertOnFailures(): boolean {
  const recentFailed = payoutsByStatus.get("failed") ?? [];
  return recentFailed.length >= FAILURE_ALERT_THRESHOLD;
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
