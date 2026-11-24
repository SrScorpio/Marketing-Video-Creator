/**
 * Modelo de datos del asistente de descubrimiento en el panel (SSS-282).
 *
 * Puente puro (fs + JSON) entre los artefactos del descubrimiento y el webview:
 *   - `.mvc/discovery.json`   → resumen de páginas, acciones, formularios,
 *                               avisos y enlaces saltados;
 *   - `.mvc/mvc-config.borrador.json` → propuesta de fases editable;
 *   - `mvc-config.json`       → si existe, para pedir confirmación al sobrescribir.
 *
 * No importa `vscode` a propósito: así se prueba en vitest (Node) y el E2E puede
 * reutilizarlo contra un crawl real. El host sólo traduce mensajes del webview.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ProjectConfig } from '../types/project-config';
import { RawDiscovery } from './types';
import { discoveryToPhases } from './phases-proposer';
import { buildPhasesDraft, writePhasesDraft } from './phases-draft';

/** Nombres fijos de los artefactos (coinciden con normalizer.ts y el contrato de SSS-282). */
export const DISCOVERY_FILE_NAME = 'discovery.json';
export const PROPOSAL_FILE_NAME = 'mvc-config.borrador.json';
export const PROJECT_CONFIG_FILE_NAME = 'mvc-config.json';

export interface DiscoveryActionView {
  kind: string;
  text: string;
  selector: string;
  selectorStrategy: string;
}

export interface DiscoveryFormView {
  label: string;
  fieldCount: number;
}

export interface DiscoveryPageView {
  path: string;
  url: string;
  title: string;
  /** Primer encabezado de la pantalla ('' si no tiene). */
  heading: string;
  actionCount: number;
  formCount: number;
  statusCount: number;
  actions: DiscoveryActionView[];
  forms: DiscoveryFormView[];
}

export interface DiscoveryView {
  generatedAt: string;
  baseUrl: string;
  pageCount: number;
  actionCount: number;
  formCount: number;
  depthReached: number;
  pages: DiscoveryPageView[];
  warnings: string[];
  skipped: Array<{ url: string; reason: string }>;
}

/** Paso tal y como se pinta en el panel (selector en sólo lectura). */
export interface ProposalStepView {
  action: string;
  selector: string | null;
  /** Texto de un `fill`, URL de un `goto`, tecla de un `press`, ms de un `wait`. */
  detail: string | null;
}

export interface PhaseProposalView {
  id: string;
  label: string;
  duration: number;
  script: string;
  url: string | null;
  steps: ProposalStepView[];
  /** Pasos originales: es lo que se reenvía a `savePhases` sin reinterpretarlo. */
  rawSteps: Array<Record<string, unknown>>;
}

export interface ProposalView {
  phases: PhaseProposalView[];
  warnings: string[];
  filePath: string;
}

export interface DiscoveryPanelPayload {
  discovery: DiscoveryView | null;
  proposal: ProposalView | null;
  /** Ya existe `mvc-config.json`: hay que confirmar antes de sobrescribir. */
  configExists: boolean;
  configPhaseCount: number;
  errors: string[];
}

/* ------------------------------------------------------------------ lectura */

function readJsonFile(filePath: string): { value: unknown; error: string | null; missing: boolean } {
  if (!fs.existsSync(filePath)) {
    return { value: null, error: null, missing: true };
  }

  try {
    return { value: JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown, error: null, missing: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { value: null, error: message, missing: false };
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/* -------------------------------------------------------------- inventario */

/** Convierte el `.mvc/discovery.json` (contrato fijo) en el resumen del panel. */
export function summarizeDiscovery(raw: unknown): DiscoveryView | null {
  const doc = asRecord(raw);
  if (!doc || !Array.isArray(doc.pages)) {
    return null;
  }

  const pages: DiscoveryPageView[] = [];

  for (const item of asArray(doc.pages)) {
    const page = asRecord(item);
    if (!page) {
      continue;
    }

    const actions: DiscoveryActionView[] = asArray(page.elements)
      .map(element => asRecord(element))
      .filter((element): element is Record<string, unknown> => element !== null)
      .map(element => ({
        kind: asString(element.kind, 'desconocido'),
        text: asString(element.text),
        selector: asString(element.selector),
        selectorStrategy: asString(element.selectorStrategy, 'css')
      }));

    const forms: DiscoveryFormView[] = asArray(page.forms)
      .map(form => asRecord(form))
      .filter((form): form is Record<string, unknown> => form !== null)
      .map(form => ({
        label: asString(form.label) || '(sin etiqueta)',
        fieldCount: asArray(form.fields).length
      }));

    const headings = asArray(page.headings)
      .map(heading => asRecord(heading))
      .filter((heading): heading is Record<string, unknown> => heading !== null);

    pages.push({
      path: asString(page.path) || asString(page.url) || '/',
      url: asString(page.url),
      title: asString(page.title),
      heading: headings.length > 0 ? asString(headings[0].text) : '',
      actionCount: actions.length,
      formCount: forms.length,
      statusCount: asArray(page.statusTexts).length,
      actions,
      forms
    });
  }

  const stats = asRecord(doc.stats) ?? {};
  const skipped = asArray(stats.skipped)
    .map(skip => asRecord(skip))
    .filter((skip): skip is Record<string, unknown> => skip !== null)
    .map(skip => ({ url: asString(skip.url), reason: asString(skip.reason, 'desconocido') }));

  const warnings = asArray(doc.warnings)
    .filter((warning): warning is string => typeof warning === 'string')
    .map(warning => warning.trim())
    .filter(warning => warning.length > 0);

  return {
    generatedAt: asString(doc.generatedAt),
    baseUrl: asString(doc.baseUrl),
    pageCount: typeof stats.pageCount === 'number' ? stats.pageCount : pages.length,
    actionCount: pages.reduce((total, page) => total + page.actionCount, 0),
    formCount: pages.reduce((total, page) => total + page.formCount, 0),
    depthReached: typeof stats.depthReached === 'number' ? stats.depthReached : 0,
    pages,
    warnings,
    skipped
  };
}

/* --------------------------------------------------------------- propuesta */

const STEP_STRING_KEYS = ['selector', 'text', 'url', 'key', 'waitUntil'] as const;
const STEP_NUMBER_KEYS = ['timeoutMs', 'ms'] as const;

/** Normaliza un paso: devuelve el original saneado y su vista de sólo lectura. */
function normalizeStep(raw: unknown): { raw: Record<string, unknown>; view: ProposalStepView } | null {
  const step = asRecord(raw);
  if (!step) {
    return null;
  }

  const action = asString(step.action);
  if (!action) {
    return null;
  }

  const clean: Record<string, unknown> = { action };

  for (const key of STEP_STRING_KEYS) {
    const value = asString(step[key]);
    if (value) {
      clean[key] = value;
    }
  }

  for (const key of STEP_NUMBER_KEYS) {
    const value = step[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      clean[key] = value;
    }
  }

  const detail =
    typeof clean.text === 'string'
      ? clean.text
      : typeof clean.url === 'string'
        ? clean.url
        : typeof clean.key === 'string'
          ? clean.key
          : typeof clean.ms === 'number'
            ? `${clean.ms} ms`
            : null;

  return {
    raw: clean,
    view: {
      action,
      selector: typeof clean.selector === 'string' ? clean.selector : null,
      detail
    }
  };
}

/** Localiza el array de fases en los formatos que puede escribir el convertidor. */
function findPhaseArray(raw: unknown): unknown[] | null {
  const doc = asRecord(raw);
  if (!doc) {
    return null;
  }

  if (Array.isArray(doc.phases)) {
    return doc.phases;
  }

  const project = asRecord(doc.project);
  if (project && Array.isArray(project.phases)) {
    return project.phases;
  }

  if (Array.isArray(doc.fases)) {
    return doc.fases;
  }

  const proposal = asRecord(doc.proposal) ?? asRecord(doc.borrador) ?? asRecord(doc.propuesta);
  if (proposal && Array.isArray(proposal.phases)) {
    return proposal.phases;
  }

  return null;
}

/**
 * Valida la propuesta de fases del convertidor.
 * Descarta fases sin `id`/`label` y sanea los pasos, pero NUNCA inventa ni
 * reescribe selectores: los que llegan del descubrimiento pasan tal cual.
 */
export function readProposal(raw: unknown): { phases: PhaseProposalView[]; warnings: string[] } {
  const source = findPhaseArray(raw);
  const warnings: string[] = [];

  if (!source) {
    if (raw !== null && raw !== undefined) {
      warnings.push('La propuesta de fases no tiene un array de fases reconocible.');
    }
    return { phases: [], warnings };
  }

  const phases: PhaseProposalView[] = [];
  const seen = new Set<string>();

  source.forEach((item, index) => {
    const phase = asRecord(item);

    if (!phase) {
      warnings.push(`Fase ${index + 1}: no es un objeto; se descarta.`);
      return;
    }

    const id = asString(phase.id);
    const label = asString(phase.label);

    if (!id) {
      warnings.push(`Fase ${index + 1}: sin id; se descarta.`);
      return;
    }
    if (!label) {
      warnings.push(`Fase ${id}: sin nombre; se descarta.`);
      return;
    }
    if (seen.has(id)) {
      warnings.push(`Fase ${id}: id repetido; se descarta la duplicada.`);
      return;
    }

    const duration = typeof phase.duration === 'number' && Number.isFinite(phase.duration) ? phase.duration : 0;

    if (duration <= 0) {
      warnings.push(`Fase ${id}: duración no válida; se guardará como 0 y el pipeline la rechazará hasta que la edites.`);
    }

    const steps: ProposalStepView[] = [];
    const rawSteps: Array<Record<string, unknown>> = [];

    asArray(phase.steps).forEach(step => {
      const normalized = normalizeStep(step);
      if (normalized) {
        steps.push(normalized.view);
        rawSteps.push(normalized.raw);
      }
    });

    if (rawSteps.length !== asArray(phase.steps).length) {
      warnings.push(`Fase ${id}: se han descartado pasos sin acción válida.`);
    }

    seen.add(id);
    phases.push({
      id,
      label,
      duration,
      script: asString(phase.script),
      url: asString(phase.url) || null,
      steps,
      rawSteps
    });
  });

  return { phases, warnings };
}

/** Payload exacto que espera el caso `savePhases` del host. */
export function phaseProposalToSavePayload(phases: PhaseProposalView[]): Array<Record<string, unknown>> {
  return phases.map(phase => ({
    id: phase.id,
    label: phase.label,
    duration: phase.duration,
    url: phase.url ?? undefined,
    script: phase.script,
    steps: phase.rawSteps
  }));
}

/* ------------------------------------------------------------------ payload */

/**
 * Genera `.mvc/mvc-config.borrador.json` a partir del inventario.
 *
 * Usa el convertidor (`discoveryToPhases` + `buildPhasesDraft`) y escribe SÓLO
 * el borrador: `mvc-config.json` nunca se toca desde aquí, ni siquiera si ya
 * existe. `base` conserva nombre/URL/variante del proyecto activo.
 */
export function writeProposalFromDiscovery(
  discovery: unknown,
  workspaceRoot: string,
  options: { base?: Partial<ProjectConfig> | null } = {}
): { filePath: string; phaseCount: number; warnings: string[] } {
  const source = asRecord(discovery);

  if (!source || !Array.isArray(source.pages)) {
    throw new Error('El descubrimiento no tiene el formato esperado (falta "pages").');
  }

  const proposal = discoveryToPhases(discovery as RawDiscovery);

  if (proposal.phases.length === 0) {
    return { filePath: '', phaseCount: 0, warnings: proposal.warnings };
  }

  const draft = buildPhasesDraft(proposal, {
    base: options.base ?? null,
    baseUrl: asString(source.baseUrl)
  });

  return {
    filePath: writePhasesDraft(workspaceRoot, draft),
    phaseCount: proposal.phases.length,
    warnings: proposal.warnings
  };
}

/**
 * Lee los artefactos del workspace y construye el payload del panel.
 * Nunca lanza: los problemas se devuelven en `errors` para que el panel los
 * muestre en lugar de quedarse en blanco.
 */
export function loadDiscoveryPanelPayload(outDir: string): DiscoveryPanelPayload {
  const mvcDir = path.join(outDir, '.mvc');
  const errors: string[] = [];

  const discoveryFile = path.join(mvcDir, DISCOVERY_FILE_NAME);
  const discoveryRead = readJsonFile(discoveryFile);
  let discovery: DiscoveryView | null = null;

  if (discoveryRead.missing) {
    errors.push(`No se encontró .mvc/${DISCOVERY_FILE_NAME}. Usa "Descubrir app" para generarlo.`);
  } else if (discoveryRead.error) {
    errors.push(`No se pudo leer .mvc/${DISCOVERY_FILE_NAME}: ${discoveryRead.error}`);
  } else {
    discovery = summarizeDiscovery(discoveryRead.value);
    if (!discovery) {
      errors.push(`El .mvc/${DISCOVERY_FILE_NAME} no tiene el formato esperado (falta "pages").`);
    }
  }

  const proposalFile = path.join(mvcDir, PROPOSAL_FILE_NAME);
  const proposalRead = readJsonFile(proposalFile);
  let proposal: ProposalView | null = null;

  if (proposalRead.error) {
    errors.push(`No se pudo leer .mvc/${PROPOSAL_FILE_NAME}: ${proposalRead.error}`);
  } else if (!proposalRead.missing) {
    const { phases, warnings } = readProposal(proposalRead.value);
    proposal = { phases, warnings, filePath: proposalFile };
  }

  const configFile = path.join(mvcDir, PROJECT_CONFIG_FILE_NAME);
  const configRead = readJsonFile(configFile);
  const configExists = !configRead.missing;
  const configDoc = configRead.value;
  const configPhases = findPhaseArray(configDoc) ?? [];

  return {
    discovery,
    proposal,
    configExists,
    configPhaseCount: configPhases.length,
    errors
  };
}
