/**
 * Servicio de montaje de vídeo con FFmpeg.
 * Cut, mux, concat, buildMobile → MP4.
 * Auto-instalación de FFmpeg si no existe.
 */

import * as child_process from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import * as os from "os";
import * as path from "path";
import * as zlib from "zlib";
import { createLogger } from "../utils/logger";
import { getExtensionSettings } from "../config/extension-settings";

const logger = createLogger("ffmpeg-builder");

/** Opciones para buildDesktop/buildMobile */
export interface FfmpegOptions {
  inputFiles: string[];
  outputPath: string;
  variant?: "desktop" | "mobile";
  videoCodec?: string;
  audioCodec?: string;
}

/**
 * Builder de vídeos con FFmpeg.
 * 
 * Proporciona métodos para:
 * - Cut: cortar vídeo por rango de tiempo
 * - Mux: mezclar audio con vídeo
 * - Concat: concatenar múltiples clips
 * - buildMobileVideo: escalar vídeo a resolución mobile (1080x1920)
 * 
 * Auto-instala FFmpeg si no existe y `ffmpeg.autoDownload` está habilitado.
 */
export class FfmpegBuilder {
  private ffmpegPath: string = "";
  private initialized: boolean = false;

  /**
   * Inicializa el builder: localiza o instala FFmpeg.
   */
  async initialize(): Promise<void> {
    if (this.initialized && this.ffmpegPath) {
      return;
    }

    const settings = getExtensionSettings();

    // 1. Si hay path configurado, usarlo directamente
    if (settings.ffmpegPath) {
      this.ffmpegPath = settings.ffmpegPath;
      this.initialized = true;
      logger.info(`FFmpeg usando path configurado: ${this.ffmpegPath}`);
      return;
    }

    // 2. Verificar si ffmpeg está en el PATH del sistema
    const systemFfmpeg = this.findFfmpegInPath();
    if (systemFfmpeg) {
      this.ffmpegPath = systemFfmpeg;
      this.initialized = true;
      logger.info(`FFmpeg encontrado en PATH: ${this.ffmpegPath}`);
      return;
    }

    // 3. Si no existe y autoDownload está habilitado, descargar FFmpeg
    if (settings.ffmpegAutoDownload) {
      logger.info("FFmpeg no encontrado, iniciando descarga on-demand...");
      await this.downloadAndInstallFfmpeg();
      return;
    }

    // 4. Fallback a ffmpeg del PATH
    logger.warn("FFmpeg no encontrado y autoDownload deshabilitado.");
    this.ffmpegPath = "ffmpeg";
    this.initialized = true;
  }

  /**
   * Busca ffmpeg en el PATH del sistema.
   */
  private findFfmpegInPath(): string | null {
    const pathEnv = process.env.PATH || "";
    const pathDirs = pathEnv.split(path.delimiter);

    for (const dir of pathDirs) {
      const winPath = path.join(dir, "ffmpeg.exe");
      if (fs.existsSync(winPath)) {
        return winPath;
      }
      const unixPath = path.join(dir, "ffmpeg");
      if (fs.existsSync(unixPath)) {
        return unixPath;
      }
    }
    return null;
  }

  /**
   * Descarga FFmpeg desde gyan.dev y lo descomprime.
   */
  private async downloadAndInstallFfmpeg(): Promise<void> {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    const ffmpegDir = path.join(appData, "MarketingVideoCreator", "ffmpeg");
    const zipPath = path.join(ffmpegDir, "ffmpeg-release-essentials.zip");

    fs.mkdirSync(ffmpegDir, { recursive: true });

    const downloadUrl = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";
    logger.info(`Descargando FFmpeg desde: ${downloadUrl}`);
    await this.downloadFile(downloadUrl, zipPath);

    logger.info("Descomprimiendo FFmpeg...");
    await this.unzipFile(zipPath, ffmpegDir);

    try { fs.unlinkSync(zipPath); } catch { /* ignore */ }

    const exePath = this.findFfmpegInDirectory(ffmpegDir);
    if (exePath) {
      this.ffmpegPath = exePath;
      this.initialized = true;
      logger.info(`FFmpeg instalado correctamente: ${this.ffmpegPath}`);
    } else {
      throw new Error("FFmpeg descargado pero no se encontró el ejecutable ffmpeg.exe");
    }
  }

  /**
   * Busca el ejecutable ffmpeg.exe en un directorio y sus subdirectorios.
   */
  private findFfmpegInDirectory(dir: string): string | null {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        const nested = this.findFfmpegInDirectory(fullPath);
        if (nested) {
          return nested;
        }
      } else if (entry.name === "ffmpeg.exe") {
        return fullPath;
      }
    }
    return null;
  }

  /**
   * Descarga un archivo desde una URL.
   */
  private downloadFile(url: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const httpClient = url.startsWith("https") ? https : http;

      httpClient.get(url, { timeout: 30000 }, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307) {
          if (response.headers.location) {
            this.downloadFile(response.headers.location, outputPath).then(resolve).catch(reject);
            return;
          }
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Error al descargar FFmpeg: HTTP ${response.statusCode}`));
          return;
        }

        const fileStream = fs.createWriteStream(outputPath);
        response.pipe(fileStream);

        fileStream.on("finish", () => {
          fileStream.close();
          resolve();
        });

        fileStream.on("error", (err) => {
          fileStream.close();
          reject(err);
        });
      }).on("error", (err) => {
        reject(err);
      }).on("timeout", () => {
        reject(new Error("Tiempo de espera agotado al descargar FFmpeg"));
      });
    });
  }

  /**
   * Descomprime un archivo ZIP.
   */
  private unzipFile(zipPath: string, destDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const readStream = fs.createReadStream(zipPath);
      const gunzip = zlib.createUnzip();
      const extract = this.extractZip(readStream, gunzip, destDir);

      gunzip.on("error", (err) => {
        readStream.close();
        reject(err);
      });

      extract.on("error", (err) => {
        readStream.close();
        reject(err);
      });

      extract.on("finish", () => {
        readStream.close();
        resolve();
      });
    });
  }

  /**
   * Extrae un archivo ZIP usando 7-Zip si está disponible.
   */
  private extractZip(readStream: fs.ReadStream, gunzip: zlib.Unzip, destDir: string): fs.WriteStream {
    logger.warn("Descompresión ZIP: usando 7-Zip si disponible.");

    if (this.isSevenZipAvailable()) {
      return this.extractWithSevenZip(readStream, destDir);
    }

    throw new Error("No se puede descomprimir ZIP: instala 7-Zip en el PATH");
  }

  /**
   * Verifica si 7z (7-Zip) está disponible en el PATH.
   */
  private isSevenZipAvailable(): boolean {
    try {
      const result = child_process.spawnSync("7z", ["--version"], {
        stdio: "pipe",
        timeout: 5000
      });
      return result.status === 0;
    } catch {
      return false;
    }
  }

  /**
   * Extrae ZIP usando 7-Zip.
   */
  private extractWithSevenZip(readStream: fs.ReadStream, destDir: string): fs.WriteStream {
    const tempZipPath = path.join(destDir, `temp-${crypto.randomBytes(8).toString("hex")}.zip`);

    return readStream.pipe(fs.createWriteStream(tempZipPath))
      .on("finish", () => {
        const result = child_process.spawnSync("7z", ["x", tempZipPath, `-o${destDir}`, "-y"], {
          stdio: "inherit",
          timeout: 60000
        });

        try { fs.unlinkSync(tempZipPath); } catch { /* ignore */ }

        if (result.status !== 0) {
          throw new Error("Error al extraer ZIP con 7z");
        }
      });
  }

  /**
   * Corta un vídeo por rango de tiempo.
   * ffmpeg -ss {start} -to {end} -i {inputPath} -c:v libx264 -pix_fmt yuv420p -an {outputPath}
   */
  async cut(inputPath: string, outputPath: string, start: number, end: number): Promise<void> {
    await this.initialize();
    await this.ensureOutputDir(outputPath);

    const args = [
      "-ss", start.toString(),
      "-to", end.toString(),
      "-i", `"${inputPath}"`,
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-an",
      "-y",
      `"${outputPath}"`
    ];

    logger.info(`FFmpeg cut: ${inputPath} [${start}s → ${end}s] → ${outputPath}`);
    await this.runFfmpeg(args);
  }

  /**
   * Mezcla audio con vídeo.
   * ffmpeg -i {videoPath} -i {audioPath} -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -shortest {outputPath}
   */
  async mux(videoPath: string, audioPath: string, outputPath: string): Promise<void> {
    await this.initialize();
    await this.ensureOutputDir(outputPath);

    const args = [
      "-i", `"${videoPath}"`,
      "-i", `"${audioPath}"`,
      "-map", "0:v:0",
      "-map", "1:a:0",
      "-c:v", "copy",
      "-c:a", "aac",
      "-shortest",
      "-y",
      `"${outputPath}"`
    ];

    logger.info(`FFmpeg mux: ${videoPath} + ${audioPath} → ${outputPath}`);
    await this.runFfmpeg(args);
  }

  /**
   * Concatena múltiples clips de vídeo.
   * ffmpeg -f concat -safe 0 -i {concatListFile} -c copy {outputPath}
   */
  async concat(inputPaths: string[], outputPath: string): Promise<void> {
    await this.initialize();
    await this.ensureOutputDir(outputPath);

    // Crear archivo de lista de concatenación
    const concatListContent = inputPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
    const concatListPath = path.join(
      path.dirname(outputPath),
      `concat-${crypto.randomBytes(4).toString("hex")}.txt`
    );

    fs.writeFileSync(concatListPath, concatListContent);

    try {
      const args = [
        "-f", "concat",
        "-safe", "0",
        "-i", `"${concatListPath}"`,
        "-c", "copy",
        "-y",
        `"${outputPath}"`
      ];

      logger.info(`FFmpeg concat: ${inputPaths.length} clips → ${outputPath}`);
      await this.runFfmpeg(args);
    } finally {
      // Limpiar archivo temporal
      try { fs.unlinkSync(concatListPath); } catch { /* ignore */ }
    }
  }

  /**
   * Escala un vídeo a resolución mobile (1080x1920).
   * ffmpeg -i {inputPath} -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=white" -c:v libx264 -pix_fmt yuv420p -c:a aac {outputPath}
   */
  async buildMobileVideo(inputPath: string, outputPath: string): Promise<void> {
    await this.initialize();
    await this.ensureOutputDir(outputPath);

    const args = [
      "-i", `"${inputPath}"`,
      "-vf", "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=white",
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-y",
      `"${outputPath}"`
    ];

    logger.info(`FFmpeg build mobile: ${inputPath} → ${outputPath} (1080x1920)`);
    await this.runFfmpeg(args);
  }

  /**
   * Construye un vídeo final (desktop o mobile) a partir de clips.
   * Wrapper de compatibilidad para mantener la API anterior.
   */
  async build(options: FfmpegOptions): Promise<string> {
    const { inputFiles, outputPath, variant } = options;

    if (variant === "mobile") {
      if (inputFiles.length === 1) {
        await this.buildMobileVideo(inputFiles[0], outputPath);
      } else {
        const concatPath = path.join(path.dirname(outputPath), "temp-concat.mp4");
        await this.concat(inputFiles, concatPath);
        await this.buildMobileVideo(concatPath, outputPath);
        try { fs.unlinkSync(concatPath); } catch { /* ignore */ }
      }
    } else {
      await this.concat(inputFiles, outputPath);
    }

    return outputPath;
  }

  /**
   * Asegura que el directorio de salida existe.
   */
  private async ensureOutputDir(filePath: string): Promise<void> {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Ejecuta un comando FFmpeg y espera a que termine.
   */
  private runFfmpeg(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      logger.debug(`Ejecutando FFmpeg: ${this.ffmpegPath} ${args.join(" ")}`);

      const proc = child_process.spawn(this.ffmpegPath, args, {
        stdio: ["ignore", "pipe", "pipe"],
        shell: true
      });

      let stderr = "";
      proc.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          const errorMsg = stderr.trim() || `FFmpeg exited with code ${code}`;
          reject(new Error(`FFmpeg error: ${errorMsg}`));
        }
      });

      proc.on("error", (error) => {
        const err = error as NodeJS.ErrnoException;
        if (err.code === "ENOENT") {
          reject(new Error(`FFmpeg no encontrado en: ${this.ffmpegPath}`));
        } else {
          reject(error);
        }
      });
    });
  }
}
