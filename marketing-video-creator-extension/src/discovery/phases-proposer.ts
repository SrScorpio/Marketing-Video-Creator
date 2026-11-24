/**
 * Convertidor `discovery` → borrador de fases (SSS-282).
 *
 * Función PURA (sin IO, sin navegador, sin VS Code): recibe el inventario fijo
 * que escribe el normalizador y devuelve fases con la forma que ya consume el
 * pipeline (`id/label/duration/url/script/steps`, ver `types/phase.ts`).
 *
 * Reglas de seguridad del borrador:
 *   - Sólo se usan selectores OBSERVADOS en la app (nada inventado); los pasos
 *     de navegación usan la URL real de la página del inventario.
 *   - Nunca se pulsa una acción sensible (pagar/comprar/borrar/eliminar/…) ni
 *     nada dentro de un formulario. Por defecto no se pulsa NADA: el borrador
 *     navega y espera, y lista las acciones seguras para que el agente decida.
 *   - El guion lleva un marcador `[borrador]` explícito: quien lo lea sabe que
 *     la narración hay que pulirla, no grabarla tal cual.
 */

import { CaptureStep, PhaseConfig } from '../types/phase';
import { isValidDuration, isValidPhaseId } from '../utils/validators';
import { isDestructiveAction } from './destructive';
import { isUnstableSelector } from './normalizer';
import { DiscoveryElement, DiscoveryPage, RawDiscovery, SelectorStrategy } from './types';

export interface ProposeOptions {
  /** Máximo de fases propuestas (una por pantalla). Default 10. */
  maxPhases?: number;
  /** Duración de cada fase a partir de la primera, en segundos. Default 8. */
  duration?: number;
  /** Duración de la fase de apertura, en segundos. Default 5. */
  firstDuration?: number;
  /**
   * Añadir un `click` sobre una acción segura observada (nunca sensible, nunca
   * dentro de un formulario). Desactivado por defecto: un borrador no debe
   * ejecutar acciones de la app del usuario sin que se pida expresamente.
   */
  includeSafeClicks?: boolean;
}

export interface PhaseProposal {
  phases: PhaseConfig[];
  warnings: string[];
}

/** Marcador del guion: se sustituye al pulir la narración. */
export const DRAFT_SCRIPT_MARKER = '[borrador]';

export const DEFAULT_MAX_PHASES = 10;
export const DEFAULT_PHASE_DURATION = 8;
export const DEFAULT_FIRST_DURATION = 5;
/** Margen tras navegar/esperar para que se vea la pantalla en el vídeo. */
export const STEP_SETTLE_MS = 800;
export const GUARD_TIMEOUT_MS = 15000;

/** Estrategias que el normalizador garantiza estables entre builds. */
const STABLE_STRATEGIES: SelectorStrategy[] = ['id', 'data-testid', 'aria-label', 'role+name'];
const MAX_SCRIPT_HEADING = 60;
const MAX_SCRIPT_EXAMPLES = 4;
const MAX_WARNING_NAMES = 5;

const ACCENTS = /[\u0300-\u036f]/g;

/** `Crear Ficha — Gestión` → `crear-ficha-gestion` (id válido de fase). */
export function slugify(value: string, maxLength: number = 28): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(ACCENTS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
}

function clean(value: unknown, max: number): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

/** Etiqueta legible de la pantalla: encabezado, título o último tramo del path. */
export function pageLabel(page: DiscoveryPage): string {
  const heading = page.headings.find(item => clean(item.text, MAX_SCRIPT_HEADING).length > 0);
  if (heading) {
    return clean(heading.text, MAX_SCRIPT_HEADING);
  }

  const title = clean(page.title, MAX_SCRIPT_HEADING);
  if (title) {
    return title;
  }

  const segment = clean(page.path, 300)
    .split('/')
    .filter(Boolean)
    .slice(-1)[0];

  return segment ? segment.replace(/[-_]+/g, ' ').replace(/\.[a-z0-9]+$/i, '') : 'inicio';
}

/**
 * Path relativo de la URL de arranque del crawl: con él se decide qué pantalla
 * abre la demo (el inventario viene ordenado por path, no por orden de visita).
 */
function entryPath(baseUrl: string): string | null {
  try {
    const parsed = new URL(baseUrl);
    const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

/** La pantalla de arranque primero; el resto conserva el orden del inventario. */
function orderPages(pages: DiscoveryPage[], baseUrl: string): DiscoveryPage[] {
  const entry = entryPath(baseUrl);
  if (!entry) {
    return [...pages];
  }

  const index = pages.findIndex(page => page.path === entry);
  if (index <= 0) {
    return [...pages];
  }

  return [pages[index], ...pages.slice(0, index), ...pages.slice(index + 1)];
}

/** Primer control estable que sirve de guarda («esta pantalla ya cargó»). */
function guardElement(page: DiscoveryPage): DiscoveryElement | null {
  const candidates = page.elements.filter(element => element.kind !== 'status' && element.selector);
  const stable = candidates.find(element => STABLE_STRATEGIES.includes(element.selectorStrategy));
  return stable ?? candidates[0] ?? null;
}

/**
 * Acción segura para un clic de demostración: botón con selector estable, texto
 * no destructivo y FUERA de un formulario (nunca envía datos).
 */
function safeClickCandidate(page: DiscoveryPage): DiscoveryElement | null {
  return (
    page.elements.find(
      element =>
        element.kind === 'button' &&
        element.formLabel === null &&
        STABLE_STRATEGIES.includes(element.selectorStrategy) &&
        clean(element.text, 200).length > 0 &&
        !isDestructiveAction(element.text)
    ) ?? null
  );
}

function fieldLabels(page: DiscoveryPage): string[] {
  return unique(
    page.forms
      .flatMap(form => form.fields.map(field => clean(field.label, 80)))
      .filter(label => label.length > 0 && label !== 'campo sin etiqueta')
  );
}

/** Guion borrador en el idioma del proyecto (es), con marcador de revisión. */
function buildScript(page: DiscoveryPage, label: string, index: number, total: number): string {
  const position =
    index === 0
      ? `Abre la demo en «${label}»`
      : `Continúa la demo en «${label}»`;

  const parts: string[] = [`${position} (pantalla ${index + 1} de ${total}).`];

  const subheading = page.headings.slice(1).find(item => clean(item.text, MAX_SCRIPT_HEADING).length > 0);
  if (subheading) {
    parts.push(`Sección «${clean(subheading.text, MAX_SCRIPT_HEADING)}».`);
  }

  const labels = fieldLabels(page);
  if (labels.length > 0) {
    parts.push(`La pantalla pide ${labels.length} dato(s): ${labels.slice(0, MAX_SCRIPT_EXAMPLES).join(', ')}.`);
  }

  if (page.elements.length > 0) {
    parts.push(`Ofrece ${page.elements.length} control(es) para recorrer la app.`);
  } else {
    parts.push('Pantalla sin controles: cuenta aquí lo que muestra.');
  }

  if (page.statusTexts.length > 0) {
    parts.push(`Estado visible: «${clean(page.statusTexts[0], 120)}».`);
  }

  parts.push(
    `${DRAFT_SCRIPT_MARKER} Sustituye este texto por la narración real: qué resuelve esta pantalla y por qué le importa al usuario.`
  );

  return parts.join(' ');
}

function resolveDuration(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && isValidDuration(value) ? value : fallback;
}

function phaseId(index: number, label: string, used: Set<string>): string {
  let base = slugify(label);

  if (!base || !isValidPhaseId(base)) {
    base = `pantalla-${index + 1}`;
  }

  let id = `${String(index + 1).padStart(2, '0')}-${base}`;
  let suffix = 2;
  while (used.has(id)) {
    id = `${String(index + 1).padStart(2, '0')}-${base}-${suffix++}`;
  }
  used.add(id);
  return id;
}

/**
 * Propone fases ejecutables a partir del inventario normalizado. Nunca escribe
 * en disco: el llamante decide si guarda el borrador y si lo aplica con
 * confirmación explícita.
 */
export function discoveryToPhases(discovery: RawDiscovery, options: ProposeOptions = {}): PhaseProposal {
  const warnings: string[] = [];
  const maxPhases = Math.max(1, Math.floor(options.maxPhases ?? DEFAULT_MAX_PHASES));
  const duration = resolveDuration(options.duration, DEFAULT_PHASE_DURATION);
  const firstDuration = resolveDuration(options.firstDuration, DEFAULT_FIRST_DURATION);
  const includeClicks = options.includeSafeClicks ?? false;

  const pages = Array.isArray(discovery?.pages) ? discovery.pages : [];
  const ordered = orderPages(pages, discovery?.baseUrl ?? '');
  const selected = ordered.slice(0, maxPhases);

  if (ordered.length > selected.length) {
    warnings.push(
      `Se han omitido ${ordered.length - selected.length} pantalla(s): el borrador propone como máximo ${maxPhases} fases (ajústalo en el inventario o sube el límite).`
    );
  }

  const used = new Set<string>();
  const phases: PhaseConfig[] = [];

  selected.forEach((page, index) => {
    const label = pageLabel(page);
    const steps: CaptureStep[] = [];

    // Navegación declarada con la URL OBSERVADA (la primera fase ya arranca en
    // su `url`, que el pipeline usa para abrir el navegador).
    if (index > 0) {
      steps.push({ action: 'goto', url: page.url, waitUntil: 'load' });
    }

    const guard = guardElement(page);
    if (guard) {
      steps.push({ action: 'waitForSelector', selector: guard.selector, timeoutMs: GUARD_TIMEOUT_MS });
      if (guard.selectorStrategy === 'css') {
        warnings.push(
          `Pantalla «${label}»: el selector de espera es css (${guard.selector}); revísalo si la pantalla cambia de estructura.`
        );
      }
    } else if (page.elements.length === 0) {
      warnings.push(`Pantalla «${label}»: no se observaron controles; el borrador no puede esperar ningún selector.`);
    } else {
      warnings.push(`Pantalla «${label}»: sólo se observaron textos de estado; no se usa guarda de espera.`);
    }

    if (includeClicks) {
      const candidate = safeClickCandidate(page);
      if (candidate) {
        steps.push({ action: 'click', selector: candidate.selector });
      }
    } else {
      const safe = unique(
        page.elements
          .filter(
            element =>
              element.kind === 'button' &&
              element.formLabel === null &&
              STABLE_STRATEGIES.includes(element.selectorStrategy) &&
              clean(element.text, 200).length > 0 &&
              !isDestructiveAction(element.text)
          )
          .map(element => clean(element.text, 60))
      ).slice(0, MAX_WARNING_NAMES);

      if (safe.length > 0) {
        warnings.push(
          `Pantalla «${label}»: acciones seguras que el borrador NO pulsa (añádelas a mano si quieres mostrarlas): ${safe.join(', ')}.`
        );
      }
    }

    steps.push({ action: 'wait', ms: STEP_SETTLE_MS });

    const risky = unique(
      page.elements.filter(element => isDestructiveAction(element.text)).map(element => clean(element.text, 60))
    ).slice(0, MAX_WARNING_NAMES);

    if (risky.length > 0) {
      warnings.push(
        `Pantalla «${label}»: acciones sensibles detectadas y NUNCA pulsadas en el borrador: ${risky.join(', ')}.`
      );
    }

    const unstableFields = page.forms
      .flatMap(form => form.fields)
      .filter(field => field.selector && isUnstableSelector(field.selector));

    if (unstableFields.length > 0) {
      warnings.push(
        `Pantalla «${label}»: ${unstableFields.length} campo(s) de formulario con selector inestable; revísalos antes de añadir pasos fill.`
      );
    }

    phases.push({
      id: phaseId(index, label, used),
      label,
      duration: index === 0 ? firstDuration : duration,
      url: page.url,
      script: buildScript(page, label, index, selected.length),
      steps
    });
  });

  if (phases.length === 0) {
    warnings.push('El inventario no contiene páginas: no hay fases que proponer.');
  }

  return { phases, warnings };
}
