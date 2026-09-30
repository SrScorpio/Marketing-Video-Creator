import fs from 'node:fs';
import path from 'node:path';

const { chromium } = await import('playwright').catch(async () => import('@playwright/test'));

const root = process.cwd();
const configPath = path.resolve(root, process.argv[2] || 'marketing/demo-video/config/demo-prod.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const pdfPath = config.demoPdf ? path.resolve(root, config.demoPdf) : '';
const outDir = path.resolve(root, 'marketing/output/demo-video/mobile/pdf-pages');

if (!pdfPath || !fs.existsSync(pdfPath)) {
  throw new Error(`PDF not found: ${pdfPath}`);
}

fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
async function savePageShot(pageNumber) {
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  const fileUrl = `file:///${pdfPath.replace(/\\/g, '/')}#page=${pageNumber}&zoom=page-width`;
  await page.goto(fileUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2400);
  const out = path.join(outDir, `page-${pageNumber}.png`);
  await page.screenshot({
    path: out,
    clip: { x: 305, y: 8, width: 758, height: 1070 },
  });
  console.log(`PDF_PAGE ${pageNumber} ${out}`);
  await page.close();
}

await savePageShot(1);
await savePageShot(2);

await context.close();
await browser.close();
