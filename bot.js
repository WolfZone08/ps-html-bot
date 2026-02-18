import TelegramBot from "node-telegram-bot-api";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import { renderImage } from "./render.js";

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "PlayStation oyun linkini göndər.");
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || !text.includes("store.playstation.com")) return;

  try {
    const res = await fetch(text);
    const html = await res.text();
    const $ = cheerio.load(html);

    const title = $("title").text() || "Oyun";
    const image = $('meta[property="og:image"]').attr("content");

    const priceMatch = html.match(/\\d+[.,]\\d+/);
    const priceTR = priceMatch ? priceMatch[0] + " TL" : "-";
    const priceUA = "-";

    const buffer = await renderImage({
      title,
      priceTR,
      priceUA,
      image
    });

    await bot.sendPhoto(chatId, buffer);
  } catch (err) {
    console.log(err);
    bot.sendMessage(chatId, "Xəta baş verdi.");
  }
});
