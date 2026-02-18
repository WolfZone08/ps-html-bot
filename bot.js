import TelegramBot from "node-telegram-bot-api";
import puppeteer from "puppeteer";

const bot = new TelegramBot(process.env.BOT_TOKEN, {
  polling: true
});

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "TR category link göndər.");
});

bot.on("message", async (msg) => {
  if (!msg.text) return;
  if (!msg.text.includes("store.playstation.com")) return;

  const chatId = msg.chat.id;
  const trCategoryUrl = msg.text;
  const uaCategoryUrl = trCategoryUrl.replace("en-tr", "uk-ua");

  try {
    const browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const page = await browser.newPage();
    await page.goto(trCategoryUrl, { waitUntil: "networkidle2" });

    // İlk 3 product link götürürük
    const productLinks = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll("a"));
      return links
        .map(a => a.href)
        .filter(h => h.includes("/product/"))
        .slice(0, 3);
    });

    for (const trProduct of productLinks) {
      const uaProduct = trProduct.replace("en-tr", "uk-ua");

      const gameData = await scrapeGame(browser, trProduct, uaProduct);
      const imageBuffer = await renderImage(browser, gameData);

      await bot.sendPhoto(chatId, imageBuffer, {
        caption: `${gameData.title}\nTR: ${gameData.trPrice}\nUA: ${gameData.uaPrice}`
      });
    }

    await browser.close();

  } catch (err) {
    console.log(err);
    bot.sendMessage(chatId, "Xəta baş verdi.");
  }
});

// ===== SCRAPE FUNCTION =====

async function scrapeGame(browser, trUrl, uaUrl) {

  const page = await browser.newPage();

  // TR səhifə
  await page.goto(trUrl, { waitUntil: "networkidle2" });

  const trData = await page.evaluate(() => {
    return {
      title: document.querySelector("h1")?.innerText || "",
      price: document.querySelector('[data-qa*="finalPrice"]')?.innerText || "",
      image: document.querySelector("img")?.src || ""
    };
  });

  // UA səhifə
  await page.goto(uaUrl, { waitUntil: "networkidle2" });

  const uaPrice = await page.evaluate(() => {
    return document.querySelector('[data-qa*="finalPrice"]')?.innerText || "";
  });

  await page.close();

  return {
    title: trData.title,
    cover: trData.image,
    trPrice: trData.price,
    uaPrice: uaPrice
  };
}

// ===== RENDER FUNCTION =====

async function renderImage(browser, game) {

  const page = await browser.newPage();

  const html = `
  <html>
  <body style="
    width:1080px;
    height:1350px;
    background:#1b0022;
    font-family:Arial;
    color:white;
    text-align:center;
    padding-top:80px;
  ">
    <h1 style="font-size:60px;">${game.title}</h1>
    <img src="${game.cover}" style="width:600px;border-radius:30px;margin:40px 0;" />
    <h2 style="font-size:48px;">TR: ${game.trPrice}</h2>
    <h2 style="font-size:48px;">UA: ${game.uaPrice}</h2>
  </body>
  </html>
  `;

  await page.setContent(html);
  const buffer = await page.screenshot({ type: "jpeg" });

  await page.close();

  return buffer;
}
