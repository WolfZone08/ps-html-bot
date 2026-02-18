import fs from "fs/promises";
import path from "path";
import puppeteer from "puppeteer";

const TEMPLATE = path.join(process.cwd(), "template.html");

function esc(s){
  return String(s ?? "—");
}

export async function renderCard({
  title, imageUrl, platform, trPrice, uaPrice, endDate, url
}) {
  let html = await fs.readFile(TEMPLATE, "utf8");
  html = html
    .replace("{{TITLE}}", esc(title))
    .replace("{{IMAGE_URL}}", esc(imageUrl))
    .replace("{{PLATFORM}}", esc(platform || "—"))
    .replace("{{TR_PRICE}}", esc(trPrice || "—"))
    .replace("{{UA_PRICE}}", esc(uaPrice || "—"))
    .replace("{{END_DATE}}", esc(endDate || "—"))
    .replace("{{URL}}", esc(url || "—"));

  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 2 });

    await page.setContent(html, { waitUntil: "networkidle2", timeout: 60000 });

    // puppeteer versiyalarında waitForTimeout fərqli ola bilər – universal:
    await new Promise(r => setTimeout(r, 800));

    const png = await page.screenshot({ type: "png" });
    return png;
  } finally {
    await browser.close();
  }
}
