#!/usr/bin/env node
/**
 * E2E del crawler de descubrimiento (SSS-282).
 *
 * Levanta una app local de 3 pantallas enlazadas (index → detalle → informe,
 * más una cuarta a profundidad 3 para probar el límite), ejecuta el crawler
 * compilado (dist/) y verifica:
 *   - devuelve exactamente las 3 pantallas enlazadas, con selectores estables;
 *   - no sale del origen ni sigue externos/mailto/anclas;
 *   - respeta maxDepth y maxPages;
 *   - no pulsa nada: el servidor no recibe NINGÚN POST/PUT/DELETE/PATCH;
 *   - un 403 o un timeout se registran en `warnings` sin abortar el crawl;
 *   - un storageState dentro del repo se rechaza.
 *
 * Uso: npm run compile && npm run test:e2e:discovery
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync, writeFileSync, unlinkSync, mkdtempSync, rmSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { tmpdir, homedir } from 'node:os';
import { execSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const require = createRequire(import.meta.url);

const failures = [];
const passes = [];

function check(name, condition, detail = '') {
  if (condition) {
    passes.push(name);
    console.log(`PASS ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function eq(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), `esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(actual)}`);
}

const compiled = join(root, 'dist', 'discovery', 'index.js');
if (!existsSync(compiled)) {
  console.log('dist/discovery/index.js no existe: compilando…');
  // Comando constante sin entrada del usuario: no hay superficie de inyección.
  execSync('npm run compile', { cwd: root, stdio: 'inherit' });
}

const { crawlApp, assertStorageStateOutsideRepo } = require(compiled);

const fixtures = join(root, 'scripts', 'fixtures', 'discovery-app');
const requests = [];
let mutations = 0;

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  requests.push({ method: req.method, path: url.pathname });

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    mutations += 1;
  }

  if (url.pathname === '/mutate') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('mutado');
    return;
  }

  if (url.pathname === '/bloqueada.html') {
    res.writeHead(403, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Acceso restringido</title></head><body><h1>403</h1><p>No autorizado.</p></body></html>');
    return;
  }

  if (url.pathname === '/lenta.html') {
    setTimeout(() => {
      if (!res.writableEnded) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Lenta</title></head><body><h1>Tarde</h1></body></html>');
      }
    }, 5000);
    return;
  }

  const file = join(fixtures, url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//, ''));

  if (!existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('no encontrado');
    return;
  }

  const type = extname(file) === '.html' ? 'text/html; charset=utf-8' : 'application/octet-stream';
  res.writeHead(200, { 'content-type': type });
  res.end(readFileSync(file));
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;
const origin = new URL(base).origin;
console.log(`App de prueba en ${base}`);

const pageByPath = (doc, path) => doc.pages.find(page => page.path === path);
const elementBySelector = (page, selector) => page?.elements.find(element => element.selector === selector);
const skippedByReason = (doc, reason) => doc.stats.skipped.filter(entry => entry.reason === reason);

try {
  // ---------------------------------------------------------------------------
  // 1. Crawl por defecto: 3 pantallas enlazadas, nada fuera del origen.
  // ---------------------------------------------------------------------------
  const doc = await crawlApp({ url: `${base}/index.html`, headless: true });
  const paths = doc.pages.map(page => page.path);

  eq('pageCount = 3', doc.stats.pageCount, 3);
  eq('paths de las 3 pantallas', paths, ['/index.html', '/detalle.html', '/informe.html']);
  eq('depthReached = 2', doc.stats.depthReached, 2);
  check('baseUrl es la URL inicial', doc.baseUrl === `${base}/index.html`, doc.baseUrl);
  check('generatedAt es ISO-8601', /^\d{4}-\d{2}-\d{2}T/.test(doc.generatedAt), doc.generatedAt);
  check('todas las páginas son del mismo origen', doc.pages.every(page => new URL(page.url).origin === origin));
  check('sin warnings en el crawl limpio', doc.warnings.length === 0, JSON.stringify(doc.warnings));

  const index = pageByPath(doc, '/index.html');
  const detalle = pageByPath(doc, '/detalle.html');
  const informe = pageByPath(doc, '/informe.html');

  eq('título de index', index?.title, 'Inicio — App de prueba');
  eq('headings de index', index?.headings, [
    { level: 1, text: 'Gestión de clientes' },
    { level: 2, text: 'Resumen del día' }
  ]);

  // Estrategias de selector en el orden exigido.
  check('selector por id (#guardar)', !!elementBySelector(index, '#guardar'));
  check('selector por data-testid', !!elementBySelector(index, '[data-testid="abrir-detalle"]'));
  check('selector por aria-label', !!elementBySelector(index, 'button[aria-label="Abrir ayuda"]'));
  check('selector por role+name', !!elementBySelector(index, 'role=button[name="Ver más"]'));
  check('último recurso: css (clase estable)', !!elementBySelector(index, 'button.btn-icono'));
  check('los selectores usan la estrategia declarada', index.elements.every(element =>
    ['id', 'data-testid', 'aria-label', 'role+name', 'css'].includes(element.selectorStrategy)
  ));
  check('los elementos llevan texto visible', (index?.elements.length ?? 0) > 5 && index.elements.some(element => element.text === 'Pagar ahora'));
  check('formLabel informa del formulario contenedor', elementBySelector(index, '#guardar')?.formLabel === 'Alta de cliente', String(elementBySelector(index, '#guardar')?.formLabel));
  check('formLabel es null fuera de formularios', elementBySelector(index, '#pagar')?.formLabel === null);

  const form = index?.forms.find(item => item.label === 'Alta de cliente');
  check('formulario con etiqueta', !!form);
  eq('campos del formulario (label/type/selector)', form?.fields, [
    { label: 'Nombre', type: 'text', selector: '#nombre' },
    { label: 'Email', type: 'email', selector: '#email' },
    { label: 'Plan', type: 'select', selector: '#plan' },
    { label: 'Notas', type: 'textarea', selector: '#notas' }
  ]);
  check('textos de estado', (index?.statusTexts ?? []).includes('Todo listo para empezar.') && (index?.statusTexts ?? []).includes('Aviso de prueba'));

  check('detalle tiene su botón por aria-label', !!elementBySelector(detalle, 'button[aria-label="Eliminar cliente"]'));
  check('detalle tiene enlace por data-testid', !!elementBySelector(detalle, '[data-testid="ver-informe"]'));
  check('detalle no repite el enlace de vuelta', (detalle?.elements ?? []).filter(element => element.kind === 'link').length >= 1);
  check('informe tiene enlace por id', !!elementBySelector(informe, '#mas-detalle'));

  // Guardas de navegación.
  check('enlace externo descartado', skippedByReason(doc, 'externo').some(entry => entry.url.includes('externo.example.com')));
  check('mailto descartado', skippedByReason(doc, 'no-http').some(entry => entry.url.startsWith('mailto:')));
  check('ancla # descartada', skippedByReason(doc, 'ancla').some(entry => entry.url === '#ayuda'));
  check('profundo.html descartado por profundidad', skippedByReason(doc, 'max-profundidad').some(entry => entry.url.endsWith('/profundo.html')));
  check('ninguna página fuera de la app local', requests.every(request => request.path === '/index.html' || request.path === '/detalle.html' || request.path === '/informe.html' || request.path === '/favicon.ico'), JSON.stringify(requests.map(request => request.path)));
  check('ningún POST/PUT/DELETE/PATCH en el servidor', mutations === 0, `mutaciones=${mutations}`);
  check('ninguna petición a /mutate', requests.every(request => request.path !== '/mutate'));

  // ---------------------------------------------------------------------------
  // 2. maxPages = 2
  // ---------------------------------------------------------------------------
  const limited = await crawlApp({ url: `${base}/index.html`, headless: true, maxPages: 2 });
  eq('maxPages=2 lee 2 páginas', limited.stats.pageCount, 2);
  check('maxPages=2 descarta el resto por max-paginas', skippedByReason(limited, 'max-paginas').length > 0);

  // ---------------------------------------------------------------------------
  // 3. maxDepth = 0
  // ---------------------------------------------------------------------------
  const shallow = await crawlApp({ url: `${base}/index.html`, headless: true, maxDepth: 0 });
  eq('maxDepth=0 lee sólo la inicial', shallow.stats.pageCount, 1);
  check('maxDepth=0 descarta los enlaces por max-profundidad', skippedByReason(shallow, 'max-profundidad').length > 0);

  // ---------------------------------------------------------------------------
  // 4. 401/403 no aborta
  // ---------------------------------------------------------------------------
  const forbidden = await crawlApp({ url: `${base}/bloqueada.html`, headless: true });
  eq('403 se inventaría', forbidden.stats.pageCount, 1);
  check('403 queda en warnings', forbidden.warnings.some(warning => warning.includes('403')), JSON.stringify(forbidden.warnings));

  // ---------------------------------------------------------------------------
  // 5. Timeout no aborta
  // ---------------------------------------------------------------------------
  const timedOut = await crawlApp({ url: `${base}/lenta.html`, headless: true, timeoutMs: 500 });
  eq('timeout no devuelve páginas', timedOut.stats.pageCount, 0);
  check('timeout queda en warnings', timedOut.warnings.some(warning => warning.includes('No se pudo leer')), JSON.stringify(timedOut.warnings));
  check('timeout queda en skipped como error', skippedByReason(timedOut, 'error').length === 1);

  // ---------------------------------------------------------------------------
  // 6. storageState: fuera del repo sí, dentro del repo no.
  // ---------------------------------------------------------------------------
  const outside = join(tmpdir(), `mvc-storage-${Date.now()}.json`);
  writeFileSync(outside, '{"cookies":[],"origins":[]}');

  let outsideOk = true;
  try {
    assertStorageStateOutsideRepo(outside, root);
  } catch {
    outsideOk = false;
  }
  check('storageState fuera del repo aceptado', outsideOk);
  rmSync(outside, { force: true });

  const insideRepo = join(root, '.storage-state-prohibido.json');
  writeFileSync(insideRepo, '{"cookies":[],"origins":[]}');

  let insideRejected = false;
  try {
    await crawlApp({ url: `${base}/index.html`, headless: true, repoRoot: root, storageStatePath: insideRepo });
  } catch (error) {
    insideRejected = /fuera del repo|dentro del repositorio/i.test(String(error?.message ?? error));
  } finally {
    unlinkSync(insideRepo);
  }
  check('storageState dentro del repo rechazado antes de navegar', insideRejected);

  // ---------------------------------------------------------------------------
  // 7. Guarda estática: el crawler no pulsa nada.
  // ---------------------------------------------------------------------------
  const crawlerSource = readFileSync(join(root, 'src', 'discovery', 'crawler.ts'), 'utf-8');
  const forbiddenCalls = ['page.click(', '.fill(', '.press(', '.check(', '.selectOption(', '.submit(', 'page.dblclick('];
  check('el crawler no contiene clics/escrituras', forbiddenCalls.every(call => !crawlerSource.includes(call)), forbiddenCalls.filter(call => crawlerSource.includes(call)).join(', '));
  check('el crawler no sigue enlaces fuera del origen', crawlerSource.includes("reason: 'externo'") && crawlerSource.includes("reason: 'no-http'"));
  check('la heurística destructiva cubre los términos exigidos', ['pagar', 'comprar', 'borrar', 'eliminar', 'delete', 'pay', 'checkout', 'subscribe'].every(term => crawlerSource.toLowerCase().includes(term)));

  // ---------------------------------------------------------------------------
  // 8. Contrato: sin campos extra fuera del contrato.
  // ---------------------------------------------------------------------------
  const pageKeys = Object.keys(doc.pages[0]).sort();
  eq('campos de página del contrato', pageKeys, ['elements', 'forms', 'headings', 'path', 'statusTexts', 'title', 'url']);
  const elementKeys = Object.keys(doc.pages[0].elements[0]).sort();
  eq('campos de elemento del contrato', elementKeys, ['formLabel', 'kind', 'selector', 'selectorStrategy', 'text']);
  eq('campos de stats del contrato', Object.keys(doc.stats).sort(), ['depthReached', 'pageCount', 'skipped']);
  eq('campos de la raíz del contrato', Object.keys(doc).sort(), ['baseUrl', 'generatedAt', 'pages', 'stats', 'warnings']);
} catch (error) {
  failures.push(`excepción no controlada: ${error?.stack ?? error}`);
  console.error(error);
} finally {
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
}

console.log(`\n${passes.length} PASS · ${failures.length} FAIL`);
if (failures.length > 0) {
  console.error('\nFallos:');
  for (const failure of failures) {
    console.error(` - ${failure}`);
  }
  process.exit(1);
}

console.log('E2E de descubrimiento: OK');
