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
export {
  DISCOVERY_JSON_FILE,
  DISCOVERY_MD_FILE,
  isUnstableSelector,
  normalizeDiscovery,
  renderDiscoveryMarkdown,
  selectorStrategyOf,
  serializeDiscoveryJson,
  writeDiscoveryArtifacts
} from './normalizer';
export type { DiscoveryArtifacts, NormalizedDiscovery, NormalizeOptions } from './normalizer';
