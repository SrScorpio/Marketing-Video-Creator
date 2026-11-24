/**
 * Persistencia del borrador de fases propuesto por el convertidor (SSS-282).
 *
 * Dos artefactos y dos niveles de riesgo:
 *   1. `.mvc/mvc-config.borrador.json` — SIEMPRE se escribe: es una propuesta,
 *      no configuración activa, y vive dentro de `.mvc/` (ignorado por git).
 *   2. `mvc-config.json` — NUNCA se escribe de forma automática. Sólo lo toca
 *      `applyPhasesDraftToProjectConfig` cuando el llamante demuestra que el
 *      usuario ha confirmado (`confirm()` resuelve `true`); la escritura usa el
 *      mismo serializador y la misma escritura atómica que `savePhases`.
 *
 * Sin dependencias de VS Code: el diálogo modal lo inyecta la extensión, así que
 * la garantía «sin confirmación no se toca el fichero» se prueba en vitest.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ProjectConfig, ProjectConfigFile } from '../types/project-config';
import { CONFIG_VERSION, normalizePhases, validateProjectConfig } from '../config/project-schema';
import {
  PROJECT_CONFIG_FILE,
  fileHash,
  readProjectConfigFile,
  writeProjectConfigFile
} from '../config/config-file';
import { PhaseConfig } from '../types/phase';
import { PhaseProposal } from './phases-proposer';
import { DISCOVERY_JSON_FILE } from './normalizer';
import { RawDiscovery } from './types';

/** Nombre fijo del borrador: el pipeline nunca lo lee como configuración activa. */
export const PHASES_DRAFT_FILE = 'mvc-config.borrador.json';

export interface DraftOptions {
  /** Proyecto activo del workspace: se conservan nombre, URL, salida y variante. */
  base?: Partial<ProjectConfig> | null;
  /** URL de arranque del descubrimiento, si aún no hay `mvc-config.json`. */
  baseUrl?: string;
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Construye el borrador con la MISMA forma que `mvc-config.json` (versión +
 * proyecto), de modo que pueda compararse, revisarse y aplicarse sin traducción.
 */
export function buildPhasesDraft(proposal: PhaseProposal, options: DraftOptions = {}): ProjectConfigFile {
  const base = options.base ?? {};
  const variant = base.variant === 'mobile' || base.variant === 'both' ? base.variant : 'desktop';

  const project: ProjectConfig = {
    name: clean(base.name) || 'demo',
    url: clean(base.url) || clean(options.baseUrl),
    phases: proposal.phases,
    outputDir: clean(base.outputDir) || './output/demo-video',
    variant
  };

  return { version: CONFIG_VERSION, project };
}

/** Ruta del borrador dentro de `.mvc/`. */
export function phasesDraftPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.mvc', PHASES_DRAFT_FILE);
}

/** Ruta del inventario que escribe el descubrimiento. */
export function discoveryPathOf(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.mvc', DISCOVERY_JSON_FILE);
}

/**
 * Escribe SÓLO el borrador (crea `.mvc/` si hace falta). Nunca toca
 * `mvc-config.json`, `discovery.*` ni el resto de `.mvc/`.
 */
export function writePhasesDraft(workspaceRoot: string, draft: ProjectConfigFile): string {
  const outDir = path.dirname(phasesDraftPath(workspaceRoot));
  fs.mkdirSync(outDir, { recursive: true });

  const target = phasesDraftPath(workspaceRoot);
  if (!writeProjectConfigFile(target, draft.project)) {
    throw new Error(`No se pudo escribir el borrador de fases en ${target}.`);
  }
  return target;
}

/**
 * Lee y valida el inventario del descubrimiento. Los errores dicen qué hacer
 * (volver a lanzar el descubrimiento), no un ENOENT crudo.
 */
export function readDiscoveryDoc(discoveryPath: string): RawDiscovery {
  let text: string;

  try {
    text = fs.readFileSync(discoveryPath, 'utf-8');
  } catch {
    throw new Error(
      `No se pudo leer ${DISCOVERY_JSON_FILE}: ejecuta antes «Marketing Video Creator: Descubrir app».`
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`${DISCOVERY_JSON_FILE} no es JSON válido; vuelve a lanzar el descubrimiento.`);
  }

  const candidate = raw as Partial<RawDiscovery> | null;
  if (!candidate || typeof candidate !== 'object' || !Array.isArray(candidate.pages)) {
    throw new Error(`${DISCOVERY_JSON_FILE} no tiene el contrato esperado (falta pages[]); vuelve a lanzar el descubrimiento.`);
  }

  if (typeof candidate.baseUrl !== 'string') {
    throw new Error(`${DISCOVERY_JSON_FILE} no tiene baseUrl; vuelve a lanzar el descubrimiento.`);
  }

  return candidate as RawDiscovery;
}

export type ApplyDraftReason = 'applied' | 'cancelled' | 'invalid-phases' | 'invalid-config' | 'write-failed';

export interface ApplyDraftResult {
  applied: boolean;
  reason: ApplyDraftReason;
  configPath: string;
  /** Hash del `mvc-config.json` antes de pedir confirmación (null si no existía). */
  hashBefore: string | null;
  /** Hash al terminar: igual a `hashBefore` si no se escribió nada. */
  hashAfter: string | null;
  phases: PhaseConfig[];
  warnings: string[];
}

/**
 * Aplica el borrador a `mvc-config.json` SÓLO con confirmación explícita.
 *
 * Orden deliberado: se validan las fases ANTES de preguntar (un borrador roto no
 * llega a molestar al usuario) y no se escribe nada hasta que `confirm()`
 * resuelve `true`. La escritura reutiliza el serializador y la escritura atómica
 * del caso `savePhases` del panel.
 */
export async function applyPhasesDraftToProjectConfig(options: {
  workspaceRoot: string;
  draft: ProjectConfigFile;
  confirm: () => Promise<boolean>;
}): Promise<ApplyDraftResult> {
  const configPath = path.join(options.workspaceRoot, PROJECT_CONFIG_FILE);
  const hashBefore = fileHash(configPath);
  const { phases, warnings } = normalizePhases(options.draft?.project?.phases);

  if (phases.length === 0) {
    return { applied: false, reason: 'invalid-phases', configPath, hashBefore, hashAfter: hashBefore, phases, warnings };
  }

  const confirmed = await options.confirm();

  if (!confirmed) {
    return { applied: false, reason: 'cancelled', configPath, hashBefore, hashAfter: fileHash(configPath), phases, warnings };
  }

  const existing = readProjectConfigFile(configPath);
  const project: ProjectConfig = { ...(existing ?? options.draft.project), phases };
  const errors = validateProjectConfig(project);

  if (errors.length > 0) {
    warnings.push(...errors);
    return { applied: false, reason: 'invalid-config', configPath, hashBefore, hashAfter: fileHash(configPath), phases, warnings };
  }

  const written = writeProjectConfigFile(configPath, project);

  return {
    applied: written,
    reason: written ? 'applied' : 'write-failed',
    configPath,
    hashBefore,
    hashAfter: fileHash(configPath),
    phases,
    warnings
  };
}
