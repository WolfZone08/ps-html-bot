import TelegramBot from "node-telegram-bot-api";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const bot = new TelegramBot(process.env.BOT_TOKEN, {
  polling: true
});

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "PlayStation oyun linki göndər.");
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || !text.includes("store.playstation.com")) return;

  try {
    const response = await fetch(text, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
      }
    });

    const html = await response.text();
    const $ = cheerio.load(html);

    const title = $('meta[property="og:title"]').attr("content");
    const image = $('meta[property="og:image"]').attr("content");

    const priceTR = html.match(/"price":"([^"]+)"/);
    const priceUA = html.match(/"basePrice":"([^"]+)"/);

    if (!title) {
      bot.sendMessage(chatId, "Oyun tapılmadı və ya səhifə bloklandı.");
      return;
    }

    let caption = `🎮 ${title}\n`;

    if (priceTR) caption += `TR: ${priceTR[1]} TL\n`;
    if (priceUA) caption += `UA: ${priceUA[1]} UAH\n`;

    if (image) {
      await bot.sendPhoto(chatId, image, { caption });
    } else {
      await bot.sendMessage(chatId, caption);
    }
  } catch (err) {
    bot.sendMessage(chatId, "Xəta baş verdi.");
  }
});
