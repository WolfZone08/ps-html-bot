import TelegramBot from "node-telegram-bot-api";
import puppeteer from "puppeteer";

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) throw new Error("BOT_TOKEN yoxdur (Railway Variables-a əlavə et).");

const bot = new TelegramBot(TOKEN, { polling: true });

/** ---------------- FX (AZN baza ilə) ----------------
 * Mənbə: open.er-api.com (key tələb etmir).
 * 1 AZN = X TRY, 1 AZN = X UAH qaytarır.
 */
let fxCache = { ts: 0, rates: null };

async function getFxAZN() {
  const now = Date.now();
  if (fxCache.rates && now - fxCache.ts < 60 * 60 * 1000) return fxCache.rates; // 1 saat cache

  const url = "https://open.er-api.com/v6/latest/AZN";
  const res = await fetch(url);
  const data = await res.json();

  if (data?.result !== "success" || !data?.rates) {
    throw new Error("FX API cavabı alınmadı.");
  }

  fxCache = { ts: now, rates: data.rates };
  return fxCache.rates;
}

// TRY->AZN: azn = try / (TRY per 1 AZN)
// UAH->AZN: azn = uah / (UAH per 1 AZN)
function toAZN(amount, currency, rates) {
  if (typeof amount !== "number" || !isFinite(amount)) return null;

  if (currency === "TRY") {
    const perAZN = rates.TRY;
    if (!perAZN) return null;
    return amount / perAZN;
  }
  if (currency === "UAH") {
    const perAZN = rates.UAH;
    if (!perAZN) return null;
    return amount / perAZN;
  }
  return null;
}

function ceilAZN(x) {
  if (x === null) return null;
  return Math.ceil(x); // 70.3 -> 71
}

/** Mətn qiyməti rəqəmə çevirir:
 * "₺1.299,90" / "1 299,90 ₴" / "₴1,299.90" -> 1299.90
 */
function parsePriceText(txt) {
  if (!txt) return null;

  const cleaned = String(txt)
    .replace(/\s/g, "")
    .replace(/[₺₴]/g, "")
    .replace(/TRY|UAH/gi, "");

  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");
  let numStr = cleaned;

  if (hasComma && hasDot) {
    const lastComma = cleaned.lastIndexOf(",");
    const lastDot = cleaned.lastIndexOf(".");
    const decSep = lastComma > lastDot ? "," : ".";
    const thouSep = decSep === "," ? "." : ",";
    numStr = cleaned.split(thouSep).join("");
    numStr = decSep === "," ? numStr.replace(",", ".") : numStr;
  } else if (hasComma && !hasDot) {
    numStr = cleaned.replace(",", ".");
  } else {
    numStr = cleaned;
  }

  const val = Number(numStr);
  return Number.isFinite(val) ? val : null;
}

/** Category səhifədən product linklərini çıxarır */
function extractProductLinksFromCategory() {
  const links = Array.from(document.querySelectorAll("a"))
    .map((a) => a.href)
    .filter((h) => h && h.includes("/product/"));

  const uniq = [];
  const seen = new Set();
  for (const l of links) {
    if (!seen.has(l)) {
      seen.add(l);
      uniq.push(l);
    }
  }
  return uniq;
}

async function getCategoryProducts(browser, categoryUrl, limit = 24) {
  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123 Safari/537.36"
  );

  await page.goto(categoryUrl, { waitUntil: "networkidle2", timeout: 60000 });

  // bir az scroll: görünən kartlar yüklənsin
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.35));
  await new Promise((r) => setTimeout(r, 700));

  const productLinks = await page.evaluate(extractProductLinksFromCategory);
  await page.close();

  return productLinks.slice(0, limit);
}

async function scrapeProduct(browser, productUrl) {
  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123 Safari/537.36"
  );

  await page.goto(productUrl, { waitUntil: "networkidle2", timeout: 60000 });

  const data = await page.evaluate(() => {
    const title =
      document.querySelector("h1")?.innerText ||
      document.querySelector('meta[property="og:title"]')?.getAttribute("content") ||
      document.title ||
      "";

    // qiymət üçün bir neçə ehtimal
    const selectors = [
      '[data-qa*="finalPrice"]',
      '[data-qa*="price"]',
      '[data-testid*="price"]'
    ];

    let priceText = "";
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el?.innerText && /\d/.test(el.innerText)) {
        priceText = el.innerText;
        break;
      }
    }

    // fallback: body text içindən ₺/₴ olan hissə
    if (!priceText) {
      const bodyText = document.body.innerText;
      const m = bodyText.match(/(₺|₴)\s?\d[\d\s.,]*/);
      if (m) priceText = m[0];
    }

    return { title: (title || "").trim(), priceText: (priceText || "").trim() };
  });

  await page.close();
  return data;
}

/** Parallel işi limitləyən helper */
async function mapLimit(arr, limit, fn) {
  const ret = [];
  let i = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (i < arr.length) {
      const idx = i++;
      ret[idx] = await fn(arr[idx], idx);
    }
  });
  await Promise.all(workers);
  return ret;
}

/** ---------------- Telegram ---------------- */
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "TR category link at (endirim səhifəsi).\n\nMəs:\nhttps://store.playstation.com/en-tr/category/.../1\n\nVə ya:\n/cat <link>"
  );
});

bot.onText(/\/cat (.+)/, async (msg, m) => {
  const url = (m?.[1] || "").trim();
  await handleCategory(msg.chat.id, url);
});

bot.on("message", async (msg) => {
  const text = msg.text || "";
  if (text.startsWith("/")) return;

  if (text.includes("store.playstation.com") && text.includes("/category/")) {
    await handleCategory(msg.chat.id, text.trim());
  }
});

async function handleCategory(chatId, trCategoryUrl) {
  try {
    await bot.sendMessage(chatId, "Yoxlayıram… (səhifədə görünən ilk 24 oyun)");

    const rates = await getFxAZN();

    const browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
    });

    try {
      const trProducts = await getCategoryProducts(browser, trCategoryUrl, 24);

      // TR linkini UA locale-ə çeviririk
      const pairs = trProducts.map((trUrl) => {
        const uaUrl = trUrl
          .replace("/en-tr/", "/ru-ua/")
          .replace("/tr-tr/", "/ru-ua/");
        return { trUrl, uaUrl };
      });

      // Paralelliyi 2-3 saxla (blok riskini azaldır)
      const results = await mapLimit(pairs, 3, async ({ trUrl, uaUrl }) => {
        const tr = await scrapeProduct(browser, trUrl);
        const ua = await scrapeProduct(browser, uaUrl);

        const trVal = parsePriceText(tr.priceText);
        const uaVal = parsePriceText(ua.priceText);

        const trAZN = ceilAZN(toAZN(trVal, "TRY", rates));
        const uaAZN = ceilAZN(toAZN(uaVal, "UAH", rates));

        return {
          title: tr.title || ua.title || "—",
          trText: tr.priceText || "—",
          uaText: ua.priceText || "—",
          trAZN,
          uaAZN
        };
      });

      // Telegram mesaj limitinə görə bölürük
      let out = `✅ Tapıldı: ${results.length}\n\n`;
      for (const r of results) {
        const block =
          `🎮 ${r.title}\n` +
          `🇹🇷 ${r.trText} → ${r.trAZN ?? "—"} ₼\n` +
          `🇺🇦 ${r.uaText} → ${r.uaAZN ?? "—"} ₼\n\n`;

        if (out.length + block.length > 3500) {
          await bot.sendMessage(chatId, out);
          out = "";
        }
        out += block;
      }
      if (out.trim()) await bot.sendMessage(chatId, out);

      await bot.sendMessage(chatId, "Bitdi ✅");
    } finally {
      await browser.close().catch(() => {});
    }
  } catch (e) {
    await bot.sendMessage(chatId, `Xəta: ${e.message}`);
  }
}

console.log("Bot başladı…");
