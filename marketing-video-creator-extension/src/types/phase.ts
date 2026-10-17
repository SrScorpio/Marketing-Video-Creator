/**
 * Tipos para las fases del vídeo demo.
 */

/** Acción de captura ejecutada dentro de una fase. */
export type CaptureStep =
  | { action: 'goto'; url: string; waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' }
  | { action: 'click'; selector: string }
  | { action: 'fill'; selector: string; text: string }
  | { action: 'press'; selector: string; key: string }
  | { action: 'waitForSelector'; selector: string; timeoutMs?: number }
  | { action: 'wait'; ms: number };

export interface Phase {
  id: string;
  label: string;
  duration: number; // segundos
  /** URL propia de la fase (si no, se usa la del proyecto). */
  url?: string;
  script?: string;
  steps?: CaptureStep[];
  srtPath?: string;
  clipPath?: string;
  screenshotPath?: string;
}

export interface PhaseConfig {
  id: string;
  label: string;
  duration: number;
  /** URL propia de la fase (si no, se usa la del proyecto). */
  url?: string;
  /** Texto de la narración. Vacío = fase sin voz. */
  script?: string;
  /** Pasos de captura declarados para esta fase. */
  steps?: CaptureStep[];
}

export type PhaseStatus = 'pending' | 'capturing' | 'narrating' | 'rendering' | 'done' | 'error' | 'cancelled';

export interface PhaseState {
  phase: Phase;
  status: PhaseStatus;
  progress: number; // 0-100
  error?: string;
}

/** Instantánea serializable del estado de todas las fases (para el webview). */
export interface PhaseProgress {
  status: 'idle' | 'running' | 'done' | 'error' | 'cancelled';
  progress: number;
  phases: Array<{
    id: string;
    label: string;
    status: PhaseStatus;
    progress: number;
    clipPath?: string;
    error?: string;
  }>;
}
