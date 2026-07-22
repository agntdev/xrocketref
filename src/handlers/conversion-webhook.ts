import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
import {
  getReferralByCode,
  createConversion,
  createPayout,
  executeXRocketPayout,
  getOrCreateAdmin,
  updatePayoutStatus,
} from "../store.js";

interface ConversionFlow {
  step: "awaiting_code" | "awaiting_details";
  code?: string;
}

const composer = new Composer<Ctx>();

function backToMenu() {
  return inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]);
}

composer.callbackQuery("conversion:record", async (ctx) => {
  await ctx.answerCallbackQuery();
  (ctx.session as unknown as { conversion_flow?: ConversionFlow }).conversion_flow = {
    step: "awaiting_code",
  };
  await ctx.editMessageText(
    "Enter the referral code for the conversion you want to record.",
    {
      reply_markup: inlineKeyboard([[inlineButton("Cancel", "conversion:cancel")]]),
    },
  );
});

composer.callbackQuery("conversion:cancel", async (ctx) => {
  await ctx.answerCallbackQuery();
  delete (ctx.session as unknown as { conversion_flow?: ConversionFlow }).conversion_flow;
  await ctx.editMessageText("Conversion recording cancelled.", { reply_markup: backToMenu() });
});

composer.on("message", async (ctx, next) => {
  const flow = (ctx.session as unknown as { conversion_flow?: ConversionFlow }).conversion_flow;
  if (!flow) {
    await next();
    return;
  }

  const text = ctx.message?.text?.trim();
  if (!text) return;

  if (flow.step === "awaiting_code") {
    const referral = getReferralByCode(text);
    if (!referral) {
      await ctx.reply(
        `No referral found with code "${text}". Check the code and try again.`,
        { reply_markup: inlineKeyboard([[inlineButton("Cancel", "conversion:cancel")]]) },
      );
      return;
    }
    if (referral.status === "converted") {
      await ctx.reply(
        `Referral ${text} has already been converted.`,
        { reply_markup: backToMenu() },
      );
      delete (ctx.session as unknown as { conversion_flow?: ConversionFlow }).conversion_flow;
      return;
    }
    flow.code = text;
    flow.step = "awaiting_details";
    await ctx.reply(
      "Referral found. Now send the order details in this format:\n\n<code>ORDER_ID AMOUNT</code>\n\nExample: <code>ORD-12345 49.99</code>",
      {
        parse_mode: "HTML",
        reply_markup: inlineKeyboard([[inlineButton("Cancel", "conversion:cancel")]]),
      },
    );
    return;
  }

  if (flow.step === "awaiting_details") {
    const parts = text.split(/\s+/);
    if (parts.length < 2) {
      await ctx.reply(
        "Please send both order ID and amount separated by a space.\nExample: <code>ORD-12345 49.99</code>",
        { parse_mode: "HTML", reply_markup: inlineKeyboard([[inlineButton("Cancel", "conversion:cancel")]]) },
      );
      return;
    }

    const orderId = parts[0];
    const amount = parseFloat(parts[1]);
    if (isNaN(amount) || amount <= 0) {
      await ctx.reply(
        "Invalid amount. Please enter a positive number.\nExample: <code>ORD-12345 49.99</code>",
        { parse_mode: "HTML", reply_markup: inlineKeyboard([[inlineButton("Cancel", "conversion:cancel")]]) },
      );
      return;
    }

    const referral = getReferralByCode(flow.code!);
    if (!referral) {
      await ctx.reply("Referral no longer exists. Start over from the menu.", { reply_markup: backToMenu() });
      delete (ctx.session as unknown as { conversion_flow?: ConversionFlow }).conversion_flow;
      return;
    }

    // Record the conversion
    const conversion = createConversion(referral.id, orderId, amount, true);
    if (!conversion) {
      await ctx.reply("Failed to record conversion. Try again.", { reply_markup: backToMenu() });
      delete (ctx.session as unknown as { conversion_flow?: ConversionFlow }).conversion_flow;
      return;
    }

    // Trigger payout workflow
    const admin = getOrCreateAdmin(referral.referrer_id);
    const payout = createPayout(referral.id, conversion.id, admin.payout_amount || amount);

    let payoutResult;
    if (admin.xrocket_account) {
      payoutResult = await executeXRocketPayout(admin.xrocket_account, payout.amount);
    } else {
      payoutResult = { success: false, error: "No XRocket account configured" };
    }

    if (payoutResult.success) {
      updatePayoutStatus(payout.id, "success", payoutResult.tx_reference);
      await ctx.reply(
        `Conversion recorded!\n\nReferral: ${flow.code}\nOrder: ${orderId}\nAmount: $${amount.toFixed(2)}\nPayout: ✅ Sent (ref: ${payoutResult.tx_reference})`,
        { reply_markup: backToMenu() },
      );
    } else {
      updatePayoutStatus(payout.id, "failed", undefined, payoutResult.error);
      await ctx.reply(
        `Conversion recorded but payout failed.\n\nReferral: ${flow.code}\nOrder: ${orderId}\nAmount: $${amount.toFixed(2)}\nError: ${payoutResult.error}\n\nYou can retry the payout from the menu.`,
        { reply_markup: backToMenu() },
      );
    }

    delete (ctx.session as unknown as { conversion_flow?: ConversionFlow }).conversion_flow;
    return;
  }

  await next();
});

export default composer;
