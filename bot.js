import TelegramBot from "node-telegram-bot-api";

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) {
  throw new Error("BOT_TOKEN env yoxdur. Railway -> Variables -> BOT_TOKEN əlavə et.");
}

const bot = new TelegramBot(TOKEN, { polling: true });

/**
 * PlayStation Store "Chihiro" API endpoint formatı:
 * /store/api/chihiro/00_09_000/container/{COUNTRY}/{LANG}/999/{CONTENT_ID}
 *
 * Mənbə: PS Store chihiro endpoint nümunələri (container formatı) 0
 */

const LOCALES = {
  TR: { country: "TR", lang: "tr", currency: "TRY" },
  UA: { country: "UA", lang: "uk", currency: "UAH" }
};

// Node 18+ fetch var (Railway node 20/22 olur adətən)
async function fetchJson(url, { timeoutMs = 15000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36",
        "accept": "application/json,text/plain,*/*"
      }
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${res.statusText} | ${text.slice(0, 200)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function extractProductId(input) {
  // qəbul edir:
  // https://store.playstation.com/tr-tr/product/UP0006-PPSA27360_00-26STANDARDBUNDLE
  // https://store.playstation.com/en-us/product/UP0002-PPSA01649_00-CODB07CROSSSGEN01
  const m = String(input).match(/\/product\/([A-Z0-9_-]+)/i);
  return m ? m[1] : null;
}

function pickPriceInfo(data) {
  // Chihiro JSON-da ən çox bunlar olur:
  // data.name
  // data.default_sku?.display_price
  // data.default_sku?.prices (bəzən)
  // data.default_sku?.price (bəzən)
  const name =
    data?.name ||
    data?.localized_name ||
    data?.title_name ||
    data?.long_name ||
    "Ad tapılmadı";

  const sku = data?.default_sku || null;

  // display_price ən stabil field-lərdən olur (məs: "299,99 TL")
  const displayPrice =
    sku?.display_price ||
    sku?.price?.display ||
    sku?.prices?.[0]?.display_price ||
    null;

  // end date (hamısında olmaya bilər)
  const offerEnd =
    sku?.price?.offer_end_date ||
    sku?.prices?.[0]?.offer_end_date ||
    sku?.price?.end_date ||
    sku?.prices?.[0]?.end_date ||
    null;

  // endirim faizi bəzən olur
  const discount =
    sku?.price?.discount_percentage ??
    sku?.prices?.[0]?.discount_percentage ??
    null;

  return { name, displayPrice, offerEnd, discount };
}

function buildChihiroUrl({ country, lang }, productId) {
  return `https://store.playstation.com/store/api/chihiro/00_09_000/container/${country}/${lang}/999/${productId}`;
}

// gündəlik məzənnə (AZN çevirmə)
// open.er-api.com pulsuz “latest/{BASE}” verir 
async function getRates(base) {
  const url = `https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`;
  const j = await fetchJson(url);
  if (j?.result !== "success" || !j?.rates) {
    throw new Error("Məzənnə API cavabı problemli oldu.");
  }
  return j.rates;
}

function tryParseNumberFromDisplay(display) {
  // "299,99 TL" -> 299.99
  // "1.299,99 TL" -> 1299.99
  if (!display) return null;
  const s = String(display)
    .replace(/[^\d.,]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

async function getRegionResult(regionKey, productId) {
  const loc = LOCALES[regionKey];
  const url = buildChihiroUrl(loc, productId);
  const data = await fetchJson(url);
  const info = pickPriceInfo(data);
  return { regionKey, ...info, currency: loc.currency };
}

function formatLine(label, value) {
  return value ? `${label}: ${value}` : `${label}: -`;
}

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(
    chatId,
    [
      "PS Store product link göndər.",
      "",
      "Misal:",
      "https://store.playstation.com/tr-tr/product/UP0006-PPSA27360_00-26STANDARDBUNDLE",
      "",
      "Və ya /p <link>"
    ].join("\n")
  );
});

bot.onText(/\/p (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const link = match?.[1]?.trim();
  await handleProduct(chatId, link);
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();

  // /start və /p handler-ləri ayrıdı, burda sadəcə URL tuturuq
  if (!text) return;
  if (text.startsWith("/")) return;

  if (text.includes("store.playstation.com") && text.includes("/product/")) {
    await handleProduct(chatId, text);
  }
});

async function handleProduct(chatId, link) {
  const productId = extractProductId(link);
  if (!productId) {
    await bot.sendMessage(chatId, "Product link düzgün deyil. /product/.... olmalıdır.");
    return;
  }

  await bot.sendMessage(chatId, "Yoxlayıram... (TR + UA)");

  try {
    // paralel sorğu
    const [tr, ua] = await Promise.all([
      getRegionResult("TR", productId),
      getRegionResult("UA", productId)
    ]);

    // ad: TR-dən götürək, boşdursa UA
    const title = tr.name && tr.name !== "Ad tapılmadı" ? tr.name : ua.name;

    // AZN çevirmə (istəsən göstərək)
    // TRY->AZN, UAH->AZN
    let aznBlock = "";
    try {
      const [tryRates, uahRates] = await Promise.all([getRates("TRY"), getRates("UAH")]);
      const trNum = tryParseNumberFromDisplay(tr.displayPrice);
      const uaNum = tryParseNumberFromDisplay(ua.displayPrice);

      const tryToAzn = tryRates?.AZN;
      const uahToAzn = uahRates?.AZN;

      if (tryToAzn && uahToAzn) {
        const trAzn = trNum != null ? (trNum * tryToAzn) : null;
        const uaAzn = uaNum != null ? (uaNum * uahToAzn) : null;

        aznBlock =
          "\n\n" +
          "AZN (təxmini):\n" +
          `TR → ${trAzn != null ? trAzn.toFixed(2) : "-"} AZN\n` +
          `UA → ${uaAzn != null ? uaAzn.toFixed(2) : "-"} AZN`;
      }
    } catch {
      // məzənnə alınmasa sadəcə göstərməyək
    }

    const lines = [
      `🎮 ${title}`,
      "",
      formatLine("TR", tr.displayPrice),
      formatLine("UA", ua.displayPrice)
    ];

    // endirim bitmə tarixi varsa (hər məhsulda olmur)
    const endDate = tr.offerEnd || ua.offerEnd;
    if (endDate) lines.push("", `⏳ Endirim bitmə: ${endDate}`);

    // endirim faizi varsa
    const disc = tr.discount ?? ua.discount;
    if (disc != null) lines.push(`🔻 Endirim: ${disc}%`);

    const out = lines.join("\n") + aznBlock;

    await bot.sendMessage(chatId, out, {
      disable_web_page_preview: true
    });
  } catch (e) {
    await bot.sendMessage(
      chatId,
      `Xəta baş verdi: ${String(e?.message || e).slice(0, 300)}`
    );
  }
}
