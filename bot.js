import { Telegraf } from "telegraf";
import { fetch } from "undici";
import { startServer } from "./render.js";

/**
 * ENV:
 * BOT_TOKEN=xxxx
 * TL_TO_AZN=0.039 (optional)
 * UAH_TO_AZN=0.039 (optional)
 * FX_MODE=auto | manual   (default auto)
 */

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("BOT_TOKEN yoxdur!");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// ---- SETTINGS
const DEFAULT_LIMIT = 24;
const FX_MODE = (process.env.FX_MODE || "auto").toLowerCase(); // auto | manual
const MANUAL_TL_TO_AZN = parseFloat(process.env.TL_TO_AZN || "0");
const MANUAL_UAH_TO_AZN = parseFloat(process.env.UAH_TO_AZN || "0");

// ---- FX cache
let fxCache = {
  tl_to_azn: MANUAL_TL_TO_AZN || 0,
  uah_to_azn: MANUAL_UAH_TO_AZN || 0,
  ts: 0
};

function nowMs() {
  return Date.now();
}

async function getFxRates() {
  // manual mode
  if (FX_MODE === "manual") {
    return {
      tl_to_azn: MANUAL_TL_TO_AZN || 0,
      uah_to_azn: MANUAL_UAH_TO_AZN || 0,
      source: "manual"
    };
  }

  // auto mode (cache 6h)
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  if (fxCache.ts && nowMs() - fxCache.ts < SIX_HOURS && fxCache.tl_to_azn && fxCache.uah_to_azn) {
    return { tl_to_azn: fxCache.tl_to_azn, uah_to_azn: fxCache.uah_to_azn, source: "cache" };
  }

  // try fetch live rates
  // exchangerate.host: base=TRY symbol=AZN and base=UAH symbol=AZN
  try {
    const [tr, ua] = await Promise.all([
      fetchJson("https://api.exchangerate.host/latest?base=TRY&symbols=AZN"),
      fetchJson("https://api.exchangerate.host/latest?base=UAH&symbols=AZN")
    ]);

    const tl_to_azn = tr?.rates?.AZN;
    const uah_to_azn = ua?.rates?.AZN;

    if (typeof tl_to_azn === "number" && typeof uah_to_azn === "number") {
      fxCache = { tl_to_azn, uah_to_azn, ts: nowMs() };
      return { tl_to_azn, uah_to_azn, source: "exchangerate.host" };
    }
  } catch (_) {}

  // fallback to manual values if provided
  const tl_to_azn = MANUAL_TL_TO_AZN || 0;
  const uah_to_azn = MANUAL_UAH_TO_AZN || 0;
  fxCache = { tl_to_azn, uah_to_azn, ts: nowMs() };
  return { tl_to_azn, uah_to_azn, source: "fallback-manual" };
}

async function fetchText(url, extraHeaders = {}) {
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Linux; Android 12; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      ...extraHeaders
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

async function fetchJson(url, extraHeaders = {}) {
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Linux; Android 12; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      "accept": "application/json",
      ...extraHeaders
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

function normalizeSpaces(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function formatMoney(amount, currency) {
  if (amount == null || Number.isNaN(amount)) return "-";
  // amount could be "2899.99" or 2899.99
  const n = typeof amount === "string" ? parseFloat(amount.replace(",", ".")) : amount;
  if (!Number.isFinite(n)) return "-";
  // TR uses comma, UA also commonly uses comma; we keep 2 decimals and replace dot->comma for display
  return `${n.toFixed(2).replace(".", ",")} ${currency}`;
}

function tryBuildLocaleUrl(inputUrl, locale) {
  // input: https://store.playstation.com/tr-tr/product/XXXX  OR /en-us/product/...
  // output: replace /xx-xx/ with /locale/
  try {
    const u = new URL(inputUrl);
    const parts = u.pathname.split("/").filter(Boolean); // [locale, product, ...]
    if (parts.length >= 2) {
      parts[0] = locale;
      u.pathname = "/" + parts.join("/");
      return u.toString();
    }
    return inputUrl;
  } catch {
    return inputUrl;
  }
}

function isCategoryUrl(url) {
  return /\/category\//i.test(url);
}
function isProductUrl(url) {
  return /\/product\//i.test(url);
}

function extractNextData(html) {
  // Next.js script tag: <script id="__NEXT_DATA__" type="application/json">...</script>
  const marker = 'id="__NEXT_DATA__"';
  const idx = html.indexOf(marker);
  if (idx === -1) return null;

  const start = html.indexOf(">", idx);
  if (start === -1) return null;
  const end = html.indexOf("</script>", start);
  if (end === -1) return null;

  const jsonText = html.slice(start + 1, end).trim();
  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

// Iterative scan to avoid "Maximum call stack size exceeded"
function scanForProductCards(nextData) {
  // We’ll try to find objects that look like product cards:
  // - have "name"/"title"/"displayName"
  // - have prices with currency codes
  // - have url / productId
  const found = [];
  const seen = new Set();

  const queue = [nextData];
  while (queue.length) {
    const cur = queue.shift();
    if (!cur || typeof cur !== "object") continue;

    // detect product-like nodes
    // Heuristic: has fields that look like product + price
    const name =
      cur.name || cur.displayName || cur.title || cur.conceptName || cur.productName || cur.localizedName;

    // Some pages include "Access Denied" blocks — filter them out
    const safeName = normalizeSpaces(name);
    const looksBadName = safeName.toLowerCase() === "access denied" || safeName.length < 2;

    // price variants:
    // try common keys
    const priceObj =
      cur.price ||
      cur.prices ||
      cur.defaultSku?.price ||
      cur.sku?.price ||
      cur.offer?.price ||
      cur.discountedPrice ||
      null;

    // url variants
    const url = cur.url || cur.webUrl || cur.productUrl || cur.href || cur.link || null;

    // id variants
    const pid = cur.id || cur.productId || cur.conceptId || cur.skuId || cur.entityId || null;

    // Try to extract a numeric price and currency
    // Possible shapes:
    // 1) { basePrice: { value: 2899.99, currencyCode: "TRY" }, ...}
    // 2) { value: 2899.99, currencyCode: "TRY" }
    // 3) { formattedPrice: "2.899,99 TL" }
    let value = null;
    let currency = null;
    let formatted = null;

    const tryRead = (obj) => {
      if (!obj || typeof obj !== "object") return;

      // formatted
      if (typeof obj.formattedPrice === "string") formatted = obj.formattedPrice;
      if (typeof obj.displayPrice === "string") formatted = obj.displayPrice;
      if (typeof obj.formatted === "string") formatted = obj.formatted;

      // value
      if (typeof obj.value === "number") value = obj.value;
      if (typeof obj.amount === "number") value = obj.amount;
      if (typeof obj.val === "number") value = obj.val;

      // currency
      if (typeof obj.currencyCode === "string") currency = obj.currencyCode;
      if (typeof obj.currency === "string") currency = obj.currency;
      if (typeof obj.isoCurrencyCode === "string") currency = obj.isoCurrencyCode;

      // nested basePrice/discountedPrice
      if (obj.basePrice && typeof obj.basePrice === "object") tryRead(obj.basePrice);
      if (obj.discountedPrice && typeof obj.discountedPrice === "object") tryRead(obj.discountedPrice);
      if (obj.finalPrice && typeof obj.finalPrice === "object") tryRead(obj.finalPrice);
      if (obj.price && typeof obj.price === "object") tryRead(obj.price);
    };

    tryRead(priceObj);

    const hasSomePrice = formatted || (value != null && currency);

    if (safeName && !looksBadName && hasSomePrice) {
      const key = pid || url || safeName;
      if (!seen.has(key)) {
        seen.add(key);
        found.push({
          name: safeName,
          value,
          currency,
          formatted: formatted ? normalizeSpaces(formatted) : null,
          url: url ? String(url) : null
        });
      }
    }

    // push children
    for (const v of Object.values(cur)) {
      if (v && typeof v === "object") queue.push(v);
    }
  }

  return found;
}

function pickBestPrice(productCards, preferredCurrencies) {
  // pick first card that matches currency
  for (const cur of preferredCurrencies) {
    const hit = productCards.find((x) => (x.currency || "").toUpperCase() === cur);
    if (hit) return hit;
  }
  // fallback any
  return productCards[0] || null;
}

async function fetchProductInfoForLocale(productUrl, locale) {
  const url = tryBuildLocaleUrl(productUrl, locale);

  // Some locales for UA: ru-ua, uk-ua, en-ua
  const tryLocales = locale === "ua" ? ["ru-ua", "uk-ua", "en-ua"] : [locale];

  for (const loc of tryLocales) {
    try {
      const u = tryBuildLocaleUrl(productUrl, loc);
      const html = await fetchText(u, { "accept-language": loc });
      const nextData = extractNextData(html);
      if (!nextData) continue;

      const cards = scanForProductCards(nextData);

      // For product page, we want 1 game. Usually first best card is ok.
      // For TR -> TRY, UA -> UAH
      const preferred = loc === "tr-tr" ? ["TRY", "TL"] : ["UAH"];
      const best = pickBestPrice(cards, preferred);

      if (best) {
        return {
          ok: true,
          locale: loc,
          name: best.name,
          priceFormatted: best.formatted,
          priceValue: best.value,
          currency: (best.currency || (loc === "tr-tr" ? "TRY" : "UAH")).toUpperCase()
        };
      }
    } catch (_) {}
  }

  return { ok: false };
}

async function fetchCategoryProducts(categoryUrl, limit = DEFAULT_LIMIT) {
  // We will fetch TR category page and extract product URLs from __NEXT_DATA__ by scanning.
  // Then for each product URL, fetch TR+UA price by product page parsing.

  const trUrl = tryBuildLocaleUrl(categoryUrl, "tr-tr");
  const html = await fetchText(trUrl, { "accept-language": "tr-tr" });
  const nextData = extractNextData(html);
  if (!nextData) throw new Error("Category __NEXT_DATA__ tapılmadı (bloklana bilər).");

  // Scan for product-like nodes that contain url
  const cards = scanForProductCards(nextData)
    .filter((x) => x.url && isProductUrl(x.url))
    .map((x) => ({
      url: x.url.startsWith("http") ? x.url : "https://store.playstation.com" + x.url
    }));

  // unique urls
  const uniq = [];
  const seen = new Set();
  for (const c of cards) {
    if (!seen.has(c.url)) {
      seen.add(c.url);
      uniq.push(c.url);
    }
  }

  const sliced = uniq.slice(0, limit);

  return sliced;
}

function toAZN(value, rate) {
  if (!value || !rate) return null;
  const n = typeof value === "string" ? parseFloat(value.replace(",", ".")) : value;
  if (!Number.isFinite(n)) return null;
  const m = n * rate;
  return Math.round(m * 100) / 100;
}

function fmtAZN(v) {
  if (v == null) return "-";
  return `${v.toFixed(2).replace(".", ",")} AZN`;
}

async function handleProduct(ctx, productUrl) {
  await ctx.reply("Yoxlayıram... (TR + UA)");

  const [fx, tr, ua] = await Promise.all([
    getFxRates(),
    fetchProductInfoForLocale(productUrl, "tr-tr"),
    fetchProductInfoForLocale(productUrl, "ua")
  ]);

  if (!tr.ok && !ua.ok) {
    return ctx.reply("Oyun tapılmadı və ya səhifə bloklandı.");
  }

  const title = tr.ok ? tr.name : ua.name;

  // Parse numeric for AZN
  const trAZN = tr.ok ? toAZN(tr.priceValue, fx.tl_to_azn) : null;
  const uaAZN = ua.ok ? toAZN(ua.priceValue, fx.uah_to_azn) : null;

  const trLine = tr.ok
    ? `TR: ${tr.priceFormatted || formatMoney(tr.priceValue, "TL")}`
    : `TR: -`;
  const uaLine = ua.ok
    ? `UA: ${ua.priceFormatted || formatMoney(ua.priceValue, "UAH")}`
    : `UA: -`;

  const aznLines = `AZN (təxmini):\nTR → ${fmtAZN(trAZN)}\nUA → ${fmtAZN(uaAZN)}`;

  return ctx.reply(`${title}\n\n${trLine}\n${uaLine}\n\n${aznLines}`);
}

async function handleCategory(ctx, categoryUrl, limit = DEFAULT_LIMIT) {
  await ctx.reply(`Yoxlayıram... (səhifədə görünən ilk ${limit} oyun)`);

  const productUrls = await fetchCategoryProducts(categoryUrl, limit);

  if (!productUrls.length) {
    return ctx.reply("Category-də oyun tapılmadı (bloklana bilər).");
  }

  const fx = await getFxRates();

  // sequential to avoid hitting rate limits
  const lines = [];
  let okCount = 0;

  for (let i = 0; i < productUrls.length; i++) {
    const url = productUrls[i];

    const tr = await fetchProductInfoForLocale(url, "tr-tr");
    const ua = await fetchProductInfoForLocale(url, "ua");

    // If both fail, skip
    if (!tr.ok && !ua.ok) continue;

    okCount++;

    const title = tr.ok ? tr.name : ua.name;

    // numeric values for AZN
    const trAZN = tr.ok ? toAZN(tr.priceValue, fx.tl_to_azn) : null;
    const uaAZN = ua.ok ? toAZN(ua.priceValue, fx.uah_to_azn) : null;

    const trText = tr.ok ? (tr.priceFormatted || formatMoney(tr.priceValue, "TL")) : "-";
    const uaText = ua.ok ? (ua.priceFormatted || formatMoney(ua.priceValue, "UAH")) : "-";

    // compact line:
    lines.push(
      `🎮 ${title}\n🇹🇷 ${trText} → ${fmtAZN(trAZN)}\n🇺🇦 ${uaText} → ${fmtAZN(uaAZN)}`
    );

    // Telegram message size limit — split every ~8 items
    if (lines.length === 8) {
      await ctx.reply(lines.join("\n\n"));
      lines.length = 0;
    }
  }

  if (lines.length) await ctx.reply(lines.join("\n\n"));

  if (!okCount) return ctx.reply("Heç bir oyun oxuna bilmədi (bloklana bilər).");
  return ctx.reply(`✅ Tapıldı: ${okCount}`);
}

// ---- Commands
bot.start(async (ctx) => {
  await ctx.reply(
    `Salam 👋\nKomandalar:\n\n` +
      `/p <product_link>\n— 1 oyunun TR+UA qiyməti (+ AZN)\n\n` +
      `/cat <category_link> [limit]\n— category səhifəsindəki oyunları çıxarır (default 24)\n\n` +
      `Qeyd:\n- Railway-də Replicas = 1 olsun (yoxsa Telegram polling conflict verir).\n- FX_MODE=auto ilə kursu özü götürür, istəsən manual et: FX_MODE=manual + TL_TO_AZN + UAH_TO_AZN`
  );
});

bot.command("p", async (ctx) => {
  const text = (ctx.message?.text || "").trim();
  const parts = text.split(/\s+/);
  const url = parts[1];
  if (!url || !isProductUrl(url)) {
    return ctx.reply("PS Store product link göndər. Misal: https://store.playstation.com/tr-tr/product/...");
  }
  try {
    await handleProduct(ctx, url);
  } catch (e) {
    await ctx.reply("Xəta baş verdi: " + (e?.message || "unknown"));
  }
});

bot.command("cat", async (ctx) => {
  const text = (ctx.message?.text || "").trim();
  const parts = text.split(/\s+/);
  const url = parts[1];
  const limit = Math.max(1, Math.min(parseInt(parts[2] || DEFAULT_LIMIT, 10) || DEFAULT_LIMIT, 100));

  if (!url || !isCategoryUrl(url)) {
    return ctx.reply("PS Store category link at. Misal: https://store.playstation.com/tr-tr/category/.../1");
  }

  try {
    await handleCategory(ctx, url, limit);
  } catch (e) {
    await ctx.reply("Xəta baş verdi: " + (e?.message || "unknown"));
  }
});

// If user sends link directly
bot.on("text", async (ctx) => {
  const text = (ctx.message?.text || "").trim();
  const url = text.match(/https?:\/\/\S+/)?.[0];

  if (!url) return;

  try {
    if (isProductUrl(url)) return handleProduct(ctx, url);
    if (isCategoryUrl(url)) return handleCategory(ctx, url, DEFAULT_LIMIT);
  } catch (e) {
    return ctx.reply("Xəta baş verdi: " + (e?.message || "unknown"));
  }
});

// ---- Start
startServer(); // Railway keep-alive
bot.launch({
  dropPendingUpdates: true
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

console.log("Bot started.");
