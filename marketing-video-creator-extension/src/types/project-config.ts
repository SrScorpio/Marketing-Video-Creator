/**
 * Tipos para la configuración del proyecto de vídeo.
 */

export interface ProjectConfig {
  name: string;
  url: string;
  phases: Array<{ id: string; label: string; duration: number }>;
  outputDir: string;
  variant: 'desktop' | 'mobile' | 'both';
}

export interface ProjectConfigFile {
  version: string;
  project: ProjectConfig;
}

export interface SrtEntry {
  index: number;
  startTime: string; // HH:MM:SS,mmm
  endTime: string;   // HH:MM:SS,mmm
  text: string;
}
