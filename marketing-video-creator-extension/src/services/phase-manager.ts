/**
 * Gestor de fases del vídeo demo.
 *
 * Pipeline real por fase:
 *   captura Playwright (webm) → narración TTS (opcional) →
 *   normalización a clip MP4 → SRT del guion → concatenación de la versión final.
 *
 * Sin dependencias de VS Code: los servicios se inyectan y el progreso se
 * emite por eventos, de modo que la extensión pueda reenviarlo al webview y el
 * pipeline sea verificable en Node puro.
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { Phase, PhaseProgress, PhaseState, PhaseStatus } from '../types/phase';
import { SrtEntry } from '../types/project-config';
import { Canvas } from '../utils/ffmpeg-args';
import { createLogger } from '../utils/logger';
import { buildSrtFromScript, parseSrt, renderSrt } from '../utils/srt';
import { FfmpegBuilder } from './ffmpeg-builder';
import { PlaywrightCapture } from './playwright-capture';
import { TtsService } from './tts-service';

const logger = createLogger('phase-manager');

const DEFAULT_DESKTOP_CANVAS: Canvas = { width: 1920, height: 1080, fps: 30 };
const DEFAULT_MOBILE_CANVAS: Canvas = { width: 1080, height: 1920, fps: 30 };

export interface PhaseManagerOptions {
  /** Directorio raíz de salida del proyecto de vídeo. */
  outputDir: string;
  /** URL de la app a demostrar (las fases pueden sobrescribirla con `phase.url`). */
  projectUrl?: string;
  /** Variante de grabación: define el viewport de captura. */
  variant?: 'desktop' | 'mobile';
  headless?: boolean;
  desktopCanvas?: Canvas;
  mobileCanvas?: Canvas;
  /** Lienzo usado al normalizar cada clip (por defecto, el de la variante). */
  clipCanvas?: Canvas;
  /**
   * Viewport CSS usado para grabar la variante mobile (por defecto 432x768,
   * 9:16 exacto, con deviceScaleFactor 3). Grabar a 1080x1920 CSS px daría un
   * viewport irreal y un vídeo peor escalado.
   */
  mobileCaptureViewport?: { width: number; height: number };
  /** Milisegundos de espera al final de cada fase antes de cortar la grabación. */
  settleMs?: number;
  capture?: PlaywrightCapture;
  tts?: TtsService;
  ffmpeg?: FfmpegBuilder;
}

export interface PhaseManagerEvents {
  state: (progress: PhaseProgress) => void;
  log: (message: string) => void;
}

export class PhaseManager extends EventEmitter {
  private phases: Phase[] = [];
  private states: Map<string, PhaseState> = new Map();
  private readonly capture: PlaywrightCapture;
  private readonly tts: TtsService;
  private readonly ffmpeg: FfmpegBuilder;
  private readonly outputDir: string;
  private readonly clipsDir: string;
  private readonly audioDir: string;
  private readonly srtDir: string;
  private readonly variant: 'desktop' | 'mobile';
  private readonly headless: boolean;
  private readonly desktopCanvas: Canvas;
  private readonly mobileCanvas: Canvas;
  private readonly clipCanvas: Canvas;
  private readonly mobileCaptureViewport: { width: number; height: number };
  private readonly projectUrl: string;
  private readonly settleMs: number;
  private cancelled: boolean = false;
  private running: boolean = false;

  constructor(options: PhaseManagerOptions) {
    super();

    this.outputDir = options.outputDir;
    this.clipsDir = path.join(options.outputDir, 'clips');
    this.audioDir = path.join(options.outputDir, 'audio');
    this.srtDir = path.join(options.outputDir, 'srt');
    this.variant = options.variant ?? 'desktop';
    this.headless = options.headless ?? true;
    this.desktopCanvas = options.desktopCanvas ?? DEFAULT_DESKTOP_CANVAS;
    this.mobileCanvas = options.mobileCanvas ?? DEFAULT_MOBILE_CANVAS;
    this.clipCanvas =
      options.clipCanvas ??
      (this.variant === 'mobile' ? this.mobileCanvas : this.desktopCanvas);
    this.projectUrl = options.projectUrl ?? '';
    this.settleMs = options.settleMs ?? 400;
    this.mobileCaptureViewport = options.mobileCaptureViewport ?? { width: 432, height: 768 };

    for (const dir of [this.outputDir, this.clipsDir, this.audioDir, this.srtDir]) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.capture = options.capture ?? new PlaywrightCapture();
    this.tts = options.tts ?? new TtsService();
    this.ffmpeg = options.ffmpeg ?? new FfmpegBuilder();
  }

  on<K extends keyof PhaseManagerEvents>(event: K, listener: PhaseManagerEvents[K]): this {
    return super.on(event, listener);
  }

  emit<K extends keyof PhaseManagerEvents>(event: K, ...args: Parameters<PhaseManagerEvents[K]>): boolean {
    return super.emit(event, ...args);
  }

  get isRunning(): boolean {
    return this.running;
  }

  get outputDirectory(): string {
    return this.outputDir;
  }

  setPhases(phases: Phase[]): void {
    this.phases = phases;
    this.states.clear();

    for (const phase of phases) {
      this.states.set(phase.id, { phase, status: 'pending', progress: 0 });
    }

    logger.info(`Fases configuradas: ${phases.length}`);
    this.emitState();
  }

  getStates(): PhaseState[] {
    return this.phases.map(phase => this.states.get(phase.id)).filter((s): s is PhaseState => !!s);
  }

  /** Instantánea serializable (apta para postMessage del webview). */
  snapshot(): PhaseProgress {
    const states = this.getStates();
    const overallProgress =
      states.length === 0
        ? 0
        : Math.round(states.reduce((sum, state) => sum + state.progress, 0) / states.length);

    const statuses = states.map(state => state.status);
    let status: PhaseProgress['status'] = 'idle';

    if (this.cancelled && statuses.some(s => s === 'cancelled')) {
      status = 'cancelled';
    } else if (statuses.includes('error')) {
      status = 'error';
    } else if (this.running || statuses.some(s => s !== 'pending' && s !== 'done')) {
      status = 'running';
    } else if (states.length > 0 && statuses.every(s => s === 'done')) {
      status = 'done';
    }

    return {
      status,
      progress: overallProgress,
      phases: states.map(state => ({
        id: state.phase.id,
        label: state.phase.label,
        status: state.status,
        progress: state.progress,
        clipPath: state.phase.clipPath,
        error: state.error
      }))
    };
  }

  /** Cancela el pipeline en curso (se comprueba entre fases y al cerrar la captura). */
  async cancel(): Promise<void> {
    this.cancelled = true;
    this.emitLog('Cancelación solicitada.');
    await this.capture.release();
  }

  /** Cierra el navegador al terminar la ejecución (libera procesos Chromium). */
  async release(): Promise<void> {
    await this.capture.release();
  }

  /**
   * Ejecuta todas las fases en orden. Un fallo de fase no aborta el resto:
   * cada fase queda marcada con su propio estado y error.
   */
  async runAll(): Promise<PhaseProgress> {
    if (this.phases.length === 0) {
      throw new Error('No hay fases configuradas.');
    }

    if (this.running) {
      throw new Error('Ya hay una ejecución en curso.');
    }

    this.running = true;
    this.cancelled = false;
    this.emitLog('Iniciando pipeline de demo...');

    try {
      await this.ffmpeg.initialize();
      this.emitLog(`FFmpeg: ${this.ffmpeg.executablePath}`);

      try {
        await this.tts.initialize();
      } catch (error) {
        this.emitLog(
          `Narración TTS no disponible (${error instanceof Error ? error.message : String(error)}). ` +
            'Se generará vídeo sin voz.'
        );
      }

      for (const phase of this.phases) {
        if (this.cancelled) {
          this.markCancelled(phase);
          continue;
        }
        await this.runPhase(phase);
      }
    } finally {
      this.running = false;
      // Cierra Chromium al terminar: deja de haber procesos huérfanos.
      await this.capture.release();
      this.emitState();
    }

    const snapshot = this.snapshot();
    this.emitLog(
      `Pipeline finalizado: ${snapshot.phases.filter(p => p.status === 'done').length}/${snapshot.phases.length} fases OK`
    );

    return snapshot;
  }

  /** Ejecuta una fase concreta y devuelve su estado final. */
  async runPhase(phase: Phase): Promise<PhaseState> {
    const state = this.states.get(phase.id);
    if (!state) {
      throw new Error(`Fase desconocida: ${phase.id}`);
    }

    try {
      state.status = 'capturing';
      state.progress = 10;
      state.error = undefined;
      this.emitState();

      const webmPath = await this.capturePhase(phase);
      if (!webmPath) {
        throw new Error('Playwright no generó ninguna grabación para la fase.');
      }

      state.progress = 45;
      this.emitState();

      const audioPath = await this.narratePhase(phase);

      state.status = 'rendering';
      state.progress = 80;
      this.emitState();

      const clipPath = path.join(this.clipsDir, `${phase.id}.mp4`);
      await this.ffmpeg.buildPhaseClip({
        videoInput: webmPath,
        audioInput: audioPath,
        output: clipPath,
        canvas: this.clipCanvas
      });
      phase.clipPath = clipPath;

      await this.generateSrt(phase, clipPath);

      state.status = 'done';
      state.progress = 100;
      this.emitState();
      this.emitLog(`Fase ${phase.id} completada → ${path.basename(clipPath)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state.status = this.cancelled ? 'cancelled' : 'error';
      state.error = message;
      state.progress = 100;
      this.emitState();
      this.emitLog(`Fase ${phase.id} ${state.status === 'cancelled' ? 'cancelada' : 'con error'}: ${message}`);
      logger.error(`Error en fase ${phase.id}:`, message);
    }

    return state;
  }

  private async capturePhase(phase: Phase): Promise<string> {
    const isMobile = this.variant === 'mobile';
    const viewport = isMobile ? this.mobileCaptureViewport : this.desktopCanvas;

    this.emitLog(`Capturando fase ${phase.id}...`);

    await this.capture.start({
      phaseId: phase.id,
      url: phase.url ?? this.projectUrl,
      headless: this.headless,
      width: viewport.width,
      height: viewport.height,
      isMobile,
      clipsDir: this.clipsDir
    });

    if (phase.steps && phase.steps.length > 0) {
      await this.capture.runSteps(phase.steps);
      await this.capture.wait(this.settleMs);
    } else {
      // Fase sin pasos declarados: se graba la duración configurada.
      await this.capture.wait(Math.max(1000, Math.round(phase.duration * 1000)));
    }

    if (this.cancelled) {
      throw new Error('Captura cancelada por el usuario.');
    }

    return this.capture.stop();
  }

  private async narratePhase(phase: Phase): Promise<string | null> {
    const script = (phase.script ?? '').trim();
    if (!script) {
      this.emitLog(`Fase ${phase.id}: sin guion, clip sin narración.`);
      return null;
    }

    this.emitLog(`Generando narración de ${phase.id}...`);

    try {
      return await this.tts.generateForPhase(phase.id, script, this.audioDir);
    } catch (error) {
      this.emitLog(
        `Fase ${phase.id}: narración no disponible (${
          error instanceof Error ? error.message : String(error)
        }). Se genera vídeo sin voz.`
      );
      return null;
    }
  }

  private async generateSrt(phase: Phase, clipPath: string): Promise<void> {
    const script = (phase.script ?? '').trim();
    if (!script) {
      return;
    }

    const durationSec = (await this.ffmpeg.probeDuration(clipPath)) ?? phase.duration;
    const entries = buildSrtFromScript(script, durationSec * 1000);
    if (entries.length === 0) {
      return;
    }

    await this.writeSrt(phase.id, entries);
    phase.srtPath = this.getSrtPath(phase.id);
    this.emitLog(`Subtítulos de ${phase.id} generados (${entries.length} entradas).`);
  }

  private markCancelled(phase: Phase): void {
    const state = this.states.get(phase.id);
    if (state && state.status === 'pending') {
      state.status = 'cancelled';
      state.progress = 0;
    }
  }

  getSrtPath(phaseId: string): string {
    return path.join(this.srtDir, `${phaseId}.srt`);
  }

  async readSrt(phaseId: string): Promise<SrtEntry[]> {
    const srtPath = this.getSrtPath(phaseId);
    if (!fs.existsSync(srtPath)) {
      return [];
    }

    return parseSrt(fs.readFileSync(srtPath, 'utf-8'));
  }

  async writeSrt(phaseId: string, entries: SrtEntry[]): Promise<void> {
    fs.mkdirSync(this.srtDir, { recursive: true });
    fs.writeFileSync(this.getSrtPath(phaseId), renderSrt(entries), 'utf-8');
  }

  /** Rutas de los clips ya generados, en el orden de las fases. */
  get clipPaths(): string[] {
    return this.phases
      .map(phase => phase.clipPath)
      .filter((clipPath): clipPath is string => !!clipPath && fs.existsSync(clipPath));
  }

  /** Vídeo maestro: concatenación de los clips reales (sin recodificar). */
  async buildFinalVideo(): Promise<string> {
    const clips = this.clipPaths;
    if (clips.length === 0) {
      throw new Error('No hay clips generados. Ejecuta la captura antes de montar el vídeo.');
    }

    const outputPath = path.join(this.outputDir, 'demo-video.mp4');
    this.emitLog(`Montando vídeo maestro con ${clips.length} clips...`);
    return this.ffmpeg.buildVideo(clips, outputPath);
  }

  /** Variante desktop (1920x1080) → output/demo-video/desktop/. */
  async buildDesktopVideo(): Promise<string> {
    const master = await this.buildFinalVideo();
    const outputPath = path.join(this.outputDir, 'desktop', 'demo-video-desktop.mp4');
    this.emitLog('Renderizando variante desktop (1920x1080)...');
    return this.ffmpeg.buildDesktopVideo(master, outputPath);
  }

  /** Variante mobile (1080x1920) → output/demo-video/mobile/. */
  async buildMobileVideo(): Promise<string> {
    const master = await this.buildFinalVideo();
    const outputPath = path.join(this.outputDir, 'mobile', 'demo-video-mobile.mp4');
    this.emitLog('Renderizando variante mobile (1080x1920)...');
    return this.ffmpeg.buildMobileVideo(master, outputPath);
  }

  private emitState(): void {
    this.emit('state', this.snapshot());
  }

  private emitLog(message: string): void {
    logger.info(message);
    this.emit('log', message);
  }
}

export type { PhaseStatus };
