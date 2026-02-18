import puppeteer from "puppeteer";
import fs from "fs";

export async function renderImage(data) {

  try {

    // HTML oxu və dəyiş
    let html = fs.readFileSync("./template.html", "utf8");

    html = html
      .replace("{{TITLE}}", data.title || "")
      .replace("{{COVER}}", data.cover || "")
      .replace("{{TR_PRICE}}", data.trPrice || "-")
      .replace("{{UA_PRICE}}", data.uaPrice || "-")
      .replace("{{END_DATE}}", data.endDate || "")
      .replace("{{PLATFORM}}", data.platform || "PS4 • PS5");

    // Browser aç
    const browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const page = await browser.newPage();

    await page.setViewport({
      width: 1080,
      height: 1350
    });

    await page.setContent(html, { waitUntil: "networkidle0" });

    // AUTO TITLE SIZE (Crash Safe)
    await page.evaluate(() => {
      const el = document.getElementById("title");
      if (!el) return;

      let size = 60;
      el.style.fontSize = size + "px";

      while (el.scrollHeight > el.clientHeight && size > 34) {
        size -= 2;
        el.style.fontSize = size + "px";
      }
    });

    // Şəkili buffer kimi götür
    const buffer = await page.screenshot({
      type: "png"
    });

    await browser.close();

    return buffer;

  } catch (err) {
    console.error("RENDER ERROR:", err);
    throw err;
  }
}
