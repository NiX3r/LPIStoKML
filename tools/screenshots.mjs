// Regenerates README screenshots (docs/images/*.png) and the link-preview image (web/og-image.png).
//
//   npm i --no-save playwright && npx playwright install chromium
//   node tools/screenshots.mjs
//
// Serves the repo itself on a free port, so nothing else needs to be running.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SAMPLE = join(ROOT, "test", "20260523-930318-DPB-SHP.zip");
const IMAGES = join(ROOT, "docs", "images");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png" };

const server = createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path.endsWith("/")) path += "index.html";
  path = normalize(path).replace(/^([\\/])+/, "");
  try {
    const body = await readFile(join(ROOT, path));
    res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(0);
const base = `http://localhost:${server.address().port}`;
const app = `${base}/web/`;

async function convertSample(page) {
  await page.goto(app);
  await page.setInputFiles("#zip-input", SAMPLE);
  await page.fill("#id_uz", "62418");
  await page.fill("#output_name", "Farma_Novak");
  await Promise.all([page.waitForEvent("download"), page.click("#submit-btn")]);
  await page.waitForSelector("#preview:not([hidden])");
}

const browser = await chromium.launch();
try {
  // Desktop (2× for crisp images)
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 2, acceptDownloads: true });
  const page = await desktop.newPage();
  await page.goto(app);
  await page.screenshot({ path: join(IMAGES, "home.png") });
  await convertSample(page);
  await page.locator("#preview").screenshot({ path: join(IMAGES, "preview.png") });
  await page.screenshot({ path: join(IMAGES, "converter.png"), fullPage: true });
  await page.goto(`${app}wiki.html`);
  await page.screenshot({ path: join(IMAGES, "wiki.png") });
  await desktop.close();

  // Phone
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true,
  });
  const mobile = await phone.newPage();
  await convertSample(mobile);
  await mobile.evaluate(() => window.scrollTo(0, document.getElementById("success-msg").getBoundingClientRect().top + scrollY - 24));
  await mobile.screenshot({ path: join(IMAGES, "mobile.png") });
  await phone.close();

  // Link preview, composed from the screenshots above
  const og = await browser.newPage({ viewport: { width: 1280, height: 640 } });
  await og.goto(`${base}/tools/og-image.html`);
  await og.waitForLoadState("networkidle");
  await og.screenshot({ path: join(ROOT, "web", "og-image.png") });
  await og.screenshot({ path: join(IMAGES, "thumbnail.png") });
} finally {
  await browser.close();
  server.close();
}
console.log("Screenshots written to docs/images/ and web/og-image.png");
