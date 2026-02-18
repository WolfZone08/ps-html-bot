import TelegramBot from "node-telegram-bot-api";
import puppeteer from "puppeteer";

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "Link göndər.");
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;

  if (!msg.text) return;
  if (msg.text.startsWith("/")) return;

  const url = msg.text;

  try {
    const browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle2" });

    const data = await page.evaluate(() => {
      const title =
        document.querySelector("h1")?.innerText || "PlayStation";

      const img =
        document.querySelector("img")?.src || "";

      return { title, img };
    });

    const html = `
      <html>
        <body style="
          width:800px;
          height:1000px;
          background:#2b0033;
          display:flex;
          flex-direction:column;
          align-items:center;
          justify-content:center;
          font-family:Arial;
          color:white;
        ">
          <h1 style="font-size:40px;text-align:center;padding:20px;">
            ${data.title}
          </h1>
          <img src="${data.img}" style="width:400px;border-radius:20px;" />
        </body>
      </html>
    `;

    await page.setContent(html);
    const buffer = await page.screenshot({ type: "jpeg" });

    await bot.sendPhoto(chatId, buffer);

    await browser.close();
  } catch (err) {
    console.log(err);
    bot.sendMessage(chatId, "Xəta baş verdi.");
  }
});
