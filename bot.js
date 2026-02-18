import TelegramBot from "node-telegram-bot-api";
import * as cheerio from "cheerio";
import fs from "fs/promises";
import { renderImage } from "./render.js";

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling:true });

const tiersTR = JSON.parse(await fs.readFile("tiers_tr.json"));
const tiersUA = JSON.parse(await fs.readFile("tiers_ua.json"));

function map(num, tiers){
  const t = tiers.find(x=>num>=x.min && num<=x.max);
  return t ? `${t.azn} ₼` : "-";
}

function toNum(str){
  if(!str)return null;
  const s=str.replace(/[^\d,.\s]/g,"").replace(/\.(?=\d{3})/g,"").replace(",",".");
  return Number(s);
}

function detectPlatform(text){
  const t=text.toLowerCase();
  if(t.includes("ps5") && !t.includes("ps4")) return "PS5";
  return "PS4 • PS5";
}

bot.on("message", async msg=>{
  const text=msg.text;
  if(!text||!text.includes("store.playstation.com/en-tr"))return;

  const ua=text.replace("en-tr","uk-ua");

  const [trHtml, uaHtml]=await Promise.all([
    fetch(text).then(r=>r.text()),
    fetch(ua).then(r=>r.text())
  ]);

  const $tr=cheerio.load(trHtml);
  const $ua=cheerio.load(uaHtml);

  const a=$tr('a[href*="/product/"]').first();
  const title=a.text().trim();
  const container=a.closest("li,div");
  const textBlock=container.text();
  const trPrice=toNum(textBlock.match(/(\d{1,3}(\.\d{3})*,\d{2})\s*TL/)?.[1]);
  const platform=detectPlatform(textBlock);
  const cover=container.find("img").attr("src");

  const uaBlock=$ua('a[href*="/product/"]').first().closest("li,div").text();
  const uaPrice=toNum(uaBlock.match(/UAH\s*([\d\s]+,\d{2})/)?.[1]);

  const trAzn=map(trPrice, tiersTR);
  const uaAzn=map(uaPrice, tiersUA);

  const coverBuf=Buffer.from(await fetch(cover).then(r=>r.arrayBuffer()));
  await fs.writeFile("cover.jpg", coverBuf);

  const img = await renderImage({
    title,
    tr:trAzn,
    ua:uaAzn,
    platform,
    date:"Endirimin son tarixi",
    cover:"cover.jpg"
  });

  await bot.sendPhoto(msg.chat.id, img, {
    caption:`${title}\n${platform}\nTR: ${trAzn} | UA: ${uaAzn}`
  });
});
