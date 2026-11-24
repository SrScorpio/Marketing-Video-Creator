#!/usr/bin/env node
/**
 * E2E del asistente de descubrimiento en el panel (SSS-282).
 *
 * Cubre el camino completo que hace el host cuando el usuario pulsa
 * "Descubrir app" en la pestaña `Descubrir`:
 *
 *   1. crawl real (Playwright) contra la app local de 3 pantallas;
 *   2. escritura de `.mvc/discovery.json` (normalizador ya entregado);
 *   3. lectura del payload del panel (`loadDiscoveryPanelPayload`): páginas,
 *      contadores, avisos, enlaces saltados y propuesta de fases;
 *   4. edición de label/guion por el usuario y guardado por el caso `savePhases`
 *      (validado con `normalizePhases`, el mismo que usa el host), comprobando
 *      que los selectores guardados son los OBSERVADOS (ninguno inventado);
 *   5. detección de `mvc-config.json` existente (confirmación antes de pisar);
 *   6. cancelación a mitad del crawl: no se cuelga y no escribe inventario;
 *   7. el bundle del webview contiene la pestaña y sus controles.
 *
 * El `.mvc/mvc-config.borrador.json` se genera aquí con la forma fijada en el
 * contrato (el convertidor es una tarea hermana): este script valida el panel,
 * no la heurística de agrupación en fases.
 *
 * Uso: npm run compile && npm run test:e2e:discovery:panel
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
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
  check(
    name,
    JSON.stringify(actual) === JSON.stringify(expected),
    `esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(actual)}`
  );
}

const compiledIndex = join(root, 'dist', 'discovery', 'index.js');
const compiledSchema = join(root, 'dist', 'config', 'project-schema.js');
const panelBundle = join(root, 'dist', 'panel', 'index.js');

if (!existsSync(compiledIndex) || !existsSync(panelBundle)) {
  console.log('Falta dist/: compilando…');
  // Comando constante sin entrada del usuario: no hay superficie de inyección.
  execSync('npm run compile', { cwd: root, stdio: 'inherit' });
}

const {
  buildPhasesDraft,
  crawlApp,
  discoveryToPhases,
  loadDiscoveryPanelPayload,
  normalizeDiscovery,
  phaseProposalToSavePayload,
  writeDiscoveryArtifacts,
  writePhasesDraft
} = require(compiledIndex);
const { normalizePhases } = require(compiledSchema);

/* --------------------------- app local de prueba --------------------------- */

const fixtures = join(root, 'scripts', 'fixtures', 'discovery-app');
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript' };
const served = [];
let mutations = 0;

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  served.push(url.pathname);

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    mutations += 1;
  }

  const relative = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//, '');
  const file = join(fixtures, relative);

  if (!existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('404');
    return;
  }

  res.writeHead(200, { 'content-type': mime[extname(file)] ?? 'text/plain' });
  res.end(readFileSync(file));
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const workDir = mkdtempSync(join(tmpdir(), 'mvc-panel-e2e-'));
const mvcDir = join(workDir, '.mvc');
mkdirSync(mvcDir, { recursive: true });

try {
  /* ------------------------- 1. crawl + inventario ------------------------ */

  const raw = await crawlApp({ url: `${base}/`, maxDepth: 2, maxPages: 15, headless: true });
  const discovery = normalizeDiscovery(raw);
  const artifacts = writeDiscoveryArtifacts(discovery, mvcDir);

  check('el crawl produce .mvc/discovery.json', existsSync(artifacts.jsonPath));
  check('el crawl produce .mvc/discovery.md', existsSync(artifacts.mdPath));
  check('el crawl lee al menos las 3 pantallas enlazadas', discovery.pages.length >= 3, `${discovery.pages.length} páginas`);

  const observedSelectors = new Set(
    discovery.pages.flatMap(page => [
      ...page.elements.map(element => element.selector),
      ...page.forms.flatMap(form => form.fields.map(field => field.selector))
    ])
  );

  /* ------------- 2. borrador de fases con el convertidor REAL ------------- */

  const proposal = discoveryToPhases(discovery);
  writePhasesDraft(
    workDir,
    buildPhasesDraft(proposal, { baseUrl: discovery.baseUrl })
  );
  const borradorPath = join(mvcDir, 'mvc-config.borrador.json');

  check('el convertidor escribe .mvc/mvc-config.borrador.json', existsSync(borradorPath));
  check('el convertidor propone fases para las pantallas', proposal.phases.length >= 3, `${proposal.phases.length} fases`);
  check('el borrador NO escribe mvc-config.json', !existsSync(join(mvcDir, 'mvc-config.json')));
  const borrador = JSON.parse(readFileSync(borradorPath, 'utf-8'));

  /* --------------------- 3. payload del panel (sin vscode) ---------------- */

  const payload = loadDiscoveryPanelPayload(workDir);

  eq('payload sin errores de lectura', payload.errors, []);
  check('el panel ve el inventario', payload.discovery !== null);
  eq('páginas del panel == páginas del crawl', payload.discovery.pageCount, discovery.pages.length);
  check('el panel cuenta páginas enlazadas conocidas', payload.discovery.pages.some(page => page.path === '/detalle.html'));
  check('el panel cuenta páginas enlazadas conocidas (informe)', payload.discovery.pages.some(page => page.path === '/informe.html'));
  check(
    'contador de acciones agregado correcto',
    payload.discovery.actionCount ===
      discovery.pages.reduce((total, page) => total + page.elements.length, 0),
    `${payload.discovery.actionCount} acciones`
  );
  check(
    'contador de formularios agregado correcto',
    payload.discovery.formCount === discovery.pages.reduce((total, page) => total + page.forms.length, 0),
    `${payload.discovery.formCount} formularios`
  );
  check('el enlace externo aparece en enlaces saltados', payload.discovery.skipped.some(skip => skip.reason === 'externo'));
  check('los avisos llegan al panel', Array.isArray(payload.discovery.warnings));
  eq('las páginas conservan el orden del normalizador', payload.discovery.pages.map(page => page.path), discovery.pages.map(page => page.path));

  check('el panel ve la propuesta de fases', payload.proposal !== null);
  eq('el panel ve las mismas fases que el convertidor', payload.proposal.phases.length, borrador.project.phases.length);
  check(
    'todas las fases tienen pasos con selector observado',
    payload.proposal.phases.every(phase =>
      phase.steps.every(step => step.selector === null || observedSelectors.has(step.selector))
    ),
    'algún selector de la propuesta no está en el inventario'
  );
  check('las fases muestran su URL de navegación', payload.proposal.phases.every(phase => phase.url === null || phase.url.startsWith(base)));

  /* ----------------- 4. edición del usuario + savePhases ------------------ */

  const edited = payload.proposal.phases.map((phase, index) =>
    index === 0 ? { ...phase, label: 'Portada editada', script: 'Guion pulido por el usuario.' } : phase
  );
  const savePayload = phaseProposalToSavePayload(edited);
  const { phases: saved, warnings: saveWarnings } = normalizePhases(savePayload);

  eq('savePhases no descarta ninguna fase', saved.length, edited.length);
  eq('savePhases no avisa de pasos inválidos', saveWarnings, []);
  eq('savePhases guarda la etiqueta editada', saved[0].label, 'Portada editada');
  eq('savePhases guarda el guion editado', saved[0].script, 'Guion pulido por el usuario.');
  check(
    'los pasos guardados siguen usando selectores observados',
    saved.every(phase =>
      (phase.steps ?? []).every(step => !step.selector || observedSelectors.has(step.selector))
    ),
    'algún selector guardado no está en el inventario'
  );
  // `normalizePhases` añade el `waitUntil: 'load'` por defecto a los `goto`: se
  // comparan acción y destino, no el objeto exacto.
  eq(
    'los pasos del borrador llegan intactos a savePhases',
    saved[0].steps.map(step => ({ action: step.action, selector: step.selector ?? null, url: step.url ?? null })),
    borrador.project.phases[0].steps.map(step => ({ action: step.action, selector: step.selector ?? null, url: step.url ?? null }))
  );

  /* ------------- 5. mvc-config.json existente → confirmación ------------- */

  check('sin mvc-config.json no hay que confirmar nada', payload.configExists === false);
  writeFileSync(
    join(mvcDir, 'mvc-config.json'),
    JSON.stringify(
      {
        version: '1.0.0',
        project: {
          name: 'demo',
          url: `${base}/`,
          variant: 'desktop',
          outputDir: './output/demo-video',
          phases: [{ id: '01-vieja', label: 'Vieja', duration: 5 }]
        }
      },
      null,
      2
    ),
    'utf-8'
  );

  const payloadWithConfig = loadDiscoveryPanelPayload(workDir);
  check('el panel detecta mvc-config.json existente', payloadWithConfig.configExists === true);
  eq('el panel cuenta las fases actuales para confirmar', payloadWithConfig.configPhaseCount, 1);

  /* --------------------------- 6. cancelación ---------------------------- */

  let pagesRead = 0;
  const partial = await crawlApp({
    url: `${base}/`,
    maxDepth: 2,
    maxPages: 15,
    headless: true,
    isCancelled: () => pagesRead >= 1,
    onPage: () => {
      pagesRead += 1;
    }
  });

  check('cancelar no deja el crawl colgado', partial !== null && typeof partial === 'object');
  check('cancelar devuelve inventario parcial, no completo', partial.pages.length >= 1 && partial.pages.length < discovery.pages.length, `${partial.pages.length} páginas`);
  check('cancelar deja constancia en warnings', partial.warnings.some(warning => /cancelad/i.test(warning)));

  /* ------------------------------- 7. webview ---------------------------- */

  const bundle = readFileSync(panelBundle, 'utf-8');
  check('el bundle del webview incluye la pestaña Descubrir', bundle.includes('Descubrir'));
  check('el bundle incluye el botón Descubrir app', bundle.includes('Descubrir app'));
  check('el bundle incluye la cancelación del descubrimiento', bundle.includes('Cancelar descubrimiento'));
  check('el bundle incluye la confirmación de sobrescritura', bundle.includes('mvc-config.json'));
  check('el bundle del webview no está vacío', statSync(panelBundle).size > 50_000);

  /* ------------------------------ 8. seguridad --------------------------- */

  eq('el recorrido no ha enviado ningún formulario ni mutado nada', mutations, 0);
  check('sólo se han pedido rutas del propio origen', served.every(path => path.startsWith('/')));
  check(
    'el inventario no contiene URLs de origen externo',
    discovery.pages.every(page => page.url.startsWith(base))
  );
} catch (error) {
  failures.push(`excepción no controlada: ${error?.stack ?? error}`);
  console.error(error);
} finally {
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
  rmSync(workDir, { recursive: true, force: true });
}

console.log(`\n${passes.length} PASS · ${failures.length} FAIL`);
if (failures.length > 0) {
  console.error('\nFallos:');
  for (const failure of failures) {
    console.error(` - ${failure}`);
  }
  process.exit(1);
}

console.log('E2E del asistente de descubrimiento en el panel: OK');
