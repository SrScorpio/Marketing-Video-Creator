/**
 * Modelo de datos del asistente de descubrimiento en el panel (SSS-282).
 *
 * Este módulo es lo que el host envía al webview: un resumen del
 * `.mvc/discovery.json` (páginas, contadores, avisos y enlaces saltados) y la
 * propuesta de fases de `.mvc/mvc-config.borrador.json`. Se prueba sin VS Code
 * (fs + JSON) para que el E2E pueda reutilizarlo contra un crawl real.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PROPOSAL_FILE_NAME,
  PROJECT_CONFIG_FILE_NAME,
  loadDiscoveryPanelPayload,
  phaseProposalToSavePayload,
  readProposal,
  writeProposalFromDiscovery
} from '../src/discovery/panel-model';

let dir: string;

function writeJson(name: string, value: unknown): string {
  const target = path.join(dir, name);
  fs.writeFileSync(target, JSON.stringify(value, null, 2), 'utf-8');
  return target;
}

const discoveryFixture = {
  generatedAt: '2026-11-24T00:00:00.000Z',
  baseUrl: 'http://127.0.0.1:4000',
  pages: [
    {
      url: 'http://127.0.0.1:4000/',
      path: '/',
      title: 'Inicio',
      headings: [{ level: 1, text: 'Gestión de caballos' }],
      elements: [
        { kind: 'link', text: 'Detalle', selector: '#ir-detalle', selectorStrategy: 'id', formLabel: null },
        { kind: 'button', text: 'Nueva ficha', selector: '[data-testid="nueva-ficha"]', selectorStrategy: 'data-testid', formLabel: null }
      ],
      forms: [],
      statusTexts: ['Todo listo']
    },
    {
      url: 'http://127.0.0.1:4000/detalle.html',
      path: '/detalle.html',
      title: 'Detalle del caballo',
      headings: [{ level: 1, text: 'Ficha del caballo' }],
      elements: [
        { kind: 'input', text: 'Nombre', selector: '#nombre', selectorStrategy: 'id', formLabel: 'Ficha' }
      ],
      forms: [
        {
          label: 'Ficha',
          fields: [{ label: 'Nombre', type: 'text', selector: '#nombre' }]
        }
      ],
      statusTexts: []
    },
    {
      url: 'http://127.0.0.1:4000/informe.html',
      path: '/informe.html',
      title: 'Informe',
      headings: [],
      elements: [
        { kind: 'link', text: 'Volver', selector: 'role=link[name="Volver"]', selectorStrategy: 'role+name', formLabel: null }
      ],
      forms: [],
      statusTexts: []
    }
  ],
  stats: {
    pageCount: 3,
    depthReached: 2,
    skipped: [
      { url: 'https://externo.test/promo', reason: 'externo' },
      { url: '/privado.html', reason: 'max-paginas' }
    ]
  },
  warnings: ['Selector CSS inestable descartado en /informe.html']
};

const proposalFixture = {
  generatedAt: '2026-11-24T00:00:00.000Z',
  baseUrl: 'http://127.0.0.1:4000',
  phases: [
    {
      id: '01-inicio',
      label: 'Inicio',
      duration: 8,
      script: '[BORRADOR] Presenta la pantalla de inicio.',
      url: 'http://127.0.0.1:4000/',
      steps: [
        { action: 'goto', url: 'http://127.0.0.1:4000/' },
        { action: 'click', selector: '#ir-detalle' }
      ]
    },
    {
      id: '02-detalle',
      label: 'Detalle del caballo',
      duration: 10,
      script: '[BORRADOR] Rellena la ficha.',
      steps: [{ action: 'fill', selector: '#nombre', text: 'Rocinante' }]
    }
  ]
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvc-panel-model-'));
  fs.mkdirSync(path.join(dir, '.mvc'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('loadDiscoveryPanelPayload', () => {
  it('resume el inventario y la propuesta de fases con los nombres de fichero fijados', () => {
    writeJson(path.join('.mvc', 'discovery.json'), discoveryFixture);
    writeJson(path.join('.mvc', PROPOSAL_FILE_NAME), proposalFixture);

    const payload = loadDiscoveryPanelPayload(dir);

    expect(payload.errors).toEqual([]);
    expect(payload.discovery).not.toBeNull();
    expect(payload.discovery!.pageCount).toBe(3);
    expect(payload.discovery!.actionCount).toBe(4);
    expect(payload.discovery!.formCount).toBe(1);
    expect(payload.discovery!.pages.map(page => page.path)).toEqual(['/', '/detalle.html', '/informe.html']);
    expect(payload.discovery!.pages[0].actions[0]).toMatchObject({
      kind: 'link',
      text: 'Detalle',
      selector: '#ir-detalle',
      selectorStrategy: 'id'
    });
    expect(payload.discovery!.pages[1].forms).toEqual([{ label: 'Ficha', fieldCount: 1 }]);
    expect(payload.discovery!.warnings).toEqual(['Selector CSS inestable descartado en /informe.html']);
    expect(payload.discovery!.skipped).toEqual([
      { url: 'https://externo.test/promo', reason: 'externo' },
      { url: '/privado.html', reason: 'max-paginas' }
    ]);
    expect(payload.discovery!.generatedAt).toBe('2026-11-24T00:00:00.000Z');
    expect(payload.discovery!.baseUrl).toBe('http://127.0.0.1:4000');

    expect(payload.proposal).not.toBeNull();
    expect(payload.proposal!.phases).toHaveLength(2);
    expect(payload.proposal!.phases[0]).toMatchObject({ id: '01-inicio', label: 'Inicio', duration: 8 });
    expect(payload.proposal!.phases[0].steps).toEqual([
      { action: 'goto', selector: null, detail: 'http://127.0.0.1:4000/' },
      { action: 'click', selector: '#ir-detalle', detail: null }
    ]);
    expect(payload.proposal!.phases[1].steps[0]).toEqual({ action: 'fill', selector: '#nombre', detail: 'Rocinante' });
    expect(payload.configExists).toBe(false);
  });

  it('detecta mvc-config.json existente y cuenta sus fases para la confirmación', () => {
    writeJson(path.join('.mvc', 'discovery.json'), discoveryFixture);
    writeJson(path.join('.mvc', PROPOSAL_FILE_NAME), proposalFixture);
    writeJson(
      path.join('.mvc', PROJECT_CONFIG_FILE_NAME),
      { version: '1.0.0', project: { url: 'http://127.0.0.1:4000', phases: [{ id: '01-a', label: 'A', duration: 5 }] } }
    );

    const payload = loadDiscoveryPanelPayload(dir);

    expect(payload.configExists).toBe(true);
    expect(payload.configPhaseCount).toBe(1);
  });

  it('sin artefactos devuelve null y explica qué falta sin lanzar', () => {
    const payload = loadDiscoveryPanelPayload(dir);

    expect(payload.discovery).toBeNull();
    expect(payload.proposal).toBeNull();
    expect(payload.errors.join(' ')).toContain('discovery.json');
    expect(payload.configExists).toBe(false);
  });

  it('un JSON corrupto no rompe el panel: se informa y se ignora el artefacto', () => {
    fs.writeFileSync(path.join(dir, '.mvc', 'discovery.json'), '{ esto no es json', 'utf-8');
    writeJson(path.join('.mvc', PROPOSAL_FILE_NAME), proposalFixture);

    const payload = loadDiscoveryPanelPayload(dir);

    expect(payload.discovery).toBeNull();
    expect(payload.proposal!.phases).toHaveLength(2);
    expect(payload.errors.join(' ')).toContain('discovery.json');
  });

  it('acepta la propuesta envuelta en project.phases (formato de mvc-config)', () => {
    fs.mkdirSync(path.join(dir, '.mvc'), { recursive: true });
    writeJson(path.join('.mvc', PROPOSAL_FILE_NAME), { version: '1.0.0', project: { phases: proposalFixture.phases } });

    const payload = loadDiscoveryPanelPayload(dir);

    expect(payload.proposal!.phases).toHaveLength(2);
    expect(payload.proposal!.warnings).toEqual([]);
  });
});

describe('readProposal', () => {
  it('descarta fases sin id o sin label y las reporta', () => {
    const { phases, warnings } = readProposal({
      phases: [
        { id: '01-ok', label: 'Vale', duration: 5, steps: [] },
        { id: '', label: 'Sin id', duration: 5 },
        { id: '03-sin-label', label: '   ', duration: 5 },
        'no soy una fase'
      ]
    });

    expect(phases.map(phase => phase.id)).toEqual(['01-ok']);
    expect(warnings.length).toBe(3);
  });

  it('sanea duration y tipos de los pasos sin inventar selectores', () => {
    const { phases } = readProposal({
      phases: [
        {
          id: '01-x',
          label: 'X',
          duration: 'mucho',
          script: 42,
          steps: [{ action: 'click', selector: '  #btn  ' }, { selector: '#sin-accion' }, null]
        }
      ]
    });

    expect(phases[0].duration).toBe(0);
    expect(phases[0].script).toBe('');
    expect(phases[0].steps).toHaveLength(1);
    expect(phases[0].steps[0]).toEqual({ action: 'click', selector: '#btn', detail: null });
    expect(phases[0].rawSteps).toEqual([{ action: 'click', selector: '#btn' }]);
  });

  it('devuelve lista vacía para entradas que no son objeto', () => {
    expect(readProposal(null).phases).toEqual([]);
    expect(readProposal('texto').phases).toEqual([]);
  });
});

describe('phaseProposalToSavePayload', () => {
  it('construye el payload de savePhases conservando pasos y guion editado', () => {
    const { phases } = readProposal(proposalFixture);
    const edited = phases.map(phase =>
      phase.id === '01-inicio' ? { ...phase, label: 'Portada', script: 'Guion pulido por el usuario.' } : phase
    );

    const payload = phaseProposalToSavePayload(edited);

    expect(payload).toHaveLength(2);
    expect(payload[0]).toEqual({
      id: '01-inicio',
      label: 'Portada',
      duration: 8,
      url: 'http://127.0.0.1:4000/',
      script: 'Guion pulido por el usuario.',
      steps: [
        { action: 'goto', url: 'http://127.0.0.1:4000/' },
        { action: 'click', selector: '#ir-detalle' }
      ]
    });
    expect(payload[1].steps).toEqual([{ action: 'fill', selector: '#nombre', text: 'Rocinante' }]);
  });
});

describe('writeProposalFromDiscovery', () => {
  it('genera el borrador con el convertidor y lo deja legible por el panel', () => {
    writeJson(path.join('.mvc', 'discovery.json'), discoveryFixture);

    const result = writeProposalFromDiscovery(discoveryFixture, dir, {
      base: { name: 'demo', url: 'http://127.0.0.1:4000', variant: 'mobile', outputDir: './out' }
    });

    expect(result.phaseCount).toBeGreaterThan(0);
    expect(result.filePath.endsWith(path.join('.mvc', PROPOSAL_FILE_NAME))).toBe(true);
    expect(fs.existsSync(result.filePath)).toBe(true);

    const payload = loadDiscoveryPanelPayload(dir);
    expect(payload.errors).toEqual([]);
    expect(payload.proposal!.phases.length).toBe(result.phaseCount);

    // Ningún selector inventado: todos salen del inventario.
    const observed = new Set(discoveryFixture.pages.flatMap(page => page.elements.map(element => element.selector)));
    const usedSelectors = payload.proposal!.phases.flatMap(phase =>
      phase.steps.map(step => step.selector).filter((selector): selector is string => selector !== null)
    );
    expect(usedSelectors.length).toBeGreaterThan(0);
    expect(usedSelectors.every(selector => observed.has(selector))).toBe(true);

    // El borrador conserva el proyecto activo y NO escribe mvc-config.json.
    const draft = JSON.parse(fs.readFileSync(result.filePath, 'utf-8'));
    expect(draft.project).toMatchObject({ name: 'demo', variant: 'mobile', outputDir: './out' });
    expect(fs.existsSync(path.join(dir, '.mvc', PROJECT_CONFIG_FILE_NAME))).toBe(false);
  });

  it('no toca un mvc-config.json existente al proponer', () => {
    writeJson(path.join('.mvc', 'discovery.json'), discoveryFixture);
    const configPath = writeJson(path.join('.mvc', PROJECT_CONFIG_FILE_NAME), {
      version: '1.0.0',
      project: { url: 'http://127.0.0.1:4000', phases: [{ id: '01-a', label: 'A', duration: 5 }] }
    });
    const before = fs.readFileSync(configPath, 'utf-8');

    writeProposalFromDiscovery(discoveryFixture, dir);

    expect(fs.readFileSync(configPath, 'utf-8')).toBe(before);
  });

  it('rechaza un inventario sin pages en lugar de escribir basura', () => {
    expect(() => writeProposalFromDiscovery({ generatedAt: 'x' }, dir)).toThrow(/pages/);
    expect(fs.existsSync(path.join(dir, '.mvc', PROPOSAL_FILE_NAME))).toBe(false);
  });
});
