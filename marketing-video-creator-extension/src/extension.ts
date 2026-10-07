/**
 * Marketing Video Creator - VS Code Extension
 * Entry point principal.
 */

import * as vscode from 'vscode';
import { createLogger } from './utils/logger';
import { getExtensionSettings } from './config/extension-settings';
import { loadProjectConfig, saveProjectConfig, createDefaultConfig, validateProjectConfig } from './config/project-config';
import { PhaseManager } from './services/phase-manager';

const logger = createLogger('extension');

let phaseManager: PhaseManager | null = null;

export function activate(context: vscode.ExtensionContext) {
  logger.info('Marketing Video Creator activada');

  // Registrar comandos
  const startDemoCmd = vscode.commands.registerCommand(
    'marketing-video-creator.startDemo',
    async () => {
      await handleStartDemo(context);
    }
  );

  const openPanelCmd = vscode.commands.registerCommand(
    'marketing-video-creator.openPanel',
    async () => {
      await handleOpenPanel(context);
    }
  );

  const exportMobileCmd = vscode.commands.registerCommand(
    'marketing-video-creator.exportMobile',
    async () => {
      await handleExportMobile(context);
    }
  );

  context.subscriptions.push(startDemoCmd, openPanelCmd, exportMobileCmd);
}

export function deactivate() {
  logger.info('Marketing Video Creator desactivada');
}

async function handleStartDemo(context: vscode.ExtensionContext): Promise<void> {
  const settings = getExtensionSettings();

  // Verificar API Key
  if (!settings.apiKey && settings.nanBuildersEnabled) {
    vscode.window.showErrorMessage(
      'Marketing Video Creator: API Key no configurada. Configúrala en settings.json.'
    );
    return;
  }

  // Obtener workspace
  const workspace = vscode.workspace.workspaceFolders?.[0];
  if (!workspace) {
    vscode.window.showErrorMessage('Marketing Video Creator: Abre un workspace primero.');
    return;
  }

  // Cargar o crear config
  let config = loadProjectConfig(workspace);
  if (!config) {
    const url = await vscode.window.showInputBox({
      prompt: 'Introduce la URL de la app a demostrar',
      placeHolder: 'https://ejemplo.com'
    });

    if (!url) return;

    config = createDefaultConfig(workspace, url);
    saveProjectConfig(workspace, config);
  }

  // Validar config
  const errors = validateProjectConfig(config);
  if (errors.length > 0) {
    vscode.window.showErrorMessage(
      `Configuración inválida:\n${errors.join('\n')}`
    );
    return;
  }

  // Iniciar PhaseManager
  phaseManager = new PhaseManager(config.outputDir);
  phaseManager.setPhases(
    config.phases.map(p => ({
      id: p.id,
      label: p.label,
      duration: p.duration,
      script: ''
    }))
  );

  // Abrir panel
  await handleOpenPanel(context);

  // Iniciar captura
  vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Marketing Video Creator: Capturando demo...',
      cancellable: true
    },
    async (progress, token) => {
      token.onCancellationRequested(() => {
        phaseManager && phaseManager['capture'].close();
      });

      try {
        await phaseManager!.runAll();
        vscode.window.showInformationMessage('Marketing Video Creator: Demo completada.');
      } catch (error) {
        vscode.window.showErrorMessage(
          `Marketing Video Creator: Error: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );
}

async function handleOpenPanel(context: vscode.ExtensionContext): Promise<void> {
  const panel = vscode.window.createWebviewPanel(
    'marketingVideoCreatorPanel',
    'Marketing Video Creator',
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true
    }
  );

  // Contenido HTML del panel
  panel.webview.html = getWebviewContent(panel.webview, context.extensionUri);

  // Mensajes del webview
  panel.webview.onDidReceiveMessage(
    async (message) => {
      switch (message.type) {
        case 'getConfig':
          panel.webview.postMessage({
            type: 'config',
            data: getExtensionSettings()
          });
          break;

        case 'saveConfig':
          // TODO: Guardar configuración
          break;

        case 'startCapture':
          if (phaseManager) {
            await phaseManager!.runAll();
            panel.webview.postMessage({ type: 'progress', data: phaseManager.getStates() });
          }
          break;

        case 'buildVideo':
          if (phaseManager) {
            const outputPath = await phaseManager.buildFinalVideo();
            panel.webview.postMessage({ type: 'videoReady', data: { path: outputPath } });
          }
          break;
      }
    }
  );
}

async function handleExportMobile(context: vscode.ExtensionContext): Promise<void> {
  if (!phaseManager) {
    vscode.window.showErrorMessage('Marketing Video Creator: No hay fases configuradas.');
    return;
  }

  vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Marketing Video Creator: Exportando mobile...',
      cancellable: false
    },
    async (progress) => {
      try {
        const outputPath = await phaseManager!.buildMobileVideo();
        vscode.window.showInformationMessage(
          `Marketing Video Creator: Vídeo mobile exportado a ${outputPath}`
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          `Marketing Video Creator: Error: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );
}

function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script type="module" crossorigin src="${webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist/panel/index.js'))}"></script>
</head>
<body>
  <div id="root"></div>
</body>
</html>`;
}


