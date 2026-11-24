#!/usr/bin/env node
/**
 * E2E del convertidor `discovery` → borrador de fases (SSS-282).
 *
 * Flujo real, sin mocks del navegador ni del disco:
 *   1. sirve la app de prueba de 3 pantallas y la rastrea con el crawler;
 *   2. normaliza y PERSISTE `.mvc/discovery.json` (lo que leerá el convertidor);
 *   3. `discoveryToPhases` propone fases y se escribe el borrador;
 *   4. EJECUTA los pasos del borrador con Playwright contra la app real;
 *   5. aplica el borrador: sin confirmación `mvc-config.json` queda igual (hash)
 *      y con confirmación se escribe; después se ejecutan las fases guardadas.
 *
 * Uso: npm run compile && npm run test:e2e:discovery:phases
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { chromium } from '@playwright/test';

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

const {
  crawlApp,
  normalizeDiscovery,
  writeDiscoveryArtifacts,
  readDiscoveryDoc,
  discoveryToPhases,
  buildPhasesDraft,
  writePhasesDraft,
  applyPhasesDraftToProjectConfig,
  phasesDraftPath,
  discoveryPathOf,
  DRAFT_SCRIPT_MARKER
} = require(compiled);
const { normalizePhases, validateProjectConfig, CONFIG_VERSION } = require(join(root, 'dist', 'config', 'project-schema.js'));
const { fileHash, PROJECT_CONFIG_FILE } = require(join(root, 'dist', 'config', 'config-file.js'));

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

  res.writeHead(200, { 'content-type': extname(file) === '.html' ? 'text/html; charset=utf-8' : 'application/octet-stream' });
  res.end(readFileSync(file));
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
console.log(`App de prueba en ${base}`);

/** Ejecuta los pasos de una fase como lo hace `PlaywrightCapture.runSteps`. */
async function runPhase(page, phase) {
  await page.goto(phase.url, { waitUntil: 'load' });
  for (const step of phase.steps ?? []) {
    switch (step.action) {
      case 'goto':
        await page.goto(step.url, { waitUntil: step.waitUntil ?? 'load' });
        break;
      case 'click':
        await page.click(step.selector, { timeout: 5000 });
        break;
      case 'fill':
        await page.fill(step.selector, step.text, { timeout: 5000 });
        break;
      case 'press':
        await page.press(step.selector, step.key, { timeout: 5000 });
        break;
      case 'waitForSelector':
        await page.waitForSelector(step.selector, { timeout: step.timeoutMs ?? 15000 });
        break;
      case 'wait':
        // En el E2E no hace falta esperar el margen real de grabación.
        await page.waitForTimeout(Math.min(step.ms, 100));
        break;
      default:
        throw new Error(`Acción no soportada por el pipeline: ${step.action}`);
    }
  }
}

const workDir = mkdtempSync(join(tmpdir(), 'mvc-e2e-phases-'));
const mvcDir = join(workDir, '.mvc');
let browser;

try {
  // ---------------------------------------------------------------------------
  // 1. Descubrimiento real: crawl + normalización + persistencia del inventario.
  // ---------------------------------------------------------------------------
  const raw = await crawlApp({ url: `${base}/index.html`, headless: true });
  eq('crawl: 3 pantallas', raw.stats.pageCount, 3);
  eq('crawl: 0 mutaciones HTTP', mutations, 0);

  const doc = normalizeDiscovery(raw);
  mkdirSync(mvcDir, { recursive: true });
  writeFileSync(join(mvcDir, 'guion.md'), '# guion previo\n', 'utf8');
  writeDiscoveryArtifacts(doc, mvcDir);

  // Proyecto activo previo: el convertidor NO debe perder sus ajustes.
  const existingConfig = {
    version: CONFIG_VERSION,
    project: {
      name: 'app-prueba',
      url: `${base}/index.html`,
      outputDir: './output/mi-demo',
      variant: 'desktop',
      phases: [{ id: '99-antigua', label: 'Fase antigua', duration: 4 }]
    }
  };
  const configPath = join(workDir, PROJECT_CONFIG_FILE);
  writeFileSync(configPath, JSON.stringify(existingConfig, null, 2), 'utf8');
  const configHashBefore = fileHash(configPath);

  // ---------------------------------------------------------------------------
  // 2. Convertidor puro sobre el inventario LEÍDO de disco.
  // ---------------------------------------------------------------------------
  const stored = readDiscoveryDoc(discoveryPathOf(workDir));
  const proposal = discoveryToPhases(stored);
  const persisted = JSON.parse(readFileSync(discoveryPathOf(workDir), 'utf8'));

  eq('fases: una por pantalla', proposal.phases.length, 3);
  check(
    'fases: la portada abre la demo',
    proposal.phases[0].url === `${base}/index.html`,
    proposal.phases.map(phase => phase.url).join(', ')
  );
  eq('fases: ids válidos y numerados', proposal.phases.map(phase => phase.id), ['01-gestion-de-clientes', '02-cliente-42', '03-informe-mensual']);
  eq('fases: duraciones 5/8/8', proposal.phases.map(phase => phase.duration), [5, 8, 8]);
  check('guion: todas llevan marcador de borrador', proposal.phases.every(phase => phase.script.includes(DRAFT_SCRIPT_MARKER)));
  check(
    'guion: redactado en español con posición de pantalla',
    proposal.phases[0].script.startsWith('Abre la demo en ') &&
      proposal.phases[1].script.startsWith('Continúa la demo en ') &&
      proposal.phases[0].script.includes('(pantalla 1 de 3)')
  );

  const selectorsOfPage = path => new Set(persisted.pages.find(page => page.path === path).elements.map(element => element.selector));
  const selectorChecks = proposal.phases.map(phase => {
    const pageSelectors = selectorsOfPage(new URL(phase.url).pathname);
    return (phase.steps ?? [])
      .filter(step => step.action === 'click' || step.action === 'waitForSelector')
      .every(step => pageSelectors.has(step.selector));
  });
  check('selectores: TODOS los pasos salen del discovery persistido, ni uno inventado', selectorChecks.every(Boolean));
  check(
    'navegación: goto usa la URL observada de la fase',
    proposal.phases.every(phase => (phase.steps ?? []).filter(step => step.action === 'goto').every(step => step.url === phase.url))
  );
  check('borrador por defecto: no pulsa nada', proposal.phases.every(phase => !(phase.steps ?? []).some(step => step.action === 'click')));
  const warningsText = proposal.warnings.join('\n');
  check('avisos: lista acciones seguras sin pulsarlas', warningsText.includes('NO pulsa') && warningsText.includes('Abrir ayuda'));
  check('avisos: marca acciones sensibles', warningsText.includes('Borrar cuenta') && warningsText.includes('Pagar ahora') && warningsText.includes('NUNCA pulsadas'));

  const withClicks = discoveryToPhases(stored, { includeSafeClicks: true });
  const clickSelectors = withClicks.phases.flatMap(phase => (phase.steps ?? []).flatMap(step => (step.action === 'click' ? [step.selector] : [])));
  check('clics opcionales: nunca destructivos ni de formulario', clickSelectors.length > 0 && !clickSelectors.includes('#borrar') && !clickSelectors.includes('#pagar') && !clickSelectors.includes('#guardar'), clickSelectors.join(', '));

  // ---------------------------------------------------------------------------
  // 3. Borrador en disco: SÓLO el borrador, config intacta.
  // ---------------------------------------------------------------------------
  const existingProject = JSON.parse(readFileSync(configPath, 'utf8')).project;
  const draft = buildPhasesDraft(proposal, { base: existingProject, baseUrl: stored.baseUrl });
  const draftPath = writePhasesDraft(workDir, draft);

  check('fs: borrador en .mvc/mvc-config.borrador.json', draftPath === phasesDraftPath(workDir) && existsSync(draftPath));
  const draftJson = JSON.parse(readFileSync(draftPath, 'utf8'));
  check('borrador: misma forma que mvc-config.json', draftJson.version === CONFIG_VERSION && Array.isArray(draftJson.project.phases));
  check('borrador: conserva los ajustes del proyecto activo', draftJson.project.name === 'app-prueba' && draftJson.project.url === `${base}/index.html` && draftJson.project.outputDir === './output/mi-demo');
  check('fs: mvc-config.json intacto tras escribir el borrador', fileHash(configPath) === configHashBefore);
  check('fs: guion.md intacto', readFileSync(join(mvcDir, 'guion.md'), 'utf8') === '# guion previo\n');
  eq('fs: sin ficheros temporales', readdirSync(mvcDir).filter(name => name.startsWith('.')), []);
  const draftNormalized = normalizePhases(draftJson.project.phases);
  eq('borrador: pasa la normalización del pipeline sin avisos', draftNormalized.warnings, []);
  eq('borrador: la configuración resultante es válida', validateProjectConfig(draftJson.project), []);

  // ---------------------------------------------------------------------------
  // 4. El borrador se EJECUTA contra la app real (sin retocar selectores).
  // ---------------------------------------------------------------------------
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  let draftError = null;
  try {
    for (const phase of draftJson.project.phases) {
      await runPhase(page, phase);
    }
  } catch (error) {
    draftError = error instanceof Error ? error.message : String(error);
  }
  check('ejecución: los pasos del borrador corren en la app real', draftError === null, draftError ?? '');
  eq('ejecución: 0 mutaciones HTTP al ejecutar el borrador', mutations, 0);

  // ---------------------------------------------------------------------------
  // 5. Aplicación: sin confirmación NO se toca mvc-config.json.
  // ---------------------------------------------------------------------------
  const cancelled = await applyPhasesDraftToProjectConfig({ workspaceRoot: workDir, draft, confirm: async () => false });
  check('confirmación: sin aceptar, reason=cancelled', cancelled.reason === 'cancelled' && cancelled.applied === false, cancelled.reason);
  check('confirmación: mismo hash antes y después', cancelled.hashBefore === configHashBefore && cancelled.hashAfter === configHashBefore);
  check('confirmación: contenido de mvc-config.json idéntico', readFileSync(configPath, 'utf8') === JSON.stringify(existingConfig, null, 2));

  const applied = await applyPhasesDraftToProjectConfig({ workspaceRoot: workDir, draft, confirm: async () => true });
  check('confirmación: con aceptar, reason=applied', applied.reason === 'applied' && applied.applied === true, `${applied.reason} ${applied.warnings.join(' / ')}`);
  check('confirmación: el hash cambia al escribir', applied.hashAfter !== configHashBefore && fileHash(configPath) === applied.hashAfter);

  const appliedFile = JSON.parse(readFileSync(configPath, 'utf8'));
  eq('aplicado: 3 fases en mvc-config.json', appliedFile.project.phases.length, 3);
  eq('aplicado: fase antigua reemplazada', appliedFile.project.phases.map(phase => phase.id), ['01-gestion-de-clientes', '02-cliente-42', '03-informe-mensual']);
  check(
    'aplicado: conserva nombre, URL y salida del proyecto',
    appliedFile.project.name === 'app-prueba' &&
      appliedFile.project.url === `${base}/index.html` &&
      appliedFile.project.outputDir === './output/mi-demo' &&
      appliedFile.project.variant === 'desktop'
  );
  eq('aplicado: los pasos guardados son los del borrador', appliedFile.project.phases, draftJson.project.phases);

  const appliedNormalized = normalizePhases(appliedFile.project.phases);
  eq('aplicado: el pipeline lo normaliza sin descartes', appliedNormalized.warnings, []);
  eq('aplicado: validación del pipeline sin errores', validateProjectConfig(appliedFile.project), []);

  // Las fases REALMENTE guardadas también se ejecutan: eso es «sin retocar».
  let appliedError = null;
  const beforeAppliedRun = mutations;
  try {
    for (const phase of appliedNormalized.phases) {
      await runPhase(page, { ...phase, url: phase.url ?? draftJson.project.phases[0].url });
    }
  } catch (error) {
    appliedError = error instanceof Error ? error.message : String(error);
  }
  check('ejecución: las fases guardadas corren tal cual', appliedError === null, appliedError ?? '');
  eq('ejecución: 0 mutaciones HTTP con las fases guardadas', mutations, beforeAppliedRun);

  check('fs: el borrador sigue disponible tras aplicar', existsSync(draftPath));
  check('fs: discovery.json/.md intactos', existsSync(discoveryPathOf(workDir)) && existsSync(join(mvcDir, 'discovery.md')));
  eq(
    'fs: conjunto exacto de .mvc/',
    readdirSync(mvcDir).sort(),
    ['discovery.json', 'discovery.md', 'guion.md', 'mvc-config.borrador.json']
  );

  // El borrador no se versiona: `.mvc/` está ignorado por git (misma regla que discovery).
  // Comando constante, sin entrada del usuario: no hay superficie de inyección.
  try {
    const ignored = execSync('git check-ignore .mvc/mvc-config.borrador.json', {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'ignore']
    })
      .toString()
      .trim();
    eq('git: el borrador está ignorado', ignored, '.mvc/mvc-config.borrador.json');
  } catch {
    check('git: el borrador está ignorado', false, 'git check-ignore falló (¿no es un repo git?)');
  }
} finally {
  if (browser) {
    await browser.close();
  }
  await new Promise(resolve => server.close(resolve));
  rmSync(workDir, { recursive: true, force: true });
}

console.log(`\n${passes.length} PASS · ${failures.length} FAIL — E2E del convertidor discovery → fases`);
if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
