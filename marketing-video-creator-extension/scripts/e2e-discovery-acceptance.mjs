#!/usr/bin/env node
/**
 * E2E de aceptación de SSS-282: descubrimiento real → borrador → captura.
 *
 * Flujo (sin mocks del navegador, del disco ni de FFmpeg):
 *   1. sirve estáticamente el fixture `test/e2e/fixtures/app/` (3 pantallas
 *      enlazadas, botones, formulario instrumentado y un enlace externo);
 *   2. control positivo del instrumento del formulario (submit real en consola
 *      + POST al servidor) para demostrar que la sonda detecta envíos;
 *   3. `discoverApp` real (crawlApp) + normalización + `.mvc/discovery.json`:
 *      3 páginas con selectores, externo en `skipped`, CERO submit de formulario
 *      y cero mutaciones HTTP;
 *   4. límites: `maxDepth` y `maxPages` con valores bajos se respetan;
 *   5. con el inventario persistido, el camino REAL del panel genera el
 *      borrador (`.mvc/mvc-config.borrador.json`);
 *   6. el pipeline de captura (PhaseManager: Playwright + FFmpeg reales) ejecuta
 *      ESE borrador sin retocar selectores y produce clips, SRT, MP4 y frames;
 *   7. el contrato del manifiesto sigue coherente y `test:e2e` ejecuta este job.
 *
 * Uso: node ./scripts/e2e-discovery-acceptance.mjs
 *      (o `npm run test:e2e`, que lo encadena tras el E2E de pipeline)
 *      `MVC_E2E_KEEP=1` conserva el directorio de artefactos.
 */

import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const repoRoot = resolve(root, '..');
const require = createRequire(import.meta.url);

const passes = [];
const failures = [];
const knownDefects = [];

function check(name, condition, detail = '') {
  if (condition) {
    passes.push(name);
    console.log(`PASS ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/**
 * Marca un defecto de PRODUCTO ya abierto y asignado a DEV. No cuenta como
 * fallo del gate porque no afecta al criterio de aceptación de SSS-282, pero el
 * E2E lo sigue comprobando: si DEV lo arregla, esta línea pasa a PASS para que
 * se retire la marca.
 */
function knownDefect(name, condition, detail = '') {
  if (condition) {
    passes.push(name);
    console.log(`PASS ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    knownDefects.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`XFAIL ${name} — defecto conocido${detail ? `: ${detail}` : ''}`);
  }
}

function eq(name, actual, expected) {
  check(
    name,
    JSON.stringify(actual) === JSON.stringify(expected),
    `esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(actual)}`
  );
}

function ffprobe(file) {
  const output = execFileSync(
    'ffprobe',
    [
      '-v', 'error',
      '-show_entries', 'stream=codec_type,codec_name,width,height',
      '-show_entries', 'format=duration',
      '-of', 'json',
      file
    ],
    { encoding: 'utf8' }
  );
  const parsed = JSON.parse(output);
  const video = (parsed.streams ?? []).find(stream => stream.codec_type === 'video');
  const audio = (parsed.streams ?? []).find(stream => stream.codec_type === 'audio');
  return {
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    videoCodec: video?.codec_name ?? '',
    hasAudio: Boolean(audio),
    durationSec: Number.parseFloat(parsed.format?.duration ?? '0')
  };
}

const compiledDiscovery = join(root, 'dist', 'discovery', 'index.js');
if (!existsSync(compiledDiscovery)) {
  console.log('dist/ no existe: compilando…');
  execFileSync('npm', ['run', 'compile'], { cwd: root, stdio: 'inherit' });
}

const {
  crawlApp,
  normalizeDiscovery,
  writeDiscoveryArtifacts,
  readDiscoveryDoc,
  discoveryPathOf,
  writeProposalFromDiscovery
} = require(compiledDiscovery);
const { normalizePhases, validateProjectConfig, CONFIG_VERSION } = require(join(root, 'dist', 'config', 'project-schema.js'));
const { fileHash, PROJECT_CONFIG_FILE } = require(join(root, 'dist', 'config', 'config-file.js'));
const { FfmpegBuilder: FfmpegBuilderReal } = require(join(root, 'dist', 'services', 'ffmpeg-builder.js'));
const { PhaseManager: PhaseManagerReal } = require(join(root, 'dist', 'services', 'phase-manager.js'));

const fixtures = join(root, 'test', 'e2e', 'fixtures', 'app');
if (!existsSync(join(fixtures, 'index.html'))) {
  console.error(`No existe el fixture de la app: ${fixtures}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Servidor estático del fixture + observador de submits y mutaciones.
// ---------------------------------------------------------------------------
const requests = [];
const consoleSubmits = [];
let formSubmits = 0;
let mutations = 0;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8'
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  requests.push({ method: req.method, path: url.pathname });

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    mutations += 1;
  }

  if (url.pathname === '/__form-submit') {
    if (req.method === 'POST') {
      formSubmits += 1;
    }
    res.writeHead(204);
    res.end();
    return;
  }

  const relative = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
  const file = normalize(join(fixtures, relative));

  if (!file.startsWith(fixtures + sep) || !existsSync(file) || !extname(file)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('no encontrado');
    return;
  }

  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});

await new Promise(resolvePromise => server.listen(0, '127.0.0.1', resolvePromise));
const base = `http://127.0.0.1:${server.address().port}`;
console.log(`Fixture E2E servido en ${base}\n`);

const workDir = mkdtempSync(join(tmpdir(), 'mvc-e2e-acceptance-'));
const mvcDir = join(workDir, '.mvc');
mkdirSync(mvcDir, { recursive: true });
let browser;

try {
  // -------------------------------------------------------------------------
  // 1. Control positivo: el formulario instrumentado SÍ deja rastro al enviarse.
  //    Sin esto, «no hubo submit» no significaría nada.
  // -------------------------------------------------------------------------
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const consoleMessages = [];
  page.on('console', message => consoleMessages.push(message.text()));

  const submitBefore = formSubmits;
  await page.goto(`${base}/index.html`, { waitUntil: 'load' });
  await page.fill('#nombre', 'Prueba QA');
  await page.click('#enviar-solicitud');
  await page.waitForTimeout(500);

  const positiveConsole = consoleMessages.filter(text => text.includes('FORM_SUBMIT'));
  check(
    'control positivo: el submit real aparece en la consola del navegador',
    positiveConsole.some(text => text.includes('form-solicitud')),
    positiveConsole.join(' | ') || `consola: ${consoleMessages.slice(-3).join(' | ')}`
  );
  eq('control positivo: el submit real llega al servidor (POST /__form-submit)', formSubmits - submitBefore, 1);

  // Desde aquí las sondas quedan a cero: cualquier submit o mutación que ocurra
  // durante el descubrimiento o la captura es imputable al producto.
  formSubmits = 0;
  mutations = 0;
  const requestsBeforeCrawl = requests.length;

  // -------------------------------------------------------------------------
  // 2. `discoverApp` real sobre la app de 3 pantallas.
  // -------------------------------------------------------------------------
  const raw = await crawlApp({
    url: `${base}/index.html`,
    maxDepth: 3,
    maxPages: 10,
    headless: true,
    repoRoot
  });

  eq('descubrimiento: 3 pantallas', raw.stats.pageCount, 3);
  eq(
    'descubrimiento: las 3 pantallas enlazadas',
    raw.pages.map(pagina => pagina.path).sort(),
    ['/detalle.html', '/index.html', '/informe.html']
  );
  check(
    'descubrimiento: cada pantalla trae título',
    raw.pages.every(pagina => pagina.title.trim().length > 0),
    raw.pages.map(pagina => `${pagina.path}=${pagina.title}`).join(', ')
  );
  check(
    'descubrimiento: cada pantalla inventaría selectores',
    raw.pages.every(pagina => pagina.elements.length > 0 && pagina.elements.every(elemento => elemento.selector.trim().length > 0)),
    raw.pages.map(pagina => `${pagina.path}=${pagina.elements.length}`).join(', ')
  );
  check(
    'descubrimiento: el formulario trae etiqueta y campos con selector',
    raw.pages.some(
      pagina =>
        pagina.forms.length > 0 &&
        pagina.forms.every(form => form.fields.length > 0 && form.fields.every(campo => campo.selector.trim().length > 0))
    )
  );

  const skipped = raw.stats.skipped;
  check(
    'descubrimiento: el enlace externo queda en skipped con motivo externo',
    skipped.some(entrada => entrada.reason === 'externo' && entrada.url.includes('externo.example.org/oferta')),
    skipped.map(entrada => `${entrada.reason}:${entrada.url}`).join(', ')
  );
  check(
    'descubrimiento: no se sale del origen',
    raw.pages.every(pagina => pagina.url.startsWith(base))
  );

  // El crawler abre SU propio navegador: la consola no es accesible, así que la
  // evidencia de "no submit" es el servidor (POST) y la ausencia de mutaciones.
  eq('descubrimiento: CERO submits de formulario', formSubmits, 0);
  eq('descubrimiento: CERO mutaciones HTTP (sólo GET/HEAD)', mutations, 0);
  const crawlRequests = requests.slice(requestsBeforeCrawl);
  check(
    'descubrimiento: ninguna petición al endpoint del formulario',
    crawlRequests.every(entrada => entrada.path !== '/__form-submit'),
    crawlRequests.filter(entrada => entrada.path === '/__form-submit').map(entrada => entrada.method).join(', ')
  );

  // -------------------------------------------------------------------------
  // 3. Normalización + `.mvc/discovery.json` persistido (lo que lee el panel).
  // -------------------------------------------------------------------------
  const normalized = normalizeDiscovery(raw);
  const artifacts = writeDiscoveryArtifacts(normalized, mvcDir);
  check('discovery.json: escrito en .mvc/', existsSync(artifacts.jsonPath) && artifacts.jsonPath === discoveryPathOf(workDir));
  check('discovery.md: escrito en .mvc/', existsSync(artifacts.mdPath));

  const stored = readDiscoveryDoc(discoveryPathOf(workDir));
  eq('discovery.json: 3 páginas con su path', stored.pages.map(pagina => pagina.path).sort(), ['/detalle.html', '/index.html', '/informe.html']);
  check(
    'discovery.json: cada página tiene sus selectores',
    stored.pages.every(
      pagina => Array.isArray(pagina.elements) && pagina.elements.length > 0 && pagina.elements.every(elemento => elemento.selector)
    ),
    stored.pages.map(pagina => `${pagina.path}: ${pagina.elements.map(elemento => elemento.selector).join(' ')}`).join('\n')
  );
  check(
    'discovery.json: el formulario conserva sus campos y selectores',
    stored.pages.some(pagina => pagina.forms.some(form => form.fields.length >= 2 && form.fields.every(campo => campo.selector)))
  );
  check(
    'discovery.json: el externo queda en skipped',
    stored.stats.skipped.some(entrada => entrada.reason === 'externo' && entrada.url.includes('externo.example.org'))
  );
  eq('discovery.json: pageCount coherente', stored.stats.pageCount, 3);

  // Cada selector inventariado se resuelve en la página real: el inventario no
  // contiene selectores inventados ni de otra pantalla. Los elementos de estado
  // (`role=status[name=…]`) se comprueban aparte: ver `knownDefect` más abajo.
  const selectorErrors = [];
  const statusSelectorErrors = [];
  for (const pagina of stored.pages) {
    await page.goto(pagina.url, { waitUntil: 'load' });
    const controles = [
      ...pagina.elements.filter(elemento => elemento.kind !== 'status').map(elemento => elemento.selector),
      ...pagina.forms.flatMap(form => form.fields.map(campo => campo.selector))
    ];
    for (const selector of controles) {
      let count = 0;
      try {
        count = await page.locator(selector).count();
      } catch (error) {
        selectorErrors.push(`${pagina.path} ${selector}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      if (count < 1) {
        selectorErrors.push(`${pagina.path} ${selector}: 0 coincidencias`);
      }
    }

    for (const elemento of pagina.elements.filter(candidato => candidato.kind === 'status')) {
      let count = 0;
      try {
        count = await page.locator(elemento.selector).count();
      } catch (error) {
        statusSelectorErrors.push(`${pagina.path} ${elemento.selector}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      if (count < 1) {
        statusSelectorErrors.push(`${pagina.path} ${elemento.selector}: 0 coincidencias`);
      }
    }
  }
  check(
    'discovery.json: TODOS los selectores de control resuelven en la app real',
    selectorErrors.length === 0,
    selectorErrors.slice(0, 5).join(' | ')
  );
  knownDefect(
    'discovery.json: los selectores de estado (role=status[name=…]) resuelven',
    statusSelectorErrors.length === 0,
    `defecto abierto en DEV — ${statusSelectorErrors.join(' | ')}`
  );

  // -------------------------------------------------------------------------
  // 4. Límites con valores bajos (segundo y tercer caso).
  // -------------------------------------------------------------------------
  const shallow = await crawlApp({ url: `${base}/index.html`, maxDepth: 1, maxPages: 10, headless: true, repoRoot });
  eq('maxDepth=1: sólo la portada y su primer nivel', shallow.stats.pageCount, 2);
  eq('maxDepth=1: páginas esperadas', shallow.pages.map(pagina => pagina.path).sort(), ['/detalle.html', '/index.html']);
  check(
    'maxDepth=1: la pantalla de profundidad 2 queda en skipped',
    shallow.stats.skipped.some(entrada => entrada.reason === 'max-profundidad' && entrada.url.endsWith('/informe.html')),
    shallow.stats.skipped.map(entrada => `${entrada.reason}:${entrada.url}`).join(', ')
  );

  const single = await crawlApp({ url: `${base}/index.html`, maxDepth: 3, maxPages: 1, headless: true, repoRoot });
  eq('maxPages=1: una sola página', single.stats.pageCount, 1);
  eq('maxPages=1: la portada', single.pages.map(pagina => pagina.path), ['/index.html']);
  check(
    'maxPages=1: el resto queda en skipped como max-paginas',
    single.stats.skipped.some(entrada => entrada.reason === 'max-paginas'),
    single.stats.skipped.map(entrada => `${entrada.reason}:${entrada.url}`).join(', ')
  );
  eq('límites: el crawl acotado tampoco muta nada', mutations, 0);
  eq('límites: el crawl acotado tampoco envía el formulario', formSubmits, 0);

  // -------------------------------------------------------------------------
  // 5. Borrador por el camino REAL del panel (convertidor real).
  // -------------------------------------------------------------------------
  const draftResult = writeProposalFromDiscovery(normalized, workDir);
  const draftPath = join(mvcDir, 'mvc-config.borrador.json');
  eq('borrador: 3 fases propuestas', draftResult.phaseCount, 3);
  check('borrador: escrito en .mvc/mvc-config.borrador.json', draftResult.filePath === draftPath && existsSync(draftPath));
  check('borrador: NO se crea mvc-config.json', !existsSync(join(workDir, PROJECT_CONFIG_FILE)));

  const draftJson = JSON.parse(readFileSync(draftPath, 'utf8'));
  const draftPhases = draftJson.project.phases;
  eq('borrador: contrato version+project', draftJson.version, CONFIG_VERSION);
  eq('borrador: 3 fases en el JSON', draftPhases.length, 3);
  eq('borrador: la portada abre la demo', draftPhases[0].url, `${base}/index.html`);
  check(
    'borrador: ids válidos y únicos',
    draftPhases.every(fase => /^[a-z0-9][a-z0-9-]*$/.test(fase.id)) &&
      new Set(draftPhases.map(fase => fase.id)).size === draftPhases.length,
    draftPhases.map(fase => fase.id).join(', ')
  );
  check(
    'borrador: cada fase lleva label, duración, guion y url',
    draftPhases.every(fase => fase.label.trim() && fase.duration > 0 && fase.script.trim() && fase.url.startsWith(base))
  );
  check('borrador: por defecto no pulsa nada', draftPhases.every(fase => !(fase.steps ?? []).some(paso => paso.action === 'click')));
  check(
    'borrador: ningún paso referencia un selector ausente del inventario',
    draftPhases.every(fase => {
      const pagina = stored.pages.find(candidata => candidata.url === fase.url);
      if (!pagina) {
        return false;
      }
      const disponibles = new Set(pagina.elements.map(elemento => elemento.selector));
      return (fase.steps ?? [])
        .filter(paso => paso.action === 'click' || paso.action === 'waitForSelector')
        .every(paso => disponibles.has(paso.selector));
    })
  );
  // Los selectores de los pasos se resuelven de verdad: si el borrador usara un
  // selector roto, la captura fallaría y este check sería HIGH (bloqueante).
  const draftSelectorErrors = [];
  for (const fase of draftPhases) {
    await page.goto(fase.url, { waitUntil: 'load' });
    for (const paso of (fase.steps ?? []).filter(candidato => candidato.action === 'click' || candidato.action === 'waitForSelector')) {
      let count = 0;
      try {
        count = await page.locator(paso.selector).count();
      } catch (error) {
        draftSelectorErrors.push(`${fase.id} ${paso.selector}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      if (count < 1) {
        draftSelectorErrors.push(`${fase.id} ${paso.selector}: 0 coincidencias`);
      }
    }
  }
  check(
    'borrador: TODOS los selectores de sus pasos resuelven en la app real',
    draftSelectorErrors.length === 0,
    draftSelectorErrors.join(' | ')
  );

  const draftNormalized = normalizePhases(draftPhases);
  eq('borrador: el pipeline lo normaliza sin avisos', draftNormalized.warnings, []);
  eq('borrador: configuración válida para el pipeline', validateProjectConfig(draftJson.project), []);
  const draftHashBeforeCapture = fileHash(draftPath);

  // -------------------------------------------------------------------------
  // 6. Pipeline de captura REAL con el borrador leído de disco, sin retocarlo.
  // -------------------------------------------------------------------------
  const outputDir = join(workDir, 'output');
  const manager = new PhaseManagerReal({
    outputDir,
    projectUrl: normalized.baseUrl,
    variant: 'desktop',
    headless: true,
    ffmpeg: new FfmpegBuilderReal(),
    settleMs: 300
  });

  const logs = [];
  manager.on('log', message => {
    logs.push(message);
    console.log(`   [captura] ${message}`);
  });

  // Fases EXACTAMENTE como quedaron en disco (mismos selectores y pasos).
  manager.setPhases(draftPhases);
  const requestsBeforeCapture = requests.length;
  const snapshot = await manager.runAll();

  check(
    'captura: las 3 fases terminan en done',
    snapshot.phases.length === 3 && snapshot.phases.every(fase => fase.status === 'done'),
    snapshot.phases.map(fase => `${fase.id}=${fase.status}${fase.error ? ` (${fase.error})` : ''}`).join(', ')
  );
  check(
    'captura: un clip MP4 por fase',
    snapshot.phases.every(fase => fase.clipPath && existsSync(fase.clipPath)),
    snapshot.phases.map(fase => fase.clipPath ?? '(sin clip)').join(', ')
  );
  check(
    'captura: un SRT por fase',
    snapshot.phases.every(fase => {
      const srtPath = manager.getSrtPath(fase.id);
      return existsSync(srtPath);
    }),
    snapshot.phases.map(fase => manager.getSrtPath(fase.id)).join(', ')
  );

  const clipInfos = snapshot.phases.map(fase => ffprobe(fase.clipPath));
  eq(
    'captura: los clips salen a 1920x1080 (desktop)',
    clipInfos.map(info => `${info.width}x${info.height}`),
    ['1920x1080', '1920x1080', '1920x1080']
  );
  check('captura: los clips tienen audio y duración > 0', clipInfos.every(info => info.hasAudio && info.durationSec > 0));

  let finalVideo = '';
  try {
    finalVideo = await manager.buildDesktopVideo();
  } catch (error) {
    check('captura: MP4 final generado', false, error instanceof Error ? error.message : String(error));
  }

  if (finalVideo && existsSync(finalVideo)) {
    check('captura: MP4 final generado', true);
    const finalInfo = ffprobe(finalVideo);
    eq('captura: MP4 final 1920x1080', `${finalInfo.width}x${finalInfo.height}`, '1920x1080');
    eq('captura: MP4 final en h264', finalInfo.videoCodec, 'h264');
    check('captura: MP4 final con pista de audio', finalInfo.hasAudio);
    check('captura: MP4 final con duración > 0', finalInfo.durationSec > 0, `${finalInfo.durationSec.toFixed(2)}s`);

    const clipsDuration = clipInfos.reduce((total, info) => total + info.durationSec, 0);
    check(
      'captura: el MP4 dura la suma de los 3 clips (±1 s)',
      Math.abs(finalInfo.durationSec - clipsDuration) <= 1,
      `mp4=${finalInfo.durationSec.toFixed(2)}s clips=${clipsDuration.toFixed(2)}s`
    );

    // Frames: se extrae uno de cada clip y otro del vídeo final, y se comprueba
    // que son PNG reales con las dimensiones esperadas.
    const framesDir = join(workDir, 'frames');
    mkdirSync(framesDir, { recursive: true });
    const frames = [];
    for (const [index, fase] of snapshot.phases.entries()) {
      const framePath = join(framesDir, `clip-${index + 1}.png`);
      execFileSync('ffmpeg', ['-v', 'error', '-ss', '0.3', '-i', fase.clipPath, '-frames:v', '1', '-y', framePath]);
      frames.push(framePath);
    }
    const finalFrame = join(framesDir, 'final.png');
    execFileSync('ffmpeg', ['-v', 'error', '-ss', '0.3', '-i', finalVideo, '-frames:v', '1', '-y', finalFrame]);
    frames.push(finalFrame);

    check(
      'frames: 1 PNG por fase + 1 del MP4 final',
      frames.length === 4 && frames.every(frame => existsSync(frame)),
      frames.join(', ')
    );
    const frameInfos = frames.map(frame => ffprobe(frame));
    eq(
      'frames: todos a 1920x1080',
      frameInfos.map(info => `${info.width}x${info.height}`),
      ['1920x1080', '1920x1080', '1920x1080', '1920x1080']
    );
    check(
      'frames: los PNG tienen contenido (no son ficheros vacíos)',
      frames.every(frame => readFileSync(frame).length > 5000)
    );
  } else {
    check('captura: MP4 final generado', false, 'buildDesktopVideo no devolvió un fichero existente');
  }

  // La captura ejecuta el borrador tal cual: ni submits ni mutaciones ni cambios
  // en el fichero del borrador.
  eq('captura: CERO submits de formulario al ejecutar el borrador', formSubmits, 0);
  const captureRequests = requests.slice(requestsBeforeCapture);
  check(
    'captura: ninguna petición al endpoint del formulario',
    captureRequests.every(entrada => entrada.path !== '/__form-submit'),
    captureRequests.filter(entrada => entrada.path === '/__form-submit').map(entrada => entrada.method).join(', ')
  );
  eq('captura: CERO mutaciones HTTP', mutations, 0);
  check(
    'captura: el borrador en disco queda intacto (mismos selectores)',
    fileHash(draftPath) === draftHashBeforeCapture
  );

  // -------------------------------------------------------------------------
  // 7. Contrato del manifiesto + wiring del job E2E.
  // -------------------------------------------------------------------------
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const declaredCommands = manifest.contributes.commands.map(command => command.command);
  const activationCommands = manifest.activationEvents
    .filter(event => event.startsWith('onCommand:'))
    .map(event => event.replace('onCommand:', ''));

  eq('manifiesto: activationEvents ↔ contributes.commands', [...new Set(activationCommands)].sort(), [...new Set(declaredCommands)].sort());
  check('manifiesto: ids de comando únicos', new Set(declaredCommands).size === declaredCommands.length);
  check('manifiesto: todos los comandos tienen título', manifest.contributes.commands.every(command => command.title.trim().length > 0));
  check(
    'manifiesto: los comandos de descubrimiento están declarados',
    declaredCommands.includes('marketing-video-creator.discoverApp') &&
      declaredCommands.includes('marketing-video-creator.proposePhases')
  );
  check('manifiesto: el bundle declarado en main existe tras compilar', existsSync(join(root, manifest.main.replace(/^\.\//, ''))));
  check(
    'manifiesto: el job E2E encadena este script',
    typeof manifest.scripts['test:e2e'] === 'string' &&
      manifest.scripts['test:e2e'].includes('e2e-discovery-acceptance.mjs'),
    manifest.scripts['test:e2e']
  );
} finally {
  if (browser) {
    await browser.close();
  }
  await new Promise(resolvePromise => server.close(resolvePromise));
  if (process.env.MVC_E2E_KEEP === '1') {
    console.log(`\nArtefactos E2E conservados en ${workDir}`);
  } else {
    rmSync(workDir, { recursive: true, force: true });
  }
}

console.log(`\n${passes.length} PASS · ${failures.length} FAIL · ${knownDefects.length} XFAIL — E2E de aceptación del descubrimiento`);
if (knownDefects.length > 0) {
  console.log('Defectos conocidos (no bloquean esta aceptación, abiertos en DEV):');
  for (const defect of knownDefects) {
    console.log(` - ${defect}`);
  }
}
if (failures.length > 0) {
  console.error(`\nFallos:\n${failures.join('\n')}`);
  process.exit(1);
}
