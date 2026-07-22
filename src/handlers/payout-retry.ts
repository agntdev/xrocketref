import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
import {
  getFailedPayouts,
  getPayout,
  executeXRocketPayout,
  getOrCreateAdmin,
  updatePayoutStatus,
  getReferral,
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

  // Retry all failed payouts
  let succeeded = 0;
  let stillFailed = 0;
  const results: string[] = [];

  for (const payout of failedPayouts) {
    const result = await executeXRocketPayout(admin.xrocket_account, payout.amount);
    if (result.success) {
      updatePayoutStatus(payout.id, "success", result.tx_reference);
      const referral = getReferral(payout.referral_id);
      results.push(`✅ Payout ${payout.id.slice(0, 8)} — $${payout.amount.toFixed(2)} (ref: ${result.tx_reference})`);
      succeeded++;
    } else {
      updatePayoutStatus(payout.id, "failed", undefined, result.error);
      results.push(`❌ Payout ${payout.id.slice(0, 8)} — $${payout.amount.toFixed(2)} (error: ${result.error})`);
      stillFailed++;
    }
  }

  const summary = `Payout retry complete.\n\n${results.join("\n")}\n\nSucceeded: ${succeeded} | Still failed: ${stillFailed}`;
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

  const result = await executeXRocketPayout(admin.xrocket_account, payout.amount);
  if (result.success) {
    updatePayoutStatus(payout.id, "success", result.tx_reference);
    await ctx.editMessageText(
      `Payout retried successfully!\n\nAmount: $${payout.amount.toFixed(2)}\nReference: ${result.tx_reference}`,
      { reply_markup: backToMenu() },
    );
  } else {
    updatePayoutStatus(payout.id, "failed", undefined, result.error);
    await ctx.editMessageText(
      `Payout retry failed.\n\nAmount: $${payout.amount.toFixed(2)}\nError: ${result.error}\n\nTry again later or check your XRocket account.`,
      { reply_markup: backToMenu() },
    );
  }
});

export default composer;
