/**
 * Descubrimiento automático de pantallas (SSS-282): punto de entrada.
 *
 * Esta tarea expone SÓLO el crawler y su contrato crudo. La persistencia a
 * `.mvc/discovery.json` / `.mvc/discovery.md`, la normalización y la conversión
 * a fases son tareas aparte.
 */

export * from './types';
export {
  assertStorageStateOutsideRepo,
  canonicalUrl,
  clampLimits,
  classifyLink,
  crawlApp,
  isDestructiveAction,
  isSameOrigin,
  originOf,
  pathOf
} from './crawler';
export type { LinkDecision } from './crawler';
export { readPageForInventory } from './page-reader';
