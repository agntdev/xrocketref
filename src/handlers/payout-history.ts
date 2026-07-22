import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, paginate } from "../toolkit/index.js";
import { getAllPayouts, getPayoutsByStatus, type Payout } from "../store.js";

const PAGE_SIZE = 5;

const composer = new Composer<Ctx>();

function backToMenu() {
  return inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]);
}

function formatPayoutList(payouts: Payout[], page: number, filter: string): { text: string; markup: ReturnType<typeof inlineKeyboard> } {
  if (payouts.length === 0) {
    const filterLabel = filter === "all" ? "" : ` (${filter})`;
    return {
      text: `No payouts${filterLabel} found.`,
      markup: inlineKeyboard([
        [inlineButton("All", "payout_hist:all"), inlineButton("Failed", "payout_hist:failed"), inlineButton("Sent", "payout_hist:sent")],
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    };
  }

  const { page: actualPage, pageItems, totalPages, controls } = paginate(payouts, {
    page,
    perPage: PAGE_SIZE,
    callbackPrefix: `payout_hist:${filter}`,
  });

  const lines = pageItems.map((p, i) => {
    const num = actualPage * PAGE_SIZE + i + 1;
    const statusIcon = p.status === "sent" ? "✅" : p.status === "failed" ? "❌" : "⏳";
    const ref = p.tx_reference ? ` (ref: ${p.tx_reference})` : "";
    return `${num}. ${statusIcon} $${p.amount.toFixed(2)} — ${p.status}${ref}`;
  });

  const text = `Payouts (${payouts.length} total, filter: ${filter}):\n\n${lines.join("\n")}`;
  const filterRow = [
    inlineButton(filter === "all" ? "● All" : "All", "payout_hist:all"),
    inlineButton(filter === "failed" ? "● Failed" : "Failed", "payout_hist:failed"),
    inlineButton(filter === "sent" ? "● Sent" : "Sent", "payout_hist:sent"),
  ];
  const rows = [...controls.inline_keyboard, filterRow];
  rows.push([inlineButton("⬅️ Back to menu", "menu:main")]);

  return { text, markup: inlineKeyboard(rows) };
}

composer.callbackQuery("payout:history", async (ctx) => {
  await ctx.answerCallbackQuery();
  const payouts = getAllPayouts();
  const { text, markup } = formatPayoutList(payouts, 0, "all");
  await ctx.editMessageText(text, { reply_markup: markup });
});

composer.callbackQuery("payout_hist:all", async (ctx) => {
  await ctx.answerCallbackQuery();
  const payouts = getAllPayouts();
  const { text, markup } = formatPayoutList(payouts, 0, "all");
  await ctx.editMessageText(text, { reply_markup: markup });
});

composer.callbackQuery("payout_hist:failed", async (ctx) => {
  await ctx.answerCallbackQuery();
  const payouts = getPayoutsByStatus("failed");
  const { text, markup } = formatPayoutList(payouts, 0, "failed");
  await ctx.editMessageText(text, { reply_markup: markup });
});

composer.callbackQuery("payout_hist:sent", async (ctx) => {
  await ctx.answerCallbackQuery();
  const payouts = getPayoutsByStatus("sent");
  const { text, markup } = formatPayoutList(payouts, 0, "sent");
  await ctx.editMessageText(text, { reply_markup: markup });
});

// Pagination for filtered views
composer.callbackQuery(/^payout_hist:(all|failed|sent):prev:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const filter = ctx.match[1] as string;
  const page = parseInt(ctx.match[2], 10);
  const payouts = filter === "all" ? getAllPayouts() : getPayoutsByStatus(filter as Payout["status"]);
  const { text, markup } = formatPayoutList(payouts, page, filter);
  await ctx.editMessageText(text, { reply_markup: markup });
});

composer.callbackQuery(/^payout_hist:(all|failed|sent):next:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const filter = ctx.match[1] as string;
  const page = parseInt(ctx.match[2], 10);
  const payouts = filter === "all" ? getAllPayouts() : getPayoutsByStatus(filter as Payout["status"]);
  const { text, markup } = formatPayoutList(payouts, page, filter);
  await ctx.editMessageText(text, { reply_markup: markup });
});

export default composer;
