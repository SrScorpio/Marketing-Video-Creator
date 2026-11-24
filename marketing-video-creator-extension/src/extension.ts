/**
 * Marketing Video Creator - VS Code Extension
 * Entry point: comandos, panel webview y puente con el pipeline.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';
import { chromium } from '@playwright/test';
import { getExtensionSettings, ExtensionSettings } from './config/extension-settings';
import {
  createConfigFromSettings,
  loadProjectConfig,
  normalizePhases,
  saveProjectConfig,
  validateProjectConfig
} from './config/project-config';
import { PhaseManager } from './services/phase-manager';
import {
  applyPhasesDraftToProjectConfig,
  buildPhasesDraft,
  crawlApp,
  discoveryPathOf,
  discoveryToPhases,
  normalizeDiscovery,
  RawDiscovery,
  readDiscoveryDoc,
  writeDiscoveryArtifacts,
  writePhasesDraft
} from './discovery';

import { createPipelineServices } from './config/pipeline-services';
import { PROMPT_ENTRY_FILE, PROMPT_PACK } from './prompts/prompt-pack';
import {
  RequirementCheck,
  checkRequirements,
  formatRequirement,
  summarizeRequirements
} from './services/requirements';
import { FfmpegBuilder } from './services/ffmpeg-builder';
import { PhaseProgress } from './types/phase';
import { createLogger } from './utils/logger';

const logger = createLogger('extension');

let currentPanel: vscode.WebviewPanel | undefined;
let phaseManager: PhaseManager | undefined;
let lastProgress: PhaseProgress = { status: 'idle', progress: 0, phases: [] };
let extensionUri: vscode.Uri | undefined;
let discoveryChannel: vscode.OutputChannel | undefined;

export function activate(context: vscode.ExtensionContext): void {
  extensionUri = context.extensionUri;
  logger.info('Marketing Video Creator activada');

  context.subscriptions.push(
    vscode.commands.registerCommand('marketing-video-creator.startDemo', () => handleStartDemo()),
    vscode.commands.registerCommand('marketing-video-creator.openPanel', () => handleOpenPanel()),
    vscode.commands.registerCommand('marketing-video-creator.cancelDemo', () => handleCancel()),
    vscode.commands.registerCommand('marketing-video-creator.exportMobile', () => handleExport('mobile')),
    vscode.commands.registerCommand('marketing-video-creator.exportDesktop', () => handleExport('desktop')),
    vscode.commands.registerCommand('marketing-video-creator.openOutputFolder', () => handleOpenOutputFolder()),
    vscode.commands.registerCommand('marketing-video-creator.createPromptPack', () => handleCreatePromptPack()),
    vscode.commands.registerCommand('marketing-video-creator.checkRequirements', () => handleCheckRequirements()),
    vscode.commands.registerCommand('marketing-video-creator.discoverApp', () => handleDiscoverApp()),
    vscode.commands.registerCommand('marketing-video-creator.proposePhases', () => handleProposePhases())
  );
}

export function deactivate(): void {
  currentPanel?.dispose();
  discoveryChannel?.dispose();
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
  const services = createPipelineServices(settings);

  phaseManager = new PhaseManager({
    outputDir,
    projectUrl: config.url,
    variant: config.variant === 'mobile' ? 'mobile' : 'desktop',
    headless: settings.playwrightHeadless,
    desktopCanvas: { width: settings.variantDesktopWidth, height: settings.variantDesktopHeight, fps: settings.playwrightFps },
    mobileCanvas: { width: settings.variantMobileWidth, height: settings.variantMobileHeight, fps: settings.playwrightFps },
    capture: services.capture,
    tts: services.tts,
    ffmpeg: services.ffmpeg
  });

  phaseManager.setPhases(
    config.phases.map(phase => ({
      id: phase.id,
      label: phase.label,
      duration: phase.duration,
      url: phase.url,
      script: phase.script ?? '',
      steps: phase.steps
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
    if (!(await ensureRequirements('captura'))) {
      return;
    }

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

  if (!(await ensureRequirements('montaje'))) {
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

/**
 * Escribe el pack de prompts en el workspace (`.mvc/prompts/`) y abre el índice.
 * No sobreescribe nada existente: si el usuario ya editó un prompt, se respeta.
 */
async function handleCreatePromptPack(): Promise<void> {
  const workspace = vscode.workspace.workspaceFolders?.[0];

  if (!workspace) {
    void vscode.window.showErrorMessage('Abre una carpeta de workspace para crear el pack de prompts.');
    return;
  }

  const creados: string[] = [];
  const existentes: string[] = [];

  for (const file of PROMPT_PACK) {
    const target = path.join(workspace.uri.fsPath, file.path);

    if (fs.existsSync(target)) {
      existentes.push(file.path);
      continue;
    }

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.content, 'utf-8');
    creados.push(file.path);
  }

  if (creados.length > 0) {
    const entry = vscode.Uri.file(path.join(workspace.uri.fsPath, PROMPT_ENTRY_FILE));
    const document = await vscode.workspace.openTextDocument(entry);
    await vscode.window.showTextDocument(document, { preview: false });
  }

  const resumen = `Pack de prompts: ${creados.length} creado(s)${existentes.length > 0 ? `, ${existentes.length} ya existían (sin tocar)` : ''}.`;
  logger.info(resumen);
  postToPanel({ type: 'log', data: resumen });

  void vscode.window.showInformationMessage(
    `${resumen} Adjúntalos al chat con #file:${PROMPT_ENTRY_FILE} y pide modo wizard o autónomo.`
  );
}

/* ------------------------------------------------------------------------- *
 * Descubrimiento automático de pantallas (SSS-282)
 *
 * Recorre la URL de `mvc-config.json` en modo SÓLO LECTURA, normaliza el
 * inventario y deja `.mvc/discovery.json` + `.mvc/discovery.md` listos para
 * adjuntar como contexto en los prompts 01/03. Sólo escribe esos dos
 * artefactos: el resto de `.mvc/` (guion, prompts, config) queda intacto.
 * ------------------------------------------------------------------------- */

function getDiscoveryChannel(): vscode.OutputChannel {
  if (!discoveryChannel) {
    discoveryChannel = vscode.window.createOutputChannel('Marketing Video Creator — Descubrimiento');
  }

  return discoveryChannel;
}

async function handleDiscoverApp(): Promise<RawDiscovery | undefined> {
  const workspace = vscode.workspace.workspaceFolders?.[0];

  if (!workspace) {
    void vscode.window.showErrorMessage('Abre la carpeta del proyecto para descubrir la app.');
    return undefined;
  }

  const project = loadProjectConfig(workspace);
  const url = (project?.url ?? '').trim();

  if (!url) {
    void vscode.window.showErrorMessage(
      'Configura primero la URL de la app (pestaña Configuración) y vuelve a lanzar el descubrimiento.'
    );
    return undefined;
  }

  const settings = getExtensionSettings();
  const channel = getDiscoveryChannel();
  channel.appendLine('');
  channel.appendLine(`# Descubrimiento ${new Date().toISOString()}`);
  channel.appendLine(`URL: ${url} · maxDepth: ${settings.discoveryMaxDepth} · maxPages: ${settings.discoveryMaxPages}`);

  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Marketing Video Creator: descubriendo pantallas',
      cancellable: true
    },
    async (progress, token): Promise<RawDiscovery | undefined> => {
      try {
        return await crawlApp({
          url,
          maxDepth: settings.discoveryMaxDepth,
          maxPages: settings.discoveryMaxPages,
          headless: settings.playwrightHeadless,
          executablePath: settings.playwrightBrowserPath.trim() || undefined,
          storageStatePath: settings.discoveryStorageState.trim() || undefined,
          repoRoot: workspace.uri.fsPath,
          isCancelled: () => token.isCancellationRequested,
          onPage: (page, info) => {
            progress.report({ message: `${info.index}: ${page.title || page.path}` });
            channel.appendLine(`  · (${info.index}) ${page.path} — ${page.title}`);
          }
        });
      } catch (error) {
        reportError(error);
        return undefined;
      }
    }
  );

  if (!result) {
    return undefined;
  }

  // Normalización pura (sin navegador) + escritura de los dos artefactos.
  const normalized = normalizeDiscovery(result);
  let artifactsText = '';

  try {
    const artifacts = writeDiscoveryArtifacts(normalized, path.join(workspace.uri.fsPath, '.mvc'));
    artifactsText = ` Inventario en .mvc/${path.basename(artifacts.jsonPath)} y .mvc/${path.basename(artifacts.mdPath)}.`;
    channel.appendLine(`Normalizado: ${artifacts.jsonPath}`);
    channel.appendLine(`Markdown:   ${artifacts.mdPath}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    channel.appendLine(`No se pudo escribir .mvc/discovery.*: ${message}`);
    logger.error(`No se pudo escribir el inventario normalizado: ${message}`);
  }

  channel.appendLine(JSON.stringify(normalized, null, 2));
  channel.appendLine(
    `# Fin: ${normalized.stats.pageCount} pantalla(s), profundidad ${normalized.stats.depthReached}, ${normalized.stats.skipped.length} descartada(s), ${normalized.warnings.length} aviso(s).`
  );

  const resumen = `Descubrimiento: ${normalized.stats.pageCount} pantalla(s), ${normalized.stats.skipped.length} enlace(s) descartado(s), ${normalized.warnings.length} aviso(s).`;
  logger.info(resumen);
  postToPanel({ type: 'log', data: resumen });
  void vscode.window.showInformationMessage(
    `${resumen}${artifactsText} Adjúntalos al chat (#file:.mvc/discovery.md) o míralos en el canal "Marketing Video Creator — Descubrimiento".`
  );

  return normalized;
}

/* ------------------------------------------------------------------------- *
 * Convertidor discovery → borrador de fases (SSS-282)
 *
 * A partir de `.mvc/discovery.json` propone fases ejecutables y SIEMPRE deja el
 * borrador en `.mvc/mvc-config.borrador.json`. `mvc-config.json` sólo se escribe
 * si el usuario confirma en el diálogo modal; esa escritura reutiliza el mismo
 * serializador/escritura atómica que el caso `savePhases` del panel.
 * ------------------------------------------------------------------------- */

/** Botón del diálogo modal: sin pulsarlo, `mvc-config.json` no se toca. */
const ACTION_WRITE_PHASES = 'Escribir fases';

async function handleProposePhases(): Promise<void> {
  const workspace = vscode.workspace.workspaceFolders?.[0];

  if (!workspace) {
    void vscode.window.showErrorMessage('Abre la carpeta del proyecto para proponer fases.');
    return;
  }

  try {
    const discovery = readDiscoveryDoc(discoveryPathOf(workspace.uri.fsPath));
    const proposal = discoveryToPhases(discovery);

    if (proposal.phases.length === 0) {
      void vscode.window.showErrorMessage(
        'El descubrimiento no tiene pantallas con las que proponer fases. Vuelve a lanzar «Descubrir app».'
      );
      return;
    }

    const draft = buildPhasesDraft(proposal, {
      base: loadProjectConfig(workspace),
      baseUrl: discovery.baseUrl
    });
    const draftPath = writePhasesDraft(workspace.uri.fsPath, draft);
    const draftRelative = `.mvc/${path.basename(draftPath)}`;

    for (const warning of proposal.warnings) {
      logger.warn(warning);
      postToPanel({ type: 'log', data: warning });
    }

    const resumen = `Borrador de ${proposal.phases.length} fase(s) en ${draftRelative} (${proposal.warnings.length} aviso(s)).`;
    logger.info(resumen);
    postToPanel({ type: 'log', data: resumen });

    const result = await applyPhasesDraftToProjectConfig({
      workspaceRoot: workspace.uri.fsPath,
      draft,
      confirm: async () => {
        const action = await vscode.window.showWarningMessage(
          `Borrador de ${proposal.phases.length} fase(s) generado en ${draftRelative}. ` +
            '¿Escribir estas fases en mvc-config.json? Se reemplazan las fases actuales.',
          { modal: true },
          ACTION_WRITE_PHASES
        );

        return action === ACTION_WRITE_PHASES;
      }
    });

    for (const warning of result.warnings) {
      postToPanel({ type: 'log', data: warning });
    }

    if (result.reason === 'applied') {
      postProjectState(workspace);
      postToPanel({
        type: 'log',
        data: `${result.phases.length} fase(s) escritas en mvc-config.json. Revisa el guion [borrador] antes de grabar.`
      });
      void vscode.window.showInformationMessage(
        `Marketing Video Creator: ${result.phases.length} fase(s) guardadas en mvc-config.json. Revisa el guion [borrador] antes de grabar.`
      );
      return;
    }

    if (result.reason === 'cancelled') {
      postToPanel({ type: 'log', data: `mvc-config.json sin cambios; el borrador queda en ${draftRelative}.` });
      void vscode.window.showInformationMessage(
        `Marketing Video Creator: mvc-config.json sin cambios. El borrador queda en ${draftRelative}.`
      );
      return;
    }

    const detalle = result.warnings.length > 0 ? ` ${result.warnings.join(' ')}` : '';
    void vscode.window.showErrorMessage(
      `Marketing Video Creator: no se pudo aplicar el borrador (${result.reason}).${detalle}`
    );
  } catch (error) {
    reportError(error);
  }
}

/** Envía al panel la configuración y el progreso reales (mismo mensaje que `savePhases`). */
function postProjectState(workspace: vscode.WorkspaceFolder): void {
  postToPanel({
    type: 'settings',
    data: {
      settings: getExtensionSettings(),
      project: loadProjectConfig(workspace),
      progress: lastProgress,
      running: phaseManager?.isRunning ?? false
    }
  });
}

/* ------------------------------------------------------------------------- *
 * Requisitos externos: FFmpeg/FFprobe, navegador de Playwright y voz.
 * Ninguno viaja en el VSIX, así que se comprueban antes de grabar para dar un
 * mensaje accionable en lugar del error crudo del binario que falta.
 * ------------------------------------------------------------------------- */

/** Ruta donde Playwright espera su Chromium (null si no se puede determinar). */
function detectChromiumPath(): string | null {
  try {
    const chromiumPath = chromium.executablePath();
    return typeof chromiumPath === 'string' && chromiumPath.length > 0 ? chromiumPath : null;
  } catch {
    return null;
  }
}

function fileExists(filePath: string): boolean {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function collectRequirementChecks(): RequirementCheck[] {
  const settings = getExtensionSettings();

  return checkRequirements({
    platform: process.platform,
    findInPath: FfmpegBuilder.findInPath,
    exists: fileExists,
    chromiumPath: detectChromiumPath(),
    configuredFfmpegPath: settings.ffmpegPath,
    configuredBrowserPath: settings.playwrightBrowserPath,
    configuredTtsProvider: settings.ttsProvider,
    ffmpegAutoDownload: settings.ffmpegAutoDownload
  });
}

function reportRequirements(checks: RequirementCheck[]): void {
  for (const check of checks) {
    postToPanel({ type: 'log', data: formatRequirement(check) });
  }
  postToPanel({ type: 'requirements', data: checks });
}

/** Instala el Chromium de Playwright con el CLI que viaja dentro de la extensión. */
async function installBrowser(): Promise<boolean> {
  const cli = path.join(extensionUri?.fsPath ?? '', 'node_modules', 'playwright', 'cli.js');

  if (!fileExists(cli)) {
    void vscode.window.showErrorMessage(
      `No se encontró el instalador de Playwright (${cli}). Reinstala la extensión o ejecuta "npx playwright install chromium".`
    );
    return false;
  }

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Marketing Video Creator: instalando el navegador (~130 MB, una sola vez)...',
      cancellable: false
    },
    () =>
      new Promise<boolean>(resolve => {
        const child = child_process.spawn(process.execPath, [cli, 'install', 'chromium'], {
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
        });

        child.stdout?.on('data', data => logger.info(`[playwright install] ${String(data).trim()}`));
        child.stderr?.on('data', data => logger.warn(`[playwright install] ${String(data).trim()}`));
        child.on('error', error => {
          logger.error('Fallo al instalar el navegador:', error);
          resolve(false);
        });
        child.on('close', code => resolve(code === 0));
      })
  );
}

/** Comprueba los requisitos y ofrece arreglarlos (comando propio y botón del panel). */
async function handleCheckRequirements(): Promise<void> {
  let checks = collectRequirementChecks();
  reportRequirements(checks);

  let summary = summarizeRequirements(checks);

  if (!summary.ok) {
    const acciones: string[] = [];

    if (summary.blocking.some(check => check.id === 'chromium') && getExtensionSettings().playwrightAutoInstall) {
      acciones.push('Instalar navegador');
    }

    acciones.push('Ver ajustes');

    const elegido = await vscode.window.showErrorMessage(`Marketing Video Creator: ${summary.text}`, ...acciones);

    if (elegido === 'Instalar navegador') {
      const instalado = await installBrowser();
      if (instalado) {
        checks = collectRequirementChecks();
        reportRequirements(checks);
        summary = summarizeRequirements(checks);
      }
    } else if (elegido === 'Ver ajustes') {
      void vscode.commands.executeCommand('workbench.action.openSettings', 'marketingVideoCreator');
    }
  }

  if (summary.ok) {
    void vscode.window.showInformationMessage(`Marketing Video Creator: ${summary.text}`);
  }
}

/**
 * Pre-flight: si falta un requisito obligatorio, avisa y no arranca (mejor eso
 * que fallar con el error del binario a mitad de la grabación).
 */
async function ensureRequirements(etapa: 'captura' | 'montaje', intento = 0): Promise<boolean> {
  const checks = collectRequirementChecks();
  reportRequirements(checks);

  const { blocking, text } = summarizeRequirements(checks);
  const relevantes = etapa === 'captura' ? blocking : blocking.filter(check => check.id === 'ffmpeg');

  if (relevantes.length === 0) {
    return true;
  }

  const acciones: string[] = [];

  if (relevantes.some(check => check.id === 'chromium') && getExtensionSettings().playwrightAutoInstall) {
    acciones.push('Instalar navegador');
  }

  acciones.push('Ver ajustes');

  const elegido = await vscode.window.showErrorMessage(`Marketing Video Creator: no se puede ${etapa === 'captura' ? 'grabar' : 'montar'}. ${text}`, ...acciones);

  if (elegido === 'Ver ajustes') {
    void vscode.commands.executeCommand('workbench.action.openSettings', 'marketingVideoCreator');
    return false;
  }

  if (elegido === 'Instalar navegador' && intento < 1) {
    const instalado = await installBrowser();
    return instalado ? ensureRequirements(etapa, intento + 1) : false;
  }

  return false;
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

      case 'checkRequirements': {
        await handleCheckRequirements();
        break;
      }

      case 'savePhases': {
        const workspace = vscode.workspace.workspaceFolders?.[0];
        const existing = workspace ? loadProjectConfig(workspace) : null;

        if (!workspace) {
          postToPanel({ type: 'log', data: 'Abre una carpeta de workspace antes de guardar las fases.' });
          break;
        }

        if (!existing) {
          postToPanel({ type: 'log', data: 'Configura primero la URL de la app (pestaña Configuración) y guarda.' });
          break;
        }

        const { phases, warnings } = normalizePhases(message.data);

        for (const warning of warnings) {
          postToPanel({ type: 'log', data: warning });
        }

        if (phases.length === 0) {
          postToPanel({ type: 'log', data: 'No hay fases válidas: no se ha guardado nada.' });
          break;
        }

        existing.phases = phases;
        const saved = saveProjectConfig(workspace, existing);

        postToPanel({ type: 'log', data: saved ? `${phases.length} fase(s) guardadas.` : 'No se han podido guardar las fases.' });

        // Se devuelve lo realmente guardado para que el panel muestre lo que se
        // ha descartado (una fase sin id válido, unos pasos mal escritos...).
        if (saved) {
          postProjectState(workspace);
        } else {
          postToPanel({
            type: 'settings',
            data: {
              settings: getExtensionSettings(),
              project: loadProjectConfig(workspace),
              progress: lastProgress,
              running: phaseManager?.isRunning ?? false
            }
          });
        }
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
