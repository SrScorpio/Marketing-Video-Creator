/**
 * Tests de los módulos puros de SSS-282 sobre FIXTURES en disco (QA).
 *
 * Los specs de `discovery-normalizer.test.ts` y `discovery-phases.test.ts` usan
 * objetos inline construidos por el autor. Este fichero hace lo mismo con
 * fixtures JSON versionados en `test/fixtures/discovery/`, de modo que:
 *   - los datos sucios del crawler quedan congelados y son revisables por
 *     cualquiera (no hay que leer el spec para saber qué se probó);
 *   - el inventario normalizado se prueba también SIN pasar por el
 *     normalizador (contrato que consume el convertidor);
 *   - se recorre el pipeline completo fixture sucio → normalizado → fases y se
 *     comprueba que cada paso referencia un selector OBSERVADO.
 *
 * Además se cubre la garantía del encargo con hash: el borrador NUNCA toca
 * `mvc-config.json`; sin confirmación el fichero queda byte a byte idéntico y
 * con confirmación se escriben las fases conservando el resto del proyecto.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  normalizeDiscovery,
  selectorStrategyOf
} from '../src/discovery/normalizer';
import { DRAFT_SCRIPT_MARKER, discoveryToPhases } from '../src/discovery/phases-proposer';
import {
  applyPhasesDraftToProjectConfig,
  buildPhasesDraft,
  phasesDraftPath,
  writePhasesDraft
} from '../src/discovery/phases-draft';
import { CONFIG_VERSION, normalizePhases } from '../src/config/project-schema';
import { PROJECT_CONFIG_FILE, fileHash, readProjectConfigFile } from '../src/config/config-file';
import { RawDiscovery } from '../src/discovery/types';

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'discovery');
const FIXED_NOW_ISO = '2026-02-03T04:05:06.000Z';
const FIXED_NOW = () => new Date(FIXED_NOW_ISO);
const ELEMENT_STRATEGIES = ['id', 'data-testid', 'aria-label', 'role+name', 'css'];

/** Lee un fixture y devuelve una copia limpia: ningún test comparte estado. */
function readFixture<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8')) as T;
}

const dirty = (): RawDiscovery => readFixture<RawDiscovery>('raw-dirty-discovery.json');
const normalized = (): RawDiscovery => readFixture<RawDiscovery>('normalized-discovery.json');
const existingConfig = () => readFixture<{ version: string; project: Record<string, unknown> }>('mvc-config.existing.json');

const normalizedDoc = () => normalizeDiscovery(dirty(), { now: FIXED_NOW });

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvc-fixtures-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------------- *
 * normalizeDiscovery sobre el fixture SUCIO
 * ------------------------------------------------------------------------- */

describe('fixtures · normalizeDiscovery (crawler sucio)', () => {
  it('deduplica páginas por path normalizado: gana la primera y se avisa', () => {
    const doc = normalizedDoc();

    expect(doc.pages.map(page => page.path)).toEqual(['/', '/clientes', '/informe?tab=2']);
    expect(doc.pages.map(page => page.title)).toEqual(['Inicio', 'Clientes', 'Informe']);
    expect(doc.stats.pageCount).toBe(3);
    // El duplicado tenía otro título: si ganara, el índice mostraría "Clientes duplicada".
    expect(doc.warnings.some(warning => warning.includes('página duplicada descartada (/clientes)'))).toBe(true);
  });

  it('normaliza url y path: sin hash, sin barra final y con la query intacta', () => {
    const doc = normalizedDoc();
    const clientes = doc.pages.find(page => page.path === '/clientes')!;
    const informe = doc.pages.find(page => page.path === '/informe?tab=2')!;

    expect(clientes.url).toBe('http://app.test/clientes/');
    expect(informe.url).toBe('http://app.test/informe?tab=2');
    expect(informe.path).toBe('/informe?tab=2');
  });

  it('recalcula stats (pageCount, depthReached truncado) y deduplica/ordena los descartes', () => {
    const doc = normalizedDoc();

    expect(doc.stats.depthReached).toBe(3);
    expect(doc.stats.skipped).toEqual([
      { url: '#ayuda', reason: 'ancla' },
      { url: 'mailto:a@b.test', reason: 'error' },
      { url: 'https://externo.test/x', reason: 'externo' }
    ]);
  });

  it('respeta el contrato fijo: claves exactas en todas las capas', () => {
    const doc = normalizedDoc();

    expect(Object.keys(doc)).toEqual(['generatedAt', 'baseUrl', 'pages', 'stats', 'warnings']);
    for (const page of doc.pages) {
      expect(Object.keys(page)).toEqual(['url', 'path', 'title', 'headings', 'elements', 'forms', 'statusTexts']);
      for (const element of page.elements) {
        expect(Object.keys(element)).toEqual(['kind', 'text', 'selector', 'selectorStrategy', 'formLabel']);
        expect(ELEMENT_STRATEGIES).toContain(element.selectorStrategy);
      }
      for (const form of page.forms) {
        expect(Object.keys(form)).toEqual(['label', 'fields']);
      }
    }
    expect(Object.keys(doc.stats)).toEqual(['pageCount', 'depthReached', 'skipped']);
  });

  it('un generatedAt no ISO se sustituye por el reloj inyectado y baseUrl pierde el hash', () => {
    const doc = normalizedDoc();

    expect(doc.generatedAt).toBe(FIXED_NOW_ISO);
    expect(doc.baseUrl).toBe('http://app.test');
  });

  it('deduplica elementos por selector y conserva el que aporta texto', () => {
    const clientes = normalizedDoc().pages.find(page => page.path === '/clientes')!;
    const nuevoCliente = clientes.elements.filter(element => element.selector === '#nuevo-cliente');

    expect(nuevoCliente).toHaveLength(1);
    expect(nuevoCliente[0].text).toBe('Nuevo cliente');
  });

  it('conserva elementos sin texto si el selector es estable', () => {
    const doc = normalizedDoc();
    const inicio = doc.pages.find(page => page.path === '/')!;
    const clientes = doc.pages.find(page => page.path === '/clientes')!;

    expect(inicio.elements.find(element => element.selector === '#sin-texto')).toMatchObject({ text: '', kind: 'button' });
    expect(clientes.elements.find(element => element.selector === '#icono-sin-texto')).toMatchObject({ text: '', kind: 'button' });
  });

  it('selectores autogenerados: reescribe a role+name si hay texto y descarta si no lo hay', () => {
    const doc = normalizedDoc();
    const elements = doc.pages.find(page => page.path === '/clientes')!.elements;
    const selectors = elements.map(element => element.selector);

    expect(selectors).toContain('form >> role=button[name="Guardar"]');
    expect(selectors).toContain('role=button[name="Ver más"]');
    expect(selectors.some(selector => /css-1x2y3z|sc-bdVaJa/.test(selector))).toBe(false);
    expect(elements.find(element => element.text === 'Guardar')?.selectorStrategy).toBe('role+name');

    const text = doc.warnings.join('\n');
    expect(text).toContain('/clientes — 2 selector(es) inestable(s) reescrito(s) a role+name');
    expect(text).toContain('/clientes — 1 elemento(s) descartado(s) por selector inestable sin alternativa');
  });

  it('recalcula selectorStrategy desde el selector, en orden id > data-testid > aria-label > role+name > css', () => {
    const clientes = normalizedDoc().pages.find(page => page.path === '/clientes')!;
    const strategy = (selector: string) => clientes.elements.find(element => element.selector === selector)?.selectorStrategy;

    // El crudo mentía a propósito (el enlace decía role+name y el select decía id).
    expect(strategy('#nuevo-cliente')).toBe('id');
    expect(strategy('button[aria-label="Abrir panel"]')).toBe('aria-label');
    expect(strategy('role=button[name="Ver más"]')).toBe('role+name');
    expect(strategy('select[name="plan"]')).toBe('css');
    expect(strategy('a[href="/clientes/42"]')).toBe('css');

    // Preferencia entre criterios simultáneos (ningún selector del crawler los combina hoy).
    expect(selectorStrategyOf('#guardar')).toBe('id');
    expect(selectorStrategyOf('[id="con espacio"]')).toBe('id');
    expect(selectorStrategyOf('[data-testid="x"][aria-label="y"]')).toBe('data-testid');
    expect(selectorStrategyOf('[aria-label="y"][role="button"]')).toBe('aria-label');
    expect(selectorStrategyOf('role=button[name="Ver más"]')).toBe('role+name');
    expect(selectorStrategyOf('button.primario')).toBe('css');
  });

  it('formularios: deduplica campos, recorta etiquetas, minúsculiza tipos y avisa de selectores inestables', () => {
    const doc = normalizedDoc();
    const forms = doc.pages.find(page => page.path === '/clientes')!.forms;

    expect(forms[0].label).toBe('Alta de cliente');
    expect(forms[0].fields).toEqual([
      { label: 'Nombre', type: 'text', selector: '#nombre' },
      { label: 'campo sin etiqueta', type: 'text', selector: '#apellidos' }
    ]);
    expect(forms.map(form => form.label)).toContain('formulario 2');
    expect(doc.warnings.some(warning => warning.includes('1 campo(s) de formulario con selector inestable'))).toBe(true);
  });

  it('deduplica los avisos del crudo y no repite los generados', () => {
    const doc = normalizedDoc();
    const repeated = doc.warnings.filter(warning => warning === 'lector: 1 nodo sin texto');

    expect(repeated).toHaveLength(1);
    expect(doc.warnings).toHaveLength(new Set(doc.warnings).size);
    expect(doc.warnings.some(warning => warning.trim() === '')).toBe(false);
  });

  it('no muta el fixture de entrada', () => {
    const raw = dirty();
    const before = JSON.stringify(raw);

    normalizeDiscovery(raw, { now: FIXED_NOW });

    expect(JSON.stringify(raw)).toBe(before);
  });
});

/* ------------------------------------------------------------------------- *
 * discoveryToPhases sobre el fixture NORMALIZADO (contrato que consume el pipeline)
 * ------------------------------------------------------------------------- */

describe('fixtures · discoveryToPhases (inventario normalizado)', () => {
  it('genera una fase por pantalla y abre por la portada de baseUrl (no por orden alfabético)', () => {
    const { phases } = discoveryToPhases(normalized());

    expect(phases).toHaveLength(4);
    expect(phases.map(phase => phase.label)).toEqual(['Clientes', 'Cliente 42', 'Informe', 'Vacía']);
    expect(phases.map(phase => phase.url)).toEqual([
      'http://app.test/clientes',
      'http://app.test/clientes/42',
      'http://app.test/informe?tab=2',
      'http://app.test/vacia'
    ]);
  });

  it('cada fase tiene id, label, duration, url y script; el guion lleva el marcador de borrador', () => {
    const { phases } = discoveryToPhases(normalized());

    expect(phases.map(phase => phase.id)).toEqual(['01-clientes', '02-cliente-42', '03-informe', '04-vacia']);
    expect(new Set(phases.map(phase => phase.id)).size).toBe(phases.length);
    expect(phases.map(phase => phase.duration)).toEqual([5, 8, 8, 8]);

    for (const phase of phases) {
      expect(phase.id).toMatch(/^[a-z0-9-]+$/);
      expect(typeof phase.label).toBe('string');
      expect(phase.label.length).toBeGreaterThan(0);
      expect(typeof phase.url).toBe('string');
      expect(phase.script).toContain(DRAFT_SCRIPT_MARKER);
      expect((phase.steps ?? []).length).toBeGreaterThan(0);
    }
    expect(phases[0].script).toContain('Abre la demo en «Clientes» (pantalla 1 de 4).');
  });

  it('cada paso con selector referencia un selector PRESENTE en su página del inventario', () => {
    const discovery = normalized();
    const { phases } = discoveryToPhases(discovery, { includeSafeClicks: true });

    expect(phases.some(phase => (phase.steps ?? []).some(step => step.action === 'click'))).toBe(true);

    phases.forEach((phase, index) => {
      const page = discovery.pages.find(candidate => candidate.url === phase.url);
      expect(page).toBeDefined();
      const observed = new Set(page!.elements.map(element => element.selector));

      for (const step of phase.steps ?? []) {
        if (step.action === 'waitForSelector' || step.action === 'click') {
          expect(observed.has(step.selector as string)).toBe(true);
        }
        if (step.action === 'goto') {
          expect(step.url).toBe(phase.url);
        }
      }
      if (index === 0) {
        expect((phase.steps ?? []).some(step => step.action === 'goto')).toBe(false);
      } else {
        expect((phase.steps ?? [])[0]).toEqual({ action: 'goto', url: page!.url, waitUntil: 'load' });
      }
    });
  });

  it('por defecto no pulsa nada; con clics activados sólo propone botones estables de fuera de formulario', () => {
    const discovery = normalized();
    const withoutClicks = discoveryToPhases(discovery);
    const withClicks = discoveryToPhases(discovery, { includeSafeClicks: true });

    expect(
      withoutClicks.phases.flatMap(phase => (phase.steps ?? []).filter(step => step.action === 'click'))
    ).toEqual([]);

    const clicks = withClicks.phases.flatMap(phase =>
      (phase.steps ?? []).flatMap(step => (step.action === 'click' ? [step.selector as string] : []))
    );

    expect(clicks).toEqual(['[data-testid="abrir-informe"]', 'button[aria-label="Descargar informe"]']);
    for (const forbidden of ['#pagar', '#eliminar', '#guardar']) {
      expect(clicks).not.toContain(forbidden);
    }
  });

  it('las fases generadas pasan la normalización del pipeline sin avisos', () => {
    const { phases } = discoveryToPhases(normalized(), { includeSafeClicks: true });
    const { phases: stored, warnings } = normalizePhases(phases);

    expect(warnings).toEqual([]);
    expect(stored).toHaveLength(phases.length);
    expect(stored[1].steps).toEqual(phases[1].steps);
  });

  it('maxPhases recorta la propuesta y lo dice', () => {
    const { phases, warnings } = discoveryToPhases(normalized(), { maxPhases: 2 });

    expect(phases.map(phase => phase.id)).toEqual(['01-clientes', '02-cliente-42']);
    expect(warnings.join('\n')).toContain('Se han omitido 2 pantalla(s)');
  });
});

/* ------------------------------------------------------------------------- *
 * Pipeline completo: fixture SUCIO → normalizado → fases
 * ------------------------------------------------------------------------- */

describe('fixtures · pipeline sucio → normalizado → fases', () => {
  it('ningún paso referencia un selector que no exista en el inventario normalizado', () => {
    const doc = normalizedDoc();
    const { phases } = discoveryToPhases(doc, { includeSafeClicks: true });

    expect(phases).toHaveLength(doc.pages.length);
    expect(phases[0].url).toBe('http://app.test/');

    for (const phase of phases) {
      const page = doc.pages.find(candidate => candidate.url === phase.url);
      expect(page).toBeDefined();
      const observed = new Set(page!.elements.map(element => element.selector));

      for (const step of phase.steps ?? []) {
        if (step.action === 'waitForSelector' || step.action === 'click') {
          expect(observed.has(step.selector as string)).toBe(true);
        }
      }
    }
  });

  it('los selectores de los pasos son estables por construcción (nunca css autogenerado)', () => {
    const doc = normalizedDoc();
    const { phases } = discoveryToPhases(doc);

    for (const phase of phases) {
      for (const step of phase.steps ?? []) {
        if (step.action === 'waitForSelector') {
          expect(step.selector as string).not.toMatch(/css-|sc-|jsx-|:nth-/);
        }
      }
    }
  });
});

/* ------------------------------------------------------------------------- *
 * Guardado: el borrador no toca mvc-config.json; sólo la confirmación escribe
 * ------------------------------------------------------------------------- */

describe('fixtures · guardado del borrador de fases', () => {
  function workspace(): { root: string; configPath: string; discoveryPath: string; draft: ReturnType<typeof buildPhasesDraft> } {
    const root = tempDir();
    const configPath = path.join(root, PROJECT_CONFIG_FILE);
    const mvc = path.join(root, '.mvc');
    const discoveryPath = path.join(mvc, 'discovery.json');

    fs.mkdirSync(mvc, { recursive: true });
    fs.writeFileSync(configPath, `${JSON.stringify(existingConfig(), null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(mvc, 'guion.md'), '# guion previo\n', 'utf8');
    fs.writeFileSync(discoveryPath, JSON.stringify(normalized(), null, 2), 'utf8');

    const draft = buildPhasesDraft(discoveryToPhases(normalized()), { baseUrl: normalized().baseUrl });
    return { root, configPath, discoveryPath, draft };
  }

  it('writePhasesDraft escribe sólo .mvc/mvc-config.borrador.json y deja mvc-config.json intacto (hash)', () => {
    const { root, configPath, discoveryPath, draft } = workspace();
    const configHash = fileHash(configPath);
    const discoveryHash = fileHash(discoveryPath);

    const draftPath = writePhasesDraft(root, draft);

    expect(draftPath).toBe(phasesDraftPath(root));
    expect(draftPath).toBe(path.join(root, '.mvc', 'mvc-config.borrador.json'));
    expect(fileHash(configPath)).toBe(configHash);
    expect(fileHash(discoveryPath)).toBe(discoveryHash);
    expect(fs.readFileSync(path.join(root, '.mvc', 'guion.md'), 'utf8')).toBe('# guion previo\n');

    const stored = JSON.parse(fs.readFileSync(draftPath, 'utf8'));
    expect(stored.version).toBe(CONFIG_VERSION);
    expect(stored.project.phases).toHaveLength(4);
    expect(fs.readdirSync(path.join(root, '.mvc')).filter(name => name.startsWith('.'))).toEqual([]);
  });

  it('sin confirmación mvc-config.json queda byte a byte igual (mismo hash)', async () => {
    const { root, configPath, draft } = workspace();
    const hashBefore = fileHash(configPath);
    const bytesBefore = fs.readFileSync(configPath, 'utf8');
    let calls = 0;

    const result = await applyPhasesDraftToProjectConfig({
      workspaceRoot: root,
      draft,
      confirm: async () => {
        calls += 1;
        return false;
      }
    });

    expect(calls).toBe(1);
    expect(result.applied).toBe(false);
    expect(result.reason).toBe('cancelled');
    expect(result.hashBefore).toBe(hashBefore);
    expect(result.hashAfter).toBe(hashBefore);
    expect(fileHash(configPath)).toBe(hashBefore);
    expect(fs.readFileSync(configPath, 'utf8')).toBe(bytesBefore);
  });

  it('con confirmación escribe las fases del borrador y conserva el resto del proyecto', async () => {
    const { root, configPath, draft } = workspace();
    const hashBefore = fileHash(configPath);

    const result = await applyPhasesDraftToProjectConfig({ workspaceRoot: root, draft, confirm: async () => true });

    expect(result.applied).toBe(true);
    expect(result.reason).toBe('applied');
    expect(result.hashAfter).not.toBe(hashBefore);
    expect(fileHash(configPath)).toBe(result.hashAfter);

    const stored = readProjectConfigFile(configPath)!;
    expect(stored).toMatchObject({
      name: 'proyecto-activo',
      url: 'https://app.real/',
      outputDir: './salida-real',
      variant: 'mobile'
    });
    expect(stored.phases.map(phase => phase.id)).toEqual(draft.project.phases.map(phase => phase.id));
    expect(stored.phases[0].steps).toEqual(draft.project.phases[0].steps);
    expect(stored.phases.map(phase => phase.id)).not.toContain('99-vieja');
  });

  it('sin mvc-config.json previo y sin confirmación no se crea el fichero', async () => {
    const root = tempDir();
    const draft = buildPhasesDraft(discoveryToPhases(normalized()), { baseUrl: normalized().baseUrl });

    const result = await applyPhasesDraftToProjectConfig({ workspaceRoot: root, draft, confirm: async () => false });

    expect(result.hashBefore).toBeNull();
    expect(result.hashAfter).toBeNull();
    expect(fs.existsSync(path.join(root, PROJECT_CONFIG_FILE))).toBe(false);
  });
});
