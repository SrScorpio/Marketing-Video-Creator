/**
 * Normalizador del descubrimiento (SSS-282).
 *
 * Convierte la estructura CRUDA que devuelve `crawlApp()` (ver `types.ts`) en:
 *   1. el JSON normalizado con el contrato fijo —`normalizeDiscovery()`—,
 *   2. el inventario legible en markdown —`renderDiscoveryMarkdown()`—,
 *   3. los dos artefactos en `.mvc/` —`writeDiscoveryArtifacts()`—.
 *
 * Reglas que aplica (y que fijan los tests de `test/discovery-normalizer.test.ts`):
 *   - Dedupe de elementos por selector; el primero gana salvo que no tenga texto
 *     y un duplicado sí (mismo control repetido por el lector de página).
 *   - Selectores inestables fuera: clases autogeneradas (`css-1x2y3z`, `sc-…`,
 *     `jsx-…`, hashes) y posicionales (`:nth-of-type`, `:nth-child`, `>`). Si el
 *     elemento tiene texto y un rol conocido, se REESCRIBE a `role=<rol>[name=…]`;
 *     si no hay alternativa, se descarta y se anota en `warnings`.
 *   - `selectorStrategy` se RECALCULA desde el selector: nunca se hereda del
 *     crudo. `css` queda sólo cuando no hay id/testid/aria-label/rol+nombre.
 *   - Rutas normalizadas (`/path[?query]`, sin hash, sin dobles barras, sin
 *     barra final), páginas ordenadas por path y duplicados descartados.
 *   - `stats.pageCount` se recalcula; `skipped` se deduplica y ordena.
 *   - La función es PURA: no muta la entrada y el reloj se inyecta (`now`).
 *
 * `normalizeDiscovery` NO escribe en disco: eso lo hace `writeDiscoveryArtifacts`
 * y sólo con `discovery.json` / `discovery.md`, sin tocar el resto de `.mvc/`.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  DiscoveryElement,
  DiscoveryField,
  DiscoveryForm,
  DiscoveryHeading,
  DiscoveryPage,
  ElementKind,
  RawDiscovery,
  SelectorStrategy,
  SkippedLink,
  SkipReason
} from './types';

/** El normalizador devuelve el MISMO contrato que el crawler, ya limpio. */
export type NormalizedDiscovery = RawDiscovery;

export interface NormalizeOptions {
  /** Reloj inyectable: sólo se usa si `generatedAt` falta o no es ISO-8601. */
  now?: () => Date;
}

export interface DiscoveryArtifacts {
  jsonPath: string;
  mdPath: string;
}

/** Nombres fijos de los dos artefactos: nunca se toca otro fichero de `.mvc/`. */
export const DISCOVERY_JSON_FILE = 'discovery.json';
export const DISCOVERY_MD_FILE = 'discovery.md';

const MAX_TEXT = 300;
const MAX_STATUS = 300;
const MAX_HEADINGS = 50;
const MAX_ELEMENTS = 200;
const MAX_FIELDS = 60;

const ELEMENT_KINDS: ElementKind[] = ['button', 'link', 'input', 'select', 'textarea', 'status'];
const SKIP_REASONS: SkipReason[] = ['externo', 'no-http', 'ancla', 'max-profundidad', 'max-paginas', 'error'];

const KIND_SET = new Set<string>(ELEMENT_KINDS);
const REASON_SET = new Set<string>(SKIP_REASONS);

/** Clases autogeneradas por CSS-in-JS / utilidades: cambian en cada build. */
const UNSTABLE_CLASS_PREFIX = /^(css-|sc-|jsx-|styled-|emotion-|chakra-|Mui|tw-|svelte-|v-)/;
/** Ids generados en runtime por librerías de UI (Radix, Headless UI, Ember…). */
const UNSTABLE_ID = /^(:r[0-9a-z]+:|radix-|react-|ember\d|mui-\d|headlessui-|downshift-)/i;
/** Selectores por posición: se rompen en cuanto cambia el orden del DOM. */
const POSITIONAL = /:(nth-child|nth-of-type|nth-last-child|nth-last-of-type|eq|first-child|last-child|first-of-type|last-of-type)\(/;
/** Selectores por subcadena de clase: no identifican un control concreto. */
const LOOSE_CLASS = /\[class[*^$|~]?=/;

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/* ------------------------------------------------------------------------- *
 * Helpers de texto y URL
 * ------------------------------------------------------------------------- */

function clean(value: unknown, max: number = MAX_TEXT): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function stripHash(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return url;
  }
}

/** Origen sin barra final: `http://app.test/#x` → `http://app.test`. */
function normalizeBaseUrl(url: string): string {
  const clean_ = clean(url, 600);
  if (!clean_) {
    return '';
  }
  try {
    const parsed = new URL(clean_);
    parsed.hash = '';
    if (parsed.pathname === '/' && !parsed.search) {
      return parsed.origin;
    }
    return stripHash(parsed.toString());
  } catch {
    return clean_;
  }
}

/** `pathname + search`, sin hash, con barra inicial y sin barra final. */
function normalizePath(rawPath: string, url: string): string {
  let value = clean(rawPath, 600);

  if (!value) {
    try {
      const parsed = new URL(url);
      value = `${parsed.pathname}${parsed.search}`;
    } catch {
      value = '/';
    }
  }

  value = value.replace(/#.*$/, '').replace(/\/{2,}/g, '/');
  if (!value.startsWith('/')) {
    value = `/${value}`;
  }
  if (value.length > 1 && value.endsWith('/')) {
    value = value.slice(0, -1);
  }
  return value;
}

function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function attrQuote(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/* ------------------------------------------------------------------------- *
 * Selectores
 * ------------------------------------------------------------------------- */

function isStableClassToken(token: string): boolean {
  if (!token || token.length > 40) {
    return false;
  }
  if (UNSTABLE_CLASS_PREFIX.test(token)) {
    return false;
  }
  // `foo-1a2b3c` / `a1b2c3d4` -> hash de CSS Modules o de compilador.
  if (/^[a-z]+-[a-z0-9]{6,}$/i.test(token) && /\d/.test(token)) {
    return false;
  }
  if (/^[a-z0-9]{8,}$/i.test(token) && /\d/.test(token)) {
    return false;
  }
  return /^[a-zA-Z][\w-]*$/.test(token);
}

function classTokens(selector: string): string[] {
  const withoutAttributes = selector.replace(/\[[^\]]*\]/g, ' ').replace(/(["'])(?:\\.|(?!\1).)*\1/g, ' ');
  const tokens: string[] = [];
  const matcher = /\.(-?[_a-zA-Z][\w-]*)/g;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(withoutAttributes)) !== null) {
    tokens.push(match[1]);
  }
  return tokens;
}

function idTokens(selector: string): string[] {
  const withoutAttributes = selector.replace(/\[[^\]]*\]/g, ' ');
  const tokens: string[] = [];
  const matcher = /#([^\s.#[\]:]+)/g;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(withoutAttributes)) !== null) {
    tokens.push(match[1]);
  }
  return tokens;
}

/**
 * ¿El selector depende de algo que cambia entre builds o entre renders?
 * (clase autogenerada, posición en el DOM o subcadena de clase)
 */
export function isUnstableSelector(selector: string): boolean {
  const value = clean(selector, 600);
  if (!value) {
    return true;
  }
  if (POSITIONAL.test(value) || LOOSE_CLASS.test(value)) {
    return true;
  }
  if (idTokens(value).some(token => UNSTABLE_ID.test(token))) {
    return true;
  }
  return classTokens(value).some(token => !isStableClassToken(token));
}

/** Estrategia REAL del selector; lo que diga el crudo se ignora. */
export function selectorStrategyOf(selector: string): SelectorStrategy {
  const value = clean(selector, 600);

  if (/^#[A-Za-z_][\w:.-]*$/.test(value) || /^\[id=/.test(value)) {
    return 'id';
  }
  if (/\[data-testid\s*=/.test(value)) {
    return 'data-testid';
  }
  if (/\[aria-label\s*=/.test(value)) {
    return 'aria-label';
  }
  if (/^role=/.test(value) || /\]\[role=/.test(value)) {
    return 'role+name';
  }
  return 'css';
}

function inferKind(selector: string): ElementKind {
  if (/^role=link/.test(selector)) {
    return 'link';
  }
  if (/^(a|area)[\s.#[]/.test(selector)) {
    return 'link';
  }
  if (/^input/.test(selector)) {
    return 'input';
  }
  if (/^select/.test(selector)) {
    return 'select';
  }
  if (/^textarea/.test(selector)) {
    return 'textarea';
  }
  return 'button';
}

function rewriteableRole(kind: ElementKind): string {
  if (kind === 'button') {
    return 'button';
  }
  if (kind === 'link') {
    return 'link';
  }
  return '';
}

/* ------------------------------------------------------------------------- *
 * Normalización de una página
 * ------------------------------------------------------------------------- */

interface PageCounters {
  discarded: number;
  rewritten: number;
  duplicates: number;
  unstableFields: number;
}

function normalizeHeading(raw: DiscoveryHeading): DiscoveryHeading | null {
  const text = clean(raw?.text, MAX_TEXT);
  if (!text) {
    return null;
  }
  const level = Math.floor(Number(raw?.level));
  return { level: Number.isFinite(level) ? Math.min(6, Math.max(1, level)) : 1, text };
}

function normalizeField(raw: DiscoveryField): DiscoveryField | null {
  const selector = clean(raw?.selector, 600);
  if (!selector) {
    return null;
  }
  return {
    label: clean(raw?.label, MAX_TEXT) || 'campo sin etiqueta',
    type: clean(raw?.type, 40).toLowerCase() || 'text',
    selector
  };
}

function normalizeForm(raw: DiscoveryForm, index: number): DiscoveryForm {
  const seen = new Set<string>();
  const fields: DiscoveryField[] = [];

  for (const rawField of Array.isArray(raw?.fields) ? raw.fields : []) {
    const field = normalizeField(rawField);
    if (!field || seen.has(field.selector) || fields.length >= MAX_FIELDS) {
      continue;
    }
    seen.add(field.selector);
    fields.push(field);
  }

  return {
    label: clean(raw?.label, MAX_TEXT) || `formulario ${index + 1}`,
    fields
  };
}

function normalizeElement(raw: DiscoveryElement, counters: PageCounters): DiscoveryElement | null {
  const originalSelector = clean(raw?.selector, 600);
  if (!originalSelector) {
    return null;
  }

  const text = clean(raw?.text, MAX_TEXT);
  const kind: ElementKind = KIND_SET.has(String(raw?.kind)) ? (raw.kind as ElementKind) : inferKind(originalSelector);
  const formLabel = clean(raw?.formLabel, MAX_TEXT) || null;

  if (isUnstableSelector(originalSelector)) {
    const role = rewriteableRole(kind);
    if (text && role) {
      counters.rewritten += 1;
      return {
        kind,
        text,
        selector: `role=${role}[name="${attrQuote(text)}"]`,
        selectorStrategy: 'role+name',
        formLabel
      };
    }
    counters.discarded += 1;
    return null;
  }

  return { kind, text, selector: originalSelector, selectorStrategy: selectorStrategyOf(originalSelector), formLabel };
}

function normalizePage(raw: DiscoveryPage, counters: PageCounters): DiscoveryPage {
  const url = stripHash(clean(raw?.url, 600));
  const pagePath = normalizePath(raw?.path, url);

  const headings: DiscoveryHeading[] = [];
  for (const item of Array.isArray(raw?.headings) ? raw.headings : []) {
    const heading = normalizeHeading(item);
    if (heading && headings.length < MAX_HEADINGS) {
      headings.push(heading);
    }
  }

  const elements: DiscoveryElement[] = [];
  const bySelector = new Map<string, number>();

  for (const item of Array.isArray(raw?.elements) ? raw.elements : []) {
    const element = normalizeElement(item, counters);
    if (!element) {
      continue;
    }

    const existing = bySelector.get(element.selector);
    if (existing !== undefined) {
      counters.duplicates += 1;
      // Mismo selector: gana el que aporta texto si el primero venía vacío.
      if (!elements[existing].text && element.text) {
        elements[existing] = { ...elements[existing], text: element.text, formLabel: elements[existing].formLabel ?? element.formLabel };
      }
      continue;
    }

    if (elements.length >= MAX_ELEMENTS) {
      continue;
    }
    bySelector.set(element.selector, elements.length);
    elements.push(element);
  }

  const forms: DiscoveryForm[] = [];
  const formsRaw = Array.isArray(raw?.forms) ? raw.forms : [];
  const seenForms = new Set<string>();
  for (const [index, item] of formsRaw.entries()) {
    const form = normalizeForm(item, index);
    const key = JSON.stringify(form);
    if (seenForms.has(key)) {
      continue;
    }
    seenForms.add(key);
    forms.push(form);
    for (const field of form.fields) {
      if (isUnstableSelector(field.selector)) {
        counters.unstableFields += 1;
      }
    }
  }

  const statusTexts: string[] = [];
  for (const item of Array.isArray(raw?.statusTexts) ? raw.statusTexts : []) {
    const text = clean(item, MAX_STATUS);
    if (text && !statusTexts.includes(text)) {
      statusTexts.push(text);
    }
  }

  return {
    url: url || pagePath,
    path: pagePath,
    title: clean(raw?.title, 200),
    headings,
    elements,
    forms,
    statusTexts
  };
}

function normalizeSkipped(entries: unknown): SkippedLink[] {
  const list = Array.isArray(entries) ? entries : [];
  const seen = new Set<string>();
  const result: SkippedLink[] = [];

  for (const entry of list) {
    const item = entry as Partial<SkippedLink> | undefined;
    const url = clean(item?.url, 600);
    if (!url) {
      continue;
    }
    const reason = REASON_SET.has(String(item?.reason)) ? (item?.reason as SkipReason) : 'error';
    const key = `${reason}|${url}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push({ url, reason });
  }

  return result.sort((left, right) => compareText(left.reason, right.reason) || compareText(left.url, right.url));
}

/**
 * Normaliza el inventario crudo del crawler. PURA: no muta `raw` y no escribe
 * en disco. El resultado cumple el contrato fijo de `types.ts`.
 */
export function normalizeDiscovery(raw: RawDiscovery, options: NormalizeOptions = {}): NormalizedDiscovery {
  const source = (raw ?? {}) as Partial<RawDiscovery>;
  const now = options.now ?? (() => new Date());
  const warnings: string[] = [];
  const seenWarnings = new Set<string>();

  const pushWarning = (warning: string): void => {
    if (!seenWarnings.has(warning)) {
      seenWarnings.add(warning);
      warnings.push(warning);
    }
  };

  for (const warning of Array.isArray(source.warnings) ? source.warnings : []) {
    const text = clean(warning, MAX_TEXT);
    if (text) {
      pushWarning(text);
    }
  }

  const pagesByPath = new Map<string, DiscoveryPage>();
  const rawPages = Array.isArray(source.pages) ? source.pages : [];
  const emptyCounters: PageCounters = { discarded: 0, rewritten: 0, duplicates: 0, unstableFields: 0 };

  for (const rawPage of rawPages) {
    const counters: PageCounters = { ...emptyCounters };
    const page = normalizePage(rawPage, counters);

    const duplicate = pagesByPath.get(page.path);
    if (duplicate) {
      pushWarning(`normalización: página duplicada descartada (${page.path}); se conserva "${duplicate.title || duplicate.url}".`);
      continue;
    }

    pagesByPath.set(page.path, page);

    if (counters.rewritten > 0) {
      pushWarning(
        `normalización: ${page.path} — ${counters.rewritten} selector(es) inestable(s) reescrito(s) a role+name.`
      );
    }
    if (counters.discarded > 0) {
      pushWarning(
        `normalización: ${page.path} — ${counters.discarded} elemento(s) descartado(s) por selector inestable sin alternativa.`
      );
    }
    if (counters.unstableFields > 0) {
      pushWarning(
        `normalización: ${page.path} — ${counters.unstableFields} campo(s) de formulario con selector inestable (revisar antes de grabar).`
      );
    }
  }

  const pages = Array.from(pagesByPath.values()).sort(
    (left, right) => compareText(left.path, right.path) || compareText(left.url, right.url)
  );

  const firstPageOrigin = (() => {
    const firstUrl = pages.find(page => page.url)?.url ?? '';
    try {
      return new URL(firstUrl).origin;
    } catch {
      return '';
    }
  })();

  const baseUrl = normalizeBaseUrl(source.baseUrl ?? '') || firstPageOrigin;
  const rawGeneratedAt = clean(source.generatedAt, 40);
  const generatedAt = ISO_8601.test(rawGeneratedAt) ? rawGeneratedAt : now().toISOString();

  const statsSource = (source.stats ?? {}) as Partial<RawDiscovery['stats']>;
  const rawDepth = Math.floor(Number(statsSource.depthReached));
  const depthReached = Number.isFinite(rawDepth) ? Math.max(0, rawDepth) : 0;

  return {
    generatedAt,
    baseUrl,
    pages,
    stats: {
      pageCount: pages.length,
      depthReached,
      skipped: normalizeSkipped(statsSource.skipped)
    },
    warnings
  };
}

/* ------------------------------------------------------------------------- *
 * Markdown
 * ------------------------------------------------------------------------- */

function mdCell(value: string): string {
  const text = String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ')
    .trim();
  return text || '—';
}

function mdCodeCell(value: string): string {
  const text = String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
  if (!text) {
    return '—';
  }
  if (text.includes('`')) {
    return `\`\` ${text} \`\``;
  }
  return `\`${text}\``;
}

function mdHeading(value: string): string {
  return String(value ?? '').replace(/\r?\n/g, ' ').trim();
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url || 'la app';
  }
}

/** Inventario legible: una sección por página con acciones, formularios y estados. */
export function renderDiscoveryMarkdown(doc: NormalizedDiscovery): string {
  const lines: string[] = [];
  const appName = hostOf(doc.baseUrl);

  lines.push(`# Descubrimiento de la app — ${mdHeading(appName)}`, '');
  lines.push(`- **Generado**: ${doc.generatedAt}`);
  lines.push(`- **URL base**: ${doc.baseUrl || '—'}`);
  lines.push(`- **Pantallas**: ${doc.pages.length}`);
  lines.push(`- **Profundidad alcanzada**: ${doc.stats.depthReached}`);
  lines.push(`- **Enlaces descartados**: ${doc.stats.skipped.length}`);
  lines.push(`- **Avisos**: ${doc.warnings.length}`);
  lines.push('');

  lines.push('## Índice', '');
  lines.push('| # | Pantalla | Ruta | Acciones | Formularios | Estados |');
  lines.push('|---|---|---|---|---|---|');
  for (const [index, page] of doc.pages.entries()) {
    lines.push(
      `| ${index + 1} | ${mdCell(page.title || '(sin título)')} | ${mdCodeCell(page.path)} | ${page.elements.length} | ${page.forms.length} | ${page.statusTexts.length} |`
    );
  }
  lines.push('');

  for (const [index, page] of doc.pages.entries()) {
    lines.push(`## ${index + 1}. ${mdHeading(page.title || page.path)}`, '');
    lines.push(`- **URL**: ${page.url || page.path}`);
    lines.push(
      `- **Encabezados**: ${
        page.headings.length > 0 ? page.headings.map(heading => `H${heading.level} ${heading.text}`).join(' · ') : '—'
      }`
    );
    lines.push('');

    lines.push('### Acciones', '');
    if (page.elements.length === 0) {
      lines.push('_Sin acciones inventariadas._', '');
    } else {
      lines.push('| Texto | Tipo | Selector | Estrategia | Formulario |');
      lines.push('|---|---|---|---|---|');
      for (const element of page.elements) {
        lines.push(
          `| ${mdCell(element.text)} | ${element.kind} | ${mdCodeCell(element.selector)} | ${element.selectorStrategy} | ${mdCell(
            element.formLabel ?? ''
          )} |`
        );
      }
      lines.push('');
    }

    lines.push('### Formularios', '');
    if (page.forms.length === 0) {
      lines.push('_Sin formularios._', '');
    } else {
      lines.push('| Formulario | Campo | Tipo | Selector |');
      lines.push('|---|---|---|---|');
      for (const form of page.forms) {
        if (form.fields.length === 0) {
          lines.push(`| ${mdCell(form.label)} | — | — | — |`);
          continue;
        }
        for (const field of form.fields) {
          lines.push(`| ${mdCell(form.label)} | ${mdCell(field.label)} | ${mdCell(field.type)} | ${mdCodeCell(field.selector)} |`);
        }
      }
      lines.push('');
    }

    lines.push('### Estados', '');
    if (page.statusTexts.length === 0) {
      lines.push('_Sin textos de estado._', '');
    } else {
      for (const text of page.statusTexts) {
        lines.push(`- ${text.replace(/\r?\n/g, ' ')}`);
      }
      lines.push('');
    }
  }

  lines.push('## Descartes', '');
  if (doc.stats.skipped.length === 0) {
    lines.push('_Ningún enlace descartado._', '');
  } else {
    lines.push('| URL | Motivo |');
    lines.push('|---|---|');
    for (const entry of doc.stats.skipped) {
      lines.push(`| ${mdCodeCell(entry.url)} | ${mdCell(entry.reason)} |`);
    }
    lines.push('');
  }

  lines.push('## Avisos', '');
  if (doc.warnings.length === 0) {
    lines.push('_Sin avisos._', '');
  } else {
    for (const warning of doc.warnings) {
      lines.push(`- ${warning.replace(/\r?\n/g, ' ')}`);
    }
    lines.push('');
  }

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

/* ------------------------------------------------------------------------- *
 * Persistencia
 * ------------------------------------------------------------------------- */

/** JSON estable (2 espacios, salto final) con las claves del contrato. */
export function serializeDiscoveryJson(doc: NormalizedDiscovery): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

let tmpCounter = 0;

function writeFileAtomic(target: string, content: string): void {
  const dir = path.dirname(target);
  const tmp = path.join(dir, `.tmp-${path.basename(target)}-${process.pid}-${tmpCounter++}`);

  try {
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, target);
  } catch (error) {
    try {
      if (fs.existsSync(tmp)) {
        fs.unlinkSync(tmp);
      }
    } catch {
      /* la limpieza no debe tapar el error real */
    }
    throw error;
  }
}

/**
 * Escribe `.mvc/discovery.json` y `.mvc/discovery.md` en `outDir` (normalmente
 * `<workspace>/.mvc`). Crea el directorio si falta y reemplaza SÓLO esos dos
 * artefactos: cualquier otro fichero de `.mvc/` (guion, prompts, config) queda
 * intacto. Cada fichero se escribe a un temporal y se renombra (sin dejar
 * restos a medias).
 */
export function writeDiscoveryArtifacts(doc: NormalizedDiscovery, outDir: string): DiscoveryArtifacts {
  const dir = path.resolve(outDir);
  fs.mkdirSync(dir, { recursive: true });

  const jsonPath = path.join(dir, DISCOVERY_JSON_FILE);
  const mdPath = path.join(dir, DISCOVERY_MD_FILE);

  writeFileAtomic(jsonPath, serializeDiscoveryJson(doc));
  writeFileAtomic(mdPath, renderDiscoveryMarkdown(doc));

  return { jsonPath, mdPath };
}
