import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
import {
  getReferralByCode,
  createConversion,
  triggerAutoPayout,
  getOrCreateAdmin,
  shouldAlertOnFailures,
} from "../store.js";

const composer = new Composer<Ctx>();

function backToMenu() {
  return inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]);
}

composer.callbackQuery("conversion:record", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.conversion_flow = { step: "awaiting_code" };
  await ctx.editMessageText(
    "Enter the referral code for the conversion you want to record.",
    {
      reply_markup: inlineKeyboard([[inlineButton("Cancel", "conversion:cancel")]]),
    },
  );
});

composer.callbackQuery("conversion:cancel", async (ctx) => {
  await ctx.answerCallbackQuery();
  delete ctx.session.conversion_flow;
  await ctx.editMessageText("Conversion recording cancelled.", { reply_markup: backToMenu() });
});

composer.on("message", async (ctx, next) => {
  const flow = ctx.session.conversion_flow;
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
      delete ctx.session.conversion_flow;
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
      delete ctx.session.conversion_flow;
      return;
    }

    // Record the conversion
    const conversion = createConversion(referral.id, orderId, amount, true);
    if (!conversion) {
      await ctx.reply("Failed to record conversion. Try again.", { reply_markup: backToMenu() });
      delete ctx.session.conversion_flow;
      return;
    }

    // Trigger automatic payout workflow (idempotent — checks for existing payout)
    const payoutResult = await triggerAutoPayout(referral.id, conversion.id, amount);
    const admin = getOrCreateAdmin(referral.referrer_id);

    if (payoutResult.success) {
      try {
        await ctx.api.sendMessage(
          referral.referrer_id,
          `💰 Payout sent!\n\n` +
            `Conversion: ${orderId}\n` +
            `Amount: $${amount.toFixed(2)}\n` +
            `TX Reference: ${payoutResult.txReference}\n` +
            `Attempts: ${payoutResult.attempts}`,
        );
      } catch {
        // Admin may have blocked the bot — don't abort
      }

      await ctx.reply(
        `Conversion recorded!\n\n` +
          `Referral: ${flow.code}\n` +
          `Order: ${orderId}\n` +
          `Amount: $${amount.toFixed(2)}\n` +
          `Payout: ✅ Sent (ref: ${payoutResult.txReference})`,
        { reply_markup: backToMenu() },
      );
    } else {
      try {
        const alertNote = shouldAlertOnFailures()
          ? "\n\n⚠️ High failure rate detected. Check your XRocket account."
          : "";
        await ctx.api.sendMessage(
          referral.referrer_id,
          `❌ Payout failed\n\n` +
            `Conversion: ${orderId}\n` +
            `Amount: $${amount.toFixed(2)}\n` +
            `Error: ${payoutResult.error}\n\n` +
            `Retry from the menu: 💸 Payout history${alertNote}`,
        );
      } catch {
        // Admin may have blocked the bot
      }

      await ctx.reply(
        `Conversion recorded but payout failed.\n\n` +
          `Referral: ${flow.code}\n` +
          `Order: ${orderId}\n` +
          `Amount: $${amount.toFixed(2)}\n` +
          `Error: ${payoutResult.error}\n\n` +
          `You can retry the payout from the menu.`,
        { reply_markup: backToMenu() },
      );
    }

    delete ctx.session.conversion_flow;
    return;
  }

  await next();
});

export default composer;
