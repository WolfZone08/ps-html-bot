import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";

export async function renderImage(data) {
  const {
    title,
    cover,
    trPrice,
    uaPrice,
    endDate,
    platform
  } = data;

  const templatePath = path.resolve("./template.html");
  let html = fs.readFileSync(templatePath, "utf8");

  // Replace placeholders
  html = html
    .replace("{{TITLE}}", title)
    .replace("{{COVER}}", cover)
    .replace("{{TR_PRICE}}", trPrice)
    .replace("{{UA_PRICE}}", uaPrice)
    .replace("{{END_DATE}}", endDate)
    .replace("{{PLATFORM}}", platform);

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

  // 🔥 AUTO TITLE SIZE
  await page.evaluate(() => {
    const title = document.getElementById("title");
    let size = 60;
    title.style.fontSize = size + "px";

    while (title.scrollHeight > title.clientHeight && size > 34) {
      size -= 2;
      title.style.fontSize = size + "px";
    }
  });

  const imagePath = path.resolve("./output.png");

  await page.screenshot({
    path: imagePath,
    type: "png"
  });

  await browser.close();

  return imagePath;
}
