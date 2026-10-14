/**
 * Gestión de configuración del proyecto de vídeo (acceso a disco + VS Code).
 *
 * El esquema y la normalización viven en `project-schema.ts` (sin VS Code) para
 * poder probarlos en Node puro; aquí sólo queda la lectura/escritura del fichero
 * del workspace.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ProjectConfig, ProjectConfigFile } from '../types/project-config';
import { CONFIG_VERSION, DEFAULT_PHASES, normalizePhases, validateProjectConfig } from './project-schema';
import { createLogger } from '../utils/logger';

export { CONFIG_VERSION, DEFAULT_PHASES, normalizePhases, parseCaptureSteps, validateProjectConfig } from './project-schema';

const logger = createLogger('project-config');
const CONFIG_FILE = 'mvc-config.json';

export function getConfigFilePath(workspaceFolder: vscode.WorkspaceFolder): string {
  return path.join(workspaceFolder.uri.fsPath, CONFIG_FILE);
}

export function loadProjectConfig(workspaceFolder: vscode.WorkspaceFolder): ProjectConfig | null {
  const configPath = getConfigFilePath(workspaceFolder);

  if (!fs.existsSync(configPath)) {
    logger.info('No se encontró mvc-config.json, se creará uno por defecto.');
    return null;
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(content) as ProjectConfigFile;

    if (parsed.version !== CONFIG_VERSION) {
      logger.warn('Versión de config no soportada: ' + parsed.version);
      return null;
    }

    const { phases, warnings } = normalizePhases(parsed.project?.phases);

    for (const warning of warnings) {
      logger.warn(warning);
    }

    return { ...parsed.project, phases };
  } catch (error) {
    logger.error('Error al cargar mvc-config.json:', error);
    return null;
  }
}

export function saveProjectConfig(workspaceFolder: vscode.WorkspaceFolder, config: ProjectConfig): boolean {
  const configPath = getConfigFilePath(workspaceFolder);
  const { phases, warnings } = normalizePhases(config.phases);

  for (const warning of warnings) {
    logger.warn(warning);
  }

  const file: ProjectConfigFile = {
    version: CONFIG_VERSION,
    project: { ...config, phases }
  };

  try {
    fs.writeFileSync(configPath, JSON.stringify(file, null, 2), 'utf-8');
    logger.info('Configuración guardada en ' + configPath);
    return true;
  } catch (error) {
    logger.error('Error al guardar mvc-config.json:', error);
    return false;
  }
}

export function createDefaultConfig(workspaceFolder: vscode.WorkspaceFolder, url: string): ProjectConfig {
  return createConfigFromSettings(workspaceFolder, url, []);
}

/**
 * Construye la configuración del proyecto a partir de los ajustes de la
 * extensión (`marketingVideoCreator.phases.list`), descartando entradas
 * inválidas y aplicando las fases por defecto si no queda ninguna.
 */
export function createConfigFromSettings(
  workspaceFolder: vscode.WorkspaceFolder,
  url: string,
  phases: Array<Record<string, unknown>>
): ProjectConfig {
  const { phases: mapped } = normalizePhases(phases);

  return {
    name: path.basename(workspaceFolder.uri.fsPath),
    url,
    phases: mapped.length > 0 ? mapped : DEFAULT_PHASES,
    outputDir: './output/demo-video',
    variant: 'desktop'
  };
}
