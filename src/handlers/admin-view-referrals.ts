import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, paginate } from "../toolkit/index.js";
import { getReferralsForAdmin } from "../store.js";

const PAGE_SIZE = 5;

const composer = new Composer<Ctx>();

function formatReferralList(adminId: number, page: number): { text: string; markup: ReturnType<typeof inlineKeyboard> } {
  const referrals = getReferralsForAdmin(adminId);
  if (referrals.length === 0) {
    return {
      text: "No referrals yet. Generate one to start tracking.",
      markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
    };
  }

  const { page: actualPage, pageItems, totalPages, controls } = paginate(referrals, {
    page,
    perPage: PAGE_SIZE,
    callbackPrefix: "reflist",
  });

  const lines = pageItems.map((r, i) => {
    const num = actualPage * PAGE_SIZE + i + 1;
    const status = r.status === "converted" ? "✅" : r.status === "expired" ? "⏰" : "🔵";
    return `${num}. ${status} Code: ${r.code} — ${r.campaign}`;
  });

  const text = `Referrals (${referrals.length} total):\n\n${lines.join("\n")}`;
  const rows = controls.inline_keyboard.length > 0 ? [...controls.inline_keyboard] : [];
  rows.push([inlineButton("⬅️ Back to menu", "menu:main")]);

  return { text, markup: inlineKeyboard(rows) };
}

composer.callbackQuery("admin:view_referrals", async (ctx) => {
  await ctx.answerCallbackQuery();
  const adminId = ctx.from?.id;
  if (!adminId) {
    await ctx.editMessageText("Couldn't identify your account. Try /start first.");
    return;
  }
  const { text, markup } = formatReferralList(adminId, 0);
  await ctx.editMessageText(text, { reply_markup: markup });
});

composer.callbackQuery(/^reflist:prev:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const adminId = ctx.from?.id;
  if (!adminId) return;
  const page = parseInt(ctx.match[1], 10);
  const { text, markup } = formatReferralList(adminId, page);
  await ctx.editMessageText(text, { reply_markup: markup });
});

composer.callbackQuery(/^reflist:next:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const adminId = ctx.from?.id;
  if (!adminId) return;
  const page = parseInt(ctx.match[1], 10);
  const { text, markup } = formatReferralList(adminId, page);
  await ctx.editMessageText(text, { reply_markup: markup });
});

export default composer;
