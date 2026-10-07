/**
 * Gestor de fases del vídeo demo.
 * Coordina captura, TTS, SRT y montaje por fase.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Phase, PhaseState } from '../types/phase';
import { SrtEntry } from '../types/project-config';
import { PlaywrightCapture } from './playwright-capture';
import { TtsService } from './tts-service';
import { FfmpegBuilder } from './ffmpeg-builder';
import { createLogger } from '../utils/logger';
import { sanitizeFileName } from '../utils/validators';

const logger = createLogger('phase-manager');

export class PhaseManager {
  private phases: Phase[] = [];
  private states: Map<string, PhaseState> = new Map();
  private capture: PlaywrightCapture;
  private tts: TtsService;
  private ffmpeg: FfmpegBuilder;
  private outputDir: string;

  constructor(outputDir: string) {
    this.capture = new PlaywrightCapture();
    this.tts = new TtsService();
    this.ffmpeg = new FfmpegBuilder();
    this.outputDir = outputDir;

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
  }

  setPhases(phases: Phase[]): void {
    this.phases = phases;
    this.states.clear();

    for (const phase of phases) {
      this.states.set(phase.id, {
        phase,
        status: 'pending',
        progress: 0
      });
    }

    logger.info(`Fases configuradas: ${phases.length}`);
  }

  getStates(): Map<string, PhaseState> {
    return new Map(this.states);
  }

  async runAll(): Promise<void> {
    await this.tts.initialize();
    await this.ffmpeg.initialize();

    for (const phase of this.phases) {
      await this.runPhase(phase);
    }
  }

  private async runPhase(phase: Phase): Promise<void> {
    const state = this.states.get(phase.id);
    if (!state) return;

    try {
      state.status = 'capturing';
      state.progress = 20;
      this.notifyChange();

      // TODO: Capturar con Playwright
      // this.capture.start({ ... })
      // ... interacciones del usuario ...
      // await this.capture.stop()

      state.status = 'narrating';
      state.progress = 50;
      this.notifyChange();

      // Generar audio TTS
      const audioPath = await this.tts.generateForPhase(
        phase.id,
        phase.script || '',
        this.outputDir
      );
      phase.clipPath = audioPath;

      state.status = 'rendering';
      state.progress = 80;
      this.notifyChange();

      state.status = 'done';
      state.progress = 100;
      this.notifyChange();

      logger.info(`Fase ${phase.id} completada`);
    } catch (error) {
      state.status = 'error';
      state.error = error instanceof Error ? error.message : String(error);
      this.notifyChange();
      logger.error(`Error en fase ${phase.id}:`, state.error);
    }
  }

  private notifyChange(): void {
    // TODO: Notificar al webview
    // vscode.window.activeWebview?.postMessage({ type: 'phaseUpdate', states: ... })
  }

  getSrtPath(phaseId: string): string {
    return path.join(this.outputDir, `${phaseId}.srt`);
  }

  async readSrt(phaseId: string): Promise<SrtEntry[]> {
    const srtPath = this.getSrtPath(phaseId);
    if (!fs.existsSync(srtPath)) {
      return [];
    }
    const content = fs.readFileSync(srtPath, 'utf-8');
    return this.parseSrt(content);
  }

  async writeSrt(phaseId: string, entries: SrtEntry[]): Promise<void> {
    const srtPath = this.getSrtPath(phaseId);
    const content = this.renderSrt(entries);
    fs.writeFileSync(srtPath, content, 'utf-8');
  }

  private parseSrt(content: string): SrtEntry[] {
    const entries: SrtEntry[] = [];
    const blocks = content.trim().split(/\r?\n\r?\n/);

    for (const block of blocks) {
      const lines = block.trim().split(/\r?\n/);
      if (lines.length < 3) continue;

      const index = parseInt(lines[0], 10);
      const timeLine = lines[1];
      const timeMatch = timeLine.match(/(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/);

      if (timeMatch) {
        entries.push({
          index,
          startTime: timeMatch[1],
          endTime: timeMatch[2],
          text: lines.slice(2).join('\n')
        });
      }
    }

    return entries;
  }

  private renderSrt(entries: SrtEntry[]): string {
    return entries
      .map(e => `${e.index}\n${e.startTime} --> ${e.endTime}\n${e.text}`)
      .join('\n\n');
  }

  async buildFinalVideo(): Promise<string> {
    const clipPaths = this.phases
      .map(p => p.clipPath)
      .filter((p): p is string => !!p);

    if (clipPaths.length === 0) {
      throw new Error('No hay clips para montar');
    }

    const outputPath = path.join(this.outputDir, 'demo-video.mp4');
    await this.ffmpeg.build({
      inputFiles: clipPaths,
      outputPath
    });

    return outputPath;
  }

  async buildMobileVideo(): Promise<string> {
    const clipPaths = this.phases
      .map(p => p.clipPath)
      .filter((p): p is string => !!p);

    if (clipPaths.length === 0) {
      throw new Error('No hay clips para montar');
    }

    const outputPath = path.join(this.outputDir, 'demo-video-mobile.mp4');
    await this.ffmpeg.build({
      inputFiles: clipPaths,
      outputPath,
      variant: 'mobile'
    });

    return outputPath;
  }
}
