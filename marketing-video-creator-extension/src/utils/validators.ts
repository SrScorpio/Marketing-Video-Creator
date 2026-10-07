/**
 * Validadores para configuración y datos de entrada.
 */

export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export function isValidSrtTime(time: string): boolean {
  return /^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/.test(time);
}

export function isValidPhaseId(id: string): boolean {
  return /^[a-z0-9\-]+$/.test(id);
}

export function isValidDuration(duration: number): boolean {
  return Number.isFinite(duration) && duration > 0 && duration <= 3600;
}

export function sanitizeFileName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\-_]/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 50);
}
