import puppeteer from "puppeteer";
import fs from "fs/promises";

export async function render(data) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox"]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1350 });

  await page.goto("file://" + process.cwd() + "/template.html");

  await page.evaluate((d) => {
    document.getElementById("title").textContent = d.title;
    document.getElementById("price_tr").textContent = d.tr;
    document.getElementById("price_ua").textContent = d.ua;
    document.getElementById("platform").textContent = d.platform;
    document.getElementById("endDate").textContent = d.date;
  }, data);

  const img = "data:image/jpeg;base64," + (await fs.readFile(data.cover)).toString("base64");
  await page.evaluate((src)=>{document.getElementById("cover").src=src}, img);

  const buf = await page.screenshot({type:"jpeg",quality:92});
  await browser.close();
  return buf;
}
