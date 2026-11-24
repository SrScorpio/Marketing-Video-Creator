/**
 * IO del fichero de configuración del proyecto (`mvc-config.json`), sin
 * dependencias de VS Code.
 *
 * Vive aparte de `project-config.ts` porque hay más de un camino que escribe el
 * fichero (el panel con `savePhases` y el convertidor de descubrimiento tras la
 * confirmación explícita) y ambos deben serializar y escribir EXACTAMENTE igual:
 * un único serializador y una única escritura atómica (temporal + rename).
 */

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { ProjectConfig, ProjectConfigFile } from '../types/project-config';
import { CONFIG_VERSION } from './project-schema';

/** Nombre fijo del fichero de configuración del workspace. */
export const PROJECT_CONFIG_FILE = 'mvc-config.json';

export function buildProjectConfigFile(project: ProjectConfig): ProjectConfigFile {
  return { version: CONFIG_VERSION, project };
}

function isProjectConfigFile(value: unknown): value is ProjectConfigFile {
  const candidate = value as ProjectConfigFile | null;
  return !!candidate && typeof candidate === 'object' && candidate.version === CONFIG_VERSION && !!candidate.project;
}

/** JSON con el formato estable que ya consume el pipeline (2 espacios). */
export function serializeProjectConfigFile(project: ProjectConfig): string {
  return JSON.stringify(buildProjectConfigFile(project), null, 2);
}

/**
 * Lee el proyecto TAL CUAL está en disco (sin normalizar fases). Devuelve
 * `null` si no existe, no es JSON o la versión no es la soportada.
 */
export function readProjectConfigFile(configPath: string): ProjectConfig | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return isProjectConfigFile(parsed) ? parsed.project : null;
  } catch {
    return null;
  }
}

/**
 * Escribe el fichero de configuración con temporal + rename en el mismo
 * directorio: si algo falla no queda un `mvc-config.json` a medias.
 */
export function writeProjectConfigFile(configPath: string, project: ProjectConfig): boolean {
  const temporary = path.join(
    path.dirname(configPath),
    `.${path.basename(configPath)}.tmp-${process.pid}-${Date.now()}`
  );

  try {
    fs.writeFileSync(temporary, serializeProjectConfigFile(project), 'utf-8');
    fs.renameSync(temporary, configPath);
    return true;
  } catch {
    try {
      if (fs.existsSync(temporary)) {
        fs.unlinkSync(temporary);
      }
    } catch {
      // Sin restos garantizados: si tampoco se puede limpiar, no hay nada más que hacer.
    }
    return false;
  }
}

/** SHA-256 del fichero (null si no existe): sirve para probar que no se tocó. */
export function fileHash(filePath: string): string | null {
  try {
    return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch {
    return null;
  }
}
