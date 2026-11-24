#!/usr/bin/env node
/**
 * E2E del normalizador + persistencia del descubrimiento (SSS-282).
 *
 * Levanta la app de prueba de 3 pantallas, ejecuta el crawler compilado,
 * normaliza el resultado y escribe los artefactos en un `.mvc/` temporal que ya
 * contiene otros ficheros (guion, prompts). Verifica:
 *   - el JSON cumple el contrato FIJO clave a clave (raíz, página, elemento, stats);
 *   - las páginas van ordenadas por path y con ruta normalizada;
 *   - ningún selector final es inestable y cada `selectorStrategy` es del contrato;
 *   - el markdown tiene una sección por página, tabla de acciones y de formularios;
 *   - `.mvc/discovery.json` y `.mvc/discovery.md` se crean/reemplazan y NO tocan
 *     el resto de `.mvc/` (guion, prompts);
 *   - `.mvc/` está ignorado por git (los artefactos no se versionan).
 *
 * Uso: npm run compile && npm run test:e2e:discovery:normalize
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const repoRoot = join(root, '..');
const require = createRequire(import.meta.url);

const passes = [];
const failures = [];

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
  console.error('Falta dist/discovery/index.js: ejecuta `npm run compile` antes del E2E.');
  process.exit(1);
}

const { crawlApp, isUnstableSelector, isDestructiveAction, normalizeDiscovery, renderDiscoveryMarkdown, serializeDiscoveryJson, writeDiscoveryArtifacts } = require(compiled);

const fixtures = join(root, 'scripts', 'fixtures', 'discovery-app');
let mutations = 0;

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    mutations += 1;
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
const base = `http://127.0.0.1:${server.address().port}`;
console.log(`App de prueba en ${base}`);

const FIXED = () => new Date('2026-01-01T00:00:00.000Z');
const workDir = mkdtempSync(join(tmpdir(), 'mvc-e2e-discovery-'));
const outDir = join(workDir, '.mvc');

try {
  // ---------------------------------------------------------------------------
  // 1. Crawl real + normalización pura (sin navegador, reloj inyectado).
  // ---------------------------------------------------------------------------
  const raw = await crawlApp({ url: `${base}/index.html`, headless: true, now: FIXED });

  eq('crawl: 3 pantallas', raw.stats.pageCount, 3);
  eq('crawl: 0 mutaciones HTTP', mutations, 0);

  const doc = normalizeDiscovery(raw, { now: () => new Date('2026-02-02T02:02:02.000Z') });

  check('normalize: generatedAt saneado (raw traía ISO)', doc.generatedAt === '2026-01-01T00:00:00.000Z', doc.generatedAt);
  check('normalize: baseUrl conserva la URL de arranque, sin hash', doc.baseUrl === `${base}/index.html`, doc.baseUrl);
  eq('normalize: pageCount = pages.length', doc.stats.pageCount, doc.pages.length);
  eq('normalize: depthReached = 2', doc.stats.depthReached, 2);
  eq(
    'normalize: páginas ordenadas por path',
    doc.pages.map(page => page.path),
    ['/detalle.html', '/index.html', '/informe.html']
  );
  check(
    'normalize: rutas con barra inicial y sin hash/barra final',
    doc.pages.every(page => page.path.startsWith('/') && !page.path.includes('#') && !page.path.endsWith('/')),
    doc.pages.map(page => page.path).join(', ')
  );

  // ---------------------------------------------------------------------------
  // 2. Contrato FIJO clave a clave.
  // ---------------------------------------------------------------------------
  eq('contrato: claves de raíz', Object.keys(doc), ['generatedAt', 'baseUrl', 'pages', 'stats', 'warnings']);
  eq('contrato: claves de página', Object.keys(doc.pages[0]), ['url', 'path', 'title', 'headings', 'elements', 'forms', 'statusTexts']);
  eq('contrato: claves de stats', Object.keys(doc.stats), ['pageCount', 'depthReached', 'skipped']);
  eq('contrato: claves de elemento', Object.keys(doc.pages[1].elements[0]), ['kind', 'text', 'selector', 'selectorStrategy', 'formLabel']);
  eq('contrato: claves de formulario', Object.keys(doc.pages[1].forms[0]), ['label', 'fields']);
  eq('contrato: claves de campo', Object.keys(doc.pages[1].forms[0].fields[0]), ['label', 'type', 'selector']);

  const kinds = new Set(['button', 'link', 'input', 'select', 'textarea', 'status']);
  const strategies = new Set(['id', 'data-testid', 'aria-label', 'role+name', 'css']);
  const allElements = doc.pages.flatMap(page => page.elements);
  const allFields = doc.pages.flatMap(page => page.forms.flatMap(form => form.fields));

  check('contrato: kinds válidos', allElements.every(element => kinds.has(element.kind)), [...new Set(allElements.map(element => element.kind))].join(','));
  check(
    'contrato: selectorStrategy válida',
    allElements.every(element => strategies.has(element.selectorStrategy)),
    [...new Set(allElements.map(element => element.selectorStrategy))].join(',')
  );
  check(
    'normalize: ningún selector final inestable',
    [...allElements.map(element => element.selector), ...allFields.map(field => field.selector)].every(
      selector => !isUnstableSelector(selector)
    ),
    [...allElements.map(element => element.selector), ...allFields.map(field => field.selector)].filter(isUnstableSelector).join(', ')
  );
  check(
    'normalize: ningún selector vacío ni con prefijo prohibido',
    [...allElements.map(element => element.selector), ...allFields.map(field => field.selector)].every(
      selector => typeof selector === 'string' && selector.trim().length > 0
    )
  );

  const indexPage = doc.pages.find(page => page.path === '/index.html');
  check('index: inventario no vacío', indexPage.elements.length > 0 && indexPage.forms.length > 0);
  check('index: acción destructiva marcable (#borrar presente)', indexPage.elements.some(element => isDestructiveAction(element.text)));

  // ---------------------------------------------------------------------------
  // 3. Markdown: una sección por página, acciones y formularios.
  // ---------------------------------------------------------------------------
  const markdown = renderDiscoveryMarkdown(doc);

  check('md: cabecera con host', markdown.startsWith(`# Descubrimiento de la app — ${new URL(base).host}`), markdown.split('\n')[0]);
  for (const [index, page] of doc.pages.entries()) {
    check(`md: sección ${index + 1} (${page.path})`, markdown.includes(`## ${index + 1}. ${page.title || page.path}`));
  }
  check('md: tabla de acciones', markdown.includes('| Texto | Tipo | Selector | Estrategia | Formulario |'));
  check('md: tabla de formularios', markdown.includes('| Formulario | Campo | Tipo | Selector |'));
  check('md: una fila por acción', doc.pages.every(page => page.elements.every(element => markdown.includes(`\`${element.selector}\``))));
  check('md: descartes y avisos', markdown.includes('## Descartes') && markdown.includes('## Avisos'));
  check('md: generado se reescribe con el reloj nuevo si falta el crudo', renderDiscoveryMarkdown({ ...doc, generatedAt: 'x' }).includes('x'));

  // ---------------------------------------------------------------------------
  // 4. Persistencia: sólo los dos artefactos, resto de .mvc intacto.
  // ---------------------------------------------------------------------------
  mkdirSync(join(outDir, 'prompts'), { recursive: true });
  writeFileSync(join(outDir, 'guion.md'), '# guion previo\n', 'utf8');
  writeFileSync(join(outDir, 'prompts', '00-leeme.md'), '# pack previo\n', 'utf8');
  writeFileSync(join(outDir, 'discovery.md'), 'contenido viejo\n', 'utf8');

  const artifacts = writeDiscoveryArtifacts(doc, outDir);

  check('fs: discovery.json existe', existsSync(artifacts.jsonPath));
  check('fs: discovery.md existe', existsSync(artifacts.mdPath));
  check('fs: JSON idéntico al serializador', readFileSync(artifacts.jsonPath, 'utf8') === serializeDiscoveryJson(doc));
  check('fs: markdown idéntico al renderizador', readFileSync(artifacts.mdPath, 'utf8') === markdown);
  check('fs: discovery.md reemplazado', readFileSync(artifacts.mdPath, 'utf8').includes('## 2. Inicio'));
  check('fs: guion.md intacto', readFileSync(join(outDir, 'guion.md'), 'utf8') === '# guion previo\n');
  check('fs: prompts/00-leeme.md intacto', readFileSync(join(outDir, 'prompts', '00-leeme.md'), 'utf8') === '# pack previo\n');
  eq('fs: no hay ficheros temporales', readdirSync(outDir).filter(name => name.startsWith('.tmp-')), []);
  eq('fs: conjunto exacto de ficheros', readdirSync(outDir).sort(), ['discovery.json', 'discovery.md', 'guion.md', 'prompts']);

  const second = writeDiscoveryArtifacts({ ...doc, pages: doc.pages.map(page => ({ ...page })) }, outDir);
  check('fs: reescribir es idempotente', readFileSync(second.jsonPath, 'utf8') === serializeDiscoveryJson(doc));

  // ---------------------------------------------------------------------------
  // 5. .mvc/ ignorado por git (los artefactos no se versionan).
  // ---------------------------------------------------------------------------
  try {
    // Comando constante, sin entrada del usuario: no hay superficie de inyección.
    const ignored = execSync('git check-ignore .mvc/discovery.json .mvc/discovery.md', {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'ignore']
    })
      .toString()
      .trim()
      .split('\n');
    eq('git: .mvc/discovery.json y .md ignorados', ignored.sort(), ['.mvc/discovery.json', '.mvc/discovery.md']);
  } catch {
    check('git: .mvc/ ignorado', false, 'git check-ignore falló (¿no es un repo git?)');
  }
} finally {
  await new Promise(resolve => server.close(resolve));
  rmSync(workDir, { recursive: true, force: true });
}

console.log(`\n${passes.length} PASS · ${failures.length} FAIL — E2E de normalización de descubrimiento`);
if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
