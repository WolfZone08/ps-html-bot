import TelegramBot from "node-telegram-bot-api";
import fetch from "node-fetch";

const bot = new TelegramBot(process.env.BOT_TOKEN, {
  polling: true,
});

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "TR category link göndər.");
});

bot.on("message", async (msg) => {
  if (!msg.text) return;
  if (!msg.text.includes("store.playstation.com")) return;

  const chatId = msg.chat.id;

  try {
    const res = await fetch(msg.text);
    const html = await res.text();

    const match = html.match(/"conceptId":"(.*?)"/);
    if (!match) {
      bot.sendMessage(chatId, "Oyun tapılmadı.");
      return;
    }

    const conceptId = match[1];

    const api = `https://store.playstation.com/store/api/chihiro/00_09_000/container/TR/en/999/${conceptId}`;
    const data = await fetch(api).then(r => r.json());

    const game = data?.included?.[0];
    if (!game) {
      bot.sendMessage(chatId, "Data tapılmadı.");
      return;
    }

    const name = game.attributes.name;
    const price = game.attributes.price?.displayPrice || "-";
    const discountEnd = game.attributes.price?.endDate || "-";
    const image = game.attributes.images?.[0]?.url;

    const caption =
`🎮 ${name}

🇹🇷 ${price}
🕒 ${discountEnd}`;

    if (image) {
      await bot.sendPhoto(chatId, image, { caption });
    } else {
      await bot.sendMessage(chatId, caption);
    }

  } catch (err) {
    bot.sendMessage(chatId, "Xəta baş verdi.");
  }
});
