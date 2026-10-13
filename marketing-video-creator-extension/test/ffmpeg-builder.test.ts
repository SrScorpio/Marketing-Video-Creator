/**
 * Tests de integración REALES: ejecutan FFmpeg y FFprobe de verdad.
 * Verifican el clip normalizado, la concatenación y las dos variantes de salida.
 */

import * as fs from 'fs';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FfmpegBuilder } from '../src/services/ffmpeg-builder';
import { makeWebm, probe, run, tmpDir, ffmpegBin } from './helpers/fixtures';

const TIMEOUT = 120_000;

describe('FfmpegBuilder (integración con FFmpeg real)', () => {
  let dir: string;
  let builder: FfmpegBuilder;
  let webm: string;

  beforeAll(async () => {
    dir = tmpDir('mvc-builder-');
    webm = makeWebm(dir, 'captura.webm', 2);
    builder = new FfmpegBuilder();
    await builder.initialize();
  }, TIMEOUT);

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('encuentra FFmpeg y FFprobe en el sistema', () => {
    expect(FfmpegBuilder.findInPath('ffmpeg')).toBeTruthy();
    expect(FfmpegBuilder.findInPath('ffprobe')).toBeTruthy();
    expect(builder.executablePath).toBeTruthy();
    expect(builder.probePath).toBeTruthy();
    expect(FfmpegBuilder.findInPath('binario-que-no-existe-xyz')).toBeNull();
  });

  it('inicializar es idempotente', async () => {
    const before = builder.executablePath;
    await builder.initialize();
    expect(builder.executablePath).toBe(before);
  });

  it('lanza error claro si la ruta configurada no existe', async () => {
    const broken = new FfmpegBuilder({ ffmpegPath: '/ruta/inexistente/ffmpeg' });
    await expect(broken.initialize()).rejects.toThrow(/no existe/);
  });

  it('probeDuration y probeStreams leen metadatos reales', async () => {
    const duration = await builder.probeDuration(webm);
    expect(duration).toBeGreaterThan(1.5);
    expect(duration).toBeLessThan(3);

    const streams = await builder.probeStreams(webm);
    expect(streams.width).toBe(640);
    expect(streams.height).toBe(360);
    expect(streams.hasAudio).toBe(false);
  }, TIMEOUT);

  it('buildPhaseClip normaliza a 1920x1080 con pista de audio', async () => {
    const output = path.join(dir, 'clip-desktop.mp4');
    await builder.buildPhaseClip({
      videoInput: webm,
      output,
      canvas: { width: 1920, height: 1080 },
      videoDurationSec: 2
    });

    expect(fs.existsSync(output)).toBe(true);
    const info = probe(output);
    expect(info.width).toBe(1920);
    expect(info.height).toBe(1080);
    expect(info.hasAudio).toBe(true);
  }, TIMEOUT);

  it('buildPhaseClip normaliza a 1080x1920 (mobile)', async () => {
    const output = path.join(dir, 'clip-mobile.mp4');
    await builder.buildPhaseClip({
      videoInput: webm,
      output,
      canvas: { width: 1080, height: 1920 },
      videoDurationSec: 2
    });

    const info = probe(output);
    expect(info.width).toBe(1080);
    expect(info.height).toBe(1920);
    expect(info.hasAudio).toBe(true);
  }, TIMEOUT);

  it('concat une clips homogéneos y buildVideo devuelve el maestro', async () => {
    const clipA = path.join(dir, 'a.mp4');
    const clipB = path.join(dir, 'b.mp4');

    for (const [output, size] of [
      [clipA, { width: 1920, height: 1080 }],
      [clipB, { width: 1920, height: 1080 }]
    ] as Array<[string, { width: number; height: number }]>) {
      await builder.buildPhaseClip({
        videoInput: webm,
        output,
        canvas: size,
        videoDurationSec: 1
      });
    }

    const master = await builder.buildVideo([clipA, clipB], path.join(dir, 'master.mp4'));
    const info = probe(master);

    expect(info.width).toBe(1920);
    expect(info.height).toBe(1080);
    expect(info.durationSec).toBeGreaterThan(1.5);
  }, TIMEOUT);

  it('buildDesktopVideo genera 1920x1080 y buildMobileVideo 1080x1920', async () => {
    const master = path.join(dir, 'master-2.mp4');
    await builder.buildPhaseClip({
      videoInput: webm,
      output: master,
      canvas: { width: 1920, height: 1080 },
      videoDurationSec: 1
    });

    const desktop = await builder.buildDesktopVideo(master, path.join(dir, 'out/desktop.mp4'));
    const mobile = await builder.buildMobileVideo(master, path.join(dir, 'out/mobile.mp4'));

    expect(desktop.endsWith(path.join('out', 'desktop.mp4'))).toBe(true);
    expect(mobile.endsWith(path.join('out', 'mobile.mp4'))).toBe(true);

    const desktopInfo = probe(desktop);
    const mobileInfo = probe(mobile);

    expect(`${desktopInfo.width}x${desktopInfo.height}`).toBe('1920x1080');
    expect(`${mobileInfo.width}x${mobileInfo.height}`).toBe('1080x1920');
  }, TIMEOUT);

  it('cut y mux producen ficheros válidos', async () => {
    const clip = path.join(dir, 'clip-cut.mp4');
    await builder.buildPhaseClip({
      videoInput: webm,
      output: clip,
      canvas: { width: 1920, height: 1080 },
      videoDurationSec: 2
    });

    const cut = await builder.cut(clip, path.join(dir, 'cortado.mp4'), 0, 1);
    expect(probe(cut).durationSec).toBeGreaterThan(0.5);

    const narracion = path.join(dir, 'narracion.wav');
    run(ffmpegBin(), ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '1', narracion]);

    const muxed = await builder.mux(cut, narracion, path.join(dir, 'muxed.mp4'));
    expect(probe(muxed).hasAudio).toBe(true);
  }, TIMEOUT);

  it('concat falla con lista vacía', async () => {
    await expect(builder.concat([], path.join(dir, 'nada.mp4'))).rejects.toThrow(/No hay clips/);
  }, TIMEOUT);

  it('extractZip descomprime un ZIP real', async () => {
    const zipDir = tmpDir('mvc-zip-');
    const sourceFile = path.join(zipDir, 'contenido.txt');
    fs.writeFileSync(sourceFile, 'hola zip', 'utf-8');

    const zipPath = path.join(zipDir, 'paquete.zip');
    run('python3', ['-m', 'zipfile', '-c', zipPath, 'contenido.txt'], zipDir);
    expect(fs.existsSync(zipPath)).toBe(true);
    expect(fs.statSync(zipPath).size).toBeGreaterThan(0);

    const destination = path.join(zipDir, 'extraido');
    await builder.extractZip(zipPath, destination);

    const extracted = path.join(destination, 'contenido.txt');
    expect(fs.existsSync(extracted)).toBe(true);
    expect(fs.readFileSync(extracted, 'utf-8')).toBe('hola zip');

    fs.rmSync(zipDir, { recursive: true, force: true });
  }, TIMEOUT);

  it('extractZip falla con un ZIP corrupto', async () => {
    const corruptDir = tmpDir('mvc-zip-bad-');
    const corruptZip = path.join(corruptDir, 'roto.zip');
    fs.writeFileSync(corruptZip, 'esto no es un zip');

    await expect(builder.extractZip(corruptZip, path.join(corruptDir, 'out'))).rejects.toThrow(
      /No se pudo descomprimir/
    );

    fs.rmSync(corruptDir, { recursive: true, force: true });
  }, TIMEOUT);
});
