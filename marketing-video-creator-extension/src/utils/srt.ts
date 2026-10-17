/**
 * Utilidades SRT puras (sin dependencias de VS Code).
 * Parseo, render y generación de subtítulos desde el guion de una fase.
 */

import { SrtEntry } from '../types/project-config';

/** Formatea milisegundos a HH:MM:SS,mmm */
export function formatSrtTime(ms: number): string {
  const safe = Math.max(0, Math.round(ms));
  const hours = Math.floor(safe / 3600000);
  const minutes = Math.floor((safe % 3600000) / 60000);
  const seconds = Math.floor((safe % 60000) / 1000);
  const millis = safe % 1000;

  return (
    `${String(hours).padStart(2, '0')}:` +
    `${String(minutes).padStart(2, '0')}:` +
    `${String(seconds).padStart(2, '0')},` +
    `${String(millis).padStart(3, '0')}`
  );
}

/** Convierte HH:MM:SS,mmm a milisegundos. Devuelve null si el formato no es válido. */
export function parseSrtTime(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2}):(\d{2}),(\d{3})$/.exec(time.trim());
  if (!match) {
    return null;
  }

  const [, hh, mm, ss, ms] = match;
  return (
    Number(hh) * 3600000 +
    Number(mm) * 60000 +
    Number(ss) * 1000 +
    Number(ms)
  );
}

/** Parsea el contenido de un fichero SRT. Ignora bloques malformados. */
export function parseSrt(content: string): SrtEntry[] {
  const entries: SrtEntry[] = [];
  const blocks = content.replace(/\r\n/g, '\n').trim().split(/\n{2,}/);

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 3) {
      continue;
    }

    const timeMatch = /(\d{1,2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2},\d{3})/.exec(lines[1]);
    if (!timeMatch) {
      continue;
    }

    const index = Number.parseInt(lines[0], 10);
    entries.push({
      index: Number.isFinite(index) ? index : entries.length + 1,
      startTime: timeMatch[1],
      endTime: timeMatch[2],
      text: lines.slice(2).join('\n')
    });
  }

  return entries;
}

/** Renderiza entradas SRT a texto. Reindexa 1..n para evitar huecos. */
export function renderSrt(entries: SrtEntry[]): string {
  return entries
    .map((entry, position) => `${position + 1}\n${entry.startTime} --> ${entry.endTime}\n${entry.text}`)
    .join('\n\n')
    .concat(entries.length > 0 ? '\n' : '');
}

/** Divide un guion en frases legibles (máx. ~90 caracteres por subtítulo). */
export function splitScriptIntoCues(script: string, maxChars: number = 90): string[] {
  const normalized = script.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return [];
  }

  const sentences = normalized
    .split(/(?<=[.!?…])\s+/)
    .map(sentence => sentence.trim())
    .filter(sentence => sentence.length > 0);

  const cues: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if (current.length === 0) {
      current = sentence;
      continue;
    }

    if ((current + ' ' + sentence).length <= maxChars) {
      current = `${current} ${sentence}`;
    } else {
      cues.push(current);
      current = sentence;
    }
  }

  if (current.length > 0) {
    cues.push(current);
  }

  return cues;
}

/**
 * Genera las entradas SRT de una fase distribuyendo el guion de forma
 * proporcional a la duración total (en milisegundos).
 */
export function buildSrtFromScript(script: string, durationMs: number): SrtEntry[] {
  const cues = splitScriptIntoCues(script);
  if (cues.length === 0 || durationMs <= 0) {
    return [];
  }

  const totalChars = cues.reduce((sum, cue) => sum + cue.length, 0) || 1;
  const entries: SrtEntry[] = [];
  let cursor = 0;

  cues.forEach((cue, position) => {
    const share = Math.round((cue.length / totalChars) * durationMs);
    const start = cursor;
    const end = position === cues.length - 1 ? Math.round(durationMs) : Math.min(durationMs, start + share);
    cursor = end;

    entries.push({
      index: position + 1,
      startTime: formatSrtTime(start),
      endTime: formatSrtTime(Math.max(end, start + 1)),
      text: cue
    });
  });

  return entries;
}
