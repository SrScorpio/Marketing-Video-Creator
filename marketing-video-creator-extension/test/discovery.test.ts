/**
 * Tests puros del crawler de descubrimiento (sin navegador ni jsdom).
 *
 * Cubren las decisiones que definen las guardas de seguridad: origen estricto,
 * límites, clasificación de enlaces y rechazo de un storageState dentro del repo.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  assertStorageStateOutsideRepo,
  canonicalUrl,
  clampLimits,
  classifyLink,
  isDestructiveAction,
  isSameOrigin,
  originOf,
  pathOf
} from '../src/discovery/crawler';
import { DEFAULT_MAX_DEPTH, DEFAULT_MAX_PAGES } from '../src/discovery/types';

const origin = 'http://127.0.0.1:4321';

describe('clampLimits', () => {
  it('usa los defaults del contrato (maxDepth 2, maxPages 15)', () => {
    expect(DEFAULT_MAX_DEPTH).toBe(2);
    expect(DEFAULT_MAX_PAGES).toBe(15);
    expect(clampLimits()).toEqual({ maxDepth: 2, maxPages: 15 });
  });

  it('clampea valores fuera de rango', () => {
    expect(clampLimits(-3, 0)).toEqual({ maxDepth: 0, maxPages: 1 });
    expect(clampLimits(99, 9999)).toEqual({ maxDepth: 10, maxPages: 100 });
  });

  it('redondea hacia abajo y descarta NaN', () => {
    expect(clampLimits(2.9, 7.8)).toEqual({ maxDepth: 2, maxPages: 7 });
    expect(clampLimits(Number.NaN, Number.NaN)).toEqual({ maxDepth: 2, maxPages: 15 });
  });
});

describe('origen y canonicalización', () => {
  it('origenOf sólo acepta http/https', () => {
    expect(originOf(`${origin}/a`)).toBe(origin);
    expect(originOf('https://example.com')).toBe('https://example.com');
    expect(originOf('mailto:a@b.c')).toBeNull();
    expect(originOf('ftp://example.com')).toBeNull();
    expect(originOf('no es una url')).toBeNull();
  });

  it('isSameOrigin es estricto con protocolo, host y puerto', () => {
    expect(isSameOrigin(`${origin}/x`, origin)).toBe(true);
    expect(isSameOrigin('https://127.0.0.1:4321/x', origin)).toBe(false);
    expect(isSameOrigin('http://127.0.0.1:4322/x', origin)).toBe(false);
    expect(isSameOrigin('http://localhost:4321/x', origin)).toBe(false);
  });

  it('canonicalUrl quita el hash pero conserva la query', () => {
    expect(canonicalUrl(`${origin}/a?x=1#seccion`)).toBe(`${origin}/a?x=1`);
    expect(canonicalUrl(`${origin}/a#seccion`)).toBe(`${origin}/a`);
  });

  it('pathOf devuelve pathname + search', () => {
    expect(pathOf(`${origin}/detalle.html?p=2#x`)).toBe('/detalle.html?p=2');
    expect(pathOf(`${origin}/`)).toBe('/');
  });
});

describe('classifyLink', () => {
  const current = `${origin}/index.html`;

  it('acepta enlaces internos dentro de la profundidad', () => {
    expect(classifyLink('/detalle.html', current, origin, 1, 2)).toEqual({
      action: 'enqueue',
      url: `${origin}/detalle.html`
    });
  });

  it('descarta enlaces externos', () => {
    expect(classifyLink('https://otro.example.com/x', current, origin, 1, 2)).toMatchObject({
      action: 'skip',
      reason: 'externo'
    });
  });

  it('descarta mailto, tel, javascript, anclas y no-http', () => {
    expect(classifyLink('mailto:a@b.c', current, origin, 1, 2).reason).toBe('no-http');
    expect(classifyLink('tel:+341234', current, origin, 1, 2).reason).toBe('no-http');
    expect(classifyLink('javascript:alert(1)', current, origin, 1, 2).reason).toBe('no-http');
    expect(classifyLink('#ayuda', current, origin, 1, 2).reason).toBe('ancla');
  });

  it('trata como ancla la misma pantalla con hash', () => {
    expect(classifyLink(`${origin}/index.html#zona`, current, origin, 1, 2)).toMatchObject({
      action: 'skip',
      reason: 'ancla'
    });
  });

  it('respeta maxDepth', () => {
    expect(classifyLink('/profundo.html', current, origin, 3, 2)).toMatchObject({
      action: 'skip',
      reason: 'max-profundidad'
    });
    expect(classifyLink('/profundo.html', current, origin, 2, 2)).toMatchObject({ action: 'enqueue' });
  });

  it('no enqueue hrefs vacíos', () => {
    expect(classifyLink('', current, origin, 1, 2)).toMatchObject({ action: 'skip', reason: 'no-http' });
  });
});

describe('isDestructiveAction', () => {
  it('detecta los términos exigidos por el encargo', () => {
    for (const term of ['Pagar ahora', 'Comprar', 'Borrar cuenta', 'Eliminar cliente', 'Delete account', 'Pay now', 'Ir a checkout', 'Subscribe']) {
      expect(isDestructiveAction(term), term).toBe(true);
    }
  });

  it('no marca acciones inocuas', () => {
    for (const term of ['Guardar', 'Ver detalle', 'Descargar informe', 'Añadir cliente']) {
      expect(isDestructiveAction(term), term).toBe(false);
    }
  });
});

describe('assertStorageStateOutsideRepo', () => {
  const repoRoot = path.join(os.tmpdir(), `mvc-repo-${process.pid}`);
  const inside = path.join(repoRoot, '.mvc', 'storageState.json');
  const outside = path.join(os.tmpdir(), `mvc-storage-${process.pid}.json`);

  fs.mkdirSync(path.dirname(inside), { recursive: true });
  fs.writeFileSync(inside, '{"cookies":[]}');
  fs.writeFileSync(outside, '{"cookies":[]}');

  afterAll(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
    fs.rmSync(outside, { force: true });
  });

  it('rechaza un storageState dentro del repositorio', () => {
    expect(() => assertStorageStateOutsideRepo(inside, repoRoot)).toThrow(/fuera del repo|dentro del repositorio/i);
  });

  it('acepta un storageState fuera del repositorio', () => {
    expect(() => assertStorageStateOutsideRepo(outside, repoRoot)).not.toThrow();
  });

  it('rechaza una ruta inexistente', () => {
    expect(() => assertStorageStateOutsideRepo(path.join(os.tmpdir(), 'no-existe-xyz.json'), repoRoot)).toThrow(/No existe/);
  });
});
