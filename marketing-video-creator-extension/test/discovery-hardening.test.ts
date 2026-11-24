/**
 * Endurecimiento del descubrimiento tras el QA de SSS-282 (tarjeta t_0952bc12).
 *
 * Fija, en rojo antes del fix, los cinco defectos reportados:
 *   F1 el patrón de acción destructiva no cubre cancelar/anular/desactivar/
 *      cerrar sesión/salir (y variantes), ni en el crawler ni en el convertidor;
 *   F2 `normalizePath` colapsa `//` dentro de la query y corrompe `path`;
 *   F3 el dedupe de formularios no aplica a formularios sin etiqueta;
 *   F4 un selector compuesto con id (`button#guardar`) se clasifica `css`;
 *   F5 la reescritura a role+name pierde el ámbito del formulario y colapsa
 *      controles distintos con el mismo texto.
 *
 * El patrón destructivo es UNA sola fuente de verdad: el mismo objeto que usa
 * el crawler es el que consume `phases-proposer`.
 */

import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { DESTRUCTIVE_PATTERN as CRAWLER_PATTERN, isDestructiveAction } from '../src/discovery/crawler';
import { DESTRUCTIVE_PATTERN, isDestructiveAction as isDestructiveFromSource } from '../src/discovery/destructive';
import { isUnstableSelector, normalizeDiscovery, selectorStrategyOf } from '../src/discovery/normalizer';
import { discoveryToPhases } from '../src/discovery/phases-proposer';
import { DiscoveryElement, RawDiscovery } from '../src/discovery/types';

const FIXED_NOW = () => new Date('2026-03-04T05:06:07.000Z');

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'discovery');

/** Fixture versionado: textos sensibles y seguros que fija el QA de SSS-282. */
const ACTIONS_FIXTURE = JSON.parse(
  fs.readFileSync(path.join(FIXTURES_DIR, 'destructive-actions.json'), 'utf8')
) as { sensitive: string[]; safe: string[] };

/** Textos sensibles que el QA demostró que hoy se proponían como clic. */
const SENSITIVE_TEXTS = ACTIONS_FIXTURE.sensitive;

/** Acciones claramente seguras: el patrón NO debe marcarlas. */
const SAFE_TEXTS = ACTIONS_FIXTURE.safe;

function button(index: number, text: string, formLabel: string | null = null): DiscoveryElement {
  return {
    kind: 'button',
    text,
    selector: `#accion-${index}`,
    selectorStrategy: 'id',
    formLabel
  };
}

function page(
  pagePath: string,
  elements: DiscoveryElement[] = [],
  forms: RawDiscovery['pages'][number]['forms'] = []
): RawDiscovery['pages'][number] {
  return {
    url: `http://app.test${pagePath}`,
    path: pagePath,
    title: 'Pantalla',
    headings: [],
    elements,
    forms,
    statusTexts: []
  };
}

function raw(pages: RawDiscovery['pages']): RawDiscovery {
  return {
    generatedAt: '2026-03-04T00:00:00.000Z',
    baseUrl: 'http://app.test',
    pages,
    stats: { pageCount: pages.length, depthReached: 0, skipped: [] },
    warnings: []
  };
}

/* ------------------------------------------------------------------------- *
 * F1 · patrón destructivo compartido y ampliado
 * ------------------------------------------------------------------------- */

describe('F1 · patrón de acción destructiva', () => {
  it('crawler y convertidor comparten el MISMO patrón (una sola fuente de verdad)', () => {
    expect(CRAWLER_PATTERN).toBe(DESTRUCTIVE_PATTERN);
    expect(isDestructiveAction).toBe(isDestructiveFromSource);
  });

  it.each(SENSITIVE_TEXTS)('reconoce «%s» como acción sensible', text => {
    expect(isDestructiveAction(text)).toBe(true);
  });

  it.each(SAFE_TEXTS)('no marca la acción segura «%s»', text => {
    expect(isDestructiveAction(text)).toBe(false);
  });

  it('no marca texto vacío ni nulo', () => {
    expect(isDestructiveAction('')).toBe(false);
    expect(isDestructiveAction(null as unknown as string)).toBe(false);
  });

  it('con includeSafeClicks NO propone ningún clic sobre acciones sensibles', () => {
    const discovery = raw([
      page(
        '/cuenta',
        [
          ...SENSITIVE_TEXTS.map((text, index) => button(index, text)),
          { kind: 'button', text: 'Abrir ayuda', selector: '[data-testid="abrir-ayuda"]', selectorStrategy: 'data-testid', formLabel: null },
          // Acción segura pero DENTRO de un formulario: tampoco se pulsa.
          { kind: 'button', text: 'Guardar', selector: '#guardar', selectorStrategy: 'id', formLabel: 'Alta de cliente' }
        ]
      )
    ]);

    const { phases, warnings } = discoveryToPhases(discovery, { includeSafeClicks: true });
    const clicks = phases.flatMap(phase =>
      (phase.steps ?? []).flatMap(step => (step.action === 'click' ? [step.selector] : []))
    );

    expect(clicks).toEqual(['[data-testid="abrir-ayuda"]']);
    for (const [index] of SENSITIVE_TEXTS.entries()) {
      expect(clicks).not.toContain(`#accion-${index}`);
    }
    expect(warnings.join('\n')).toContain('NUNCA pulsadas');
  });

  it('los cinco textos del informe QA quedan listados como sensibles y sin clic', () => {
    const qaTexts = ['Cancelar cuenta', 'Anular pedido', 'Desactivar usuario', 'Cerrar sesión', 'Salir'];
    const discovery = raw([page('/cuenta', qaTexts.map((text, index) => button(index, text)))]);

    const { phases, warnings } = discoveryToPhases(discovery, { includeSafeClicks: true });
    const clicks = phases.flatMap(phase =>
      (phase.steps ?? []).flatMap(step => (step.action === 'click' ? [step.selector] : []))
    );

    expect(clicks).toEqual([]);
    for (const text of qaTexts) {
      expect(warnings.join('\n')).toContain(text);
    }
  });
});

/* ------------------------------------------------------------------------- *
 * F2 · `normalizePath` no debe tocar la query
 * ------------------------------------------------------------------------- */

describe('F2 · normalizePath conserva la query intacta', () => {
  it('no colapsa `//` dentro del search y deja intacta la url', () => {
    const discovery = raw([
      page('/redir?next=http://externo.test/a'),
      page('/a//b'),
      page('/filtros/?estado=abierto')
    ]);

    const doc = normalizeDiscovery(discovery, { now: FIXED_NOW });
    const paths = doc.pages.map(item => item.path);

    expect(paths).toContain('/redir?next=http://externo.test/a');
    expect(paths).toContain('/a/b');
    expect(paths).toContain('/filtros?estado=abierto');

    const redir = doc.pages.find(item => item.path.startsWith('/redir'))!;
    expect(redir.url).toBe('http://app.test/redir?next=http://externo.test/a');
  });

  it('deriva el path de la url sin colapsar `//` del search', () => {
    const discovery = raw([
      {
        url: 'http://app.test/buscar//x?next=http://a//b',
        path: '',
        title: 'Buscar',
        headings: [],
        elements: [],
        forms: [],
        statusTexts: []
      }
    ]);

    expect(normalizeDiscovery(discovery, { now: FIXED_NOW }).pages[0].path).toBe('/buscar/x?next=http://a//b');
  });
});

/* ------------------------------------------------------------------------- *
 * F3 · dedupe de formularios sin etiqueta
 * ------------------------------------------------------------------------- */

describe('F3 · dedupe de formularios antes de etiquetar por índice', () => {
  const emailForm = { label: '', fields: [{ label: 'Email', type: 'email', selector: '#email' }] };
  const planForm = { label: '', fields: [{ label: 'Plan', type: 'select', selector: '#plan' }] };

  it('dos formularios idénticos sin etiqueta se conservan una sola vez', () => {
    const discovery = raw([page('/clientes', [], [emailForm, { ...emailForm, fields: [...emailForm.fields] }])]);

    const forms = normalizeDiscovery(discovery, { now: FIXED_NOW }).pages[0].forms;

    expect(forms).toHaveLength(1);
    expect(forms[0].label).toBe('formulario 1');
    expect(forms[0].fields).toEqual([{ label: 'Email', type: 'email', selector: '#email' }]);
  });

  it('conserva el índice original en la etiqueta por defecto de los formularios que sobreviven', () => {
    const discovery = raw([page('/clientes', [], [emailForm, { ...emailForm, fields: [...emailForm.fields] }, planForm])]);

    const forms = normalizeDiscovery(discovery, { now: FIXED_NOW }).pages[0].forms;

    expect(forms.map(form => form.label)).toEqual(['formulario 1', 'formulario 3']);
  });

  it('no deduplica formularios con etiqueta distinta aunque tengan los mismos campos', () => {
    const discovery = raw([
      page('/clientes', [], [
        { label: 'Alta', fields: [{ label: 'Nombre', type: 'text', selector: '#nombre' }] },
        { label: '', fields: [{ label: 'Nombre', type: 'text', selector: '#nombre' }] }
      ])
    ]);

    expect(normalizeDiscovery(discovery, { now: FIXED_NOW }).pages[0].forms).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------------- *
 * F4 · estrategia de un selector compuesto con id
 * ------------------------------------------------------------------------- */

describe('F4 · selectorStrategyOf reconoce el id dentro de un compuesto', () => {
  it('clasifica `button#guardar` como id (y sigue siendo estable)', () => {
    expect(selectorStrategyOf('button#guardar')).toBe('id');
    expect(selectorStrategyOf('button#guardar.primario')).toBe('id');
    expect(isUnstableSelector('button#guardar')).toBe(false);
  });

  it('no degrada la prioridad ya fijada para otros compuestos', () => {
    expect(selectorStrategyOf('#guardar')).toBe('id');
    expect(selectorStrategyOf('[id="con espacio"]')).toBe('id');
    expect(selectorStrategyOf('[data-testid="x"]')).toBe('data-testid');
    expect(selectorStrategyOf('button.primario')).toBe('css');
    expect(selectorStrategyOf('form#alta button.guardar')).toBe('css');
  });
});

/* ------------------------------------------------------------------------- *
 * F5 · reescritura role+name con ámbito de formulario y sin colapsos mudos
 * ------------------------------------------------------------------------- */

describe('F5 · reescritura a role+name', () => {
  it('cualifica con el formulario cuando el control vive dentro de uno', () => {
    const discovery = raw([
      page('/alta', [
        { kind: 'button', text: 'Guardar', selector: 'button.css-1x2y3z', selectorStrategy: 'css', formLabel: 'Alta de cliente' },
        { kind: 'button', text: 'Guardar', selector: 'button.css-9z8y7x', selectorStrategy: 'css', formLabel: null }
      ])
    ]);

    const elements = normalizeDiscovery(discovery, { now: FIXED_NOW }).pages[0].elements;

    expect(elements).toHaveLength(2);
    expect(elements.map(element => element.selector)).toEqual([
      'form >> role=button[name="Guardar"]',
      'role=button[name="Guardar"]'
    ]);
    expect(elements.map(element => element.selectorStrategy)).toEqual(['role+name', 'role+name']);
    expect(elements.map(element => element.formLabel)).toEqual(['Alta de cliente', null]);
  });

  it('avisa cuando dos controles distintos colapsan en el mismo selector reescrito', () => {
    const discovery = raw([
      page('/alta', [
        { kind: 'button', text: 'Guardar', selector: 'button.css-1x2y3z', selectorStrategy: 'css', formLabel: null },
        { kind: 'button', text: 'Guardar', selector: 'button.css-9z8y7x', selectorStrategy: 'css', formLabel: null }
      ])
    ]);

    const doc = normalizeDiscovery(discovery, { now: FIXED_NOW });
    const elements = doc.pages[0].elements;

    // No se pueden distinguir con role+name: queda uno, pero el aviso es explícito
    // (antes sólo decía "2 selector(es) reescrito(s)").
    expect(elements).toHaveLength(1);
    expect(elements[0].selector).toBe('role=button[name="Guardar"]');
    expect(doc.warnings.join('\n')).toContain('colisión');
    expect(doc.warnings.join('\n')).toContain('Guardar');
  });

  it('no avisa de colisión cuando el mismo control se leyó dos veces (mismo selector crudo)', () => {
    const discovery = raw([
      page('/alta', [
        { kind: 'button', text: 'Guardar', selector: 'button.css-1x2y3z', selectorStrategy: 'css', formLabel: 'Alta de cliente' },
        { kind: 'button', text: 'Guardar', selector: 'button.css-1x2y3z', selectorStrategy: 'css', formLabel: 'Alta de cliente' }
      ])
    ]);

    const doc = normalizeDiscovery(discovery, { now: FIXED_NOW });

    expect(doc.pages[0].elements).toHaveLength(1);
    expect(doc.warnings.join('\n')).not.toContain('colisión');
  });
});
