/**
 * Comprobación de los requisitos externos del pipeline («satélites»).
 *
 * El pipeline no es autónomo: necesita binarios y servicios que no viajan en el
 * VSIX (FFmpeg/FFprobe, el navegador de Playwright y, para la voz, SAPI de
 * Windows). Este módulo los comprueba ANTES de grabar para dar un mensaje
 * accionable en lugar del error crudo del binario que falta a mitad de faena.
 *
 * Sin dependencia de VS Code: las sondas (PATH, filesystem, ruta del navegador)
 * se inyectan, así que se prueba en Node puro.
 */

export type RequirementId = 'ffmpeg' | 'ffprobe' | 'chromium' | 'tts';

/** Plataformas que distingue el chequeo (valores de `process.platform`). */
export type Platform = 'win32' | 'darwin' | 'linux' | (string & {});

export type RequirementStatus = 'ok' | 'missing' | 'degraded';

/** `obligatorio` = sin esto no hay vídeo; `opcional` = degrada pero funciona. */
export type RequirementSeverity = 'obligatorio' | 'opcional';

export interface RequirementCheck {
  id: RequirementId;
  label: string;
  severity: RequirementSeverity;
  status: RequirementStatus;
  /** Qué se ha encontrado o qué falta, en una línea. */
  detail: string;
  /** Acción concreta para resolverlo. */
  fix?: string;
  /** Comando que el usuario puede ejecutar tal cual. */
  command?: string;
}

export interface RequirementsProbes {
  platform: Platform;
  /** Busca un ejecutable en el PATH (lo aporta FfmpegBuilder). */
  findInPath: (binary: string) => string | null;
  /** Comprueba que un fichero existe. */
  exists: (filePath: string) => boolean;
  /** Ruta donde Playwright espera su Chromium (null si no se puede saber). */
  chromiumPath?: string | null;
  configuredFfmpegPath?: string;
  configuredFfprobePath?: string;
  configuredBrowserPath?: string;
  configuredTtsProvider?: string;
  ffmpegAutoDownload?: boolean;
}

export interface RequirementsSummary {
  /** Comprobaciones obligatorias que fallan: bloquean la generación. */
  blocking: RequirementCheck[];
  /** Comprobaciones que funcionan pero degradadas (sin voz, sin ffprobe...). */
  degraded: RequirementCheck[];
  ok: boolean;
  /** Una línea lista para enseñar al usuario. */
  text: string;
}

function ffmpegFix(platform: Platform): { fix: string; command?: string } {
  if (platform === 'win32') {
    return {
      fix: 'Activa la descarga automática (marketingVideoCreator.ffmpeg.autoDownload) o define la ruta en marketingVideoCreator.ffmpeg.path.'
    };
  }

  if (platform === 'darwin') {
    return { fix: 'Instala FFmpeg o define marketingVideoCreator.ffmpeg.path.', command: 'brew install ffmpeg' };
  }

  return {
    fix: 'Instala FFmpeg o define marketingVideoCreator.ffmpeg.path.',
    command: 'sudo apt install ffmpeg'
  };
}

/**
 * Comprueba FFmpeg, FFprobe, el navegador de Playwright y el motor de voz.
 * No lanza: devuelve el estado para que quien llame decida (avisar, parar...).
 */
export function checkRequirements(probes: RequirementsProbes): RequirementCheck[] {
  const checks: RequirementCheck[] = [];
  const autoDownload = probes.ffmpegAutoDownload ?? true;

  // --- FFmpeg (obligatorio) -------------------------------------------------
  let ffmpegResolved: string | null = null;

  if (probes.configuredFfmpegPath) {
    if (probes.exists(probes.configuredFfmpegPath)) {
      ffmpegResolved = probes.configuredFfmpegPath;
      checks.push({
        id: 'ffmpeg',
        label: 'FFmpeg',
        severity: 'obligatorio',
        status: 'ok',
        detail: `ruta configurada: ${probes.configuredFfmpegPath}`
      });
    } else {
      checks.push({
        id: 'ffmpeg',
        label: 'FFmpeg',
        severity: 'obligatorio',
        status: 'missing',
        detail: `la ruta configurada no existe: ${probes.configuredFfmpegPath}`,
        fix: 'Corrige marketingVideoCreator.ffmpeg.path o déjalo vacío para usar el PATH.'
      });
    }
  } else {
    ffmpegResolved = probes.findInPath('ffmpeg');

    if (ffmpegResolved) {
      checks.push({
        id: 'ffmpeg',
        label: 'FFmpeg',
        severity: 'obligatorio',
        status: 'ok',
        detail: `en el PATH: ${ffmpegResolved}`
      });
    } else if (probes.platform === 'win32' && autoDownload) {
      checks.push({
        id: 'ffmpeg',
        label: 'FFmpeg',
        severity: 'obligatorio',
        status: 'ok',
        detail: 'no está en el PATH: se descargará automáticamente en el primer montaje (~80 MB, en %APPDATA%\\MarketingVideoCreator)'
      });
    } else {
      const { fix, command } = ffmpegFix(probes.platform);
      checks.push({
        id: 'ffmpeg',
        label: 'FFmpeg',
        severity: 'obligatorio',
        status: 'missing',
        detail: 'no está en el PATH y la descarga automática está desactivada',
        fix,
        command
      });
    }
  }

  // --- FFprobe (opcional: sin él la duración se estima) ---------------------
  const ffprobeConfigured = probes.configuredFfprobePath;
  const ffprobeInPath = probes.findInPath('ffprobe');
  const ffprobe = ffprobeConfigured || ffprobeInPath;
  const ffprobeOk = ffprobe
    ? probes.exists(ffprobe)
    : ffmpegResolved
      ? probes.exists(
          ffmpegResolved.replace(/ffmpeg(\.exe)?$/i, probes.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
        )
      : false;

  checks.push(
    ffprobeOk
      ? {
          id: 'ffprobe',
          label: 'FFprobe',
          severity: 'opcional',
          status: 'ok',
          detail: `disponible: ${ffprobe}`
        }
      : {
          id: 'ffprobe',
          label: 'FFprobe',
          severity: 'opcional',
          status: 'degraded',
          detail: 'no encontrado junto a FFmpeg: la duración de los clips se estimará desde la configuración',
          fix: 'Instala el paquete completo de FFmpeg (incluye ffprobe).'
        }
  );

  // --- Navegador de Playwright (obligatorio) --------------------------------
  if (probes.configuredBrowserPath) {
    checks.push(
      probes.exists(probes.configuredBrowserPath)
        ? {
            id: 'chromium',
            label: 'Navegador (Playwright)',
            severity: 'obligatorio',
            status: 'ok',
            detail: `navegador propio configurado: ${probes.configuredBrowserPath}`
          }
        : {
            id: 'chromium',
            label: 'Navegador (Playwright)',
            severity: 'obligatorio',
            status: 'missing',
            detail: `la ruta de navegador configurada no existe: ${probes.configuredBrowserPath}`,
            fix: 'Corrige marketingVideoCreator.playwright.browserPath apuntando a chrome.exe/msedge.exe, o déjalo vacío.'
          }
    );
  } else if (probes.chromiumPath && probes.exists(probes.chromiumPath)) {
    checks.push({
      id: 'chromium',
      label: 'Navegador (Playwright)',
      severity: 'obligatorio',
      status: 'ok',
      detail: `Chromium de Playwright instalado: ${probes.chromiumPath}`
    });
  } else {
    checks.push({
      id: 'chromium',
      label: 'Navegador (Playwright)',
      severity: 'obligatorio',
      status: 'missing',
      detail: 'Chromium de Playwright no instalado (la grabación no puede arrancar)',
      fix: 'Instálalo desde aquí (botón «Instalar navegador»), con marketingVideoCreator.playwright.autoInstall activo, o a mano.',
      command: 'npx playwright install chromium'
    });
  }

  // --- Voz (opcional: sin ella el vídeo sale sin narración) -----------------
  const provider = probes.configuredTtsProvider ?? 'sapi';

  if (provider !== 'sapi') {
    checks.push({
      id: 'tts',
      label: 'Narración (TTS)',
      severity: 'opcional',
      status: 'degraded',
      detail: `provider '${provider}' todavía no implementado: el vídeo se genera sin voz`,
      fix: "Usa 'sapi' (Windows) o deja la narración vacía."
    });
  } else if (probes.platform === 'win32') {
    checks.push({
      id: 'tts',
      label: 'Narración (TTS)',
      severity: 'opcional',
      status: 'ok',
      detail: 'SAPI de Windows (System.Speech.Synthesis), sin API key ni conexión'
    });
  } else {
    checks.push({
      id: 'tts',
      label: 'Narración (TTS)',
      severity: 'opcional',
      status: 'degraded',
      detail: 'SAPI solo existe en Windows: en este sistema el vídeo se genera sin voz',
      fix: 'Ejecuta la extensión en Windows para tener narración.'
    });
  }

  return checks;
}

/** Resume las comprobaciones: qué bloquea, qué degrada y una línea de texto. */
export function summarizeRequirements(checks: RequirementCheck[]): RequirementsSummary {
  const blocking = checks.filter(check => check.severity === 'obligatorio' && check.status === 'missing');
  const degraded = checks.filter(check => check.status === 'degraded');

  if (blocking.length === 0) {
    return {
      blocking,
      degraded,
      ok: true,
      text:
        degraded.length === 0
          ? 'Requisitos completos.'
          : `Requisitos suficientes; funcionará degradado: ${degraded.map(check => check.label).join(', ')}.`
    };
  }

  const detalle = blocking.map(check => `${check.label}: ${check.command ?? check.fix ?? 'falta instalarlo'}`).join(' · ');

  return { blocking, degraded, ok: false, text: `Faltan requisitos para generar el vídeo: ${detalle}` };
}

/** Formatea una comprobación para el log (una línea por requisito). */
export function formatRequirement(check: RequirementCheck): string {
  const icono = check.status === 'ok' ? '✅' : check.status === 'degraded' ? '⚠️' : '❌';
  const comando = check.command ? ` → ${check.command}` : '';
  return `${icono} ${check.label}: ${check.detail}${check.fix ? ` (${check.fix})` : ''}${comando}`;
}
