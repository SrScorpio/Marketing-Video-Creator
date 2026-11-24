/**
 * Tests puros del normalizador de descubrimiento (SSS-282).
 *
 * `normalizeDiscovery(raw)` no toca el navegador ni el DOM: recibe el JSON
 * crudo del crawler y devuelve el inventario del contrato listo para el agente
 * del chat. Aquí se fijan las reglas que importan:
 *   - dedupe por selector y descarte de selectores inestables (css-1x2y3z,
 *     posicionales) con reescritura a `role+name` cuando el texto lo permite;
 *   - `selectorStrategy` RECALCULADA desde el selector, nunca heredada;
 *   - rutas normalizadas, páginas ordenadas por path y duplicados fuera;
 *   - markdown con una sección por página (acciones y formularios);
 *   - escritura de`.mvc/discovery.json`/`.md` reemplazando SÓLO esos artefactos.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  normalizeDiscovery,
  renderDiscoveryMarkdown,
  serializeDiscoveryJson,
  writeDiscoveryArtifacts
} from '../src/discovery/normalizer';
import { RawDiscovery } from '../src/discovery/types';

const FIXED_NOW = () => new Date('2026-01-02T03:04:05.000Z');

function rawFixture(): RawDiscovery {
  return {
    generatedAt: '2026-01-01T00:00:00.000Z',
    baseUrl: 'http://app.test/#inicio',
    pages: [
      {
        url: 'http://app.test/z.html',
        path: 'z.html',
        title: '  Zeta  ',
        headings: [
          { level: 1, text: '  Zeta  ' },
          { level: 2, text: '   ' }
        ],
        elements: [{ kind: 'button', text: 'Volver', selector: '#volver', selectorStrategy: 'css', formLabel: '' }],
        forms: [],
        statusTexts: ['', '   ']
      },
      {
        url: 'http://app.test/index.html',
        path: 'index.html',
        title: ' Inicio ',
        headings: [{ level: 1, text: 'Inicio' }],
        elements: [
          { kind: 'button', text: ' Guardar ', selector: '#guardar', selectorStrategy: 'css', formLabel: 'Alta de cliente' },
          { kind: 'button', text: '', selector: '#guardar', selectorStrategy: 'id', formLabel: 'Alta de cliente' },
          { kind: 'button', text: 'Guardar', selector: '#guardar', selectorStrategy: 'id', formLabel: 'Alta de cliente' },
          { kind: 'button', text: 'Icono', selector: 'button.css-1x2y3z', selectorStrategy: 'css', formLabel: null },
          { kind: 'button', text: '', selector: 'button.sc-bdVaJa', selectorStrategy: 'css', formLabel: null },
          { kind: 'link', text: ' Ir a detalle ', selector: 'a[href="/detalle.html"]', selectorStrategy: 'css', formLabel: null },
          { kind: 'input', text: 'Nombre', selector: '#nombre', selectorStrategy: 'data-testid', formLabel: 'Alta de cliente' },
          { kind: 'status', text: 'Todo listo', selector: 'p.status', selectorStrategy: 'css', formLabel: null },
          { kind: 'button', text: 'Ver más', selector: 'span:nth-of-type(2)', selectorStrategy: 'css', formLabel: null },
          { kind: 'button', text: 'A|B', selector: '[data-testid="pipa"]', selectorStrategy: 'role+name', formLabel: null }
        ],
        forms: [
          {
            label: ' Alta de cliente ',
            fields: [
              { label: ' Nombre ', type: 'TEXT', selector: '#nombre' },
              { label: '', type: 'text', selector: '#nombre' }
            ]
          },
          { label: '', fields: [{ label: 'Plan', type: 'select', selector: '#plan' }] }
        ],
        statusTexts: ['Todo listo', ' ', 'Todo listo']
      },
      {
        url: 'http://app.test/detalle.html#top',
        path: '/detalle.html#top',
        title: 'Detalle',
        headings: [],
        elements: [],
        forms: [],
        statusTexts: []
      },
      {
        url: 'http://app.test/detalle.html',
        path: '/detalle.html',
        title: 'Detalle duplicado',
        headings: [],
        elements: [],
        forms: [],
        statusTexts: []
      }
    ],
    stats: {
      pageCount: 99,
      depthReached: 2,
      skipped: [
        { url: '#ayuda', reason: 'ancla' },
        { url: '#ayuda', reason: 'ancla' },
        { url: 'https://externo.example.com/x', reason: 'externo' }
      ]
    },
    warnings: ['aviso b', 'aviso a', 'aviso a']
  };
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('normalizeDiscovery · páginas', () => {
  it('normaliza rutas, ordena por path y elimina duplicados', () => {
    const doc = normalizeDiscovery(rawFixture(), { now: FIXED_NOW });

    expect(doc.pages.map(page => page.path)).toEqual(['/detalle.html', '/index.html', '/z.html']);
    expect(doc.pages.map(page => page.title)).toEqual(['Detalle', 'Inicio', 'Zeta']);
    // El hash no es una pantalla distinta: el duplicado se queda fuera.
    expect(doc.pages.filter(page => page.path === '/detalle.html')).toHaveLength(1);
    expect(doc.warnings.some(warning => warning.includes('duplicada'))).toBe(true);
  });

  it('quita el hash de la URL y recorta texto de título y encabezados', () => {
    const doc = normalizeDiscovery(rawFixture(), { now: FIXED_NOW });
    const detalle = doc.pages.find(page => page.path === '/detalle.html');
    const index = doc.pages.find(page => page.path === '/index.html');

    expect(detalle?.url).toBe('http://app.test/detalle.html');
    expect(index?.title).toBe('Inicio');
    expect(index?.headings).toEqual([{ level: 1, text: 'Inicio' }]);
    expect(index?.statusTexts).toEqual(['Todo listo']);
  });

  it('recalcula stats.pageCount y conserva depthReached y los descartes ordenados', () => {
    const doc = normalizeDiscovery(rawFixture(), { now: FIXED_NOW });

    expect(doc.stats.pageCount).toBe(doc.pages.length);
    expect(doc.stats.depthReached).toBe(2);
    expect(doc.stats.skipped).toEqual([
      { url: '#ayuda', reason: 'ancla' },
      { url: 'https://externo.example.com/x', reason: 'externo' }
    ]);
  });

  it('normaliza baseUrl y conserva el generatedAt crudo cuando es ISO válido', () => {
    const doc = normalizeDiscovery(rawFixture(), { now: FIXED_NOW });

    expect(doc.baseUrl).toBe('http://app.test');
    expect(doc.generatedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('genera generatedAt con el reloj inyectado si el crudo falta o no es ISO', () => {
    const raw = rawFixture();
    delete (raw as Partial<RawDiscovery>).generatedAt;
    expect(normalizeDiscovery(raw, { now: FIXED_NOW }).generatedAt).toBe('2026-01-02T03:04:05.000Z');

    raw.generatedAt = 'ayer por la tarde';
    expect(normalizeDiscovery(raw, { now: FIXED_NOW }).generatedAt).toBe('2026-01-02T03:04:05.000Z');
  });

  it('no muta la entrada', () => {
    const raw = rawFixture();
    const before = clone(raw);
    normalizeDiscovery(raw, { now: FIXED_NOW });
    expect(raw).toEqual(before);
  });
});

describe('normalizeDiscovery · elementos', () => {
  const doc = () => normalizeDiscovery(rawFixture(), { now: FIXED_NOW });
  const page = () => doc().pages.find(item => item.path === '/index.html')!;

  it('deduplica por selector conservando el texto informativo', () => {
    const guardar = page().elements.filter(element => element.selector === '#guardar');

    expect(guardar).toHaveLength(1);
    expect(guardar[0]).toMatchObject({ kind: 'button', text: 'Guardar', formLabel: 'Alta de cliente' });
  });

  it('recalcula selectorStrategy desde el selector, no la hereda del crudo', () => {
    const elements = page().elements;
    const strategy = (selector: string) => elements.find(element => element.selector === selector)?.selectorStrategy;

    expect(strategy('#guardar')).toBe('id');
    expect(strategy('#nombre')).toBe('id');
    expect(strategy('[data-testid="pipa"]')).toBe('data-testid');
    expect(strategy('a[href="/detalle.html"]')).toBe('css');
    expect(strategy('p.status')).toBe('css');
  });

  it('reescribe un selector css autogenerado a role+name cuando hay texto', () => {
    const icono = page().elements.find(element => element.text === 'Icono');

    expect(icono?.selector).toBe('role=button[name="Icono"]');
    expect(icono?.selectorStrategy).toBe('role+name');
  });

  it('descarta selectores inestables sin alternativa y lo anota en warnings', () => {
    const elements = page().elements;

    expect(elements.some(element => element.selector.includes('sc-bdVaJa'))).toBe(false);
    expect(doc().warnings.some(warning => warning.includes('/index.html') && warning.includes('descartado'))).toBe(true);
  });

  it('reescribe selectores posicionales a role+name', () => {
    const verMas = page().elements.find(element => element.text === 'Ver más');

    expect(verMas?.selector).toBe('role=button[name="Ver más"]');
    expect(verMas?.selectorStrategy).toBe('role+name');
  });

  it('normaliza texto y convierte formLabel vacío en null', () => {
    const link = page().elements.find(element => element.kind === 'link');
    const volver = doc().pages.find(item => item.path === '/z.html')?.elements[0];

    expect(link?.text).toBe('Ir a detalle');
    expect(volver?.formLabel).toBeNull();
  });

  it('sólo admite los valores del contrato en kind y selectorStrategy', () => {
    const kinds = new Set(['button', 'link', 'input', 'select', 'textarea', 'status']);
    const strategies = new Set(['id', 'data-testid', 'aria-label', 'role+name', 'css']);

    for (const item of doc().pages) {
      for (const element of item.elements) {
        expect(kinds.has(element.kind)).toBe(true);
        expect(strategies.has(element.selectorStrategy)).toBe(true);
      }
    }
  });
});

describe('normalizeDiscovery · formularios', () => {
  it('deduplica campos, recorta etiquetas y minúsculiza el tipo', () => {
    const forms = normalizeDiscovery(rawFixture(), { now: FIXED_NOW }).pages.find(page => page.path === '/index.html')!.forms;

    expect(forms[0].label).toBe('Alta de cliente');
    expect(forms[0].fields).toEqual([{ label: 'Nombre', type: 'text', selector: '#nombre' }]);
    expect(forms[1].label).toBe('formulario 2');
  });
});

describe('renderDiscoveryMarkdown', () => {
  const markdown = () => renderDiscoveryMarkdown(normalizeDiscovery(rawFixture(), { now: FIXED_NOW }));

  it('incluye una sección por página con título, URL, encabezados y tablas', () => {
    const md = markdown();

    expect(md).toContain('# Descubrimiento de la app — app.test');
    expect(md).toContain('## 1. Detalle');
    expect(md).toContain('## 2. Inicio');
    expect(md).toContain('## 3. Zeta');
    expect(md).toContain('- **URL**: http://app.test/index.html');
    expect(md).toContain('- **Encabezados**: H1 Inicio');
    expect(md).toContain('| Texto | Tipo | Selector | Estrategia | Formulario |');
    expect(md).toContain('| Guardar | button | `#guardar` | id | Alta de cliente |');
    expect(md).toContain('| Formulario | Campo | Tipo | Selector |');
    expect(md).toContain('| Alta de cliente | Nombre | text | `#nombre` |');
  });

  it('escapa pipes y muestra descartes y avisos', () => {
    const md = markdown();

    expect(md).toContain('| A\\|B | button |');
    expect(md).toContain('## Descartes');
    expect(md).toContain('| `#ayuda` | ancla |');
    expect(md).toContain('## Avisos');
    expect(md).toContain('- aviso a');
  });

  it('numera el índice con las mismas páginas que el JSON', () => {
    const doc = normalizeDiscovery(rawFixture(), { now: FIXED_NOW });
    const md = renderDiscoveryMarkdown(doc);

    for (const [index, item] of doc.pages.entries()) {
      expect(md).toContain(`## ${index + 1}. ${item.title || item.path}`);
    }
  });
});

describe('serializeDiscoveryJson', () => {
  it('produce JSON indentado, con salto final y las claves exactas del contrato', () => {
    const doc = normalizeDiscovery(rawFixture(), { now: FIXED_NOW });
    const text = serializeDiscoveryJson(doc);
    const parsed = JSON.parse(text);

    expect(text.endsWith('\n')).toBe(true);
    expect(Object.keys(parsed)).toEqual(['generatedAt', 'baseUrl', 'pages', 'stats', 'warnings']);
    expect(Object.keys(parsed.pages[0])).toEqual([
      'url',
      'path',
      'title',
      'headings',
      'elements',
      'forms',
      'statusTexts'
    ]);
    expect(Object.keys(parsed.pages[1].elements[0])).toEqual([
      'kind',
      'text',
      'selector',
      'selectorStrategy',
      'formLabel'
    ]);
    expect(Object.keys(parsed.stats)).toEqual(['pageCount', 'depthReached', 'skipped']);
  });
});

describe('writeDiscoveryArtifacts', () => {
  const dirs: string[] = [];

  afterEach(() => {
    while (dirs.length > 0) {
      fs.rmSync(dirs.pop() as string, { recursive: true, force: true });
    }
  });

  function tmpRepo(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvc-discovery-'));
    dirs.push(dir);
    return dir;
  }

  it('crea .mvc y escribe los dos artefactos', () => {
    const repo = tmpRepo();
    const doc = normalizeDiscovery(rawFixture(), { now: FIXED_NOW });
    const artifacts = writeDiscoveryArtifacts(doc, path.join(repo, '.mvc'));

    expect(fs.readFileSync(artifacts.jsonPath, 'utf8')).toBe(serializeDiscoveryJson(doc));
    expect(fs.readFileSync(artifacts.mdPath, 'utf8')).toBe(renderDiscoveryMarkdown(doc));
  });

  it('reemplaza sólo sus artefactos y respeta el resto de .mvc', () => {
    const repo = tmpRepo();
    const outDir = path.join(repo, '.mvc');
    fs.mkdirSync(path.join(outDir, 'prompts'), { recursive: true });
    fs.writeFileSync(path.join(outDir, 'guion.md'), '# guion previo\n');
    fs.writeFileSync(path.join(outDir, 'prompts', '00-leeme.md'), '# pack\n');
    fs.writeFileSync(path.join(outDir, 'discovery.md'), 'contenido viejo\n');

    const first = normalizeDiscovery(rawFixture(), { now: FIXED_NOW });
    writeDiscoveryArtifacts(first, outDir);

    const second = clone(first);
    second.pages[0].title = 'Otro título';
    writeDiscoveryArtifacts(second, outDir);

    expect(fs.readFileSync(path.join(outDir, 'guion.md'), 'utf8')).toBe('# guion previo\n');
    expect(fs.readFileSync(path.join(outDir, 'prompts', '00-leeme.md'), 'utf8')).toBe('# pack\n');
    expect(fs.readFileSync(path.join(outDir, 'discovery.md'), 'utf8')).toContain('Otro título');
    expect(fs.readdirSync(outDir).sort()).toEqual(['discovery.json', 'discovery.md', 'guion.md', 'prompts']);
  });

  it('no deja ficheros temporales tras un error de escritura', () => {
    const repo = tmpRepo();
    const doc = normalizeDiscovery(rawFixture(), { now: FIXED_NOW });
    const outDir = path.join(repo, '.mvc');
    // Un directorio en el nombre destino hace fallar el rename/escritura.
    fs.mkdirSync(path.join(outDir, 'discovery.md'), { recursive: true });

    expect(() => writeDiscoveryArtifacts(doc, outDir)).toThrow();
    expect(fs.readdirSync(outDir).filter(name => name.startsWith('.tmp-'))).toEqual([]);
  });
});
