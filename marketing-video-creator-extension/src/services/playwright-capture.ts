/**
 * Captura de demo con Playwright.
 * Graba el flujo del usuario en formato webm.
 */

import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { createLogger } from '../utils/logger';

const logger = createLogger('playwright-capture');

export interface CaptureOptions {
  url: string;
  headless?: boolean;
  width?: number;
  height?: number;
  isMobile?: boolean;
  slowMo?: number;
  outputDir?: string;
}

export class PlaywrightCapture {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private recording: boolean = false;
  private outputDir: string = '';

  async start(options?: CaptureOptions): Promise<void> {
    try {
      const headless = options?.headless ?? true;
      const width = options?.isMobile ? 432 : (options?.width ?? 1920);
      const height = options?.isMobile ? 768 : (options?.height ?? 1080);
      this.outputDir = options?.outputDir ?? path.join(process.cwd(), 'output', 'demo-video', 'clips');

      if (!fs.existsSync(this.outputDir)) {
        fs.mkdirSync(this.outputDir, { recursive: true });
        logger.info(`Directorio creado: ${this.outputDir}`);
      }

      logger.info(`Iniciando Chromium (headless: ${headless}, mobile: ${options?.isMobile ?? false})`);

      this.browser = await chromium.launch({
        headless,
        slowMo: options?.slowMo,
      });

      this.context = await this.browser.newContext({
        viewport: { width, height },
        recordVideo: {
          dir: this.outputDir,
          size: { width, height },
        },
        ...(options?.isMobile ? { deviceScaleFactor: 3 } : {}),
      });

      this.page = await this.context.newPage();

      if (options?.url) {
        await this.navigate(options.url);
      }

      this.recording = true;
      logger.info('Captura iniciada correctamente');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error al iniciar captura:', errorMsg);
      throw new Error(`No se pudo iniciar la captura: ${errorMsg}`);
    }
  }

  async stop(): Promise<string> {
    if (!this.context) {
      logger.warn('No hay context activo para detener');
      return '';
    }

    try {
      logger.info('Deteniendo grabación...');
      await this.context.close();
      
      // Buscar el archivo de video más reciente en el directorio de output
      const videoPath = this.findLatestVideo();
      
      this.context = null;
      this.page = null;
      this.recording = false;

      if (videoPath) {
        logger.info(`Vídeo guardado: ${videoPath}`);
        return videoPath;
      } else {
        logger.info('Captura detenida (sin vídeo encontrado)');
        return '';
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error al detener captura:', errorMsg);
      throw new Error(`No se pudo detener la captura: ${errorMsg}`);
    }
  }

  private findLatestVideo(): string {
    try {
      const files = fs.readdirSync(this.outputDir)
        .filter(f => f.endsWith('.webm'))
        .sort()
        .reverse();
      
      if (files.length > 0) {
        return path.join(this.outputDir, files[0]);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error al buscar vídeo:', errorMsg);
    }
    return '';
  }

  async navigate(url: string): Promise<void> {
    if (!this.page) {
      throw new Error('No hay página activa. Llama a start() primero.');
    }

    try {
      logger.info(`Navegando a: ${url}`);
      await this.page.goto(url, { 
        waitUntil: 'networkidle',
        timeout: 30000 
      });
      logger.info('Navegación completada');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error al navegar:', errorMsg);
      throw new Error(`No se pudo navegar a ${url}: ${errorMsg}`);
    }
  }

  async click(selector: string): Promise<void> {
    if (!this.page) {
      throw new Error('No hay página activa');
    }

    try {
      logger.debug(`Haciendo click en: ${selector}`);
      await this.page.click(selector);
      await this.page.waitForTimeout(300);
      logger.debug('Click completado');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error al hacer click:', errorMsg);
      throw new Error(`No se pudo hacer click en ${selector}: ${errorMsg}`);
    }
  }

  async type(selector: string, text: string): Promise<void> {
    if (!this.page) {
      throw new Error('No hay página activa');
    }

    try {
      logger.debug(`Escribiendo en ${selector}: ${text}`);
      const element = this.page.locator(selector);
      await element.click();
      await element.fill('');
      await element.type(text, { delay: 50 });
      await this.page.waitForTimeout(500);
      logger.debug('Escritura completada');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error al escribir:', errorMsg);
      throw new Error(`No se pudo escribir en ${selector}: ${errorMsg}`);
    }
  }

  async waitForSelector(selector: string, timeout: number = 30000): Promise<void> {
    if (!this.page) {
      throw new Error('No hay página activa');
    }

    try {
      logger.debug(`Esperando selector: ${selector} (timeout: ${timeout}ms)`);
      await this.page.waitForSelector(selector, { timeout });
      logger.debug('Selector encontrado');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error al esperar selector:', errorMsg);
      throw new Error(`No se pudo encontrar el selector ${selector}: ${errorMsg}`);
    }
  }

  async screenshot(filePath: string): Promise<void> {
    if (!this.page) {
      throw new Error('No hay página activa');
    }

    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      logger.debug(`Capturando screenshot: ${filePath}`);
      await this.page.screenshot({ path: filePath, fullPage: false });
      logger.debug('Screenshot guardado');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error al hacer screenshot:', errorMsg);
      throw new Error(`No se pudo guardar screenshot en ${filePath}: ${errorMsg}`);
    }
  }

  async close(): Promise<void> {
    try {
      if (this.context) {
        await this.context.close().catch(() => {});
      }
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }
      this.context = null;
      this.page = null;
      this.recording = false;
      logger.info('Navegador cerrado');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error al cerrar navegador:', errorMsg);
    }
  }

  get isRecording(): boolean {
    return this.recording;
  }
}
