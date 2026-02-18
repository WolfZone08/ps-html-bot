import { Telegraf } from "telegraf";
import fetch from "node-fetch";

// ================== CONFIG ==================
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("BOT_TOKEN env yoxdur!");
  process.exit(1);
}

// Sadə AZN çevirmə (istəsən sonra API ilə canlı edərik)
const TL_TO_AZN = Number(process.env.TL_TO_AZN || 0.0389);
const UAH_TO_AZN = Number(process.env.UAH_TO_AZN || 0.0393);

// Category limit (default 24)
const DEFAULT_CAT_LIMIT = 24;
const MAX_CAT_LIMIT = 60;

// Parallel sorğu limiti (blok olmasın)
const PARALLEL = 3;
const PER_REQUEST_DELAY_MS = 250;

// ================== HELPERS ==================
const bot = new Telegraf(BOT_TOKEN);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function chunkText(text, max = 3500) {
  const lines = text.split("\n");
  const parts = [];
  let cur = "";
  for (const line of lines) {
    if ((cur + "\n" + line).length > max) {
      parts.push(cur);
      cur = line;
    } else {
      cur = cur ? cur + "\n" + line : line;
    }
  }
  if (cur) parts.push(cur);
  return parts;
}

function normalizeUrl(u) {
  try {
    const url = new URL(u);
    return url.toString();
  } catch {
    return null;
  }
}

function productIdFromProductUrl(urlStr) {
  // https://store.playstation.com/tr-tr/product/UP0006-PPSA27360_00-26STANDARDBUNDLE
  const m = urlStr.match(/\/product\/([^/?#]+)/i);
  return m ? m[1] : null;
}

function isPlayStationStore(urlStr) {
  return /^https?:\/\/store\.playstation\.com\//i.test(urlStr);
}

async function fetchHtml(url, acceptLang) {
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36",
      "accept-language": acceptLang,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });
  return await res.text();
}

async function fetchNextData(url, acceptLang) {
  const html = await fetchHtml(url, acceptLang);
  const m = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/s
  );
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

// JSON içində price/title üçün “universal” axtarış fallback
function deepFindFirstString(obj, predicates, maxDepth = 12) {
  const seen = new Set();
  function walk(x, depth) {
    if (!x || depth > maxDepth) return null;
    if (typeof x === "string") {
      for (const p of predicates) if (p(x)) return x;
      return null;
    }
    if (typeof x !== "object") return null;
    if (seen.has(x)) return null;
    seen.add(x);

    if (Array.isArray(x)) {
      for (const it of x) {
        const r = walk(it, depth + 1);
        if (r) return r;
      }
      return null;
    }

    for (const k of Object.keys(x)) {
      const r = walk(x[k], depth + 1);
      if (r) return r;
    }
    return null;
  }
  return walk(obj, 0);
}

function parseMoneyFromText(str, currency) {
  if (!str) return null;
  // TR: "2.899,99 TL"  UA: "2 399,00 UAH"
  const m = str.match(/(\d[\d\.\s]*,\d{2})\s*(TL|UAH)/i);
  if (!m) return null;
  const num = m[1].replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const val = Number(num);
  if (!Number.isFinite(val)) return null;
  return { currency: currency.toUpperCase(), value: val };
}

function formatPriceLine(flag, money, rate) {
  if (!money) return `${flag} -`;
  const azn = money.value * rate;
  const moneyTxt =
    money.currency === "TL"
      ? `${money.value.toLocaleString("tr-TR")} TL`
      : `${money.value.toLocaleString("uk-UA")} UAH`;
  return `${flag} ${moneyTxt} → ${azn.toFixed(2)} AZN`;
}

// ================== CORE: PRODUCT ==================
async function getProductTRUAById(productId) {
  const trUrl = `https://store.playstation.com/tr-tr/product/${productId}`;
  const uaUrl = `https://store.playstation.com/en-ua/product/${productId}`;

  const [trData, uaData] = await Promise.all([
    fetchNextData(trUrl, "tr-TR,tr;q=0.9,en;q=0.8"),
    fetchNextData(uaUrl, "uk-UA,uk;q=0.9,en;q=0.8")
  ]);

  // title (TR üstün)
  let title =
    trData?.props?.pageProps?.product?.name ||
    uaData?.props?.pageProps?.product?.name ||
    deepFindFirstString(trData, [(s) => s.length > 3 && s.length < 120 && !s.includes("http")]) ||
    deepFindFirstString(uaData, [(s) => s.length > 3 && s.length < 120 && !s.includes("http")]) ||
    "Unknown Title";

  // price string axtarış (JSON içində “TL/UAH” olan ilk string)
  const trPriceStr = trData
    ? deepFindFirstString(trData, [(s) => /TL/i.test(s) && /,\d{2}/.test(s)])
    : null;
  const uaPriceStr = uaData
    ? deepFindFirstString(uaData, [(s) => /UAH/i.test(s) && /,\d{2}/.test(s)])
    : null;

  const tr = parseMoneyFromText(trPriceStr, "TL");
  const ua = parseMoneyFromText(uaPriceStr, "UAH");

  return { title, tr, ua, trUrl, uaUrl };
}

// ================== CORE: CATEGORY ==================
function extractProductIdsFromNextData(nextData) {
  // ən universal: JSON stringify + regex
  const out = new Set();
  const s = JSON.stringify(nextData);

  // productId formatı çox vaxt belə olur:
  // UP0006-PPSA27360_00-26STANDARDBUNDLE
  const re = /[A-Z]{2}\d{4}-[A-Z0-9]{4}\d{5}_[A-Z0-9]{2}-[A-Z0-9_]+/g;
  const hits = s.match(re) || [];
  for (const h of hits) out.add(h);

  return [...out];
}

async function getCategoryProductIds(categoryUrl) {
  const data = await fetchNextData(categoryUrl, "tr-TR,tr;q=0.9,en;q=0.8");
  if (!data) return [];
  return extractProductIdsFromNextData(data);
}

async function mapLimit(items, limit, mapper) {
  const res = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (idx < items.length) {
      const i = idx++;
      res[i] = await mapper(items[i], i);
    }
  });
  await Promise.all(workers);
  return res;
}

// ================== COMMANDS ==================
bot.start(async (ctx) => {
  await ctx.reply(
`Salam 👋
Komandalar:

/p <product_link>
— 1 oyunun TR+UA qiyməti (+ AZN)

/cat <category_link> [limit]
— category səhifəsindəki oyunları çıxarır (default 24)

Qeyd:
- BOT_TOKEN env mütləq olmalıdır.
- TL_TO_AZN və UAH_TO_AZN istəsən env ilə dəyiş.
`
  );
});

bot.command("p", async (ctx) => {
  const parts = ctx.message.text.split(" ").filter(Boolean);
  const link = normalizeUrl(parts[1] || "");
  if (!link || !isPlayStationStore(link)) {
    return ctx.reply("PS Store product link göndər. Misal: /p https://store.playstation.com/tr-tr/product/...");
  }
  const productId = productIdFromProductUrl(link);
  if (!productId) return ctx.reply("Bu linkdən productId çıxmadı. /product/.... olmalıdır.");

  await ctx.reply("Yoxlayıram... (TR + UA)");

  try {
    await sleep(PER_REQUEST_DELAY_MS);
    const r = await getProductTRUAById(productId);

    const msg =
`🎮 ${r.title}

${formatPriceLine("🇹🇷", r.tr, TL_TO_AZN)}
${formatPriceLine("🇺🇦", r.ua, UAH_TO_AZN)}

🔗 TR: ${r.trUrl}
🔗 UA: ${r.uaUrl}
`;
    return ctx.reply(msg);
  } catch (e) {
    return ctx.reply("Xəta baş verdi: " + (e?.message || "unknown"));
  }
});

bot.command("cat", async (ctx) => {
  const parts = ctx.message.text.split(" ").filter(Boolean);
  const link = normalizeUrl(parts[1] || "");
  let limit = Number(parts[2] || DEFAULT_CAT_LIMIT);
  if (!Number.isFinite(limit)) limit = DEFAULT_CAT_LIMIT;
  limit = Math.max(1, Math.min(limit, MAX_CAT_LIMIT));

  if (!link || !isPlayStationStore(link) || !/\/category\//i.test(link)) {
    return ctx.reply("Category link at. Misal: /cat https://store.playstation.com/tr-tr/category/.../1 24");
  }

  await ctx.reply(`Yoxlayıram... (səhifədə görünən ilk ${limit} oyun)`);

  const idsAll = await getCategoryProductIds(link);
  const ids = idsAll.slice(0, limit);

  if (!ids.length) {
    return ctx.reply("Bu category-də oyun tapılmadı və ya səhifə bloklandı.");
  }

  await ctx.reply(`✅ Tapıldı: ${ids.length}. Qiymətlər çıxarılır...`);

  const results = await mapLimit(ids, PARALLEL, async (productId) => {
    try {
      await sleep(PER_REQUEST_DELAY_MS);
      const r = await getProductTRUAById(productId);
      return { ok: true, productId, ...r };
    } catch {
      return { ok: false, productId };
    }
  });

  let text = `✅ Tapıldı: ${ids.length}\n\n`;

  for (const r of results) {
    if (!r.ok) {
      text += `🎮 (xəta/blok) ${r.productId}\n🇹🇷 -\n🇺🇦 -\n\n`;
      continue;
    }

    text +=
`🎮 ${r.title}
${formatPriceLine("🇹🇷", r.tr, TL_TO_AZN)}
${formatPriceLine("🇺🇦", r.ua, UAH_TO_AZN)}
\n`;
  }

  const partsMsg = chunkText(text, 3500);
  for (const p of partsMsg) await ctx.reply(p);
});

// Fallback: link göndərirsə avtomatik product kimi qəbul et
bot.on("text", async (ctx) => {
  const t = ctx.message.text.trim();
  const link = normalizeUrl(t);
  if (!link || !isPlayStationStore(link)) return;

  if (/\/product\//i.test(link)) {
    // /p kimi işlət
    ctx.message.text = `/p ${link}`;
    return bot.handleUpdate(ctx.update);
  }

  if (/\/category\//i.test(link)) {
    ctx.message.text = `/cat ${link} ${DEFAULT_CAT_LIMIT}`;
    return bot.handleUpdate(ctx.update);
  }
});

bot.launch();
console.log("Bot started ✅");
