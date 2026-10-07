/**
 * Gestión de configuración del proyecto de vídeo.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ProjectConfig, ProjectConfigFile } from '../types/project-config';
import { isValidUrl, isValidPhaseId, isValidDuration } from '../utils/validators';
import { createLogger } from '../utils/logger';

const logger = createLogger('project-config');
const CONFIG_FILE = 'mvc-config.json';
const CONFIG_VERSION = '1.0.0';

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

    return parsed.project;
  } catch (error) {
    logger.error('Error al cargar mvc-config.json:', error);
    return null;
  }
}

export function saveProjectConfig(workspaceFolder: vscode.WorkspaceFolder, config: ProjectConfig): boolean {
  const configPath = getConfigFilePath(workspaceFolder);
  const file: ProjectConfigFile = {
    version: CONFIG_VERSION,
    project: config
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
  return {
    name: path.basename(workspaceFolder.uri.fsPath),
    url,
    phases: [],
    outputDir: './output/demo-video',
    variant: 'desktop'
  };
}

export function validateProjectConfig(config: ProjectConfig): string[] {
  const errors: string[] = [];

  if (!isValidUrl(config.url)) {
    errors.push('URL inválida: ' + config.url);
  }

  for (const phase of config.phases) {
    if (!isValidPhaseId(phase.id)) {
      errors.push('ID de fase inválido: ' + phase.id);
    }
    if (!isValidDuration(phase.duration)) {
      errors.push('Duración inválida para fase ' + phase.id + ': ' + phase.duration + 's');
    }
  }

  return errors;
}
