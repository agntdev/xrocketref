import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
import {
  getFailedPayouts,
  getPayout,
  executePayoutWithRetries,
  getOrCreateAdmin,
  getReferral,
  shouldAlertOnFailures,
} from "../store.js";

const composer = new Composer<Ctx>();

function backToMenu() {
  return inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]);
}

composer.callbackQuery("payout:retry", async (ctx) => {
  await ctx.answerCallbackQuery();
  const adminId = ctx.from?.id;
  if (!adminId) {
    await ctx.editMessageText("Couldn't identify your account. Try /start first.");
    return;
  }

  const failedPayouts = getFailedPayouts();
  if (failedPayouts.length === 0) {
    await ctx.editMessageText("No failed payouts to retry.", { reply_markup: backToMenu() });
    return;
  }

  const admin = getOrCreateAdmin(adminId);
  if (!admin.xrocket_account) {
    await ctx.editMessageText(
      "No XRocket account configured. Set your account in settings first.",
      { reply_markup: backToMenu() },
    );
    return;
  }

  let succeeded = 0;
  let stillFailed = 0;
  const results: string[] = [];

  for (const payout of failedPayouts) {
    const result = await executePayoutWithRetries(payout.id, admin.xrocket_account);
    const referral = getReferral(payout.referral_id);
    if (result.success) {
      results.push(`✅ Payout ${payout.id.slice(0, 8)} — $${payout.amount.toFixed(2)} (ref: ${result.txReference})`);
      succeeded++;
    } else {
      results.push(`❌ Payout ${payout.id.slice(0, 8)} — $${payout.amount.toFixed(2)} (error: ${result.error})`);
      stillFailed++;
    }
  }

  const alertNote = shouldAlertOnFailures()
    ? "\n\n⚠️ High failure rate detected. Check your XRocket account."
    : "";
  const summary = `Payout retry complete.\n\n${results.join("\n")}\n\nSucceeded: ${succeeded} | Still failed: ${stillFailed}${alertNote}`;
  await ctx.editMessageText(summary, { reply_markup: backToMenu() });
});

// Retry a specific payout by ID
composer.callbackQuery(/^payout:retry:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const adminId = ctx.from?.id;
  if (!adminId) {
    await ctx.editMessageText("Couldn't identify your account. Try /start first.");
    return;
  }

  const payoutId = ctx.match[1];
  const payout = getPayout(payoutId);
  if (!payout) {
    await ctx.editMessageText("Payout not found.", { reply_markup: backToMenu() });
    return;
  }

  if (payout.status !== "failed") {
    await ctx.editMessageText(
      `Payout ${payoutId.slice(0, 8)} is already ${payout.status}. Only failed payouts can be retried.`,
      { reply_markup: backToMenu() },
    );
    return;
  }

  const admin = getOrCreateAdmin(adminId);
  if (!admin.xrocket_account) {
    await ctx.editMessageText(
      "No XRocket account configured. Set your account in settings first.",
      { reply_markup: backToMenu() },
    );
    return;
  }

  const result = await executePayoutWithRetries(payout.id, admin.xrocket_account);
  if (result.success) {
    await ctx.editMessageText(
      `Payout retried successfully!\n\nAmount: $${payout.amount.toFixed(2)}\nReference: ${result.txReference}\nAttempts: ${result.attempts}`,
      { reply_markup: backToMenu() },
    );
  } else {
    await ctx.editMessageText(
      `Payout retry failed after ${result.attempts} attempt(s).\n\nAmount: $${payout.amount.toFixed(2)}\nError: ${result.error}\n\nTry again later or check your XRocket account.`,
      { reply_markup: backToMenu() },
    );
  }
});

export default composer;
