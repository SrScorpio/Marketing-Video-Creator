/**
 * Esquema y normalización de la configuración del proyecto.
 *
 * Sin dependencia de VS Code a propósito: aquí vive lo que se puede verificar en
 * Node puro (normalización de fases, validación de pasos de captura y del
 * proyecto). `project-config.ts` añade el acceso a disco y a la API de VS Code.
 */

import { CaptureStep, PhaseConfig } from '../types/phase';
import { ProjectConfig } from '../types/project-config';
import { isValidDuration, isValidPhaseId, isValidUrl } from '../utils/validators';

export const CONFIG_VERSION = '1.0.0';

/** Fases por defecto cuando la configuración no aporta ninguna válida. */
export const DEFAULT_PHASES: PhaseConfig[] = [
  { id: '01-presentacion', label: 'Presentación', duration: 5 },
  { id: '02-crear-ficha', label: 'Crear Ficha', duration: 10 },
  { id: '03-evaluacion', label: 'Evaluación', duration: 10 },
  { id: '04-descargar-informe', label: 'Descargar Informe', duration: 8 },
  { id: '05-historial', label: 'Historial', duration: 7 },
  { id: '06-cuenta', label: 'Cuenta', duration: 5 },
  { id: '07-cierre', label: 'Cierre', duration: 5 }
];

const STEP_ACTIONS = ['goto', 'click', 'fill', 'press', 'waitForSelector', 'wait'] as const;

export interface ParseStepsResult {
  steps: CaptureStep[];
  errors: string[];
}

/**
 * Acepta los pasos como array ya tipado o como texto JSON (es lo que escribe el
 * usuario en el panel). Devuelve sólo los pasos válidos junto a los errores, para
 * no perder el trabajo del usuario por un paso mal escrito.
 */
export function parseCaptureSteps(raw: unknown, label: string = 'fase'): ParseStepsResult {
  if (raw === undefined || raw === null || raw === '') {
    return { steps: [], errors: [] };
  }

  let value: unknown = raw;

  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return { steps: [], errors: [`Pasos de ${label}: el JSON no es válido.`] };
    }
  }

  if (!Array.isArray(value)) {
    return { steps: [], errors: [`Pasos de ${label}: debe ser un array de acciones.`] };
  }

  const steps: CaptureStep[] = [];
  const errors: string[] = [];

  value.forEach((item, index) => {
    const prefix = `Pasos de ${label} (${index + 1})`;
    const step = item as Record<string, unknown> | null;

    if (!step || typeof step !== 'object') {
      errors.push(`${prefix}: no es un objeto.`);
      return;
    }

    const action = step.action;
    if (typeof action !== 'string' || !STEP_ACTIONS.includes(action as (typeof STEP_ACTIONS)[number])) {
      errors.push(`${prefix}: acción no soportada (${String(action)}). Válidas: ${STEP_ACTIONS.join(', ')}.`);
      return;
    }

    switch (action as (typeof STEP_ACTIONS)[number]) {
      case 'goto': {
        if (typeof step.url !== 'string' || !isValidUrl(step.url)) {
          errors.push(`${prefix}: 'goto' necesita una url válida.`);
          return;
        }
        const waitUntil = step.waitUntil;
        const allowed = ['load', 'domcontentloaded', 'networkidle'];
        steps.push({
          action: 'goto',
          url: step.url,
          waitUntil: typeof waitUntil === 'string' && allowed.includes(waitUntil) ? (waitUntil as 'load') : 'load'
        });
        return;
      }

      case 'click': {
        if (typeof step.selector !== 'string' || !step.selector.trim()) {
          errors.push(`${prefix}: 'click' necesita un selector.`);
          return;
        }
        steps.push({ action: 'click', selector: step.selector.trim() });
        return;
      }

      case 'fill': {
        if (typeof step.selector !== 'string' || !step.selector.trim()) {
          errors.push(`${prefix}: 'fill' necesita un selector.`);
          return;
        }
        if (typeof step.text !== 'string') {
          errors.push(`${prefix}: 'fill' necesita un texto.`);
          return;
        }
        steps.push({ action: 'fill', selector: step.selector.trim(), text: step.text });
        return;
      }

      case 'press': {
        if (typeof step.selector !== 'string' || !step.selector.trim()) {
          errors.push(`${prefix}: 'press' necesita un selector.`);
          return;
        }
        if (typeof step.key !== 'string' || !step.key.trim()) {
          errors.push(`${prefix}: 'press' necesita una tecla.`);
          return;
        }
        steps.push({ action: 'press', selector: step.selector.trim(), key: step.key.trim() });
        return;
      }

      case 'waitForSelector': {
        if (typeof step.selector !== 'string' || !step.selector.trim()) {
          errors.push(`${prefix}: 'waitForSelector' necesita un selector.`);
          return;
        }
        const timeoutMs = typeof step.timeoutMs === 'number' && step.timeoutMs > 0 ? step.timeoutMs : undefined;
        steps.push({ action: 'waitForSelector', selector: step.selector.trim(), timeoutMs });
        return;
      }

      case 'wait': {
        if (typeof step.ms !== 'number' || step.ms < 0) {
          errors.push(`${prefix}: 'wait' necesita milisegundos (ms).`);
          return;
        }
        steps.push({ action: 'wait', ms: step.ms });
        return;
      }
    }
  });

  return { steps, errors };
}

export interface NormalizePhasesResult {
  phases: PhaseConfig[];
  warnings: string[];
}

/**
 * Normaliza la lista de fases de la configuración: descarta entradas sin id o
 * duración válidos y se queda con el guion, la url y los pasos que sean válidos
 * (avisando de lo que descarta, en vez de hacerlo en silencio).
 */
export function normalizePhases(raw: unknown): NormalizePhasesResult {
  const warnings: string[] = [];

  if (!Array.isArray(raw)) {
    return { phases: [], warnings: ['La lista de fases no es un array válido.'] };
  }

  const phases: PhaseConfig[] = [];

  raw.forEach((item, index) => {
    const candidate = item as Record<string, unknown> | null;

    if (!candidate || typeof candidate !== 'object') {
      warnings.push(`Fase ${index + 1}: entrada inválida, descartada.`);
      return;
    }

    const id = typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id.trim() : `phase-${index + 1}`;

    if (!isValidPhaseId(id)) {
      warnings.push(`Fase ${index + 1}: id inválido ("${String(candidate.id)}"), descartada.`);
      return;
    }

    const duration = typeof candidate.duration === 'number' ? candidate.duration : Number(candidate.duration);

    if (!isValidDuration(duration)) {
      warnings.push(`Fase ${id}: duración inválida ("${String(candidate.duration)}"), descartada.`);
      return;
    }

    const label = typeof candidate.label === 'string' && candidate.label.trim() ? candidate.label.trim() : `Fase ${index + 1}`;
    const phase: PhaseConfig = { id, label, duration };

    if (typeof candidate.url === 'string' && candidate.url.trim()) {
      if (isValidUrl(candidate.url)) {
        phase.url = candidate.url.trim();
      } else {
        warnings.push(`Fase ${id}: url inválida ("${candidate.url}"), ignorada.`);
      }
    }

    if (typeof candidate.script === 'string' && candidate.script.trim()) {
      phase.script = candidate.script.trim();
    }

    const { steps, errors } = parseCaptureSteps(candidate.steps, id);
    warnings.push(...errors);

    if (steps.length > 0) {
      phase.steps = steps;
    }

    phases.push(phase);
  });

  return { phases, warnings };
}

/** Errores que impiden ejecutar el pipeline (no avisos: errores). */
export function validateProjectConfig(config: ProjectConfig): string[] {
  const errors: string[] = [];

  if (!isValidUrl(config.url)) {
    errors.push('URL inválida: ' + config.url);
  }

  if (!Array.isArray(config.phases) || config.phases.length === 0) {
    errors.push('El proyecto no tiene ninguna fase.');
    return errors;
  }

  for (const phase of config.phases) {
    if (!isValidPhaseId(phase.id)) {
      errors.push('ID de fase inválido: ' + phase.id);
    }

    if (!isValidDuration(phase.duration)) {
      errors.push('Duración inválida para fase ' + phase.id + ': ' + phase.duration + 's');
    }

    if (phase.url !== undefined && !isValidUrl(phase.url)) {
      errors.push('URL inválida en la fase ' + phase.id + ': ' + phase.url);
    }

    if (phase.steps !== undefined) {
      errors.push(...parseCaptureSteps(phase.steps, phase.id).errors);
    }
  }

  return errors;
}
