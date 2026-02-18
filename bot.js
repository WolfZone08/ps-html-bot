import TelegramBot from "node-telegram-bot-api";
import fetch from "node-fetch";

const bot = new TelegramBot(process.env.BOT_TOKEN, {
  polling: true
});

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "PlayStation oyun linki göndər.");
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || !text.includes("/product/")) return;

  try {
    const productId = text.split("/product/")[1].split("/")[0];

    const apiUrl = `https://store.playstation.com/store/api/chihiro/00_09_000/container/TR/en/999/${productId}`;

    const response = await fetch(apiUrl);
    const data = await response.json();

    if (!data || !data.name) {
      bot.sendMessage(chatId, "Oyun tapılmadı.");
      return;
    }

    let caption = `🎮 ${data.name}\n`;

    if (data.default_sku?.price) {
      caption += `Qiymət: ${data.default_sku.price}\n`;
    }

    const image = data.images?.[0]?.url;

    if (image) {
      await bot.sendPhoto(chatId, image, { caption });
    } else {
      await bot.sendMessage(chatId, caption);
    }

  } catch (err) {
    bot.sendMessage(chatId, "Xəta baş verdi.");
  }
});
