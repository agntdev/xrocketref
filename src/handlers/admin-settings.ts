import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
import { getOrCreateAdmin, updateAdminProfile } from "../store.js";

const composer = new Composer<Ctx>();

function backToMenu() {
  return inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]);
}

function settingsMenu(adminId: number) {
  const admin = getOrCreateAdmin(adminId);
  const account = admin.xrocket_account || "Not set";
  const amount = admin.payout_amount > 0 ? `$${admin.payout_amount.toFixed(2)}` : "Not set";

  return {
    text:
      `⚙️ Admin settings\n\n` +
      `XRocket account: ${account}\n` +
      `Payout amount: ${amount}`,
    markup: inlineKeyboard([
      [inlineButton("Edit XRocket account", "admin:set_account")],
      [inlineButton("Edit payout amount", "admin:set_amount")],
      [inlineButton("⬅️ Back to menu", "menu:main")],
    ]),
  };
}

composer.callbackQuery("admin:settings", async (ctx) => {
  await ctx.answerCallbackQuery();
  const adminId = ctx.from?.id;
  if (!adminId) {
    await ctx.editMessageText("Couldn't identify your account. Try /start first.");
    return;
  }
  const { text, markup } = settingsMenu(adminId);
  await ctx.editMessageText(text, { reply_markup: markup });
});

composer.callbackQuery("admin:set_account", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.payout_flow = { step: "awaiting_account" };
  await ctx.editMessageText(
    "Send your XRocket account identifier (e.g. email or account ID).",
    {
      reply_markup: inlineKeyboard([[inlineButton("Cancel", "admin:cancel_settings")]]),
    },
  );
});

composer.callbackQuery("admin:set_amount", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.payout_flow = { step: "awaiting_amount" };
  await ctx.editMessageText(
    "Send the payout amount in USD (e.g. 25.00).",
    {
      reply_markup: inlineKeyboard([[inlineButton("Cancel", "admin:cancel_settings")]]),
    },
  );
});

composer.callbackQuery("admin:cancel_settings", async (ctx) => {
  await ctx.answerCallbackQuery();
  delete ctx.session.payout_flow;
  const adminId = ctx.from?.id;
  if (adminId) {
    const { text, markup } = settingsMenu(adminId);
    await ctx.editMessageText(text, { reply_markup: markup });
  } else {
    await ctx.editMessageText("Settings cancelled.", { reply_markup: backToMenu() });
  }
});

composer.on("message", async (ctx, next) => {
  const flow = ctx.session.payout_flow;
  if (!flow) {
    await next();
    return;
  }

  const text = ctx.message?.text?.trim();
  if (!text) return;

  const adminId = ctx.from?.id;
  if (!adminId) {
    await ctx.reply("Couldn't identify your account. Try /start first.");
    delete ctx.session.payout_flow;
    return;
  }

  if (flow.step === "awaiting_account") {
    updateAdminProfile(adminId, { xrocket_account: text });
    delete ctx.session.payout_flow;
    const { text: msg, markup } = settingsMenu(adminId);
    await ctx.reply(`✅ XRocket account updated.\n\n${msg}`, { reply_markup: markup });
    return;
  }

  if (flow.step === "awaiting_amount") {
    const amount = parseFloat(text);
    if (isNaN(amount) || amount <= 0) {
      await ctx.reply(
        "Invalid amount. Please enter a positive number (e.g. 25.00).",
        { reply_markup: inlineKeyboard([[inlineButton("Cancel", "admin:cancel_settings")]]) },
      );
      return;
    }
    updateAdminProfile(adminId, { payout_amount: amount });
    delete ctx.session.payout_flow;
    const { text: msg, markup } = settingsMenu(adminId);
    await ctx.reply(`✅ Payout amount updated.\n\n${msg}`, { reply_markup: markup });
    return;
  }

  await next();
});

export default composer;
