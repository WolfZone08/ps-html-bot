import TelegramBot from "node-telegram-bot-api";
import puppeteer from "puppeteer";
import { renderCard } from "./render.js";

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// Sadə “session” saxlayırıq (hər chat üçün)
const sessions = new Map();

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id,
    "1) PS product link göndər\n2) Mən TR/UA qiymət və bitmə tarixi soruşacam\n3) Sənin dizayna uyğun PNG göndərəcəm"
  );
});

// Product ID çıxarır
function extractProductId(text){
  const m = String(text || "").match(/\/product\/([A-Z0-9_-]+)/i);
  return m?.[1] || null;
}

function buildLocaleUrl(locale, productId){
  return `https://store.playstation.com/${locale}/product/${productId}`;
}

// Title + cover çəkməyə çalışırıq (blok olsa fallback)
async function fetchMeta(productUrl){
  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
  });

  try{
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123 Safari/537.36");
    await page.goto(productUrl, { waitUntil: "domcontentloaded", timeout: 60000 });

    const meta = await page.evaluate(() => {
      const title =
        document.querySelector('meta[property="og:title"]')?.getAttribute("content") ||
        document.querySelector("h1")?.innerText ||
        document.title ||
        "";
      const image =
        document.querySelector('meta[property="og:image"]')?.getAttribute("content") ||
        document.querySelector("img")?.src ||
        "";
      return { title, image };
    });

    return {
      title: (meta.title || "").trim(),
      image: (meta.image || "").trim()
    };
  } catch {
    return { title: "", image: "" };
  } finally {
    await browser.close();
  }
}

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || "";

  // /start kimi komandaları keç
  if (text.startsWith("/")) return;

  // Əgər session varsa, deməli bot sual verib – indi user cavab verir
  const s = sessions.get(chatId);
  if (s?.step) {
    if (s.step === "TR_PRICE") {
      s.trPrice = text.trim();
      s.step = "UA_PRICE";
      sessions.set(chatId, s);
      return bot.sendMessage(chatId, "UA qiyməti yaz (misal: 799 UAH) :");
    }
    if (s.step === "UA_PRICE") {
      s.uaPrice = text.trim();
      s.step = "END_DATE";
      sessions.set(chatId, s);
      return bot.sendMessage(chatId, "Endirim bitmə tarixi yaz (misal: 28.02.2026) — yoxdursa `-` yaz:");
    }
    if (s.step === "END_DATE") {
      s.endDate = text.trim() === "-" ? "—" : text.trim();
      s.step = null;
      sessions.set(chatId, s);

      // Render et və göndər
      const png = await renderCard({
        title: s.title || "—",
        imageUrl: s.image || "https://upload.wikimedia.org/wikipedia/commons/3/3a/Gray_circles_rotate.gif",
        platform: s.platform || "PS4 • PS5",
        trPrice: s.trPrice || "—",
        uaPrice: s.uaPrice || "—",
        endDate: s.endDate || "—",
        url: s.url || "—"
      });

      await bot.sendPhoto(chatId, png, {
        caption: `Hazır ✅\n${s.title}\nTR: ${s.trPrice}\nUA: ${s.uaPrice}\nBitmə: ${s.endDate}`
      });

      sessions.delete(chatId);
      return;
    }
  }

  // Yeni link gəlirsə
  const productId = extractProductId(text);
  if (!productId) {
    return bot.sendMessage(chatId, "Product link göndər: içində `/product/XXXX` olmalıdır.");
  }

  // Biz TR locale linkini götürürük (title + cover üçün)
  const trUrl = buildLocaleUrl("tr-tr", productId);

  // Title + cover çək (alınmasa da problem deyil)
  const meta = await fetchMeta(trUrl);

  const session = {
    url: trUrl,
    title: meta.title || "Game",
    image: meta.image || "",
    platform: "PS4 • PS5",
    step: "TR_PRICE"
  };
  sessions.set(chatId, session);

  await bot.sendMessage(chatId,
    `Link alındı ✅\nBaşlıq: ${session.title || "—"}\n\nİndi TR qiyməti yaz (misal: 799 TL) :`
  );
});
