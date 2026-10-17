/**
 * Cableado de los ajustes con los servicios del pipeline.
 *
 * Regresión concreta: `extension.ts` construía el pipeline con `tts: undefined`
 * y `ffmpeg: undefined`, así que los ajustes de voz y de FFmpeg que el usuario
 * cambia en el panel/`settings.json` se ignoraban en silencio (el servicio caía
 * a sus valores por defecto y no había ningún test que lo viera).
 */

import { describe, expect, it } from 'vitest';
import { createPipelineServices, PipelineServiceSettings } from '../src/config/pipeline-services';

function settings(overrides: Partial<PipelineServiceSettings> = {}): PipelineServiceSettings {
  return {
    ttsProvider: 'sapi',
    ttsVoice: 'Microsoft Pablo',
    ttsRate: 1,
    ttsVolume: 1,
    ffmpegPath: '',
    ffmpegAutoDownload: true,
    outputVideoCodec: 'libx264',
    outputAudioCodec: 'aac',
    playwrightHeadless: true,
    playwrightBrowserPath: '',
    ...overrides
  };
}

describe('createPipelineServices', () => {
  it('pasa a la narración el provider, la voz, la velocidad y el volumen configurados', () => {
    const { tts } = createPipelineServices(
      settings({ ttsProvider: 'sapi', ttsVoice: 'Microsoft Helena', ttsRate: 1.4, ttsVolume: 0.6 })
    );

    expect(tts.provider).toBe('sapi');
    expect(tts.voice).toBe('Microsoft Helena');
    expect(tts.rate).toBe(1.4);
    expect(tts.volume).toBe(0.6);
  });

  it('aplica los valores por defecto cuando los ajustes vienen vacíos', () => {
    const { tts } = createPipelineServices(settings({ ttsVoice: '', ttsRate: 1, ttsVolume: 1 }));

    expect(tts.provider).toBe('sapi');
    expect(tts.rate).toBe(1);
    expect(tts.volume).toBe(1);
  });

  it('pasa a FFmpeg la ruta, la descarga automática y los códecs configurados', () => {
    const { ffmpeg } = createPipelineServices(
      settings({
        ffmpegPath: '/opt/ffmpeg/bin/ffmpeg',
        ffmpegAutoDownload: false,
        outputVideoCodec: 'h264_nvenc',
        outputAudioCodec: 'libmp3lame'
      })
    );

    expect(ffmpeg.configuredExecutablePath).toBe('/opt/ffmpeg/bin/ffmpeg');
    expect(ffmpeg.autoDownload).toBe(false);
    expect(ffmpeg.videoCodec).toBe('h264_nvenc');
    expect(ffmpeg.audioCodec).toBe('libmp3lame');
  });

  it('sin ruta configurada deja FFmpeg al PATH o a la descarga automática', () => {
    const { ffmpeg } = createPipelineServices(settings({ ffmpegPath: '', ffmpegAutoDownload: true }));

    expect(ffmpeg.configuredExecutablePath).toBe('');
    expect(ffmpeg.autoDownload).toBe(true);
    expect(ffmpeg.videoCodec).toBe('libx264');
  });

  it('pasa a la captura el navegador propio configurado (evita descargar Chromium)', () => {
    const { capture } = createPipelineServices(
      settings({ playwrightBrowserPath: 'C:\\Program Files\\Google\\Chrome\\chrome.exe', playwrightHeadless: false })
    );

    expect(capture.configuredExecutablePath).toBe('C:\\Program Files\\Google\\Chrome\\chrome.exe');
  });

  it('sin navegador configurado, la captura usa el Chromium de Playwright', () => {
    const { capture } = createPipelineServices(settings({ playwrightBrowserPath: '' }));

    expect(capture.configuredExecutablePath).toBe('');
  });

  it('no inyecta ningún servicio sin construir (captura, voz y FFmpeg reales)', () => {
    const services = createPipelineServices(settings());

    expect(services.tts).toBeDefined();
    expect(services.ffmpeg).toBeDefined();
    expect(services.capture).toBeDefined();
  });
});
