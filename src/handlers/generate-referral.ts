import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
import { createReferral, getReferralsForAdmin } from "../store.js";

const composer = new Composer<Ctx>();

composer.command("generate_referral", async (ctx) => {
  const adminId = ctx.from?.id;
  if (!adminId) {
    await ctx.reply("Couldn't identify your account. Try /start first.");
    return;
  }
  const referral = createReferral(adminId, "default");
  const botUsername = ctx.me.username;
  const link = `https://t.me/${botUsername}?start=ref_${referral.code}`;
  await ctx.reply(
    `Referral created! Your code is ${referral.code}.\n\nShare this link:\n${link}\n\nYou'll be notified when someone converts.`,
    { reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]) },
  );
});

composer.callbackQuery("referral:generate", async (ctx) => {
  await ctx.answerCallbackQuery();
  const adminId = ctx.from?.id;
  if (!adminId) {
    await ctx.editMessageText("Couldn't identify your account. Try /start first.");
    return;
  }
  const referral = createReferral(adminId, "default");
  const botUsername = ctx.me.username;
  const link = `https://t.me/${botUsername}?start=ref_${referral.code}`;
  await ctx.editMessageText(
    `Referral created! Your code is ${referral.code}.\n\nShare this link:\n${link}\n\nYou'll be notified when someone converts.`,
    { reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]) },
  );
});

export default composer;
