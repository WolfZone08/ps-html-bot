import fs from "fs/promises";
import path from "path";
import puppeteer from "puppeteer";

export async function renderImage(data) {
  const templatePath = path.join(process.cwd(), "template.html");
  const html = await fs.readFile(templatePath, "utf8");

  const browser = await puppeteer.launch({
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--font-render-hinting=none"
    ]
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 628, deviceScaleFactor: 2 });

    // template-ə DATA ötürürük
    const injected = html.replace(
      "</head>",
      `<script>window.__DATA__=${JSON.stringify(data)};</script></head>`
    );

    await page.setContent(injected, { waitUntil: "networkidle0" });

    // şəkil yüklənsin deyə gözləyirik
    await page.waitForTimeout(400);

    const buffer = await page.screenshot({ type: "png", fullPage: false });
    return buffer;
  } finally {
    await browser.close();
  }
}
