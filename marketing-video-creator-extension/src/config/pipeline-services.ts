/**
 * Construcción de los servicios del pipeline a partir de los ajustes de la
 * extensión.
 *
 * Vive fuera de `extension.ts` (y no importa `vscode`) para poder verificar de
 * verdad que los ajustes que el usuario toca llegan al pipeline: `extension.ts`
 * no es importable en Node puro, así que un `tts: undefined` ahí pasaba
 * desapercibido y los ajustes de voz se ignoraban en silencio.
 */

import type { ExtensionSettings } from './extension-settings';
import { FfmpegBuilder } from '../services/ffmpeg-builder';
import { TtsService } from '../services/tts-service';

/** Subconjunto de ajustes que consumen los servicios del pipeline. */
export type PipelineServiceSettings = Pick<
  ExtensionSettings,
  | 'ttsProvider'
  | 'ttsVoice'
  | 'ttsRate'
  | 'ttsVolume'
  | 'ffmpegPath'
  | 'ffmpegAutoDownload'
  | 'outputVideoCodec'
  | 'outputAudioCodec'
>;

export interface PipelineServices {
  tts: TtsService;
  ffmpeg: FfmpegBuilder;
}

export function createPipelineServices(settings: PipelineServiceSettings): PipelineServices {
  return {
    tts: new TtsService({
      provider: settings.ttsProvider,
      voice: settings.ttsVoice,
      rate: settings.ttsRate,
      volume: settings.ttsVolume
    }),
    ffmpeg: new FfmpegBuilder({
      ffmpegPath: settings.ffmpegPath,
      autoDownload: settings.ffmpegAutoDownload,
      videoCodec: settings.outputVideoCodec,
      audioCodec: settings.outputAudioCodec
    })
  };
}
