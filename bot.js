import TelegramBot from "node-telegram-bot-api";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import { renderImage } from "./render.js";

// BOT TOKEN
const bot = new TelegramBot(process.env.BOT_TOKEN, {
  polling: {
    autoStart: true,
    interval: 300,
    params: { timeout: 10 }
  }
});

// START
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "Link göndər və ya /d 16.02.2026 yaz");
});

// TARIX KOMANDASI
let discountDate = "";

bot.onText(/\/d (.+)/, (msg, match) => {
  discountDate = match[1];
  bot.sendMessage(msg.chat.id, "Tarix yadda saxlandı: " + discountDate);
});

// LINK GÖNDƏRİLƏNDƏ
bot.on("message", async (msg) => {
  if (!msg.text) return;
  if (!msg.text.startsWith("http")) return;

  const chatId = msg.chat.id;
  const url = msg.text;

  try {
    const res = await fetch(url);
    const html = await res.text();
    const $ = cheerio.load(html);

    const games = [];

    $("a").each((i, el) => {
      const title = $(el).text().trim();
      const img = $(el).find("img").attr("src");

      if (title.length > 5 && img) {
        games.push({
          title,
          img,
          tr: "-",
          ua: "-",
          date: discountDate
        });
      }
    });

    if (games.length === 0) {
      return bot.sendMessage(chatId, "Oyun tapılmadı.");
    }

    const game = games[0]; // hələlik ilkini götürürük

    const imagePath = await renderImage(game);

    await bot.sendPhoto(chatId, imagePath, {
      caption: `${game.title}\nTR: ${game.tr}\nUA: ${game.ua}`
    });

  } catch (err) {
    console.log(err);
    bot.sendMessage(chatId, "Xəta baş verdi.");
  }
});
