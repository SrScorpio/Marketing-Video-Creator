/**
 * Tests de integración del pipeline completo de fases con FFmpeg real.
 *
 * La captura y el TTS se sustituyen por dobles deterministas (un webm/wav
 * generado con FFmpeg) para comprobar la orquestación real: clip por fase,
 * SRT, degradación sin voz, manejo de errores y montaje final.
 */

import * as fs from 'fs';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FfmpegBuilder } from '../src/services/ffmpeg-builder';
import { PhaseManager } from '../src/services/phase-manager';
import { Phase } from '../src/types/phase';
import { makeWav, makeWebm, probe, tmpDir } from './helpers/fixtures';

const TIMEOUT = 180_000;

class FakeCapture {
  public started: string[] = [];
  public steps: Array<{ phaseId: string; count: number }> = [];
  public stopped = 0;

  constructor(private readonly source: string, private readonly failWith?: string) {}

  async start(options: { phaseId?: string } = {}): Promise<void> {
    if (this.failWith) {
      throw new Error(this.failWith);
    }
    this.started.push(options.phaseId ?? 'unknown');
  }

  async runSteps(steps: Array<{ action: string }>): Promise<void> {
    this.steps.push({ phaseId: this.started[this.started.length - 1], count: steps.length });
  }

  async wait(): Promise<void> {
    /* sin espera real en tests */
  }

  async stop(): Promise<string> {
    this.stopped += 1;
    return this.source;
  }

  async release(): Promise<void> {
    /* nada que liberar */
  }
}

class FakeTts {
  constructor(private readonly wav: string, private readonly fail = false) {}

  async initialize(): Promise<void> {
    if (this.fail) {
      throw new Error('TTS no disponible en este entorno de test');
    }
  }

  async generateForPhase(phaseId: string, script: string, outputDir: string): Promise<string> {
    if (this.fail) {
      throw new Error('proveedor TTS no disponible');
    }

    fs.mkdirSync(outputDir, { recursive: true });
    const target = path.join(outputDir, `${phaseId}.wav`);
    fs.copyFileSync(this.wav, target);
    expect(script.length).toBeGreaterThan(0);
    return target;
  }
}

describe('PhaseManager (pipeline end-to-end con FFmpeg real)', () => {
  let dir: string;
  let webm: string;
  let wav: string;

  beforeAll(() => {
    dir = tmpDir('mvc-pipeline-');
    webm = makeWebm(dir, 'fuente.webm', 2);
    wav = makeWav(dir, 'fuente.wav', 1);
  }, TIMEOUT);

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const phases: Phase[] = [
    {
      id: '01-presentacion',
      label: 'Presentación',
      duration: 2,
      script: 'Bienvenido a la demo. Esta es la primera fase del vídeo.',
      steps: [{ action: 'click', selector: '#empezar' }]
    },
    {
      id: '02-crear-ficha',
      label: 'Crear Ficha',
      duration: 2,
      script: 'Ahora creamos la ficha del cliente en dos pasos.'
    }
  ];

  it('genera un clip y un SRT por fase, y monta el vídeo maestro', async () => {
    const capture = new FakeCapture(webm);
    const manager = new PhaseManager({
      outputDir: path.join(dir, 'run-desktop'),
      projectUrl: 'https://ejemplo.test',
      variant: 'desktop',
      capture: capture as never,
      tts: new FakeTts(wav) as never,
      ffmpeg: new FfmpegBuilder(),
      settleMs: 0
    });

    const events: string[] = [];
    manager.on('state', progress => events.push(`state:${progress.status}`));
    manager.on('log', message => events.push(`log:${message}`));

    manager.setPhases(phases);
    const snapshot = await manager.runAll();

    expect(snapshot.status).toBe('done');
    expect(snapshot.progress).toBe(100);
    expect(snapshot.phases.every(phase => phase.status === 'done')).toBe(true);

    // Captura real invocada una vez por fase, con los pasos declarados.
    expect(capture.started).toEqual(['01-presentacion', '02-crear-ficha']);
    expect(capture.steps).toEqual([{ phaseId: '01-presentacion', count: 1 }]);

    for (const phase of phases) {
      expect(fs.existsSync(phase.clipPath!)).toBe(true);

      const clipInfo = probe(phase.clipPath!);
      expect(`${clipInfo.width}x${clipInfo.height}`).toBe('1920x1080');
      expect(clipInfo.hasAudio).toBe(true);

      const srtPath = manager.getSrtPath(phase.id);
      expect(fs.existsSync(srtPath)).toBe(true);
      const entries = await manager.readSrt(phase.id);
      expect(entries.length).toBeGreaterThan(0);
      expect(fs.readFileSync(srtPath, 'utf-8')).toMatch(/-->/);
    }

    const master = await manager.buildFinalVideo();
    const masterInfo = probe(master);
    expect(masterInfo.durationSec).toBeGreaterThan(2);
    expect(masterInfo.width).toBe(1920);

    expect(events.some(event => event.startsWith('log:'))).toBe(true);
    expect(events.filter(event => event === 'state:running').length).toBeGreaterThan(0);
  }, TIMEOUT);

  it('degrada sin voz cuando el TTS no está disponible y sigue generando vídeo', async () => {
    const tts = new FakeTts(wav);
    const manager = new PhaseManager({
      outputDir: path.join(dir, 'run-sin-voz'),
      variant: 'desktop',
      capture: new FakeCapture(webm) as never,
      tts: tts as never,
      ffmpeg: new FfmpegBuilder(),
      settleMs: 0
    });

    // Simula SAPI no disponible (Linux): initialize lanza y el pipeline continúa.
    (tts as unknown as { initialize: () => Promise<void> }).initialize = async () => {
      throw new Error('El provider SAPI solo funciona en Windows');
    };
    (tts as unknown as { generateForPhase: () => Promise<string> }).generateForPhase = async () => {
      throw new Error('SAPI no disponible');
    };

    const logs: string[] = [];
    manager.on('log', message => logs.push(message));

    manager.setPhases([{ id: '01-sin-voz', label: 'Sin voz', duration: 2, script: 'Guion sin voz.' }]);
    const snapshot = await manager.runAll();

    expect(snapshot.status).toBe('done');
    expect(snapshot.phases[0].status).toBe('done');
    expect(logs.some(message => message.includes('Narración TTS no disponible'))).toBe(true);
    expect(logs.some(message => message.includes('Se genera vídeo sin voz'))).toBe(true);
  }, TIMEOUT);

  it('marca la fase con error sin abortar el resto', async () => {
    const capture = new FakeCapture(webm, '');
    const manager = new PhaseManager({
      outputDir: path.join(dir, 'run-error'),
      variant: 'desktop',
      capture: capture as never,
      tts: new FakeTts(wav) as never,
      ffmpeg: new FfmpegBuilder(),
      settleMs: 0
    });

    manager.setPhases([
      { id: '01-ok', label: 'OK', duration: 1 },
      { id: '02-error', label: 'Error', duration: 1 }
    ]);

    (capture as unknown as { start: (options?: unknown) => Promise<void> }).start = async () => {
      throw new Error('selector no encontrado');
    };

    const snapshot = await manager.runAll();

    expect(snapshot.status).toBe('error');
    expect(snapshot.phases[0].status).toBe('error');
    expect(snapshot.phases[0].error).toContain('selector no encontrado');
    expect(snapshot.phases[1].status).toBe('error');
  }, TIMEOUT);

  it('genera la variante mobile a 1080x1920 desde el maestro', async () => {
    const manager = new PhaseManager({
      outputDir: path.join(dir, 'run-mobile'),
      variant: 'mobile',
      capture: new FakeCapture(webm) as never,
      tts: new FakeTts(wav) as never,
      ffmpeg: new FfmpegBuilder(),
      settleMs: 0
    });

    manager.setPhases([{ id: '01-mobile', label: 'Mobile', duration: 1, script: 'Versión móvil.' }]);
    await manager.runAll();

    const mobile = await manager.buildMobileVideo();
    expect(fs.existsSync(mobile)).toBe(true);

    const info = probe(mobile);
    expect(`${info.width}x${info.height}`).toBe('1080x1920');
  }, TIMEOUT);

  it('no permite ejecutar sin fases y avisa si no hay clips', async () => {
    const manager = new PhaseManager({
      outputDir: path.join(dir, 'run-vacio'),
      capture: new FakeCapture(webm) as never,
      tts: new FakeTts(wav) as never,
      ffmpeg: new FfmpegBuilder()
    });

    await expect(manager.runAll()).rejects.toThrow(/No hay fases configuradas/);
    await expect(manager.buildFinalVideo()).rejects.toThrow(/No hay clips generados/);
  }, TIMEOUT);
});
