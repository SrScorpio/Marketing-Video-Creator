/**
 * Tipos del descubrimiento automático de pantallas (SSS-282).
 *
 * CONTRATO FIJO: `crawlApp()` devuelve exactamente esta estructura. Otras
 * tareas (normalizador, panel, convertidor a fases) la consumen tal cual, así
 * que cualquier campo nuevo aquí rompe a los consumidores: no añadir campos
 * fuera del contrato sin actualizar el contrato en la issue.
 *
 *   {
 *     generatedAt, baseUrl,
 *     pages: [{ url, path, title, headings, elements, forms, statusTexts }],
 *     stats: { pageCount, depthReached, skipped },
 *     warnings
 *   }
 */

/** Estrategia del selector, en orden de preferencia (la primera disponible gana). */
export type SelectorStrategy = 'id' | 'data-testid' | 'aria-label' | 'role+name' | 'css';

/** Tipo de control inventariado. */
export type ElementKind = 'button' | 'link' | 'input' | 'select' | 'textarea' | 'status';

/** Motivo por el que una URL no se visitó. */
export type SkipReason =
  | 'externo'
  | 'no-http'
  | 'ancla'
  | 'max-profundidad'
  | 'max-paginas'
  | 'error';

export interface DiscoveryHeading {
  level: number;
  text: string;
}

export interface DiscoveryElement {
  kind: ElementKind;
  /** Texto visible (recortado) o aria-label si el elemento no tiene texto. */
  text: string;
  /** Selector listo para Playwright. */
  selector: string;
  selectorStrategy: SelectorStrategy;
  /** Etiqueta del formulario que contiene el elemento (null si vive fuera). */
  formLabel: string | null;
}

export interface DiscoveryField {
  label: string;
  /** type del input o tag del control (`select`, `textarea`). */
  type: string;
  selector: string;
}

export interface DiscoveryForm {
  label: string;
  fields: DiscoveryField[];
}

export interface DiscoveryPage {
  url: string;
  /** pathname + search de la URL. */
  path: string;
  title: string;
  headings: DiscoveryHeading[];
  elements: DiscoveryElement[];
  forms: DiscoveryForm[];
  statusTexts: string[];
}

export interface SkippedLink {
  url: string;
  reason: SkipReason;
}

export interface DiscoveryStats {
  pageCount: number;
  depthReached: number;
  skipped: SkippedLink[];
}

/** Estructura cruda que devuelve el crawler (y que persiste otra tarea). */
export interface RawDiscovery {
  /** ISO-8601 */
  generatedAt: string;
  baseUrl: string;
  pages: DiscoveryPage[];
  stats: DiscoveryStats;
  warnings: string[];
}

/**
 * Instantánea interna de una pantalla. `elements`/`forms`/`statusTexts` van tal
 * cual al contrato; `linkTargets` se usa sólo para el BFS y NO se publica.
 */
export interface RawPageSnapshot {
  url: string;
  title: string;
  headings: DiscoveryHeading[];
  elements: DiscoveryElement[];
  forms: DiscoveryForm[];
  statusTexts: string[];
  linkTargets: string[];
}

export interface CrawlProgress {
  index: number;
  url: string;
  title: string;
  queued: number;
}

export interface CrawlOptions {
  /** URL inicial (http/https). */
  url: string;
  /** Profundidad máxima de enlaces (0 = sólo la URL inicial). Default 2. */
  maxDepth?: number;
  /** Número máximo de páginas leídas. Default 15. */
  maxPages?: number;
  headless?: boolean;
  timeoutMs?: number;
  /** storageState de Playwright con sesión ya autenticada (siempre FUERA del repo). */
  storageStatePath?: string;
  /** Raíz del repositorio: sirve para rechazar un storageState dentro de él. */
  repoRoot?: string;
  /** Navegador alternativo al Chromium de Playwright (p. ej. chrome del sistema). */
  executablePath?: string;
  viewport?: { width: number; height: number };
  /** Reloj inyectable (tests deterministas). */
  now?: () => Date;
  onPage?: (page: DiscoveryPage, progress: CrawlProgress) => void;
  isCancelled?: () => boolean;
}

export const DEFAULT_MAX_DEPTH = 2;
export const DEFAULT_MAX_PAGES = 15;
export const MAX_DEPTH_LIMIT = 10;
export const MAX_PAGES_LIMIT = 100;
