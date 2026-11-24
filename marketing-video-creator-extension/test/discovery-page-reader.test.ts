// @vitest-environment jsdom
/**
 * Tests del lector de pantalla (`readPageForInventory`) contra el MISMO fixture
 * HTML que usa el E2E, ejecutado en jsdom (sin navegador).
 *
 * Verifican la prioridad de selectores exigida por el contrato:
 *   id → data-testid → aria-label → role+name → css
 */

import * as fs from 'fs';
import * as path from 'path';
import { beforeEach, describe, expect, it } from 'vitest';
import { readPageForInventory } from '../src/discovery/page-reader';

const fixture = path.join(__dirname, '..', 'scripts', 'fixtures', 'discovery-app', 'index.html');
const html = fs.readFileSync(fixture, 'utf-8');
const body = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? html;
const title = /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '';
const baseUrl = 'http://127.0.0.1:4321/index.html';

function read() {
  return readPageForInventory({ baseUrl });
}

function bySelector(snapshot: ReturnType<typeof read>, selector: string) {
  return snapshot.elements.find(element => element.selector === selector);
}

describe('readPageForInventory (fixture de la app de prueba)', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = `<head><title>${title}</title></head><body>${body}</body>`;
  });

  it('devuelve título y encabezados con nivel', () => {
    const snapshot = read();
    expect(snapshot.title).toBe('Inicio — App de prueba');
    expect(snapshot.headings).toEqual([
      { level: 1, text: 'Gestión de clientes' },
      { level: 2, text: 'Resumen del día' }
    ]);
  });

  it('prioriza id sobre el resto', () => {
    const snapshot = read();
    const guardar = bySelector(snapshot, '#guardar');
    expect(guardar).toMatchObject({ kind: 'button', selectorStrategy: 'id', text: 'Guardar', formLabel: 'Alta de cliente' });
    expect(bySelector(snapshot, '#pagar')).toMatchObject({ selectorStrategy: 'id', formLabel: null });
  });

  it('usa data-testid cuando no hay id', () => {
    const snapshot = read();
    expect(bySelector(snapshot, '[data-testid="abrir-detalle"]')).toMatchObject({
      kind: 'button',
      selectorStrategy: 'data-testid',
      text: 'Abrir detalle'
    });
  });

  it('usa aria-label como nombre accesible', () => {
    const snapshot = read();
    expect(bySelector(snapshot, 'button[aria-label="Abrir ayuda"]')).toMatchObject({
      selectorStrategy: 'aria-label',
      text: 'Abrir ayuda'
    });
  });

  it('usa role+name cuando no hay atributos estables', () => {
    const snapshot = read();
    expect(bySelector(snapshot, 'role=button[name="Ver más"]')).toMatchObject({
      kind: 'button',
      selectorStrategy: 'role+name',
      text: 'Ver más'
    });
  });

  it('cae a css (clase estable) como último recurso', () => {
    const snapshot = read();
    expect(bySelector(snapshot, 'button.btn-icono')).toMatchObject({ selectorStrategy: 'css' });
  });

  it('inventaría enlaces internos con selector propio', () => {
    const snapshot = read();
    expect(bySelector(snapshot, '#ir-detalle')).toMatchObject({ kind: 'link', text: 'Ver cliente' });
    expect(snapshot.linkTargets).toContain('http://127.0.0.1:4321/detalle.html');
    expect(snapshot.linkTargets.some(target => target.startsWith('mailto:'))).toBe(true);
    expect(snapshot.linkTargets).toContain('https://externo.example.com/oferta');
    expect(snapshot.linkTargets).toContain('#ayuda');
  });

  it('extrae formularios con etiqueta y campos (label/type/selector)', () => {
    const snapshot = read();
    expect(snapshot.forms).toHaveLength(1);
    expect(snapshot.forms[0].label).toBe('Alta de cliente');
    expect(snapshot.forms[0].fields).toEqual([
      { label: 'Nombre', type: 'text', selector: '#nombre' },
      { label: 'Email', type: 'email', selector: '#email' },
      { label: 'Plan', type: 'select', selector: '#plan' },
      { label: 'Notas', type: 'textarea', selector: '#notas' }
    ]);
  });

  it('extrae selects y textareas como elementos propios', () => {
    const snapshot = read();
    expect(bySelector(snapshot, '#plan')).toMatchObject({ kind: 'select', text: 'Plan' });
    expect(bySelector(snapshot, '#notas')).toMatchObject({ kind: 'textarea', text: 'Notas' });
    expect(bySelector(snapshot, '#nombre')).toMatchObject({ kind: 'input', text: 'Nombre', formLabel: 'Alta de cliente' });
  });

  it('recoge textos de estado sin duplicados', () => {
    const snapshot = read();
    expect(snapshot.statusTexts).toContain('Todo listo para empezar.');
    expect(snapshot.statusTexts).toContain('Aviso de prueba');
    expect(bySelector(snapshot, 'role=status[name="Todo listo para empezar."]')).toMatchObject({ kind: 'status' });
  });

  it('ignora elementos ocultos', () => {
    const snapshot = read();
    expect(bySelector(snapshot, '#oculto')).toBeUndefined();
    expect(snapshot.forms[0].fields.some(field => field.selector === '#secreto')).toBe(false);
    expect(snapshot.linkTargets).not.toContain('http://127.0.0.1:4321/oculto.html');
  });
});

describe('readPageForInventory con controles ocultos añadidos', () => {
  it('no inventaría botones/enlaces ocultos ni inputs hidden', () => {
    document.documentElement.innerHTML = `<head><title>Ocultos</title></head><body>
      <button id="oculto" hidden>No visible</button>
      <a href="/oculto.html" id="enlace-oculto" style="display:none">Oculto</a>
      <form id="f"><input type="hidden" id="secreto" name="secreto"><input id="visible" name="visible" type="text" aria-label="Visible"></form>
    </body>`;
    const snapshot = read();
    expect(bySelector(snapshot, '#oculto')).toBeUndefined();
    expect(bySelector(snapshot, '#enlace-oculto')).toBeUndefined();
    expect(snapshot.forms[0].fields.map(field => field.selector)).toEqual(['#visible']);
    expect(snapshot.linkTargets).not.toContain('http://127.0.0.1:4321/oculto.html');
  });
});
