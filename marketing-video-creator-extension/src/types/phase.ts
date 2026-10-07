/**
 * Tipos para las fases del vídeo demo.
 */

export interface Phase {
  id: string;
  label: string;
  duration: number; // segundos
  script?: string;
  srtPath?: string;
  clipPath?: string;
  screenshotPath?: string;
}

export interface PhaseConfig {
  id: string;
  label: string;
  duration: number;
}

export interface PhaseState {
  phase: Phase;
  status: 'pending' | 'capturing' | 'narrating' | 'rendering' | 'done' | 'error';
  progress: number; // 0-100
  error?: string;
}
