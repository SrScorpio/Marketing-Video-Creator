/**
 * Servicio de TTS (Text-to-Speech) local.
 *
 * Provider por defecto: SAPI (System.Speech.Synthesis, Microsoft Pablo en
 * Windows). Funciona sin API key ni conexión a internet.
 *
 * Degradación: si el provider no está disponible (p. ej. SAPI en Linux), el
 * pipeline continúa sin narración en lugar de romper (lo gestiona PhaseManager).
 */

import * as path from 'path';
import { createLogger } from '../utils/logger';
import { sintetizarSapi } from './sapi-provider';

const logger = createLogger('tts-service');

export type TtsProvider = 'sapi' | 'edge-tts' | 'external';

export interface TtsServiceOptions {
  provider?: TtsProvider;
  voice?: string;
  rate?: number;
  volume?: number;
}

export interface TtsRequest {
  text: string;
  outputPath: string;
  rate?: number;
  volume?: number;
}

export class TtsService {
  private initialized: boolean = false;
  /** Expuestos para poder verificar el cableado de los ajustes. */
  readonly provider: TtsProvider;
  readonly voice: string;
  readonly rate: number;
  readonly volume: number;

  constructor(options: TtsServiceOptions = {}) {
    this.provider = options.provider ?? 'sapi';
    this.voice = options.voice ?? 'Microsoft Pablo';
    this.rate = options.rate ?? 1;
    this.volume = options.volume ?? 1;
  }

  get isAvailable(): boolean {
    return this.initialized;
  }

  /**
   * Valida provider y plataforma. Lanza un error claro si el TTS no puede
   * funcionar (PhaseManager lo captura y sigue sin narración).
   */
  async initialize(): Promise<void> {
    if (this.provider !== 'sapi') {
      throw new Error(
        `tts.provider '${this.provider}' no soportado todavía (pendiente Fase 2). Usa 'sapi'.`
      );
    }

    if (process.platform !== 'win32') {
      throw new Error('El provider SAPI solo funciona en Windows (System.Speech.Synthesis).');
    }

    logger.info(`TTS inicializado: provider=${this.provider}, voz=${this.voice}`);
    this.initialized = true;
  }

  async generate(request: TtsRequest): Promise<string> {
    if (!this.initialized) {
      await this.initialize();
    }

    const outputPath = await sintetizarSapi({
      texto: request.text,
      outputPath: request.outputPath,
      voz: this.voice,
      rate: request.rate ?? this.rate,
      volume: request.volume ?? this.volume
    });

    logger.info(`TTS generado: ${request.text.substring(0, 50)}... → ${outputPath}`);
    return outputPath;
  }

  async generateForPhase(phaseId: string, script: string, outputDir: string): Promise<string> {
    if (!script || script.trim().length === 0) {
      throw new Error(`La fase ${phaseId} no tiene guion de narración.`);
    }

    return this.generate({
      text: script,
      outputPath: path.join(outputDir, `${phaseId}.wav`)
    });
  }
}
