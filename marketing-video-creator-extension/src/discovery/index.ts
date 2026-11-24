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
export { DEFAULT_FIRST_DURATION, DEFAULT_MAX_PHASES, DEFAULT_PHASE_DURATION, DRAFT_SCRIPT_MARKER, discoveryToPhases, pageLabel, slugify } from './phases-proposer';
export type { PhaseProposal, ProposeOptions } from './phases-proposer';
export {
  PHASES_DRAFT_FILE,
  applyPhasesDraftToProjectConfig,
  buildPhasesDraft,
  discoveryPathOf,
  phasesDraftPath,
  readDiscoveryDoc,
  writePhasesDraft
} from './phases-draft';
export type { ApplyDraftReason, ApplyDraftResult, DraftOptions } from './phases-draft';
export {
  DISCOVERY_FILE_NAME,
  PROPOSAL_FILE_NAME,
  PROJECT_CONFIG_FILE_NAME,
  loadDiscoveryPanelPayload,
  phaseProposalToSavePayload,
  readProposal,
  summarizeDiscovery,
  writeProposalFromDiscovery
} from './panel-model';
export type {
  DiscoveryActionView,
  DiscoveryFormView,
  DiscoveryPageView,
  DiscoveryPanelPayload,
  DiscoveryView,
  PhaseProposalView,
  ProposalStepView,
  ProposalView
} from './panel-model';
