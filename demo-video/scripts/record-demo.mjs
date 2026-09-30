import fs from 'node:fs';
import path from 'node:path';

const playwright = await import('playwright').catch(async () => import('@playwright/test'));
const chromium = playwright.chromium;

if (!chromium) throw new Error('Playwright Chromium runtime not available.');

const configArg = process.argv[2] || 'marketing/demo-video/config/demo-prod.json';
const root = process.cwd();
const configPath = path.resolve(root, configArg);
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const baseUrl = String(config.baseUrl || 'https://dev.judgepreai.com').replace(/\/+$/, '');
const recordingsDir = path.resolve(root, config.video.recordingsDir);
const referenceImage = path.resolve(root, config.horse.referenceImage);
const email = process.env[config.auth.emailEnv];
const password = process.env[config.auth.passwordEnv];

if (!email || !password) {
  throw new Error('Demo credentials are required via environment variables.');
}

const videoWidth = Number(config.video.width || 1080);
const videoHeight = Number(config.video.height || 1920);
const slowMo = Number(config.video.slowMo || 180);
const startedAt = Date.now();
const timeline = [];

fs.mkdirSync(recordingsDir, { recursive: true });

console.log('=== JudgePREAI Demo Recorder ===');
console.log('Target:', baseUrl);
console.log('Recording to:', recordingsDir);
console.log('Horse:', config.horse.name);
console.log('Reference image exists:', fs.existsSync(referenceImage));

const browser = await chromium.launch({
  headless: false,
  slowMo,
  args: [`--window-size=${videoWidth},${videoHeight}`],
});

const context = await browser.newContext({
  viewport: { width: videoWidth, height: videoHeight },
  screen: { width: videoWidth, height: videoHeight },
  recordVideo: { dir: recordingsDir, size: { width: videoWidth, height: videoHeight } },
  acceptDownloads: true,
  isMobile: videoWidth <= 1080,
});

const page = await context.newPage();
const sleep = (ms) => page.waitForTimeout(ms);

function mark(name, extra = {}) {
  const seconds = Number(((Date.now() - startedAt) / 1000).toFixed(3));
  timeline.push({ name, seconds, ...extra });
  console.log(`TIMELINE ${seconds}s ${name}`);
}

async function acceptConsent() {
  const button = page.locator('#consent-accept');
  if (await button.count()) {
    try {
      if (await button.first().isVisible()) await button.first().click();
    } catch {}
  }
}

async function applyZoom() {
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = 'smooth';
    document.body.style.zoom = '1.15';
  }).catch(() => {});
}

async function showOverlay(title, body, ms = 2600) {
  await page.evaluate(({ title, body }) => {
    document.getElementById('__jia_demo_overlay__')?.remove();
    const box = document.createElement('div');
    box.id = '__jia_demo_overlay__';
    box.innerHTML = `<strong>${title}</strong><span>${body}</span>`;
    box.style.cssText = 'position:fixed;top:20px;left:20px;z-index:999999;max-width:560px;padding:16px 18px;border-radius:18px;background:rgba(8,15,8,.92);color:#f4f4f0;border:1px solid rgba(201,168,76,.45);box-shadow:0 20px 60px rgba(0,0,0,.28);font-family:Inter,Arial,sans-serif;display:flex;flex-direction:column;gap:6px;font-size:15px;line-height:1.45';
    box.querySelector('strong').style.cssText = 'font-size:16px;color:#d9be73';
    document.body.appendChild(box);
  }, { title, body });
  await sleep(ms);
  await page.evaluate(() => document.getElementById('__jia_demo_overlay__')?.remove()).catch(() => {});
}

async function scrollTo(selector, pause = 900) {
  const el = page.locator(selector).first();
  if (await el.count()) {
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await sleep(pause);
  }
}

async function fill(selector, value, pause = 900) {
  if (value == null || value === '') return;
  await scrollTo(selector, 500);
  await page.locator(selector).fill(String(value));
  await sleep(pause);
}

async function captureHomeAndLogin() {
  mark('01-home-start');
  await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
  await acceptConsent();
  await applyZoom();
  await showOverlay('Presentación', 'Primero enseñamos la portada pública de JudgePREAI antes de entrar al área privada.', 3200);
  await sleep(1800);
  await page.mouse.wheel(0, 600);
  await sleep(1500);
  await page.mouse.wheel(0, 500);
  await sleep(1500);
  await page.mouse.wheel(0, -900);
  await sleep(1200);
  mark('01-login-transition');
  await page.goto(`${baseUrl}/login?next=mis-caballos`, { waitUntil: 'networkidle' });
  await acceptConsent();
  await applyZoom();
  await showOverlay('Acceso privado', 'A mitad de la presentación entramos con una cuenta de cliente.', 2600);
  await fill('#email', email, 1100);
  await fill('#password', password, 900);
  mark('01-login-submit');
  await page.locator('#login-form button[type="submit"]').click();
  await page.waitForURL(/mis-caballos|cuenta|dashboard/, { timeout: 60000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await applyZoom();
  await sleep(2000);
  mark('01-login-done', { url: page.url() });
}

async function createHorse() {
  mark('02-create-start');
  await page.goto(`${baseUrl}/detalle?new=true`, { waitUntil: 'networkidle' });
  await applyZoom();
  await showOverlay('Crear ficha', 'Ahora completamos la ficha del ejemplar campo por campo.', 2800);
  await fill('#hf-name', config.horse.name, 1100);
  await scrollTo('#hf-sexo', 400);
  await page.locator('#hf-sexo').selectOption(config.horse.gender);
  await sleep(1000);
  await fill('#hf-capa', config.horse.color || 'Tordo', 900);
  await scrollTo('#hf-image-file', 500);
  if (fs.existsSync(referenceImage)) {
    await page.locator('#hf-image-file').setInputFiles(referenceImage);
    await sleep(1800);
  }
  await fill('#hf-registro', config.horse.registry || '', 800);
  await fill('#hf-nacimiento', config.horse.birthDate, 900);
  await fill('#hf-microchip', config.horse.microchip || '', 800);
  await fill('#hf-ganaderia', config.horse.studFarm || '', 900);
  await fill('#hf-padre', config.horse.sire || '', 700);
  await fill('#hf-madre', config.horse.dam || '', 700);
  await fill('#hf-desc', config.horse.description || '', 1200);
  mark('02-create-submit');
  await scrollTo('#hf-submit', 500);
  await page.locator('#hf-submit').click();
  await page.waitForURL(/detalle(?:\.html)?\?id=/, { timeout: 60000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await sleep(2200);
  const horseId = new URL(page.url()).searchParams.get('id');
  if (!horseId) throw new Error('No se pudo obtener el ID del caballo creado.');
  mark('02-create-done', { horseId });
  return horseId;
}

async function runEvaluation(horseId) {
  mark('03-eval-start', { horseId });
  await page.goto(`${baseUrl}/evaluacion?horseId=${encodeURIComponent(horseId)}`, { waitUntil: 'networkidle' });
  await applyZoom();
  await showOverlay('Evaluación', 'JudgePREAI ya carga el ejemplar y la imagen de referencia para acelerar el flujo.', 2800);
  const select = page.locator('#eval-horse-select');
  if (await select.count()) {
    await select.selectOption(String(horseId)).catch(() => {});
    await sleep(1000);
  }
  const useRef = page.getByRole('button', { name: 'Usar esta imagen para evaluar' });
  if (await useRef.count()) {
    try {
      if (await useRef.first().isVisible()) await useRef.first().click();
    } catch {}
    await sleep(1800);
  } else if (fs.existsSync(referenceImage)) {
    await page.locator('#file-input').setInputFiles(referenceImage).catch(() => {});
    await sleep(1800);
  }
  const evaluateButton = page.locator('#btn-evaluate');
  for (let i = 0; i < 240; i += 1) {
    const disabled = await evaluateButton.isDisabled().catch(() => true);
    if (!disabled) break;
    await sleep(500);
  }
  await showOverlay('Lanzar análisis', 'Mostramos solo unos segundos de carga y luego iremos directos al resultado en el montaje.', 2200);
  mark('03-eval-submit');
  await evaluateButton.click();
  await sleep(4000);
  mark('03-eval-loading-visible');
  await page.waitForURL(/resultado/, { timeout: 180000 }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await sleep(2500);
  mark('03-eval-result', { url: page.url() });
}

async function showPdf() {
  mark('04-pdf-start');
  await showOverlay('Informe PDF', 'Desde el resultado podemos descargar el informe y compartirlo.', 2200);
  const downloadLink = page.locator('#btn-result-download');
  if (await downloadLink.count()) {
    await scrollTo('#btn-result-download', 500);
    await downloadLink.click().catch(() => {});
    await sleep(3500);
  }
  mark('04-pdf-done');
}

async function showHistoryAndAccount() {
  mark('05-history-start');
  await page.goto(`${baseUrl}/historial`, { waitUntil: 'networkidle' });
  await applyZoom();
  await showOverlay('Historial', 'Aquí vemos las evaluaciones realizadas y sus accesos rápidos.', 2400);
  await sleep(2600);
  mark('05-history-done');

  mark('06-account-start');
  await page.goto(`${baseUrl}/cuenta`, { waitUntil: 'networkidle' });
  await applyZoom();
  await showOverlay('Tu cuenta', 'La cuenta centraliza datos, contraseña, avisos y consumo de créditos.', 2600);
  await page.mouse.wheel(0, 500);
  await sleep(2200);
  mark('06-account-done');

  mark('07-close-start');
  await page.evaluate(() => {
    document.getElementById('__jia_demo_overlay__')?.remove();
    const box = document.createElement('div');
    box.id = '__jia_demo_overlay__';
    box.innerHTML = '<strong>Gracias por participar en la beta</strong><span>Crear ficha, evaluar, descargar informe y revisar historial: ese es el núcleo del producto.</span>';
    box.style.cssText = 'position:fixed;inset:auto 20px 20px 20px;z-index:999999;padding:18px 20px;border-radius:18px;background:rgba(8,15,8,.94);color:#f4f4f0;border:1px solid rgba(201,168,76,.45);box-shadow:0 20px 60px rgba(0,0,0,.28);font-family:Inter,Arial,sans-serif;display:flex;flex-direction:column;gap:8px;font-size:16px;line-height:1.45';
    box.querySelector('strong').style.cssText = 'font-size:18px;color:#d9be73';
    document.body.appendChild(box);
  });
  await sleep(6500);
  mark('07-close-done');
}

function writeTimeline() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(recordingsDir, `timeline-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify({
    baseUrl,
    video: { width: videoWidth, height: videoHeight },
    horse: config.horse.name,
    timeline,
  }, null, 2));
  console.log('Timeline written to', file);
}

try {
  await captureHomeAndLogin();
  const horseId = await createHorse();
  await runEvaluation(horseId);
  await showPdf();
  await showHistoryAndAccount();
} catch (err) {
  console.error('ERROR during recording:', err);
  await sleep(8000);
} finally {
  writeTimeline();
  console.log('Closing context and browser...');
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  console.log('Done. Check the .webm files in', recordingsDir);
}
