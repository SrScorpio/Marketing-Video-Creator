/**
 * Crawler de descubrimiento de pantallas (Playwright, modo SÓLO LECTURA).
 *
 * Reglas duras:
 *   - Mismo origen estricto: se descarta cualquier URL con distinto
 *     protocolo+host+puerto que la URL inicial.
 *   - No se pulsa nada: ni `click`, ni `fill`, ni `press`, ni `submit`. Sólo
 *     `goto` a enlaces ya presentes y lectura del DOM.
 *   - No se siguen enlaces externos, `mailto:`, `tel:` ni anclas `#`.
 *   - Respeta `maxDepth` (profundidad de enlaces) y `maxPages` (páginas leídas).
 *   - Un fallo por página (timeout, 401/403) NO aborta el crawl: se anota en
 *     `warnings` y se sigue.
 *   - `storageState` (sesión autenticada) sólo se lee y debe vivir FUERA del
 *     repositorio: contiene cookies de sesión.
 *
 * La salida es el CONTRATO FIJO descrito en `types.ts`.
 */

import { chromium, Browser, BrowserContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../utils/logger';
import { readPageForInventory } from './page-reader';
import {
  CrawlOptions,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_PAGES,
  DiscoveryPage,
  DiscoveryStats,
  DiscoveryForm,
  MAX_DEPTH_LIMIT,
  MAX_PAGES_LIMIT,
  RawDiscovery,
  RawPageSnapshot,
  SkippedLink,
  SkipReason
} from './types';

const logger = createLogger('discovery');

/** Heurística de acción peligrosa. El crawler NUNCA pulsa, pero la usan las
 *  fases posteriores para no grabar clics destructivos o de pago. */
const DESTRUCTIVE_PATTERN = /(pagar|comprar|borrar|eliminar|delete|pay|checkout|subscribe|suscrib)/i;

export interface LinkDecision {
  action: 'enqueue' | 'skip';
  url: string;
  reason?: SkipReason;
}

interface QueueItem {
  url: string;
  depth: number;
}

export function clampLimits(maxDepth?: number, maxPages?: number): { maxDepth: number; maxPages: number } {
  const depth = Number.isFinite(maxDepth)
    ? Math.max(0, Math.min(MAX_DEPTH_LIMIT, Math.floor(maxDepth as number)))
    : DEFAULT_MAX_DEPTH;
  const pages = Number.isFinite(maxPages)
    ? Math.max(1, Math.min(MAX_PAGES_LIMIT, Math.floor(maxPages as number)))
    : DEFAULT_MAX_PAGES;

  return { maxDepth: depth, maxPages: pages };
}

/** Origen exacto (protocolo+host+puerto) o null si no es http/https. */
export function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

export function isSameOrigin(url: string, origin: string): boolean {
  return originOf(url) === origin;
}

/** Quita el hash: `#seccion` no es una pantalla distinta. */
export function canonicalUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return url;
  }
}

/** path + query, para el campo `path` del contrato. */
export function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

export function isDestructiveAction(text: string): boolean {
  return DESTRUCTIVE_PATTERN.test(String(text ?? ''));
}

/**
 * Decide qué hacer con un enlace encontrado en una pantalla. Orden:
 * no-http → ancla → externo → misma página → profundidad.
 */
export function classifyLink(
  href: string,
  currentUrl: string,
  origin: string,
  nextDepth: number,
  maxDepth: number
): LinkDecision {
  const raw = String(href ?? '').trim();

  if (!raw) {
    return { action: 'skip', url: '', reason: 'no-http' };
  }

  if (/^(mailto:|tel:|javascript:|data:|blob:)/i.test(raw)) {
    return { action: 'skip', url: raw, reason: 'no-http' };
  }

  if (raw.startsWith('#')) {
    return { action: 'skip', url: raw, reason: 'ancla' };
  }

  let absolute: string;
  try {
    absolute = new URL(raw, currentUrl).toString();
  } catch {
    return { action: 'skip', url: raw, reason: 'no-http' };
  }

  if (!originOf(absolute)) {
    return { action: 'skip', url: absolute, reason: 'no-http' };
  }

  if (!isSameOrigin(absolute, origin)) {
    return { action: 'skip', url: absolute, reason: 'externo' };
  }

  const canonical = canonicalUrl(absolute);
  if (canonical === canonicalUrl(currentUrl)) {
    return { action: 'skip', url: canonical, reason: 'ancla' };
  }

  if (nextDepth > maxDepth) {
    return { action: 'skip', url: canonical, reason: 'max-profundidad' };
  }

  return { action: 'enqueue', url: canonical };
}

/**
 * Rechaza un storageState que viva dentro del repositorio. Contiene cookies de
 * sesión: sólo puede leerse desde una ruta externa.
 */
export function assertStorageStateOutsideRepo(storageStatePath: string, repoRoot?: string): void {
  const resolved = path.resolve(storageStatePath);

  if (!fs.existsSync(resolved)) {
    throw new Error(
      `No existe el storageState indicado (${storageStatePath}). Exporta la sesión con "npx playwright codegen --save-storage=<ruta fuera del repo>" y vuelve a intentarlo.`
    );
  }

  if (!repoRoot) {
    return;
  }

  const root = path.resolve(repoRoot);
  const relative = path.relative(root, resolved);
  const inside = relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));

  if (inside) {
    throw new Error(
      `El storageState (${storageStatePath}) está dentro del repositorio. Contiene cookies de sesión: guárdalo fuera del repo (por ejemplo en ~/.mvc/storageState.json) y vuelve a intentarlo.`
    );
  }
}

/**
 * Recorre la app desde `options.url` y devuelve el inventario crudo.
 *
 * Nunca lanza por una página que falla: la anota en `stats.skipped`/`warnings`
 * y sigue con el resto.
 */
export async function crawlApp(options: CrawlOptions): Promise<RawDiscovery> {
  const startUrl = options.url?.trim() ?? '';
  const origin = originOf(startUrl);

  if (!origin) {
    throw new Error(`URL no válida para descubrir: "${startUrl}" (se requiere http o https).`);
  }

  const storageStatePath = options.storageStatePath?.trim();
  if (storageStatePath) {
    assertStorageStateOutsideRepo(storageStatePath, options.repoRoot);
  }

  const { maxDepth, maxPages } = clampLimits(options.maxDepth, options.maxPages);
  const timeout = options.timeoutMs ?? 15000;
  const now = options.now ?? (() => new Date());
  const warnings: string[] = [];
  const skipped: SkippedLink[] = [];
  const pages: DiscoveryPage[] = [];
  const visited = new Set<string>();
  const queue: QueueItem[] = [{ url: canonicalUrl(startUrl), depth: 0 }];
  visited.add(canonicalUrl(startUrl));

  let depthReached = 0;

  logger.info(
    `Descubrimiento en ${canonicalUrl(startUrl)} (maxDepth=${maxDepth}, maxPages=${maxPages}${storageStatePath ? ', con sesión' : ''})`
  );

  const browser: Browser = await chromium.launch({
    headless: options.headless ?? true,
    executablePath: options.executablePath?.trim() || undefined
  });

  let context: BrowserContext | undefined;

  try {
    context = await browser.newContext({
      viewport: options.viewport ?? { width: 1440, height: 900 },
      ...(storageStatePath ? { storageState: storageStatePath } : {})
    });
    context.setDefaultTimeout(timeout);
    context.setDefaultNavigationTimeout(timeout);

    while (queue.length > 0) {
      if (options.isCancelled?.()) {
        warnings.push('Descubrimiento cancelado por el usuario.');
        logger.info('Descubrimiento cancelado por el usuario.');
        break;
      }

      if (pages.length >= maxPages) {
        for (const pending of queue.splice(0, queue.length)) {
          skipped.push({ url: pending.url, reason: 'max-paginas' });
        }
        break;
      }

      const item = queue.shift() as QueueItem;
      const page = await context.newPage();
      let snapshot: RawPageSnapshot | null = null;
      let pageUrl = item.url;

      try {
        logger.info(`Leyendo (profundidad ${item.depth}) ${item.url}`);
        const response = await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout });
        const status = response?.status() ?? 0;

        if (status === 401 || status === 403) {
          warnings.push(`La pantalla respondió HTTP ${status}: ${item.url} (se inventaría lo que haya y se sigue).`);
        } else if (status >= 400) {
          warnings.push(`La pantalla respondió HTTP ${status}: ${item.url} (se inventaría lo que haya y se sigue).`);
        }

        // Un respiro para que la app pinte datos asíncronos: sólo espera, no actúa.
        await page.waitForTimeout(150);

        pageUrl = page.url() || item.url;
        snapshot = (await page.evaluate(readPageForInventory, { baseUrl: pageUrl })) as RawPageSnapshot;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const short = message.split('\n')[0].slice(0, 200);
        warnings.push(`No se pudo leer ${item.url}: ${short}`);
        logger.warn(`Página no legible: ${item.url} — ${short}`);
        skipped.push({ url: item.url, reason: 'error' });
      } finally {
        await page.close().catch(() => undefined);
      }

      if (!snapshot) {
        continue;
      }

      const pageDepth = item.depth;
      depthReached = Math.max(depthReached, pageDepth);

      const discoveryPage: DiscoveryPage = {
        url: canonicalUrl(pageUrl),
        path: pathOf(pageUrl),
        title: snapshot.title,
        headings: snapshot.headings,
        elements: snapshot.elements,
        forms: snapshot.forms as DiscoveryForm[],
        statusTexts: snapshot.statusTexts
      };

      pages.push(discoveryPage);
      options.onPage?.(discoveryPage, {
        index: pages.length,
        url: discoveryPage.url,
        title: discoveryPage.title,
        queued: queue.length
      });

      for (const target of snapshot.linkTargets) {
        const decision = classifyLink(target, pageUrl, origin, pageDepth + 1, maxDepth);

        if (decision.action === 'skip') {
          if (decision.url) {
            skipped.push({ url: decision.url, reason: decision.reason as SkipReason });
          }
          continue;
        }

        if (visited.has(decision.url)) {
          continue;
        }

        if (pages.length + queue.length >= maxPages) {
          skipped.push({ url: decision.url, reason: 'max-paginas' });
          continue;
        }

        visited.add(decision.url);
        queue.push({ url: decision.url, depth: pageDepth + 1 });
      }
    }
  } finally {
    await context?.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }

  const stats: DiscoveryStats = {
    pageCount: pages.length,
    depthReached,
    skipped: dedupeSkipped(skipped)
  };

  const doc: RawDiscovery = {
    generatedAt: now().toISOString(),
    baseUrl: canonicalUrl(startUrl),
    pages,
    stats,
    warnings
  };

  logger.info(
    `Descubrimiento terminado: ${stats.pageCount} página(s), profundidad ${stats.depthReached}, ${stats.skipped.length} descartada(s), ${warnings.length} aviso(s).`
  );

  return doc;
}

function dedupeSkipped(entries: SkippedLink[]): SkippedLink[] {
  const seen = new Set<string>();
  const result: SkippedLink[] = [];

  for (const entry of entries) {
    const key = `${entry.reason}|${entry.url}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(entry);
  }

  return result;
}
