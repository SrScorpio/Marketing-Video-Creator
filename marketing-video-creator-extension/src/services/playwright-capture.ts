/**
 * Captura de demo con Playwright.
 * Graba el flujo de una fase en formato webm y ejecuta los pasos declarados.
 *
 * Sin dependencias de VS Code: opciones inyectables por constructor.
 */

import { chromium, Browser, BrowserContext, Page, Video } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../utils/logger';
import { CaptureStep } from '../types/phase';

const logger = createLogger('playwright-capture');

export interface CaptureOptions {
  /** URL inicial de la demo. */
  url?: string;
  /** Identificador de la fase que se está grabando (nombre del webm de salida). */
  phaseId?: string;
  headless?: boolean;
  width?: number;
  height?: number;
  isMobile?: boolean;
  deviceScaleFactor?: number;
  slowMo?: number;
  /** Directorio donde se dejan las grabaciones definitivas (.webm). */
  clipsDir?: string;
  /** Directorio temporal de grabación (se limpia al cerrar la fase). */
  tempDir?: string;
  /** Timeout de navegación y esperas, en ms. */
  timeoutMs?: number;
}

export class PlaywrightCapture {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private video: Video | null = null;
  private recording: boolean = false;
  private phaseId: string = 'phase';
  private clipsDir: string = '';
  private tempDir: string = '';
  private readonly defaults: CaptureOptions;

  constructor(options: CaptureOptions = {}) {
    this.defaults = options;
  }

  get isRecording(): boolean {
    return this.recording;
  }

  /** Arranca Chromium y empieza a grabar la fase indicada. */
  async start(options: CaptureOptions = {}): Promise<void> {
    if (this.recording) {
      throw new Error('Ya hay una captura en curso.');
    }

    const merged: CaptureOptions = { ...this.defaults, ...options };
    const headless = merged.headless ?? true;
    const width = merged.width ?? (merged.isMobile ? 432 : 1920);
    const height = merged.height ?? (merged.isMobile ? 768 : 1080);
    const timeout = merged.timeoutMs ?? 30000;

    this.phaseId = merged.phaseId ?? 'phase';
    this.clipsDir = merged.clipsDir ?? path.join(process.cwd(), 'output', 'demo-video', 'clips');
    this.tempDir = merged.tempDir ?? path.join(this.clipsDir, '.rec', this.phaseId);

    fs.mkdirSync(this.clipsDir, { recursive: true });
    fs.mkdirSync(this.tempDir, { recursive: true });

    // El navegador se lanza una sola vez por ejecución: cada fase abre su
    // propio contexto (con su propia grabación) y lo cierra al terminar.
    if (!this.browser || !this.browser.isConnected()) {
      logger.info(`Iniciando Chromium (headless=${headless}) para ${this.phaseId} (${width}x${height})`);
      this.browser = await chromium.launch({ headless, slowMo: merged.slowMo });
    }

    this.context = await this.browser.newContext({
      viewport: { width, height },
      recordVideo: { dir: this.tempDir, size: { width, height } },
      ...(merged.isMobile ? { deviceScaleFactor: merged.deviceScaleFactor ?? 3 } : {})
    });
    this.context.setDefaultTimeout(timeout);
    this.context.setDefaultNavigationTimeout(timeout);

    this.page = await this.context.newPage();
    this.video = this.page.video();
    this.recording = true;

    if (merged.url) {
      await this.navigate(merged.url);
    }
  }

  /** Ejecuta una lista de pasos de captura dentro de la fase actual. */
  async runSteps(steps: CaptureStep[]): Promise<void> {
    for (const step of steps) {
      logger.debug(`Paso: ${step.action}`);
      switch (step.action) {
        case 'goto':
          await this.navigate(step.url, step.waitUntil ?? 'networkidle');
          break;
        case 'click':
          await this.click(step.selector);
          break;
        case 'fill':
          await this.fill(step.selector, step.text);
          break;
        case 'press':
          await this.press(step.selector, step.key);
          break;
        case 'waitForSelector':
          await this.waitForSelector(step.selector, step.timeoutMs);
          break;
        case 'wait':
          await this.wait(step.ms);
          break;
        default: {
          const exhaustive: never = step;
          throw new Error(`Paso de captura no soportado: ${JSON.stringify(exhaustive)}`);
        }
      }
    }
  }

  /**
   * Cierra el contexto (finaliza la grabación) y devuelve la ruta del webm.
   *
   * Usa `page.video()` para localizar EXACTAMENTE la grabación de esta fase en
   * lugar de elegir "el .webm más reciente" del directorio, que fallaba cuando
   * había varias fases grabadas.
   */
  async stop(): Promise<string> {
    if (!this.context) {
      logger.warn('No hay contexto activo para detener.');
      return '';
    }

    const video = this.video;
    const phaseId = this.phaseId;
    const clipsDir = this.clipsDir;
    const tempDir = this.tempDir;
    const context = this.context;

    this.context = null;
    this.page = null;
    this.video = null;
    this.recording = false;

    await context.close();

    let rawPath = '';
    try {
      rawPath = video ? await video.path() : '';
    } catch (error) {
      logger.warn('No se pudo resolver la ruta del vídeo grabado:', error);
    }

    if (!rawPath || !fs.existsSync(rawPath)) {
      rawPath = PlaywrightCapture.findLatestWebm(tempDir);
    }

    if (!rawPath) {
      logger.error(`Grabación de ${phaseId} no encontrada en ${tempDir}`);
      return '';
    }

    const finalPath = path.join(clipsDir, `${phaseId}.webm`);
    fs.copyFileSync(rawPath, finalPath);
    PlaywrightCapture.removeDir(tempDir);

    logger.info(`Vídeo de ${phaseId} guardado: ${finalPath}`);
    return finalPath;
  }

  /**
   * Cierra el navegador y libera todos los recursos. Idempotente: hay que
   * llamarlo al terminar la ejecución para no dejar procesos Chromium vivos.
   */
  async release(): Promise<void> {
    try {
      if (this.context) {
        const context = this.context;
        this.context = null;
        this.page = null;
        this.video = null;
        this.recording = false;
        await context.close().catch(() => undefined);
      }
      if (this.browser) {
        await this.browser.close().catch(() => undefined);
        this.browser = null;
      }
      PlaywrightCapture.removeDir(this.tempDir);
      logger.info('Navegador cerrado');
    } catch (error) {
      logger.error('Error al cerrar el navegador:', error);
    }
  }

  async navigate(url: string, waitUntil: 'load' | 'domcontentloaded' | 'networkidle' = 'networkidle'): Promise<void> {
    await this.withPage(page => page.goto(url, { waitUntil, timeout: 30000 }));
  }

  async click(selector: string): Promise<void> {
    await this.withPage(async page => {
      await page.click(selector);
      await page.waitForTimeout(300);
    });
  }

  async fill(selector: string, text: string): Promise<void> {
    await this.withPage(async page => {
      const locator = page.locator(selector);
      await locator.click();
      await locator.fill(text);
      await page.waitForTimeout(300);
    });
  }

  async press(selector: string, key: string): Promise<void> {
    await this.withPage(async page => {
      await page.press(selector, key);
      await page.waitForTimeout(200);
    });
  }

  async waitForSelector(selector: string, timeoutMs: number = 30000): Promise<void> {
    await this.withPage(page => page.waitForSelector(selector, { timeout: timeoutMs }));
  }

  async wait(ms: number): Promise<void> {
    await this.withPage(page => page.waitForTimeout(ms));
  }

  async screenshot(filePath: string): Promise<void> {
    await this.withPage(async page => {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      await page.screenshot({ path: filePath, fullPage: false });
    });
  }

  private async withPage(action: (page: Page) => Promise<unknown>): Promise<void> {
    if (!this.page) {
      throw new Error('No hay página activa. Llama a start() primero.');
    }

    try {
      await action(this.page);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Error durante la captura:', message);
      throw new Error(`Fallo de captura: ${message}`);
    }
  }

  private static findLatestWebm(dir: string): string {
    try {
      const files = fs
        .readdirSync(dir)
        .filter(file => file.endsWith('.webm'))
        .map(file => ({ file, mtime: fs.statSync(path.join(dir, file)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);

      return files.length > 0 ? path.join(dir, files[0].file) : '';
    } catch {
      return '';
    }
  }

  private static removeDir(dir: string): void {
    try {
      if (dir && fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    } catch {
      /* directorio temporal ya eliminado */
    }
  }
}
