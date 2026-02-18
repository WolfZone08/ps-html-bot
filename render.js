import puppeteer from "puppeteer";

export async function renderImage(game) {
  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();

  const html = `
  <html>
  <body style="
    margin:0;
    width:800px;
    height:1000px;
    background:#140018;
    color:white;
    font-family:Arial;
    text-align:center;
    padding:40px;
  ">
    <h2 style="font-size:36px;">${game.title}</h2>
    <img src="${game.image}" 
         style="width:400px;height:400px;object-fit:cover;border-radius:20px;margin:30px 0;" />
    <h3>TR: ${game.tr}</h3>
    <h3>UA: ${game.ua}</h3>
    <p>Endirim bitmə tarixi: ${game.date}</p>
  </body>
  </html>
  `;

  await page.setContent(html);
  const file = await page.screenshot({ path: "output.jpg" });

  await browser.close();
  return file;
}
