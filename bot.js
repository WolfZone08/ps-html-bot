import TelegramBot from "node-telegram-bot-api";
import puppeteer from "puppeteer";
import { renderCardPng } from "./render.js";

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) throw new Error("BOT_TOKEN tapılmadı. Railway Variables-a əlavə et.");

const bot = new TelegramBot(TOKEN, { polling: true });

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "PlayStation oyun linkini göndər (product link).\nMisal:\nhttps://store.playstation.com/tr-tr/product/UP0006-PPSA27360_00-26STANDARDBUNDLE"
  );
});

function extractProductId(text) {
  const m = text.match(/\/product\/([A-Z0-9_-]+)/i);
  return m?.[1] || null;
}

function buildUrl(locale, productId) {
  return `https://store.playstation.com/${locale}/product/${productId}`;
}

function formatMoney(value, currency, locale) {
  if (typeof value !== "number") return "—";
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(value);
  } catch {
    return String(value);
  }
}

function formatDate(isoOrTs) {
  if (!isoOrTs) return "—";
  const d = typeof isoOrTs === "number" ? new Date(isoOrTs) : new Date(String(isoOrTs));
  if (isNaN(d.getTime())) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

function deepWalk(obj, fn) {
  const stack = [obj];
  const seen = new Set();
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    if (seen.has(cur)) continue;
    seen.add(cur);
    fn(cur);
    for (const k of Object.keys(cur)) stack.push(cur[k]);
  }
}

function pickBestProduct(nextData) {
  let best = null;
  deepWalk(nextData, (o) => {
    const name = o.name || o.title;
    const images = o.images || o.media || o.image || o.thumbnail || o.heroImage || o.conceptImages;
    const price = o.price || o.prices || o.priceInfo || o.offer || o.offers || o.skuPrice;

    if (typeof name === "string" && name.length > 2 && (images || price)) {
      const score = (images ? 2 : 0) + (price ? 2 : 0) + (name.length > 5 ? 1 : 0);
      if (!best || score > best.score) best = { score, o };
    }
  });
  return best?.o || null;
}

function extractInfoFromProduct(prod, locale) {
  let imageUrl = null;
  const imgCandidates = [];

  if (typeof prod?.image === "string") imgCandidates.push(prod.image);
  if (typeof prod?.thumbnail === "string") imgCandidates.push(prod.thumbnail);

  if (Array.isArray(prod?.images)) {
    for (const im of prod.images) {
      if (typeof im === "string") imgCandidates.push(im);
      if (im?.url) imgCandidates.push(im.url);
    }
  }
  if (Array.isArray(prod?.media)) {
    for (const m of prod.media) if (m?.url) imgCandidates.push(m.url);
  }
  imageUrl = imgCandidates.find((x) => typeof x === "string" && x.startsWith("http")) || null;

  const title = prod?.name || prod?.title || "—";

  let platform = "PS4 • PS5";
  if (typeof prod?.platform === "string") platform = prod.platform;
  if (Array.isArray(prod?.platforms) && prod.platforms.length) platform = prod.platforms.join(" • ");

  let currency = locale === "tr-tr" ? "TRY" : "UAH";
  let baseValue = null;
  let discountedValue = null;
  let endsAt = null;

  const priceObjects = [];
  deepWalk(prod, (o) => {
    if (!o || typeof o !== "object") return;
    if ("currencyCode" in o || "discountedPrice" in o || "basePrice" in o || "price" in o) priceObjects.push(o);
  });

  for (const p of priceObjects) {
    if (typeof p.currencyCode === "string") currency = p.currencyCode;

    const base =
      p.basePriceValue ?? p.basePrice ?? p.originalPriceValue ?? p.strikePriceValue ?? null;

    const disc =
      p.discountedPriceValue ?? p.discountedPrice ?? p.finalPriceValue ?? p.priceValue ?? null;

    const end = p.endTime ?? p.endDate ?? p.promotionEnd ?? p.discountEnd ?? null;

    if (typeof base === "number") baseValue = base;
    if (typeof disc === "number") discountedValue = disc;
    if (end && !endsAt) endsAt = end;
  }

  const current = discountedValue ?? baseValue;

  const localeTag = locale === "tr-tr" ? "tr-TR" : "uk-UA";

  return {
    title,
    platform,
    imageUrl,
    currency,
    currentText: formatMoney(current, currency, localeTag),
    oldText:
      typeof discountedValue === "number" &&
      typeof baseValue === "number" &&
      discountedValue < baseValue
        ? formatMoney(baseValue, currency, localeTag)
        : null,
    endsAtText: formatDate(endsAt)
  };
}

async function scrapePsProduct(browser, url, locale) {
  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36"
  );
  await page.setExtraHTTPHeaders({
    "accept-language": locale === "tr-tr" ? "tr-TR,tr;q=0.9,en;q=0.8" : "uk-UA,uk;q=0.9,ru-UA;q=0.8,en;q=0.7"
  });

  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

  const nextJson = await page.evaluate(() => {
    const el = document.querySelector("#__NEXT_DATA__");
    if (!el) return null;
    try { return JSON.parse(el.textContent); } catch { return null; }
  });

  await page.close();

  if (!nextJson) throw new Error("Səhifədən __NEXT_DATA__ oxunmadı (blok ola bilər).");

  const prod = pickBestProduct(nextJson);
  if (!prod) throw new Error("Məhsul datası tapılmadı (struktur dəyişib).");

  return extractInfoFromProduct(prod, locale);
}

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || "";
  if (text.startsWith("/start")) return;

  const productId = extractProductId(text);
  if (!productId) return bot.sendMessage(chatId, "Product link göndər. İçində `/product/XXXX` olmalıdır.");

  const trUrl = buildUrl("tr-tr", productId);
  const uaUrl = buildUrl("ru-ua", productId); // istəsən en-ua edərik

  await bot.sendMessage(chatId, "Yoxlayıram… (TR + UA)");

  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
  });

  try {
    const [tr, ua] = await Promise.all([
      scrapePsProduct(browser, trUrl, "tr-tr").catch((e) => ({ error: e.message })),
      scrapePsProduct(browser, uaUrl, "ru-ua").catch((e) => ({ error: e.message }))
    ]);

    // Mətn (qısa)
    const title = !tr.error ? tr.title : (!ua.error ? ua.title : productId);
    const imageUrl = (!tr.error && tr.imageUrl) ? tr.imageUrl : (!ua.error ? ua.imageUrl : null);
    const platform = !tr.error ? tr.platform : (!ua.error ? ua.platform : "—");

    const dateText = new Date().toLocaleString("az-AZ");

    // Dizayn PNG
    const png = await renderCardPng({
      title,
      platform,
      imageUrl,
      dateText,
      tr: {
        price: tr.error ? "—" : tr.currentText,
        oldPrice: tr.error ? null : tr.oldText,
        endsAtText: tr.error ? "—" : tr.endsAtText,
        url: trUrl,
        error: tr.error
      },
      ua: {
        price: ua.error ? "—" : ua.currentText,
        oldPrice: ua.error ? null : ua.oldText,
        endsAtText: ua.error ? "—" : ua.endsAtText,
        url: uaUrl,
        error: ua.error
      }
    });

    // Şəkil göndər
    await bot.sendPhoto(chatId, png, {
      caption: `${title}\nTR: ${tr.error ? "Xəta/Blok" : tr.currentText}\nUA: ${ua.error ? "Xəta/Blok" : ua.currentText}`
    });

  } catch (e) {
    await bot.sendMessage(chatId, `Xəta baş verdi: ${e.message}`);
  } finally {
    await browser.close();
  }
});
