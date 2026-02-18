import TelegramBot from "node-telegram-bot-api";
import * as cheerio from "cheerio";
import { renderImage } from "./render.js";

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "Link göndər.");
});

bot.on("message", async (msg) => {
  if (!msg.text) return;
  if (!msg.text.includes("store.playstation.com")) return;

  try {
    const res = await fetch(msg.text);
    const html = await res.text();
    const $ = cheerio.load(html);

    const games = [];

    $("a").each((i, el) => {
      const title = $(el).text().trim();
      if (title.length > 5 && games.length < 1) {
        games.push({
          title,
          image: "https://upload.wikimedia.org/wikipedia/commons/0/00/PlayStation_logo.svg",
          tr: "500 ₼",
          ua: "450 ₼",
          date: "16.02.2026"
        });
      }
    });

    if (!games.length) {
      bot.sendMessage(msg.chat.id, "Oyun tapılmadı.");
      return;
    }

    const file = await renderImage(games[0]);
    await bot.sendPhoto(msg.chat.id, file);

  } catch (err) {
    console.log(err);
    bot.sendMessage(msg.chat.id, "Xəta baş verdi.");
  }
});
