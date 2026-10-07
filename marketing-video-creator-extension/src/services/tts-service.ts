/**
 * Servicio de TTS (Text-to-Speech) local.
 * Provider por defecto: SAPI (System.Speech.Synthesis, Microsoft Pablo en Windows).
 * Funciona sin API key ni conexión a internet.
 */

import * as path from 'path';
import { createLogger } from '../utils/logger';
import { getExtensionSettings } from '../config/extension-settings';
import { sintetizarSapi } from './sapi-provider';

const logger = createLogger('tts-service');

export interface TtsOptions {
  text: string;
  outputPath: string;
  rate?: number;
  volume?: number;
}

export class TtsService {
  private initialized: boolean = false;

  /**
   * Valida el provider configurado y la plataforma. Lanza error si el
   * provider no está soportado todavía (Fase 2: Kokoro/edge-tts).
   */
  async initialize(): Promise<void> {
    const settings = getExtensionSettings();

    if (settings.ttsProvider !== 'sapi') {
      throw new Error(
        `tts.provider '${settings.ttsProvider}' no soportado todavía (pendiente Fase 2). Usa 'sapi'.`
      );
    }

    if (process.platform !== 'win32') {
      throw new Error('El provider SAPI solo funciona en Windows (System.Speech.Synthesis).');
    }

    logger.info(`TTS inicializado: provider=${settings.ttsProvider}, voz=${settings.ttsVoice}`);
    this.initialized = true;
  }

  async generate(options: TtsOptions): Promise<string> {
    if (!this.initialized) {
      await this.initialize();
    }

    const settings = getExtensionSettings();

    const outputPath = await sintetizarSapi({
      texto: options.text,
      outputPath: options.outputPath,
      voz: settings.ttsVoice,
      rate: options.rate ?? settings.ttsRate,
      volume: options.volume ?? settings.ttsVolume
    });

    logger.info(`TTS generado: ${options.text.substring(0, 50)}... → ${outputPath}`);
    return outputPath;
  }

  async generateForPhase(phaseId: string, script: string, outputDir: string): Promise<string> {
    const settings = getExtensionSettings();
    const outputPath = path.join(outputDir, `${phaseId}.wav`);

    return this.generate({
      text: script,
      outputPath,
      rate: settings.ttsRate,
      volume: settings.ttsVolume
    });
  }

  get isAvailable(): boolean {
    return this.initialized;
  }
}
