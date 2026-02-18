import puppeteer from "puppeteer";

export async function renderImage({ title, priceTR, priceUA, image }) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();

  const html = `
  <html>
  <body style="
    margin:0;
    width:800px;
    height:800px;
    background:#1b0026;
    color:white;
    font-family:Arial;
    display:flex;
    flex-direction:column;
    align-items:center;
    justify-content:center;
  ">
    <h2 style="text-align:center;">${title}</h2>
    <img src="${image}" style="width:350px;border-radius:20px;margin:20px;" />
    <div style="font-size:28px;">
      TR: ${priceTR}
    </div>
    <div style="font-size:28px;">
      UA: ${priceUA}
    </div>
  </body>
  </html>
  `;

  await page.setContent(html, { waitUntil: "networkidle0" });

  await new Promise(r => setTimeout(r, 1000));

  const buffer = await page.screenshot({ type: "jpeg" });

  await browser.close();
  return buffer;
}
