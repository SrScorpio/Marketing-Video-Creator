/**
 * Servicio de montaje de vídeo con FFmpeg.
 *
 * Cut, mux, concat, normalización por fase y variantes desktop/mobile.
 * Auto-instalación de FFmpeg si no existe.
 *
 * Sin dependencias de VS Code: la configuración se inyecta en el constructor,
 * de modo que el servicio es ejecutable y testeable en Node puro.
 */

import * as child_process from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import { createLogger } from '../utils/logger';
import {
  Canvas,
  buildConcatArgs,
  buildConcatList,
  buildCutArgs,
  buildMuxArgs,
  buildPhaseClipArgs,
  buildProbeDurationArgs,
  buildProbeStreamsArgs,
  buildVariantArgs,
  parseProbeDuration
} from '../utils/ffmpeg-args';

const logger = createLogger('ffmpeg-builder');

export interface FfmpegBuilderOptions {
  /** Ruta explícita al ejecutable de FFmpeg. */
  ffmpegPath?: string;
  /** Ruta explícita al ejecutable de FFprobe. */
  ffprobePath?: string;
  /** Descargar FFmpeg si no se encuentra en el sistema. */
  autoDownload?: boolean;
  videoCodec?: string;
  audioCodec?: string;
  crf?: number;
  preset?: string;
  desktopCanvas?: Canvas;
  mobileCanvas?: Canvas;
}

export interface PhaseClipRequest {
  videoInput: string;
  audioInput?: string | null;
  output: string;
  canvas: Canvas;
  /** Duración del vídeo grabado (se calcula con FFprobe si se omite). */
  videoDurationSec?: number;
  padVideoBySec?: number;
  padAudioBySec?: number;
}

export interface VideoStreams {
  width?: number;
  height?: number;
  videoCodec?: string;
  audioCodec?: string;
  hasAudio: boolean;
  durationSec: number | null;
}

const FFMPEG_RELEASE_URL = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';

export class FfmpegBuilder {
  private ffmpegPath: string = '';
  private ffprobePath: string = '';
  private initialized: boolean = false;
  private readonly autoDownload: boolean;
  private readonly videoCodec: string;
  private readonly audioCodec: string;
  private readonly crf: number;
  private readonly preset: string;
  private readonly desktopCanvas: Canvas;
  private readonly mobileCanvas: Canvas;
  private readonly configuredPath?: string;
  private readonly configuredProbePath?: string;

  constructor(options: FfmpegBuilderOptions = {}) {
    this.autoDownload = options.autoDownload ?? true;
    this.videoCodec = options.videoCodec ?? 'libx264';
    this.audioCodec = options.audioCodec ?? 'aac';
    this.crf = options.crf ?? 23;
    this.preset = options.preset ?? 'veryfast';
    this.desktopCanvas = options.desktopCanvas ?? { width: 1920, height: 1080 };
    this.mobileCanvas = options.mobileCanvas ?? { width: 1080, height: 1920 };
    this.configuredPath = options.ffmpegPath || undefined;
    this.configuredProbePath = options.ffprobePath || undefined;
  }

  get executablePath(): string {
    return this.ffmpegPath;
  }

  get probePath(): string {
    return this.ffprobePath;
  }

  /** Localiza (o instala) FFmpeg y FFprobe. Idempotente. */
  async initialize(): Promise<void> {
    if (this.initialized && this.ffmpegPath) {
      return;
    }

    if (this.configuredPath) {
      this.setExecutables(this.configuredPath, this.configuredProbePath);
      return;
    }

    const found = FfmpegBuilder.findInPath('ffmpeg');
    if (found) {
      logger.info(`FFmpeg encontrado en PATH: ${found}`);
      this.setExecutables(found, FfmpegBuilder.findInPath('ffprobe') ?? undefined);
      return;
    }

    if (!this.autoDownload) {
      throw new Error(
        'FFmpeg no encontrado en el PATH y la descarga automática está deshabilitada (marketingVideoCreator.ffmpeg.autoDownload).'
      );
    }

    if (process.platform !== 'win32') {
      throw new Error(
        'FFmpeg no encontrado en el PATH. Instálalo con el gestor de paquetes de tu sistema ' +
          '(p. ej. `apt install ffmpeg` o `brew install ffmpeg`) o define marketingVideoCreator.ffmpeg.path.'
      );
    }

    logger.info('FFmpeg no encontrado, iniciando descarga on-demand...');
    await this.downloadAndInstallFfmpeg();
  }

  /** Busca un ejecutable en el PATH (con o sin extensión .exe). */
  static findInPath(binary: string): string | null {
    const pathEnv = process.env.PATH || '';
    const extensions = process.platform === 'win32' ? ['.exe', ''] : [''];

    for (const dir of pathEnv.split(path.delimiter)) {
      if (!dir) {
        continue;
      }
      for (const extension of extensions) {
        const candidate = path.join(dir, binary + extension);
        try {
          if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return candidate;
          }
        } catch {
          /* directorio ilegible: seguir */
        }
      }
    }

    return null;
  }

  private setExecutables(ffmpegPath: string, ffprobePath?: string): void {
    if (!fs.existsSync(ffmpegPath)) {
      throw new Error(`La ruta configurada de FFmpeg no existe: ${ffmpegPath}`);
    }

    this.ffmpegPath = ffmpegPath;
    this.ffprobePath =
      ffprobePath ??
      path.join(path.dirname(ffmpegPath), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');

    if (!fs.existsSync(this.ffprobePath)) {
      logger.warn(`FFprobe no encontrado en ${this.ffprobePath}: la duración se estimará desde la configuración.`);
      this.ffprobePath = '';
    }

    this.initialized = true;
  }

  /** Descarga el build de FFmpeg para Windows y lo descomprime. */
  private async downloadAndInstallFfmpeg(): Promise<void> {
    const installDir = path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      'MarketingVideoCreator',
      'ffmpeg'
    );
    const zipPath = path.join(installDir, 'ffmpeg-release-essentials.zip');

    fs.mkdirSync(installDir, { recursive: true });
    await this.downloadFile(FFMPEG_RELEASE_URL, zipPath);
    await this.extractZip(zipPath, installDir);

    try {
      fs.unlinkSync(zipPath);
    } catch {
      /* el zip ya no está: nada que limpiar */
    }

    const executable = this.findBinaryRecursively(installDir, 'ffmpeg.exe');
    if (!executable) {
      throw new Error(`FFmpeg descargado en ${installDir} pero no se encontró ffmpeg.exe`);
    }

    this.setExecutables(executable);
    logger.info(`FFmpeg instalado correctamente: ${this.ffmpegPath}`);
  }

  private findBinaryRecursively(dir: string, binary: string): string | null {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const nested = this.findBinaryRecursively(fullPath, binary);
        if (nested) {
          return nested;
        }
      } else if (entry.name.toLowerCase() === binary.toLowerCase()) {
        return fullPath;
      }
    }

    return null;
  }

  private downloadFile(url: string, outputPath: string, redirects: number = 0): Promise<void> {
    return new Promise((resolve, reject) => {
      if (redirects > 5) {
        reject(new Error('Demasiadas redirecciones al descargar FFmpeg'));
        return;
      }

      const client = url.startsWith('https') ? https : http;
      const request = client.get(url, { timeout: 60000 }, response => {
        const status = response.statusCode ?? 0;

        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume();
          this.downloadFile(response.headers.location, outputPath, redirects + 1).then(resolve).catch(reject);
          return;
        }

        if (status !== 200) {
          response.resume();
          reject(new Error(`Error al descargar FFmpeg: HTTP ${status}`));
          return;
        }

        const fileStream = fs.createWriteStream(outputPath);
        response.pipe(fileStream);
        fileStream.on('finish', () => fileStream.close(() => resolve()));
        fileStream.on('error', error => {
          fileStream.close();
          reject(error);
        });
      });

      request.on('error', reject);
      request.on('timeout', () => {
        request.destroy(new Error('Tiempo de espera agotado al descargar FFmpeg'));
      });
    });
  }

  /**
   * Descomprime un ZIP usando herramientas del sistema operativo.
   *
   * Antes se usaba `zlib.createUnzip()` (gzip) sobre un fichero ZIP y se
   * abortaba si 7-Zip no estaba instalado, por lo que la auto-instalación de
   * FFmpeg fallaba en una máquina Windows limpia. Ahora: PowerShell
   * Expand-Archive en Windows y unzip/bsdtar en el resto.
   */
  async extractZip(zipPath: string, destinationDir: string): Promise<void> {
    fs.mkdirSync(destinationDir, { recursive: true });

    const attempts: Array<{ command: string; args: string[] }> =
      process.platform === 'win32'
        ? [
            {
              command: 'powershell',
              args: [
                '-NoProfile',
                '-NonInteractive',
                '-Command',
                `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destinationDir.replace(/'/g, "''")}' -Force`
              ]
            },
            { command: 'tar', args: ['-xf', zipPath, '-C', destinationDir] }
          ]
        : [
            { command: 'unzip', args: ['-o', '-q', zipPath, '-d', destinationDir] },
            { command: 'bsdtar', args: ['-xf', zipPath, '-C', destinationDir] },
            { command: 'tar', args: ['-xf', zipPath, '-C', destinationDir] }
          ];

    const errors: string[] = [];

    for (const attempt of attempts) {
      try {
        const result = child_process.spawnSync(attempt.command, attempt.args, {
          stdio: 'pipe',
          timeout: 120000,
          shell: false
        });

        if (result.error) {
          errors.push(`${attempt.command}: ${result.error.message}`);
          continue;
        }

        if (result.status === 0) {
          logger.info(`ZIP descomprimido con ${attempt.command}`);
          return;
        }

        errors.push(`${attempt.command}: exit ${result.status} ${result.stderr?.toString().trim() ?? ''}`);
      } catch (error) {
        errors.push(`${attempt.command}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    throw new Error(`No se pudo descomprimir ${path.basename(zipPath)}. Intentos: ${errors.join(' | ')}`);
  }

  /** Duración en segundos de un fichero multimedia (null si FFprobe no está disponible). */
  async probeDuration(input: string): Promise<number | null> {
    if (!this.ffprobePath) {
      return null;
    }

    const { stdout } = await this.run(this.ffprobePath, buildProbeDurationArgs(input));
    return parseProbeDuration(stdout);
  }

  /** Resolución, códecs y presencia de audio de un fichero. */
  async probeStreams(input: string): Promise<VideoStreams> {
    const streams: VideoStreams = { hasAudio: false, durationSec: null };
    if (!this.ffprobePath) {
      return streams;
    }

    const { stdout } = await this.run(this.ffprobePath, buildProbeStreamsArgs(input));

    try {
      const parsed = JSON.parse(stdout) as {
        streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number }>;
      };

      for (const stream of parsed.streams ?? []) {
        if (stream.codec_type === 'video' && !streams.videoCodec) {
          streams.videoCodec = stream.codec_name;
          streams.width = stream.width;
          streams.height = stream.height;
        }
        if (stream.codec_type === 'audio') {
          streams.hasAudio = true;
          streams.audioCodec = stream.codec_name;
        }
      }
    } catch (error) {
      logger.warn('FFprobe devolvió una salida no interpretable:', error);
    }

    streams.durationSec = await this.probeDuration(input);
    return streams;
  }

  /**
   * Normaliza la grabación de una fase al clip final: misma resolución, fps,
   * códec y pista de audio (real o silenciosa) para que la concatenación con
   * `-c copy` sea fiable.
   */
  async buildPhaseClip(request: PhaseClipRequest): Promise<string> {
    await this.ensureReady();

    const videoDurationSec =
      request.videoDurationSec ?? (await this.probeDuration(request.videoInput)) ?? 1;
    const audioDurationSec = request.audioInput ? await this.probeDuration(request.audioInput) : null;

    let padVideoBySec = request.padVideoBySec ?? 0;
    let padAudioBySec = request.padAudioBySec ?? 0;

    if (audioDurationSec !== null) {
      const delta = audioDurationSec - videoDurationSec;
      if (delta > 0.05) {
        padVideoBySec = this.round(delta + 0.3);
        logger.info(`Narración más larga que el vídeo: clonando el último fotograma ${padVideoBySec}s`);
      } else if (delta < -0.05) {
        padAudioBySec = this.round(Math.abs(delta));
      }
    }

    await this.ensureOutputDir(request.output);

    const args = buildPhaseClipArgs({
      videoInput: request.videoInput,
      audioInput: request.audioInput,
      videoDurationSec,
      output: request.output,
      canvas: request.canvas,
      videoCodec: this.videoCodec,
      audioCodec: this.audioCodec,
      crf: this.crf,
      preset: this.preset,
      padVideoBySec,
      padAudioBySec
    });

    logger.info(`Clip de fase: ${path.basename(request.videoInput)} → ${path.basename(request.output)}`);
    await this.runFfmpeg(args);
    return request.output;
  }

  /** Corta un vídeo por rango temporal. */
  async cut(input: string, output: string, startSec: number, endSec: number): Promise<string> {
    await this.ensureReady();
    await this.ensureOutputDir(output);
    await this.runFfmpeg(buildCutArgs(input, output, startSec, endSec));
    return output;
  }

  /** Mezcla audio con vídeo (sin recodificar el vídeo). */
  async mux(videoInput: string, audioInput: string, output: string): Promise<string> {
    await this.ensureReady();
    await this.ensureOutputDir(output);
    await this.runFfmpeg(buildMuxArgs(videoInput, audioInput, output, this.audioCodec));
    return output;
  }

  /** Concatena clips homogéneos sin recodificar. */
  async concat(inputs: string[], output: string): Promise<string> {
    await this.ensureReady();

    if (inputs.length === 0) {
      throw new Error('No hay clips que concatenar.');
    }

    await this.ensureOutputDir(output);
    const listPath = path.join(path.dirname(output), `concat-${crypto.randomBytes(4).toString('hex')}.txt`);

    fs.writeFileSync(listPath, buildConcatList(inputs), 'utf-8');

    try {
      await this.runFfmpeg(buildConcatArgs(listPath, output));
    } finally {
      try {
        fs.unlinkSync(listPath);
      } catch {
        /* temporal ya eliminado */
      }
    }

    return output;
  }

  /** Concatena una lista de clips y devuelve el vídeo maestro. */
  async buildVideo(inputs: string[], output: string): Promise<string> {
    return this.concat(inputs, output);
  }

  /** Renderiza la variante mobile (1080x1920 por defecto). */
  async buildMobileVideo(input: string, output: string): Promise<string> {
    return this.buildVariant(input, output, this.mobileCanvas);
  }

  /** Renderiza la variante desktop (1920x1080 por defecto). */
  async buildDesktopVideo(input: string, output: string): Promise<string> {
    return this.buildVariant(input, output, this.desktopCanvas);
  }

  /** Renderiza una variante con el lienzo indicado. */
  async buildVariant(input: string, output: string, canvas: Canvas): Promise<string> {
    await this.ensureReady();
    await this.ensureOutputDir(output);
    logger.info(`Variante ${canvas.width}x${canvas.height}: ${path.basename(input)} → ${path.basename(output)}`);
    await this.runFfmpeg(buildVariantArgs(input, output, canvas, this.videoCodec, this.audioCodec));
    return output;
  }

  private async ensureReady(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  private round(value: number): number {
    return Number(value.toFixed(3));
  }

  private async ensureOutputDir(filePath: string): Promise<void> {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  /** Ejecuta FFmpeg (sin shell) y propaga stderr como error legible. */
  private runFfmpeg(args: string[]): Promise<void> {
    logger.debug(`FFmpeg ${args.join(' ')}`);
    return this.run(this.ffmpegPath, args).then(() => undefined);
  }

  /**
   * Ejecuta un binario con `shell: false`. Las rutas viajan como argumentos
   * independientes: no se añaden comillas ni se interpreta ninguna shell.
   */
  private run(binary: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = child_process.spawn(binary, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', data => {
        stdout += data.toString();
      });
      child.stderr?.on('data', data => {
        stderr += data.toString();
      });

      child.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
          reject(new Error(`Ejecutable no encontrado: ${binary}`));
        } else {
          reject(error);
        }
      });

      child.on('close', code => {
        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }

        const detail = stderr.trim().split('\n').slice(-6).join('\n') || `exit code ${code}`;
        reject(new Error(`${path.basename(binary)} falló: ${detail}`));
      });
    });
  }
}
