/**
 * Utilidades compartidas por los tests: generación de medios reales con FFmpeg.
 */

import * as child_process from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FfmpegBuilder } from '../../src/services/ffmpeg-builder';

export function ffmpegBin(): string {
  const binary = FfmpegBuilder.findInPath('ffmpeg');
  if (!binary) {
    throw new Error('FFmpeg no está disponible en el PATH: los tests de integración requieren FFmpeg real.');
  }
  return binary;
}

export function ffprobeBin(): string {
  const binary = FfmpegBuilder.findInPath('ffprobe');
  if (!binary) {
    throw new Error('FFprobe no está disponible en el PATH.');
  }
  return binary;
}

export function run(binary: string, args: string[], cwd?: string): string {
  const result = child_process.spawnSync(binary, args, { encoding: 'utf-8', cwd });

  if (result.error) {
    throw new Error(`${binary} no se pudo ejecutar: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${binary} falló (exit ${result.status}): ${(result.stderr || '').trim()}`);
  }

  return result.stdout || '';
}

export function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Genera un webm de prueba (para simular la grabación de Playwright). */
export function makeWebm(dir: string, name: string, seconds: number, size: string = '640x360'): string {
  const output = path.join(dir, name);
  run(ffmpegBin(), [
    '-y',
    '-f',
    'lavfi',
    '-i',
    `testsrc=size=${size}:rate=30`,
    '-t',
    String(seconds),
    '-c:v',
    'libvpx-vp9',
    '-b:v',
    '500k',
    output
  ]);
  return output;
}

/** Genera un WAV de prueba (para simular la narración TTS). */
export function makeWav(dir: string, name: string, seconds: number): string {
  const output = path.join(dir, name);
  run(ffmpegBin(), [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'anullsrc=r=48000:cl=stereo',
    '-t',
    String(seconds),
    '-c:a',
    'pcm_s16le',
    output
  ]);
  return output;
}

export interface ProbeResult {
  width: number;
  height: number;
  durationSec: number;
  hasAudio: boolean;
}

/** Lee resolución, duración y presencia de audio de un fichero con FFprobe. */
export function probe(filePath: string): ProbeResult {
  const json = run(ffprobeBin(), [
    '-v',
    'error',
    '-show_entries',
    'stream=codec_type,width,height',
    '-show_entries',
    'format=duration',
    '-of',
    'json',
    filePath
  ]);

  const parsed = JSON.parse(json) as {
    streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
    format?: { duration?: string };
  };

  const video = (parsed.streams ?? []).find(stream => stream.codec_type === 'video');

  return {
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    durationSec: Number.parseFloat(parsed.format?.duration ?? '0'),
    hasAudio: (parsed.streams ?? []).some(stream => stream.codec_type === 'audio')
  };
}
