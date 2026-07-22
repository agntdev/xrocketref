import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { mainMenuKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { getOrCreateAdmin } from "../store.js";

// Register menu items at module load — buildBot() auto-loads this file, so the
// main menu aggregates every feature's button without editing this shared file.
registerMainMenuItem({ label: "🔗 Generate referral", data: "referral:generate", order: 10 });
registerMainMenuItem({ label: "📋 View referrals", data: "admin:view_referrals", order: 20 });
registerMainMenuItem({ label: "💳 Record conversion", data: "conversion:record", order: 30 });
registerMainMenuItem({ label: "💸 Retry payout", data: "payout:retry", order: 40 });

const WELCOME = "👋 Welcome! Tap a button below to get started.";

const composer = new Composer<Ctx>();

composer.command("start", async (ctx) => {
  if (ctx.from?.id) getOrCreateAdmin(ctx.from.id);
  await ctx.reply(WELCOME, { reply_markup: mainMenuKeyboard() });
});

composer.callbackQuery("menu:main", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(WELCOME, { reply_markup: mainMenuKeyboard() });
});

export default composer;
