import fs from 'node:fs';
import path from 'node:path';

const { chromium, devices } = await import('playwright').catch(async () => import('@playwright/test'));

const root = process.cwd();
const configPath = path.resolve(root, process.argv[2] || 'marketing/demo-video/config/demo-prod.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const mobile = config.variants?.mobile || {};
const baseUrl = String(config.baseUrl || 'https://dev.judgepreai.com').replace(/\/+$/, '');
const outputDir = path.resolve(root, mobile.recordingsDir || 'marketing/output/demo-video/raw/mobile');
const emailEnv = String(config.auth?.emailEnv || '').trim();
const passwordEnv = String(config.auth?.passwordEnv || '').trim();
const email = emailEnv ? process.env[emailEnv] : '';
const password = passwordEnv ? process.env[passwordEnv] : '';
const demoEvaluationId = String(config.demoEvaluationId || '').trim();

fs.mkdirSync(outputDir, { recursive: true });

const captureWidth = Number(mobile.viewportWidth || 432);
const captureHeight = Number(mobile.viewportHeight || 768);

const phases = [
  '01-presentacion',
  '02-crear-ficha',
  '03-evaluacion',
  '04-descargar-informe',
  '05-historial',
  '06-cuenta',
  '07-cierre',
];

const requestedPhases = new Set(process.argv.slice(3));
const authenticatedPhases = new Set(phases.slice(1, 6));
let authState;
let demoHorseId = '';
let browser;

function mobileContextOptions(extra = {}) {
  const iphone = devices['iPhone 14 Pro'];
  return {
    ...iphone,
    viewport: { width: captureWidth, height: captureHeight },
    deviceScaleFactor: Number(mobile.deviceScaleFactor || 3),
    isMobile: true,
    hasTouch: true,
    acceptDownloads: true,
    recordVideo: { dir: outputDir, size: { width: captureWidth, height: captureHeight } },
    ...extra,
  };
}

async function closeAndRename(context, page, phase) {
  const video = page.video();
  await context.close();
  const rawPath = await video.path();
  const finalPath = path.join(outputDir, `${phase}.webm`);
  fs.copyFileSync(rawPath, finalPath);
  console.log(`PHASE_SAVED ${phase} ${finalPath}`);
  return finalPath;
}

async function contextForPhase(phase, auth = true) {
  const storageState = auth ? authState : undefined;
  const context = await browser.newContext(mobileContextOptions({ storageState }));
  const page = await context.newPage();
  page.setDefaultTimeout(90000);
  console.log(`PHASE_START ${phase}`);
  return { context, page };
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function acceptConsent(page) {
  const button = page.locator('#consent-accept');
  if (await button.count()) {
    try { if (await button.first().isVisible()) await button.first().click(); } catch {}
  }
}

async function openMobileMenu(page, ms = 1800) {
  const toggle = page.locator('.navbar-mobile-toggle').first();
  if (await toggle.count()) {
    await toggle.click().catch(() => {});
    await page.waitForTimeout(ms);
    await toggle.click().catch(() => {});
    await page.waitForTimeout(500);
  }
}

async function scrollTo(page, selector, ms = 700) {
  const loc = page.locator(selector).first();
  if (await loc.count()) {
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(ms);
  }
}

async function showDemoNotice(page, title, message) {
  await page.evaluate(({ title, message }) => {
    const notice = document.createElement('aside');
    notice.setAttribute('role', 'status');
    notice.style.cssText = 'position:fixed;inset:18px 18px auto 18px;z-index:999999;padding:16px 18px;border-radius:12px;background:rgba(255,250,230,.98);color:#302714;border:2px solid #b68b2c;box-shadow:0 12px 32px rgba(0,0,0,.22);font-family:system-ui,sans-serif;display:flex;flex-direction:column;gap:6px;font-size:15px;line-height:1.4';
    const heading = document.createElement('strong');
    heading.textContent = title;
    const copy = document.createElement('span');
    copy.textContent = message;
    notice.append(heading, copy);
    document.body.appendChild(notice);
  }, { title, message });
}

async function fill(page, selector, value, ms = 650) {
  if (value == null || value === '') return;
  await scrollTo(page, selector, 300);
  await page.locator(selector).fill(String(value));
  await page.waitForTimeout(ms);
}

async function loginForState() {
  if (!email || !password) {
    throw new Error(`Missing demo credentials in environment variables ${emailEnv} and ${passwordEnv}.`);
  }
  const context = await browser.newContext(mobileContextOptions({ recordVideo: undefined }));
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/login?next=mis-caballos`, { waitUntil: 'networkidle' });
    await acceptConsent(page);
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(password);
    await page.locator('#login-form button[type="submit"]').click();
    await page.waitForURL(/mis-caballos|dashboard|cuenta/, { timeout: 90000 });
    return await context.storageState();
  } finally {
    await context.close();
  }
}

async function waitForDemoResult(page) {
  if (!demoEvaluationId) throw new Error('Missing demoEvaluationId in demo configuration.');
  await page.waitForFunction((evaluationId) => {
    try {
      const result = JSON.parse(sessionStorage.getItem('jia_last_result') || 'null');
      const renderedName = document.querySelector('#result-horse-name')?.textContent?.trim() || '';
      return [result?.id, result?.evaluation_id].some((id) => String(id || '') === String(evaluationId))
        && renderedName !== ''
        && renderedName !== '—';
    } catch {
      return false;
    }
  }, demoEvaluationId, { timeout: 90000 });
}

async function record01() {
  const { context, page } = await contextForPhase('01-presentacion', false);
  await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
  await acceptConsent(page);
  await page.waitForTimeout(2500);
  await openMobileMenu(page, 1600);
  await page.mouse.wheel(0, 520);
  await page.waitForTimeout(3200);
  await page.mouse.wheel(0, 520);
  await page.waitForTimeout(3200);
  await page.mouse.wheel(0, -1040);
  await page.waitForTimeout(2000);
  await page.waitForTimeout(7200);
  return closeAndRename(context, page, '01-presentacion');
}

async function record02() {
  const { context, page } = await contextForPhase('02-crear-ficha');
  await page.goto(`${baseUrl}/mis-caballos`, { waitUntil: 'networkidle' });
  await openMobileMenu(page, 1200);
  await page.waitForTimeout(1800);
  const horseLink = page.locator('a[href*="detalle.html?id="], a[href*="detalle?id="]').first();
  if (!(await horseLink.count())) throw new Error('No existing horse is available for the read-only demo.');
  const horseHref = await horseLink.getAttribute('href');
  const horseId = horseHref ? new URL(horseHref, baseUrl).searchParams.get('id') : '';
  if (!horseId) throw new Error('The existing horse link has no valid ID.');
  demoHorseId = horseId;
  await horseLink.click();
  await page.waitForURL(/detalle(?:\.html)?\?id=/, { timeout: 90000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await showDemoNotice(page, 'Ficha existente', 'Mostramos una ficha ya autorizada sin crear ni modificar datos.');
  await page.waitForTimeout(5600);
  return closeAndRename(context, page, '02-crear-ficha');
}

async function record03() {
  const { context, page } = await contextForPhase('03-evaluacion');
  if (!demoHorseId) throw new Error('Run 02-crear-ficha before 03-evaluacion in the same recording.');
  if (!demoEvaluationId) throw new Error('Missing demoEvaluationId in demo configuration.');
  const horseId = demoHorseId;
  await page.goto(`${baseUrl}/detalle.html?id=${encodeURIComponent(horseId)}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1600);
  await page.locator('#new-eval-link').click();
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1500);
  const useRef = page.getByRole('button', { name: 'Usar esta imagen para evaluar' });
  if (await useRef.count()) await useRef.first().click().catch(() => {});
  await page.waitForTimeout(1200);
  await showDemoNotice(
    page,
    'Evaluación en modo demostración',
    'No se lanza una evaluación nueva ni se consume saldo durante la grabación.'
  );
  await page.waitForTimeout(4200);
  await page.goto(`${baseUrl}/resultado.html?id=${encodeURIComponent(demoEvaluationId)}`, { waitUntil: 'networkidle' });
  await waitForDemoResult(page);
  await showDemoNotice(
    page,
    'Ejemplo de resultado preexistente',
    'Este resultado está autorizado para la demo y no se crea durante la grabación.'
  );
  await page.waitForTimeout(6500);
  await page.mouse.wheel(0, 520);
  await page.waitForTimeout(5000);
  await page.mouse.wheel(0, 520);
  await page.waitForTimeout(5000);
  await page.mouse.wheel(0, 520);
  await page.waitForTimeout(3500);
  await page.mouse.wheel(0, -760);
  await page.waitForTimeout(5500);
  return closeAndRename(context, page, '03-evaluacion');
}

async function downloadDemoPdf(page) {
  if (!demoEvaluationId) throw new Error('Missing demoEvaluationId in demo configuration.');
  const reportUrl = `${baseUrl}/api/evaluations/${encodeURIComponent(demoEvaluationId)}/report?format=pdf&download=1`;
  const report = await page.evaluate(async (url) => {
    const auth = typeof window.getAuthHeaders === 'function' ? window.getAuthHeaders() : {};
    if (!auth?.Authorization) return { ok: false, status: 0, error: 'Authenticated report request unavailable.' };
    const response = await fetch(url, { headers: { Accept: 'application/pdf', ...auth } });
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      ok: response.ok,
      status: response.status,
      contentType: response.headers.get('content-type') || '',
      contentDisposition: response.headers.get('content-disposition') || '',
      signature: new TextDecoder().decode(bytes.slice(0, 5)),
      bytes: Array.from(bytes),
    };
  }, reportUrl);
  const expectedFilename = `informe-${encodeURIComponent(demoEvaluationId)}.pdf`;
  if (!report.ok) throw new Error(`Demo PDF request failed with HTTP ${report.status}.`);
  if (!report.contentType.toLowerCase().includes('application/pdf')) throw new Error('Demo PDF response has an invalid content type.');
  if (report.signature !== '%PDF-') throw new Error('Demo PDF response has an invalid signature.');
  const contentDispositionFilename = report.contentDisposition.match(/filename="([^"]+)"/i)?.[1] || '';
  if (contentDispositionFilename !== expectedFilename) throw new Error('Demo PDF response does not match the configured evaluation ID.');
  const pdfPath = path.join(outputDir, expectedFilename);
  fs.writeFileSync(pdfPath, Buffer.from(report.bytes));
  return pdfPath;
}

async function record04() {
  const { context, page } = await contextForPhase('04-descargar-informe');
  if (!demoEvaluationId) throw new Error('Missing demoEvaluationId in demo configuration.');
  await page.goto(`${baseUrl}/resultado.html?id=${encodeURIComponent(demoEvaluationId)}`, { waitUntil: 'domcontentloaded' });
  await waitForDemoResult(page);
  await showDemoNotice(
    page,
    'Informe de ejemplo preexistente',
    'Este informe se obtiene del mismo resultado autorizado que estamos mostrando.'
  );
  await page.waitForTimeout(1000);
  const pdfPath = await downloadDemoPdf(page);
  await page.goto(`file:///${pdfPath.replace(/\\/g, '/')}#zoom=page-width`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.mouse.click(14, 14).catch(() => {});
  await page.waitForTimeout(3600);
  await page.mouse.wheel(0, 680);
  await page.waitForTimeout(4200);
  await page.mouse.wheel(0, 680);
  await page.waitForTimeout(2600);
  return closeAndRename(context, page, '04-descargar-informe');
}

async function record05() {
  const { context, page } = await contextForPhase('05-historial');
  await page.goto(`${baseUrl}/historial`, { waitUntil: 'networkidle' });
  await openMobileMenu(page, 1200);
  await page.waitForTimeout(2200);
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(4200);
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(4200);
  await page.mouse.wheel(0, -500);
  await page.waitForTimeout(2000);
  return closeAndRename(context, page, '05-historial');
}

async function record06() {
  const { context, page } = await contextForPhase('06-cuenta');
  await page.goto(`${baseUrl}/cuenta`, { waitUntil: 'networkidle' });
  await openMobileMenu(page, 1200);
  await page.waitForTimeout(1800);
  await page.mouse.wheel(0, 620);
  await page.waitForTimeout(4200);
  await page.mouse.wheel(0, 620);
  await page.waitForTimeout(4200);
  await page.mouse.wheel(0, -520);
  await page.waitForTimeout(6400);
  return closeAndRename(context, page, '06-cuenta');
}

async function record07() {
  const { context, page } = await contextForPhase('07-cierre', false);
  await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
  await acceptConsent(page);
  await page.waitForTimeout(2200);
  await openMobileMenu(page, 1800);
  await page.mouse.wheel(0, 760);
  await page.waitForTimeout(5200);
  await page.mouse.wheel(0, 760);
  await page.waitForTimeout(5200);
  await page.mouse.wheel(0, 760);
  await page.waitForTimeout(5200);
  await page.mouse.wheel(0, -1200);
  await page.waitForTimeout(5200);
  await openMobileMenu(page, 2200);
  await page.waitForTimeout(11200);
  return closeAndRename(context, page, '07-cierre');
}

const runners = [record01, record02, record03, record04, record05, record06, record07];

try {
  browser = await chromium.launch({ headless: false, slowMo: Number(config.video.slowMo || 180) });
  const shouldLogin = !requestedPhases.size
    || [...requestedPhases].some((phase) => authenticatedPhases.has(phase));
  if (shouldLogin) authState = await loginForState();
  for (let index = 0; index < runners.length; index += 1) {
    if (requestedPhases.size && !requestedPhases.has(phases[index])) continue;
    await runners[index]();
  }
} finally {
  await browser?.close();
  console.log('MOBILE_PHASES_DONE');
}
