import fs from "fs/promises";
import path from "path";
import puppeteer from "puppeteer";

const TEMPLATE_PATH = path.join(process.cwd(), "template.html");

function safeText(x) {
  if (x === null || x === undefined) return "—";
  return String(x);
}

function badgeStatus(info) {
  if (info?.error) return { status: "err", label: "Blok/Xəta" };
  return { status: "ok", label: "OK" };
}

function endsStatus(endsText) {
  // boşdursa warn, varsa ok
  if (!endsText || endsText === "—") return "warn";
  return "ok";
}

function makeOldBlock(oldText) {
  if (!oldText) return "";
  return `<div class="old">${oldText}</div>`;
}

function replaceAll(html, map) {
  let out = html;
  for (const [k, v] of Object.entries(map)) {
    out = out.split(k).join(v);
  }
  return out;
}

/**
 * @param {object} data
 * data = {
 *  title, platform, imageUrl,
 *  tr: { price, oldPrice, endsAtText, url, error? },
 *  ua: { price, oldPrice, endsAtText, url, error? },
 *  dateText
 * }
 */
export async function renderCardPng(data) {
  const tpl = await fs.readFile(TEMPLATE_PATH, "utf8");

  const trB = badgeStatus(data.tr);
  const uaB = badgeStatus(data.ua);

  const html = replaceAll(tpl, {
    "{{DATE}}": safeText(data.dateText),
    "{{LOCALE_HINT}}": "TR + UA qiymət müqayisəsi",
    "{{TITLE}}": safeText(data.title),
    "{{PLATFORM}}": safeText(data.platform || "—"),
    "{{IMAGE_URL}}": safeText(data.imageUrl || "https://upload.wikimedia.org/wikipedia/commons/3/3a/Gray_circles_rotate.gif"),

    "{{TR_STATUS}}": trB.status,
    "{{TR_LABEL}}": trB.label,
    "{{TR_PRICE}}": safeText(data.tr?.price),
    "{{TR_OLD_BLOCK}}": makeOldBlock(data.tr?.oldPrice),
    "{{TR_ENDS}}": safeText(data.tr?.endsAtText),
    "{{TR_END_STATUS}}": endsStatus(data.tr?.endsAtText),
    "{{TR_URL}}": safeText(data.tr?.url),

    "{{UA_STATUS}}": uaB.status,
    "{{UA_LABEL}}": uaB.label,
    "{{UA_PRICE}}": safeText(data.ua?.price),
    "{{UA_OLD_BLOCK}}": makeOldBlock(data.ua?.oldPrice),
    "{{UA_ENDS}}": safeText(data.ua?.endsAtText),
    "{{UA_END_STATUS}}": endsStatus(data.ua?.endsAtText),
    "{{UA_URL}}": safeText(data.ua?.url)
  });

  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 2 });

    // şəkil yükü üçün timeout artırırıq
    await page.setContent(html, { waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForFunction(() => {
  const img = document.querySelector(".cover img");
  return img && img.complete;
}, { timeout: 15000 }).catch(() => {});

    // cover şəkli yüklənsin deyə qısa gözləmə
    await new Promise((r) => setTimeout(r, 800));

    const png = await page.screenshot({ type: "png", fullPage: false });
    return png;
  } finally {
    await browser.close();
  }
}
