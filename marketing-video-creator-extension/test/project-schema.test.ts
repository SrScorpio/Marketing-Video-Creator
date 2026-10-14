/**
 * Esquema y normalización de la configuración del proyecto.
 *
 * Cubre el camino que faltaba: hasta ahora la configuración no admitía guion ni
 * pasos de captura por fase, así que el pipeline nunca podía narrar ni ejecutar
 * nada declarado por el usuario.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PHASES,
  normalizePhases,
  parseCaptureSteps,
  validateProjectConfig
} from '../src/config/project-schema';
import { ProjectConfig } from '../src/types/project-config';

function project(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    name: 'demo',
    url: 'https://ejemplo.test',
    phases: [{ id: '01-presentacion', label: 'Presentación', duration: 5 }],
    outputDir: './output/demo-video',
    variant: 'desktop',
    ...overrides
  };
}

describe('parseCaptureSteps', () => {
  it('acepta los seis tipos de acción', () => {
    const { steps, errors } = parseCaptureSteps([
      { action: 'goto', url: 'https://ejemplo.test/dashboard' },
      { action: 'click', selector: '#nueva-ficha' },
      { action: 'fill', selector: '#nombre', text: 'Rocinante' },
      { action: 'press', selector: '#nombre', key: 'Enter' },
      { action: 'waitForSelector', selector: '.resultado', timeoutMs: 5000 },
      { action: 'wait', ms: 500 }
    ]);

    expect(errors).toEqual([]);
    expect(steps.map(step => step.action)).toEqual(['goto', 'click', 'fill', 'press', 'waitForSelector', 'wait']);
  });

  it('acepta los pasos como texto JSON (es lo que escribe el panel)', () => {
    const { steps, errors } = parseCaptureSteps('[{"action":"click","selector":"#boton"}]');

    expect(errors).toEqual([]);
    expect(steps).toEqual([{ action: 'click', selector: '#boton' }]);
  });

  it('trata el vacío como "sin pasos" sin error', () => {
    expect(parseCaptureSteps(undefined)).toEqual({ steps: [], errors: [] });
    expect(parseCaptureSteps('')).toEqual({ steps: [], errors: [] });
  });

  it('informa cuando el JSON no es válido o no es un array', () => {
    expect(parseCaptureSteps('{no json').errors[0]).toMatch(/no es válido/);
    expect(parseCaptureSteps('{"action":"click"}').errors[0]).toMatch(/array/);
  });

  it('rechaza acciones no soportadas y campos obligatorios ausentes', () => {
    const { steps, errors } = parseCaptureSteps([
      { action: 'scroll' },
      { action: 'goto' },
      { action: 'click' },
      { action: 'fill', selector: '#a' },
      { action: 'press', selector: '#a' },
      { action: 'waitForSelector' },
      { action: 'wait' }
    ]);

    expect(steps).toEqual([]);
    expect(errors).toHaveLength(7);
    expect(errors[0]).toMatch(/acción no soportada/);
    expect(errors[1]).toMatch(/url válida/);
    expect(errors[2]).toMatch(/selector/);
    expect(errors[3]).toMatch(/texto/);
    expect(errors[4]).toMatch(/tecla/);
    expect(errors[5]).toMatch(/selector/);
    expect(errors[6]).toMatch(/ms/);
  });

  it('se queda con los pasos válidos y descarta sólo los malos', () => {
    const { steps, errors } = parseCaptureSteps([
      { action: 'click', selector: '#ok' },
      { action: 'click' }
    ]);

    expect(steps).toEqual([{ action: 'click', selector: '#ok' }]);
    expect(errors).toHaveLength(1);
  });

  it('normaliza el waitUntil de goto y descarta valores no soportados', () => {
    const { steps } = parseCaptureSteps([
      { action: 'goto', url: 'https://ejemplo.test', waitUntil: 'domcontentloaded' },
      { action: 'goto', url: 'https://ejemplo.test', waitUntil: 'cuando-sea' }
    ]);

    expect(steps[0]).toMatchObject({ waitUntil: 'domcontentloaded' });
    expect(steps[1]).toMatchObject({ waitUntil: 'load' });
  });
});

describe('normalizePhases', () => {
  it('conserva id, nombre, duración, url, guion y pasos', () => {
    const { phases, warnings } = normalizePhases([
      {
        id: '01-presentacion',
        label: '  Presentación  ',
        duration: 5,
        url: 'https://ejemplo.test/inicio',
        script: '  Bienvenido a la demo.  ',
        steps: [{ action: 'click', selector: '#empezar' }]
      }
    ]);

    expect(warnings).toEqual([]);
    expect(phases).toEqual([
      {
        id: '01-presentacion',
        label: 'Presentación',
        duration: 5,
        url: 'https://ejemplo.test/inicio',
        script: 'Bienvenido a la demo.',
        steps: [{ action: 'click', selector: '#empezar' }]
      }
    ]);
  });

  it('genera un id si falta y descarta lo que no se puede ejecutar', () => {
    const { phases, warnings } = normalizePhases([
      { label: 'Sin id', duration: 4 },
      { id: '02-x', label: 'Sin duración' },
      { id: 'con espacios', label: 'Id inválido', duration: 5 },
      { id: '03-ok', label: 'Válida', duration: 5 }
    ]);

    expect(phases.map(phase => phase.id)).toEqual(['phase-1', '03-ok']);
    expect(warnings).toHaveLength(2);
    expect(warnings.join(' ')).toMatch(/duración inválida/);
    expect(warnings.join(' ')).toMatch(/id inválido/);
  });

  it('ignora la url de fase inválida pero conserva la fase', () => {
    const { phases, warnings } = normalizePhases([
      { id: '01-a', label: 'A', duration: 5, url: 'no-es-una-url' }
    ]);

    expect(phases[0].url).toBeUndefined();
    expect(warnings[0]).toMatch(/url inválida/);
  });

  it('avisа de los pasos mal escritos sin perder la fase', () => {
    const { phases, warnings } = normalizePhases([
      { id: '01-a', label: 'A', duration: 5, steps: [{ action: 'click' }] }
    ]);

    expect(phases[0].steps).toBeUndefined();
    expect(warnings[0]).toMatch(/selector/);
  });

  it('devuelve lista vacía si no recibe un array', () => {
    expect(normalizePhases(null).phases).toEqual([]);
    expect(normalizePhases({ id: 'x' }).warnings[0]).toMatch(/no es un array/);
  });

  it('incluye las 7 fases por defecto con ids válidos', () => {
    expect(DEFAULT_PHASES).toHaveLength(7);
    const { phases } = normalizePhases(DEFAULT_PHASES);
    expect(phases).toHaveLength(7);
  });
});

describe('validateProjectConfig', () => {
  it('acepta un proyecto correcto', () => {
    expect(validateProjectConfig(project())).toEqual([]);
  });

  it('detecta URL inválida y proyecto sin fases', () => {
    expect(validateProjectConfig(project({ url: 'ejemplo' }))[0]).toMatch(/URL inválida/);
    expect(validateProjectConfig(project({ phases: [] }))[0]).toMatch(/ninguna fase/);
  });

  it('detecta duración, url y pasos inválidos en una fase', () => {
    const errors = validateProjectConfig(
      project({
        phases: [
          { id: '01-a', label: 'A', duration: 0 },
          { id: '02-b', label: 'B', duration: 5, url: 'mal' },
          { id: '03-c', label: 'C', duration: 5, steps: [{ action: 'click' } as never] }
        ]
      })
    );

    // La duración 0 y los pasos se rechazan; el id '01-a' es válido.
    expect(errors.some(error => /Duración inválida/.test(error))).toBe(true);
    expect(errors.some(error => /URL inválida en la fase 02-b/.test(error))).toBe(true);
    expect(errors.some(error => /selector/.test(error))).toBe(true);
  });
});
