/**
 * Lectura de settings de la extensión desde VS Code.
 */

import * as vscode from 'vscode';

const SECTION = 'marketingVideoCreator';

export interface ExtensionSettings {
  apiKey: string;
  nanBuildersEnabled: boolean;
  nanBuildersApiUrl: string;
  ttsProvider: 'sapi' | 'edge-tts' | 'external';
  ttsVoice: string;
  ttsRate: number;
  ttsVolume: number;
  sttEnabled: boolean;
  sttEngine: 'sapi' | 'whisper' | 'external';
  imagesProvider: 'local' | 'unsplash' | 'pexels' | 'manual';
  playwrightAutoInstall: boolean;
  playwrightBrowserPath: string;
  playwrightHeadless: boolean;
  playwrightFps: number;
  ffmpegPath: string;
  ffmpegAutoDownload: boolean;
  outputDirectory: string;
  outputVideoCodec: string;
  outputAudioCodec: string;
  variantDesktopWidth: number;
  variantDesktopHeight: number;
  variantMobileWidth: number;
  variantMobileHeight: number;
  phasesEnabled: boolean;
  phasesList: Record<string, unknown>[];
}

export function getExtensionSettings(): ExtensionSettings {
  const config = vscode.workspace.getConfiguration(SECTION);

  return {
    apiKey: config.get('apiKey', '') as string,
    nanBuildersEnabled: config.get('nanBuilders.enabled', false) as boolean,
    nanBuildersApiUrl: config.get('nanBuilders.apiUrl', 'https://api.nan.builders/v1') as string,
    ttsProvider: config.get('tts.provider', 'sapi') as 'sapi' | 'edge-tts' | 'external',
    ttsVoice: config.get('tts.voice', 'Microsoft Pablo') as string,
    ttsRate: config.get('tts.rate', 1.0) as number,
    ttsVolume: config.get('tts.volume', 1.0) as number,
    sttEnabled: config.get('stt.enabled', false) as boolean,
    sttEngine: config.get('stt.engine', 'sapi') as 'sapi' | 'whisper' | 'external',
    imagesProvider: config.get('images.provider', 'manual') as 'local' | 'unsplash' | 'pexels' | 'manual',
    playwrightAutoInstall: config.get('playwright.autoInstall', true) as boolean,
    playwrightBrowserPath: config.get('playwright.browserPath', '') as string,
    playwrightHeadless: config.get('playwright.headless', true) as boolean,
    playwrightFps: config.get('playwright.fps', 30) as number,
    ffmpegPath: config.get('ffmpeg.path', '') as string,
    ffmpegAutoDownload: config.get('ffmpeg.autoDownload', true) as boolean,
    outputDirectory: config.get('output.directory', './output/demo-video') as string,
    outputVideoCodec: config.get('output.videoCodec', 'libx264') as string,
    outputAudioCodec: config.get('output.audioCodec', 'aac') as string,
    variantDesktopWidth: config.get('variants.desktop.width', 1920) as number,
    variantDesktopHeight: config.get('variants.desktop.height', 1080) as number,
    variantMobileWidth: config.get('variants.mobile.width', 1080) as number,
    variantMobileHeight: config.get('variants.mobile.height', 1920) as number,
    phasesEnabled: config.get('phases.enabled', true) as boolean,
    phasesList: config.get('phases.list', []) as Record<string, unknown>[],
  };
}
