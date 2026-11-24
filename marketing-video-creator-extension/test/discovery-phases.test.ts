/**
 * Tests del convertidor `discovery` → borrador de fases (SSS-282).
 *
 * `discoveryToPhases` es pura: se prueba con objetos planos, sin navegador ni
 * VS Code. Después se cubre la persistencia del borrador y, sobre todo, la
 * garantía que pidió el encargo: sin confirmación explícita `mvc-config.json`
 * queda INTACTO (mismo hash); sólo con confirmación se escribe.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DRAFT_SCRIPT_MARKER,
  discoveryToPhases
} from '../src/discovery/phases-proposer';
import {
  PHASES_DRAFT_FILE,
  applyPhasesDraftToProjectConfig,
  buildPhasesDraft,
  discoveryPathOf,
  phasesDraftPath,
  readDiscoveryDoc,
  writePhasesDraft
} from '../src/discovery/phases-draft';
import { CONFIG_VERSION, normalizePhases } from '../src/config/project-schema';
import { fileHash, PROJECT_CONFIG_FILE, readProjectConfigFile } from '../src/config/config-file';
import { RawDiscovery } from '../src/discovery/types';

const BASE_URL = 'http://app.test/index.html';

function page(
  pagePath: string,
  title: string,
  headings: string[],
  elements: RawDiscovery['pages'][number]['elements'],
  forms: RawDiscovery['pages'][number]['forms'] = [],
  statusTexts: string[] = []
): RawDiscovery['pages'][number] {
  return {
    url: `http://app.test${pagePath}`,
    path: pagePath,
    title,
    headings: headings.map((text, index) => ({ level: index === 0 ? 1 : 2, text })),
    elements,
    forms,
    statusTexts
  };
}

/** Inventario con la forma EXACTA que produce el normalizador. */
function discoveryFixture(): RawDiscovery {
  return {
    generatedAt: '2026-01-01T00:00:00.000Z',
    baseUrl: BASE_URL,
    pages: [
      // Orden alfabético por path (como lo deja el normalizador): la portada NO va primera.
      page(
        '/detalle.html',
        'Detalle de cliente — App de prueba',
        ['Cliente 42', 'Datos de contacto'],
        [
          { kind: 'link', text: 'Ver informe', selector: '[data-testid="ver-informe"]', selectorStrategy: 'data-testid', formLabel: null },
          { kind: 'button', text: 'Eliminar cliente', selector: '#eliminar', selectorStrategy: 'id', formLabel: null },
          { kind: 'input', text: '', selector: '#telefono', selectorStrategy: 'id', formLabel: 'Editar cliente' },
          { kind: 'status', text: 'Cambios sin guardar.', selector: 'role=status', selectorStrategy: 'role+name', formLabel: null }
        ],
        [
          {
            label: 'Editar cliente',
            fields: [{ label: 'Teléfono', type: 'tel', selector: '#telefono' }]
          }
        ],
        ['Cambios sin guardar.']
      ),
      page(
        '/index.html',
        'Inicio — App de prueba',
        ['Gestión de clientes', 'Resumen del día'],
        [
          { kind: 'link', text: 'Ver cliente', selector: '#ir-detalle', selectorStrategy: 'id', formLabel: null },
          { kind: 'button', text: 'Guardar', selector: '#guardar', selectorStrategy: 'id', formLabel: 'Alta de cliente' },
          { kind: 'button', text: 'Borrar cuenta', selector: '#borrar', selectorStrategy: 'id', formLabel: 'Alta de cliente' },
          { kind: 'button', text: 'Pagar ahora', selector: '#pagar', selectorStrategy: 'id', formLabel: null },
          { kind: 'button', text: 'Abrir ayuda', selector: '[aria-label="Abrir ayuda"]', selectorStrategy: 'aria-label', formLabel: null },
          { kind: 'button', text: 'Abrir detalle', selector: '[data-testid="abrir-detalle"]', selectorStrategy: 'data-testid', formLabel: null },
          { kind: 'button', text: 'Ver más', selector: 'role=button[name="Ver más"]', selectorStrategy: 'role+name', formLabel: null },
          { kind: 'status', text: 'Todo listo para empezar.', selector: 'role=status', selectorStrategy: 'role+name', formLabel: null }
        ],
        [
          {
            label: 'Alta de cliente',
            fields: [
              { label: 'Nombre', type: 'text', selector: '#nombre' },
              { label: 'Email', type: 'email', selector: '#email' },
              { label: 'Plan', type: 'select', selector: '#plan' },
              { label: 'Notas', type: 'textarea', selector: '#notas' }
            ]
          }
        ],
        ['Todo listo para empezar.']
      ),
      page(
        '/informe.html',
        'Informe — App de prueba',
        ['Informe mensual', 'Resumen de actividad'],
        [
          { kind: 'link', text: 'Más detalle', selector: '#mas-detalle', selectorStrategy: 'id', formLabel: null },
          { kind: 'button', text: 'Descargar informe', selector: '#descargar-informe', selectorStrategy: 'id', formLabel: null },
          { kind: 'status', text: 'Informe generado a las 10:00.', selector: 'output:has-text("Informe generado a las 10:00.")', selectorStrategy: 'css', formLabel: null }
        ],
        [],
        ['Informe generado a las 10:00.']
      )
    ],
    stats: { pageCount: 3, depthReached: 2, skipped: [] },
    warnings: []
  };
}

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvc-phases-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe('discoveryToPhases', () => {
  it('genera una fase por pantalla y abre por la URL de arranque (no por orden alfabético)', () => {
    const discovery = discoveryFixture();
    const { phases } = discoveryToPhases(discovery);

    expect(phases).toHaveLength(3);
    expect(phases.map(phase => phase.label)).toEqual(['Gestión de clientes', 'Cliente 42', 'Informe mensual']);
    expect(phases.map(phase => phase.url)).toEqual([
      'http://app.test/index.html',
      'http://app.test/detalle.html',
      'http://app.test/informe.html'
    ]);
  });

  it('usa ids de fase válidos, únicos y numerados', () => {
    const { phases } = discoveryToPhases(discoveryFixture());

    expect(phases.map(phase => phase.id)).toEqual(['01-gestion-de-clientes', '02-cliente-42', '03-informe-mensual']);
    expect(new Set(phases.map(phase => phase.id)).size).toBe(phases.length);
    for (const phase of phases) {
      expect(phase.id).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('asigna duraciones coherentes con el resto del pipeline (5 s la apertura, 8 s el resto)', () => {
    const { phases } = discoveryToPhases(discoveryFixture());
    expect(phases.map(phase => phase.duration)).toEqual([5, 8, 8]);

    const custom = discoveryToPhases(discoveryFixture(), { firstDuration: 7, duration: 12 });
    expect(custom.phases.map(phase => phase.duration)).toEqual([7, 12, 12]);
  });

  it('sólo usa selectores observados y navega a la URL real de cada pantalla', () => {
    const discovery = discoveryFixture();
    const { phases } = discoveryToPhases(discovery, { includeSafeClicks: true });

    phases.forEach((phase, index) => {
      const source = discovery.pages.find(candidate => candidate.path === phase.url!.replace('http://app.test', ''))!;
      const observed = new Set(source.elements.map(element => element.selector));

      expect(phase.url).toBe(source.url);
      for (const step of phase.steps ?? []) {
        if (step.action === 'click' || step.action === 'waitForSelector') {
          expect(observed.has(step.selector)).toBe(true);
        }
        if (step.action === 'goto') {
          expect(step.url).toBe(phase.url);
        }
      }

      if (index > 0) {
        expect(phase.steps?.[0]).toEqual({ action: 'goto', url: source.url, waitUntil: 'load' });
      } else {
        expect(phase.steps?.some(step => step.action === 'goto')).toBe(false);
      }
    });
  });

  it('nunca pulsa acciones sensibles ni nada dentro de un formulario, ni con clics activados', () => {
    const { phases } = discoveryToPhases(discoveryFixture(), { includeSafeClicks: true });
    const clicks = phases.flatMap(phase =>
      (phase.steps ?? []).flatMap(step => (step.action === 'click' ? [step.selector] : []))
    );

    // Sólo acciones seguras y fuera de formulario: ayuda (aria-label) y descarga (id).
    expect(clicks).toEqual(['[aria-label="Abrir ayuda"]', '#descargar-informe']);
    for (const forbidden of ['#borrar', '#pagar', '#eliminar', '#guardar', '#actualizar']) {
      expect(clicks).not.toContain(forbidden);
    }
  });

  it('por defecto NO pulsa nada y lista las acciones seguras para decidir a mano', () => {
    const { phases, warnings } = discoveryToPhases(discoveryFixture());
    const clicks = phases.flatMap(phase => (phase.steps ?? []).filter(step => step.action === 'click'));

    expect(clicks).toEqual([]);
    expect(warnings.join('\n')).toContain('Abrir ayuda');
    expect(warnings.join('\n')).toContain('NO pulsa');
  });

  it('avisa de las acciones sensibles sin proponerlas', () => {
    const { warnings } = discoveryToPhases(discoveryFixture());
    const text = warnings.join('\n');

    expect(text).toContain('Borrar cuenta');
    expect(text).toContain('Pagar ahora');
    expect(text).toContain('NUNCA pulsadas');
    expect(text).not.toMatch(/Pagar ahora.*añádelas a mano/);
  });

  it('escribe un guion borrador en el idioma del proyecto con marcador explícito', () => {
    const { phases } = discoveryToPhases(discoveryFixture());
    const [first, second] = phases;

    expect(first.script).toContain(DRAFT_SCRIPT_MARKER);
    expect(first.script).toContain('Abre la demo en «Gestión de clientes» (pantalla 1 de 3).');
    expect(first.script).toContain('Sección «Resumen del día».');
    expect(first.script).toContain('La pantalla pide 4 dato(s): Nombre, Email, Plan, Notas.');
    expect(second.script).toContain('Continúa la demo en «Cliente 42» (pantalla 2 de 3).');
    expect(second.script).toContain(DRAFT_SCRIPT_MARKER);
  });

  it('una pantalla sin controles no rompe el borrador y se avisa', () => {
    const discovery = discoveryFixture();
    discovery.pages.push(page('/vacia.html', 'Vacía', ['Sin acciones'], [], [], ['Cargando…']));

    const { phases, warnings } = discoveryToPhases(discovery);
    const vacia = phases.find(phase => phase.url!.endsWith('/vacia.html'))!;

    expect(vacia.steps?.some(step => step.action === 'waitForSelector')).toBe(false);
    expect(vacia.steps?.[0]).toEqual({ action: 'goto', url: 'http://app.test/vacia.html', waitUntil: 'load' });
    expect(warnings.join('\n')).toContain('no se observaron controles');
  });

  it('no usa textos de estado como guarda de espera', () => {
    const discovery: RawDiscovery = {
      ...discoveryFixture(),
      pages: [page('/solo-estado.html', 'Solo estado', ['Estado'], [
        { kind: 'status', text: 'Guardado.', selector: 'role=status', selectorStrategy: 'role+name', formLabel: null }
      ])]
    };

    const { phases, warnings } = discoveryToPhases(discovery);

    expect(phases[0].steps?.some(step => step.action === 'waitForSelector')).toBe(false);
    expect(warnings.join('\n')).toContain('textos de estado');
  });

  it('limita el número de fases y lo dice', () => {
    const { phases, warnings } = discoveryToPhases(discoveryFixture(), { maxPhases: 2 });

    expect(phases).toHaveLength(2);
    expect(phases.map(phase => phase.url)).not.toContain('http://app.test/informe.html');
    expect(warnings.join('\n')).toContain('Se han omitido 1 pantalla(s)');
  });

  it('es determinista y no muta el inventario de entrada', () => {
    const discovery = discoveryFixture();
    const before = JSON.stringify(discovery);

    const a = discoveryToPhases(discovery, { includeSafeClicks: true });
    const b = discoveryToPhases(discovery, { includeSafeClicks: true });

    expect(JSON.stringify(discovery)).toBe(before);
    expect(b).toEqual(a);
  });

  it('con un inventario vacío devuelve cero fases y un aviso', () => {
    const empty: RawDiscovery = { ...discoveryFixture(), pages: [] };
    const { phases, warnings } = discoveryToPhases(empty);

    expect(phases).toEqual([]);
    expect(warnings.join('\n')).toContain('no contiene páginas');
  });
});

describe('buildPhasesDraft', () => {
  it('construye un fichero con la misma forma que mvc-config.json', () => {
    const proposal = discoveryToPhases(discoveryFixture());
    const draft = buildPhasesDraft(proposal, { baseUrl: BASE_URL });

    expect(draft.version).toBe(CONFIG_VERSION);
    expect(draft.project.url).toBe(BASE_URL);
    expect(draft.project.name).toBe('demo');
    expect(draft.project.outputDir).toBe('./output/demo-video');
    expect(draft.project.variant).toBe('desktop');
    expect(draft.project.phases).toHaveLength(3);
  });

  it('conserva nombre, URL y salida del proyecto activo', () => {
    const proposal = discoveryToPhases(discoveryFixture());
    const draft = buildPhasesDraft(proposal, {
      base: { name: 'mi-demo', url: 'https://app.real/', outputDir: './out', variant: 'mobile', phases: [] }
    });

    expect(draft.project).toMatchObject({ name: 'mi-demo', url: 'https://app.real/', outputDir: './out', variant: 'mobile' });
    expect(draft.project.phases).toHaveLength(3);
  });
});

describe('writePhasesDraft', () => {
  it('escribe SÓLO el borrador dentro de .mvc/ y no deja temporales', () => {
    const root = tempDir();
    const mvc = path.join(root, '.mvc');
    fs.mkdirSync(mvc, { recursive: true });
    fs.writeFileSync(path.join(mvc, 'guion.md'), '# guion previo\n', 'utf8');
    fs.writeFileSync(path.join(mvc, 'discovery.json'), '{"pages":[]}', 'utf8');

    const draft = buildPhasesDraft(discoveryToPhases(discoveryFixture()), { baseUrl: BASE_URL });
    const draftPath = writePhasesDraft(root, draft);

    expect(draftPath).toBe(phasesDraftPath(root));
    expect(path.basename(draftPath)).toBe(PHASES_DRAFT_FILE);
    expect(fs.existsSync(path.join(root, PROJECT_CONFIG_FILE))).toBe(false);
    expect(fs.readFileSync(path.join(mvc, 'guion.md'), 'utf8')).toBe('# guion previo\n');
    expect(fs.readdirSync(mvc).filter(name => name.startsWith('.'))).toEqual([]);

    const stored = JSON.parse(fs.readFileSync(draftPath, 'utf8'));
    expect(stored.version).toBe(CONFIG_VERSION);
    expect(stored.project.phases).toHaveLength(3);
    expect(stored.project.phases[0].steps[0]).toEqual({ action: 'waitForSelector', selector: '#ir-detalle', timeoutMs: 15000 });
  });

  it('reescribir el borrador es idempotente', () => {
    const root = tempDir();
    const draft = buildPhasesDraft(discoveryToPhases(discoveryFixture()), { baseUrl: BASE_URL });

    const first = fs.readFileSync(writePhasesDraft(root, draft), 'utf8');
    const second = fs.readFileSync(writePhasesDraft(root, draft), 'utf8');

    expect(second).toBe(first);
  });
});

describe('applyPhasesDraftToProjectConfig', () => {
  function workspaceWithConfig(): { root: string; configPath: string } {
    const root = tempDir();
    const configPath = path.join(root, PROJECT_CONFIG_FILE);
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          version: CONFIG_VERSION,
          project: {
            name: 'proyecto-activo',
            url: 'https://app.real/',
            outputDir: './salida-real',
            variant: 'mobile',
            phases: [{ id: '99-vieja', label: 'Vieja', duration: 4 }]
          }
        },
        null,
        2
      ),
      'utf8'
    );
    return { root, configPath };
  }

  it('sin confirmación deja mvc-config.json EXACTAMENTE igual (mismo hash)', async () => {
    const { root, configPath } = workspaceWithConfig();
    const hashBefore = fileHash(configPath);
    const original = fs.readFileSync(configPath, 'utf8');
    const draft = buildPhasesDraft(discoveryToPhases(discoveryFixture()), { baseUrl: BASE_URL });
    let confirmCalls = 0;

    const result = await applyPhasesDraftToProjectConfig({
      workspaceRoot: root,
      draft,
      confirm: async () => {
        confirmCalls += 1;
        return false;
      }
    });

    expect(confirmCalls).toBe(1);
    expect(result.applied).toBe(false);
    expect(result.reason).toBe('cancelled');
    expect(result.hashBefore).toBe(hashBefore);
    expect(result.hashAfter).toBe(hashBefore);
    expect(fileHash(configPath)).toBe(hashBefore);
    expect(fs.readFileSync(configPath, 'utf8')).toBe(original);
  });

  it('con confirmación escribe las fases conservando el resto del proyecto', async () => {
    const { root, configPath } = workspaceWithConfig();
    const hashBefore = fileHash(configPath);
    const draft = buildPhasesDraft(discoveryToPhases(discoveryFixture()), { baseUrl: BASE_URL });

    const result = await applyPhasesDraftToProjectConfig({ workspaceRoot: root, draft, confirm: async () => true });

    expect(result.applied).toBe(true);
    expect(result.reason).toBe('applied');
    expect(result.hashAfter).not.toBe(hashBefore);
    expect(fileHash(configPath)).toBe(result.hashAfter);

    const stored = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(stored.version).toBe(CONFIG_VERSION);
    expect(stored.project.name).toBe('proyecto-activo');
    expect(stored.project.url).toBe('https://app.real/');
    expect(stored.project.outputDir).toBe('./salida-real');
    expect(stored.project.variant).toBe('mobile');
    expect(stored.project.phases).toHaveLength(3);
    expect(stored.project.phases[0].id).toBe('01-gestion-de-clientes');
    expect(stored.project.phases[0].steps).toEqual(draft.project.phases[0].steps);
    // La fase vieja desaparece: se reemplazan las fases, no se mezclan.
    expect(stored.project.phases.map((phase: { id: string }) => phase.id)).not.toContain('99-vieja');
  });

  it('sin mvc-config.json previo lo crea a partir del borrador', async () => {
    const root = tempDir();
    const draft = buildPhasesDraft(discoveryToPhases(discoveryFixture()), { baseUrl: BASE_URL });

    const result = await applyPhasesDraftToProjectConfig({ workspaceRoot: root, draft, confirm: async () => true });

    expect(result.applied).toBe(true);
    expect(result.hashBefore).toBeNull();
    const stored = readProjectConfigFile(path.join(root, PROJECT_CONFIG_FILE));
    expect(stored?.url).toBe(BASE_URL);
    expect(stored?.phases).toHaveLength(3);
  });

  it('un borrador sin fases válidas no pregunta ni escribe', async () => {
    const { root, configPath } = workspaceWithConfig();
    const hashBefore = fileHash(configPath);
    const draft = { version: CONFIG_VERSION, project: { ...buildPhasesDraft({ phases: [], warnings: [] }).project } };
    let confirmCalls = 0;

    const result = await applyPhasesDraftToProjectConfig({
      workspaceRoot: root,
      draft,
      confirm: async () => {
        confirmCalls += 1;
        return true;
      }
    });

    expect(confirmCalls).toBe(0);
    expect(result.applied).toBe(false);
    expect(result.reason).toBe('invalid-phases');
    expect(fileHash(configPath)).toBe(hashBefore);
  });

  it('no aplica una configuración inválida aunque el usuario confirme', async () => {
    const root = tempDir();
    const draft = buildPhasesDraft(discoveryToPhases(discoveryFixture()), { baseUrl: BASE_URL });
    draft.project.url = 'no-es-una-url';

    const result = await applyPhasesDraftToProjectConfig({ workspaceRoot: root, draft, confirm: async () => true });

    expect(result.applied).toBe(false);
    expect(result.reason).toBe('invalid-config');
    expect(result.hashBefore).toBeNull();
    expect(fs.existsSync(path.join(root, PROJECT_CONFIG_FILE))).toBe(false);
  });

  it('las fases que se escriben pasan la normalización del pipeline', async () => {
    const { root, configPath } = workspaceWithConfig();
    const draft = buildPhasesDraft(discoveryToPhases(discoveryFixture()), { baseUrl: BASE_URL });

    await applyPhasesDraftToProjectConfig({ workspaceRoot: root, draft, confirm: async () => true });

    const stored = readProjectConfigFile(configPath);
    const { phases, warnings } = normalizePhases(stored?.phases);

    expect(warnings).toEqual([]);
    expect(phases).toHaveLength(3);
    expect(phases[0].steps?.length).toBeGreaterThan(0);
  });
});

describe('readDiscoveryDoc', () => {
  it('explica qué hacer si falta discovery.json', () => {
    expect(() => readDiscoveryDoc(path.join(tempDir(), '.mvc', 'discovery.json'))).toThrow(/Descubrir app/);
  });

  it('rechaza JSON inválido y contratos sin pages[]', () => {
    const root = tempDir();
    const invalid = discoveryPathOf(root);
    fs.mkdirSync(path.dirname(invalid), { recursive: true });
    fs.writeFileSync(invalid, 'no-json', 'utf8');
    expect(() => readDiscoveryDoc(invalid)).toThrow(/no es JSON válido/);

    fs.writeFileSync(invalid, JSON.stringify({ baseUrl: BASE_URL }), 'utf8');
    expect(() => readDiscoveryDoc(invalid)).toThrow(/falta pages/);

    fs.writeFileSync(invalid, JSON.stringify({ pages: [] }), 'utf8');
    expect(() => readDiscoveryDoc(invalid)).toThrow(/baseUrl/);
  });

  it('devuelve el inventario cuando el contrato se sostiene', () => {
    const root = tempDir();
    const file = discoveryPathOf(root);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(discoveryFixture()), 'utf8');

    expect(readDiscoveryDoc(file).pages).toHaveLength(3);
  });
});
