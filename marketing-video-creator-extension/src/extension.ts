/**
 * Marketing Video Creator - VS Code Extension
 * Entry point: comandos, panel webview y puente con el pipeline.
 */

import * as vscode from 'vscode';
import { getExtensionSettings, ExtensionSettings } from './config/extension-settings';
import {
  createConfigFromSettings,
  loadProjectConfig,
  saveProjectConfig,
  validateProjectConfig
} from './config/project-config';
import { PhaseManager } from './services/phase-manager';
import { PhaseProgress } from './types/phase';
import { createLogger } from './utils/logger';

const logger = createLogger('extension');

let currentPanel: vscode.WebviewPanel | undefined;
let phaseManager: PhaseManager | undefined;
let lastProgress: PhaseProgress = { status: 'idle', progress: 0, phases: [] };
let extensionUri: vscode.Uri | undefined;

export function activate(context: vscode.ExtensionContext): void {
  extensionUri = context.extensionUri;
  logger.info('Marketing Video Creator activada');

  context.subscriptions.push(
    vscode.commands.registerCommand('marketing-video-creator.startDemo', () => handleStartDemo()),
    vscode.commands.registerCommand('marketing-video-creator.openPanel', () => handleOpenPanel()),
    vscode.commands.registerCommand('marketing-video-creator.cancelDemo', () => handleCancel()),
    vscode.commands.registerCommand('marketing-video-creator.exportMobile', () => handleExport('mobile')),
    vscode.commands.registerCommand('marketing-video-creator.exportDesktop', () => handleExport('desktop')),
    vscode.commands.registerCommand('marketing-video-creator.openOutputFolder', () => handleOpenOutputFolder())
  );
}

export function deactivate(): void {
  currentPanel?.dispose();
  logger.info('Marketing Video Creator desactivada');
}

/** Crea (o reutiliza) el PhaseManager a partir de la configuración del proyecto. */
async function ensurePhaseManager(): Promise<PhaseManager> {
  const workspace = vscode.workspace.workspaceFolders?.[0];
  if (!workspace) {
    throw new Error('Abre una carpeta de workspace antes de generar vídeos.');
  }

  const settings = getExtensionSettings();
  let config = loadProjectConfig(workspace);

  if (!config) {
    const url = await vscode.window.showInputBox({
      prompt: 'Introduce la URL de la app a demostrar',
      placeHolder: 'https://ejemplo.com'
    });

    if (!url) {
      throw new Error('Operación cancelada: se necesita una URL de la app.');
    }

    config = createConfigFromSettings(workspace, url, settings.phasesList);
    saveProjectConfig(workspace, config);
  }

  const errors = validateProjectConfig(config);
  if (errors.length > 0) {
    throw new Error(`Configuración inválida: ${errors.join('; ')}`);
  }

  const outputDir = resolveOutputDir(workspace.uri.fsPath, config.outputDir);

  phaseManager = new PhaseManager({
    outputDir,
    projectUrl: config.url,
    variant: config.variant === 'mobile' ? 'mobile' : 'desktop',
    headless: settings.playwrightHeadless,
    desktopCanvas: { width: settings.variantDesktopWidth, height: settings.variantDesktopHeight, fps: settings.playwrightFps },
    mobileCanvas: { width: settings.variantMobileWidth, height: settings.variantMobileHeight, fps: settings.playwrightFps },
    capture: undefined,
    tts: undefined,
    ffmpeg: undefined
  });

  phaseManager.setPhases(
    config.phases.map(phase => ({
      id: phase.id,
      label: phase.label,
      duration: phase.duration,
      script: ''
    }))
  );

  phaseManager.on('state', progress => {
    lastProgress = progress;
    postToPanel({ type: 'state', data: progress });
  });

  phaseManager.on('log', message => {
    postToPanel({ type: 'log', data: message });
  });

  return phaseManager;
}

function resolveOutputDir(workspacePath: string, configured: string): string {
  return configured.startsWith('.') ? vscode.Uri.joinPath(vscode.Uri.file(workspacePath), configured).fsPath : configured;
}

async function handleStartDemo(): Promise<void> {
  try {
    const manager = await ensurePhaseManager();
    await handleOpenPanel();

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Marketing Video Creator: capturando demo...',
        cancellable: true
      },
      async (progress, token) => {
        token.onCancellationRequested(() => {
          void manager.cancel();
        });

        const snapshot = await manager.runAll();

        const failed = snapshot.phases.filter(phase => phase.status === 'error');
        const done = snapshot.phases.filter(phase => phase.status === 'done');

        if (failed.length > 0) {
          vscode.window.showWarningMessage(
            `Marketing Video Creator: ${done.length} fase(s) completadas, ${failed.length} con error. Revisa el panel de progreso.`
          );
        } else {
          vscode.window.showInformationMessage(
            `Marketing Video Creator: ${done.length} fase(s) capturadas. Usa "Montar vídeo" para generar el MP4.`
          );
        }

        progress.report({ increment: 100 });
      }
    );
  } catch (error) {
    reportError(error);
  }
}

async function handleCancel(): Promise<void> {
  if (!phaseManager || !phaseManager.isRunning) {
    vscode.window.showInformationMessage('Marketing Video Creator: no hay ninguna captura en curso.');
    return;
  }

  await phaseManager.cancel();
  vscode.window.showInformationMessage('Marketing Video Creator: captura cancelada.');
}

async function handleExport(variant: 'mobile' | 'desktop'): Promise<void> {
  if (!phaseManager) {
    vscode.window.showErrorMessage('Marketing Video Creator: ejecuta primero "Iniciar demo".');
    return;
  }

  const manager = phaseManager;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Marketing Video Creator: exportando variante ${variant}...`,
      cancellable: false
    },
    async () => {
      try {
        const outputPath =
          variant === 'mobile' ? await manager.buildMobileVideo() : await manager.buildDesktopVideo();
        postToPanel({ type: 'videoReady', data: { path: outputPath, variant } });
        vscode.window
          .showInformationMessage(`Vídeo ${variant} generado: ${outputPath}`, 'Abrir carpeta')
          .then(selection => {
            if (selection === 'Abrir carpeta') {
              void vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(outputPath));
            }
          });
      } catch (error) {
        reportError(error);
      }
    }
  );
}

async function handleOpenOutputFolder(): Promise<void> {
  if (!phaseManager) {
    vscode.window.showInformationMessage('Marketing Video Creator: todavía no hay carpeta de salida.');
    return;
  }

  await vscode.commands.executeCommand(
    'revealFileInOS',
    vscode.Uri.file(phaseManager.outputDirectory)
  );
}

async function handleOpenPanel(): Promise<void> {
  if (currentPanel) {
    currentPanel.reveal(vscode.ViewColumn.One);
    postToPanel({ type: 'state', data: lastProgress });
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    'marketingVideoCreatorPanel',
    'Marketing Video Creator',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [extensionUri!] }
  );

  currentPanel = panel;
  panel.webview.html = getWebviewContent(panel.webview, extensionUri!);

  panel.webview.onDidReceiveMessage(message => {
    void handleWebviewMessage(message);
  });

  panel.onDidDispose(() => {
    currentPanel = undefined;
  });
}

async function handleWebviewMessage(message: { type: string; data?: unknown }): Promise<void> {
  try {
    switch (message.type) {
      case 'ready':
      case 'getConfig': {
        const settings = getExtensionSettings();
        const workspace = vscode.workspace.workspaceFolders?.[0];
        const project = workspace ? loadProjectConfig(workspace) : null;

        postToPanel({
          type: 'settings',
          data: {
            settings,
            project,
            progress: lastProgress,
            running: phaseManager?.isRunning ?? false
          }
        });
        break;
      }

      case 'saveConfig': {
        const payload = (message.data ?? {}) as Partial<ExtensionSettings> & { url?: string };

        await saveSettingsToWorkspace(payload);

        if (payload.url) {
          const workspace = vscode.workspace.workspaceFolders?.[0];
          if (workspace) {
            const config = loadProjectConfig(workspace) ?? createConfigFromSettings(workspace, payload.url, []);
            config.url = payload.url;
            saveProjectConfig(workspace, config);
          }
        }

        postToPanel({ type: 'log', data: 'Configuración guardada.' });
        break;
      }

      case 'startCapture': {
        await handleStartDemo();
        break;
      }

      case 'cancel': {
        await handleCancel();
        break;
      }

      case 'buildVideo': {
        if (!phaseManager) {
          postToPanel({ type: 'log', data: 'Ejecuta primero la captura.' });
          break;
        }
        const outputPath = await phaseManager.buildFinalVideo();
        postToPanel({ type: 'videoReady', data: { path: outputPath, variant: 'desktop' } });
        break;
      }

      case 'exportMobile': {
        await handleExport('mobile');
        break;
      }

      case 'exportDesktop': {
        await handleExport('desktop');
        break;
      }

      case 'openOutputFolder': {
        await handleOpenOutputFolder();
        break;
      }

      default:
        logger.warn(`Mensaje de webview no reconocido: ${message.type}`);
    }
  } catch (error) {
    reportError(error);
  }
}

/**
 * Persiste la configuración editable desde el panel.
 *
 * La API Key se guarda SIEMPRE en la configuración de usuario (Global) para no
 * acabar dentro del settings.json del repositorio.
 */
async function saveSettingsToWorkspace(payload: Record<string, unknown>): Promise<void> {
  const configuration = vscode.workspace.getConfiguration('marketingVideoCreator');
  const workspace = vscode.ConfigurationTarget.Workspace;

  const updates: Array<{ key: string; value: unknown; target: vscode.ConfigurationTarget }> = [];

  if (typeof payload.apiKey === 'string') {
    updates.push({ key: 'apiKey', value: payload.apiKey, target: vscode.ConfigurationTarget.Global });
  }
  if (typeof payload.ttsProvider === 'string') {
    updates.push({ key: 'tts.provider', value: payload.ttsProvider, target: workspace });
  }
  if (typeof payload.ttsVoice === 'string') {
    updates.push({ key: 'tts.voice', value: payload.ttsVoice, target: workspace });
  }
  if (typeof payload.headless === 'boolean') {
    updates.push({ key: 'playwright.headless', value: payload.headless, target: workspace });
  }

  for (const update of updates) {
    await configuration.update(update.key, update.value, update.target);
    logger.debug(`Configuración actualizada: ${update.key}`);
  }
}

function postToPanel(message: { type: string; data: unknown }): void {
  currentPanel?.webview.postMessage(message);
}

function reportError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(message);
  postToPanel({ type: 'log', data: `Error: ${message}` });
  vscode.window.showErrorMessage(`Marketing Video Creator: ${message}`);
}

function getWebviewContent(webview: vscode.Webview, uri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(uri, 'dist', 'panel', 'index.js'));
  const nonce = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Marketing Video Creator</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
