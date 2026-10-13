/**
 * Constructores puros de argumentos de FFmpeg/FFprobe.
 *
 * Todos los argumentos se devuelven SIN comillas y se ejecutan con
 * `shell: false` en FfmpegBuilder: las rutas se pasan tal cual y el sistema
 * operativo se encarga del escapado. Añadir comillas manuales o `shell: true`
 * rompía rutas con espacios y abría la puerta a inyección de comandos.
 */

export interface Canvas {
  width: number;
  height: number;
  fps?: number;
  background?: string;
}

const DEFAULT_FPS = 30;
const DEFAULT_BACKGROUND = 'black';

/** Filtro de escala + padding para llevar cualquier vídeo al lienzo del proyecto. */
export function scalePadFilter(canvas: Canvas): string {
  const { width, height } = canvas;
  const fps = canvas.fps ?? DEFAULT_FPS;
  const background = canvas.background ?? DEFAULT_BACKGROUND;

  return [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${background}`,
    `fps=${fps}`,
    'format=yuv420p'
  ].join(',');
}

/** Entrada de audio silencioso (lavfi) con la duración indicada. */
export function silentAudioInputArgs(durationSec: number): string[] {
  const duration = Math.max(0.1, Number(durationSec.toFixed(3)));
  return ['-f', 'lavfi', '-t', String(duration), '-i', 'anullsrc=r=48000:cl=stereo'];
}

export interface PhaseClipArgs {
  videoInput: string;
  audioInput?: string | null;
  videoDurationSec: number;
  output: string;
  canvas: Canvas;
  videoCodec?: string;
  audioCodec?: string;
  crf?: number;
  preset?: string;
  /** Segundos a clonar del último fotograma (cuando la narración dura más que el vídeo). */
  padVideoBySec?: number;
  /** Segundos de silencio añadidos al final del audio (cuando el vídeo dura más). */
  padAudioBySec?: number;
}

/**
 * Args para convertir la grabación webm de una fase en el clip final
 * normalizado (misma resolución, fps, códec y pista de audio en todos los
 * clips → permite concatenar con `-c copy` sin recodificar).
 */
export function buildPhaseClipArgs(options: PhaseClipArgs): string[] {
  const {
    videoInput,
    audioInput,
    videoDurationSec,
    output,
    canvas,
    videoCodec = 'libx264',
    audioCodec = 'aac',
    crf = 23,
    preset = 'veryfast',
    padVideoBySec = 0,
    padAudioBySec = 0
  } = options;

  const args: string[] = [];

  if (padVideoBySec > 0) {
    args.push('-t', String(Number((videoDurationSec + padVideoBySec).toFixed(3))));
  }

  args.push('-i', videoInput);

  if (audioInput) {
    args.push('-i', audioInput);
    args.push('-map', '0:v:0', '-map', '1:a:0');
  } else {
    args.push(...silentAudioInputArgs(videoDurationSec));
    args.push('-map', '0:v:0', '-map', '1:a:0');
  }

  const filters: string[] = [scalePadFilter(canvas)];
  if (padVideoBySec > 0) {
    filters.push('tpad=stop_mode=clone:stop_duration=' + Number(padVideoBySec.toFixed(3)));
  }

  args.push(
    '-vf', filters.join(','),
    '-c:v', videoCodec,
    '-preset', preset,
    '-crf', String(crf),
    '-pix_fmt', 'yuv420p'
  );

  if (padAudioBySec > 0) {
    args.push('-af', 'apad=whole_dur=' + Number((videoDurationSec + padAudioBySec).toFixed(3)));
  }

  args.push(
    '-c:a', audioCodec,
    '-ar', '48000',
    '-ac', '2',
    '-shortest',
    '-movflags', '+faststart',
    '-y',
    output
  );

  return args;
}

/** Args para cortar un clip por rango temporal (reencode limpio). */
export function buildCutArgs(input: string, output: string, startSec: number, endSec: number): string[] {
  if (!(endSec > startSec)) {
    throw new Error(`Rango de corte inválido: ${startSec}s → ${endSec}s`);
  }

  return [
    '-ss', String(startSec),
    '-to', String(endSec),
    '-i', input,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    '-an',
    '-y',
    output
  ];
}

/** Args para mezclar vídeo + audio. */
export function buildMuxArgs(
  videoInput: string,
  audioInput: string,
  output: string,
  audioCodec: string = 'aac'
): string[] {
  return [
    '-i', videoInput,
    '-i', audioInput,
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-c:v', 'copy',
    '-c:a', audioCodec,
    '-shortest',
    '-y',
    output
  ];
}

/** Escapa una ruta para el fichero de lista del demuxer concat de FFmpeg. */
export function escapeConcatPath(filePath: string): string {
  return filePath.replace(/'/g, "'\\''");
}

/** Contenido del fichero de lista del demuxer concat. */
export function buildConcatList(paths: string[]): string {
  return paths.map(p => `file '${escapeConcatPath(p)}'`).join('\n') + '\n';
}

/** Args para concatenar clips sin recodificar (requiere streams homogéneos). */
export function buildConcatArgs(listFile: string, output: string): string[] {
  return [
    '-f', 'concat',
    '-safe', '0',
    '-i', listFile,
    '-c', 'copy',
    '-movflags', '+faststart',
    '-y',
    output
  ];
}

/** Args para generar la variante final (desktop/mobile) desde un vídeo maestro. */
export function buildVariantArgs(
  input: string,
  output: string,
  canvas: Canvas,
  videoCodec: string = 'libx264',
  audioCodec: string = 'aac'
): string[] {
  return [
    '-i', input,
    '-vf', scalePadFilter(canvas),
    '-c:v', videoCodec,
    '-preset', 'veryfast',
    '-crf', '20',
    '-c:a', audioCodec,
    '-ar', '48000',
    '-ac', '2',
    '-movflags', '+faststart',
    '-y',
    output
  ];
}

/** Args de FFprobe para obtener la duración de un fichero multimedia. */
export function buildProbeDurationArgs(input: string): string[] {
  return [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    input
  ];
}

/** Interpreta la salida de FFprobe. Devuelve null si no es un número válido. */
export function parseProbeDuration(stdout: string): number | null {
  const value = Number.parseFloat(stdout.trim());
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Args de FFprobe para leer resolución y códecs de un fichero. */
export function buildProbeStreamsArgs(input: string): string[] {
  return [
    '-v', 'error',
    '-show_entries', 'stream=codec_type,codec_name,width,height',
    '-of', 'json',
    input
  ];
}
