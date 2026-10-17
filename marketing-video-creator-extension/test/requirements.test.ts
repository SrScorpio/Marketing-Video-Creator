/**
 * Requisitos externos del pipeline.
 *
 * El pipeline necesita FFmpeg/FFprobe, el navegador de Playwright y (para la
 * voz) SAPI de Windows; ninguno viaja en el VSIX. Estos tests fijan que el
 * chequeo detecta cada caso y que el mensaje es ACCIONABLE (comando o ajuste
 * concreto), en lugar del error crudo del binario que falta.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import {
  RequirementCheck,
  RequirementId,
  RequirementsProbes,
  checkRequirements,
  formatRequirement,
  summarizeRequirements
} from '../src/services/requirements';

function probes(overrides: Partial<RequirementsProbes> = {}): RequirementsProbes {
  return {
    platform: 'linux',
    findInPath: () => null,
    exists: () => false,
    ...overrides
  };
}

function byId(checks: RequirementCheck[], id: RequirementId): RequirementCheck {
  const found = checks.find(check => check.id === id);

  if (!found) {
    throw new Error(`No hay comprobación para ${id}`);
  }

  return found;
}

describe('checkRequirements · FFmpeg', () => {
  it('lo da por bueno si está en el PATH', () => {
    const checks = checkRequirements(probes({ findInPath: binary => (binary === 'ffmpeg' ? '/usr/bin/ffmpeg' : null) }));
    const ffmpeg = byId(checks, 'ffmpeg');

    expect(ffmpeg.status).toBe('ok');
    expect(ffmpeg.detail).toContain('/usr/bin/ffmpeg');
  });

  it('respeta la ruta configurada y avisa si no existe', () => {
    const ok = byId(checkRequirements(probes({ configuredFfmpegPath: '/opt/ff/bin/ffmpeg', exists: () => true })), 'ffmpeg');
    expect(ok.status).toBe('ok');
    expect(ok.detail).toContain('ruta configurada');

    const mal = byId(checkRequirements(probes({ configuredFfmpegPath: '/opt/ff/bin/ffmpeg' })), 'ffmpeg');
    expect(mal.status).toBe('missing');
    expect(mal.fix).toMatch(/marketingVideoCreator\.ffmpeg\.path/);
  });

  it('en Windows con descarga automática lo considera resoluble', () => {
    const ffmpeg = byId(checkRequirements(probes({ platform: 'win32', ffmpegAutoDownload: true })), 'ffmpeg');

    expect(ffmpeg.status).toBe('ok');
    expect(ffmpeg.detail).toMatch(/se descargará automáticamente/);
  });

  it('fuera de Windows propone el gestor de paquetes de cada sistema', () => {
    const linux = byId(checkRequirements(probes({ platform: 'linux' })), 'ffmpeg');
    expect(linux.status).toBe('missing');
    expect(linux.command).toBe('sudo apt install ffmpeg');

    const mac = byId(checkRequirements(probes({ platform: 'darwin' })), 'ffmpeg');
    expect(mac.command).toBe('brew install ffmpeg');
  });

  it('en Windows sin descarga automática es un bloqueo', () => {
    const ffmpeg = byId(checkRequirements(probes({ platform: 'win32', ffmpegAutoDownload: false })), 'ffmpeg');

    expect(ffmpeg.status).toBe('missing');
    expect(ffmpeg.detail).toMatch(/descarga automática está desactivada/);
  });
});

describe('checkRequirements · FFprobe', () => {
  it('lo encuentra junto a FFmpeg', () => {
    const checks = checkRequirements(
      probes({
        findInPath: binary => (binary === 'ffmpeg' ? '/usr/local/bin/ffmpeg' : null),
        exists: filePath => filePath.endsWith('ffprobe') || filePath.endsWith('ffmpeg')
      })
    );

    const ffprobe = byId(checks, 'ffprobe');
    expect(ffprobe.status).toBe('ok');
    expect(ffprobe.severity).toBe('opcional');
  });

  it('sin él degrada en lugar de bloquear (la duración se estima)', () => {
    const ffprobe = byId(
      checkRequirements(probes({ findInPath: binary => (binary === 'ffmpeg' ? '/usr/bin/ffmpeg' : null), exists: filePath => filePath === '/usr/bin/ffmpeg' })),
      'ffprobe'
    );

    expect(ffprobe.status).toBe('degraded');
    expect(summarizeRequirements([ffprobe]).ok).toBe(true);
  });
});

describe('checkRequirements · navegador de Playwright', () => {
  it('ok si el Chromium de Playwright está descargado', () => {
    const chromium = byId(
      checkRequirements(probes({ chromiumPath: '/home/u/.cache/ms-playwright/chromium-1091/chrome-linux/chrome', exists: () => true })),
      'chromium'
    );

    expect(chromium.status).toBe('ok');
    expect(chromium.detail).toMatch(/Chromium de Playwright instalado/);
  });

  it('bloquea con el comando a ejecutar si no está descargado', () => {
    const chromium = byId(checkRequirements(probes()), 'chromium');

    expect(chromium.status).toBe('missing');
    expect(chromium.severity).toBe('obligatorio');
    expect(chromium.command).toBe('npx playwright install chromium');
    expect(summarizeRequirements([chromium]).ok).toBe(false);
  });

  it('acepta un navegador propio (Chrome/Edge) configurado', () => {
    const chromium = byId(
      checkRequirements(probes({ configuredBrowserPath: 'C:\\Program Files\\Google\\Chrome\\chrome.exe', exists: () => true })),
      'chromium'
    );

    expect(chromium.status).toBe('ok');
    expect(chromium.detail).toMatch(/navegador propio configurado/);
  });

  it('avisa si la ruta de navegador configurada no existe', () => {
    const chromium = byId(checkRequirements(probes({ configuredBrowserPath: '/ruta/inexistente/chrome' })), 'chromium');

    expect(chromium.status).toBe('missing');
    expect(chromium.fix).toMatch(/playwright\.browserPath/);
  });
});

describe('checkRequirements · narración', () => {
  it('en Windows con SAPI está lista (sin API key)', () => {
    const tts = byId(checkRequirements(probes({ platform: 'win32' })), 'tts');

    expect(tts.status).toBe('ok');
    expect(tts.detail).toMatch(/SAPI de Windows/);
  });

  it('fuera de Windows degrada: el vídeo se genera sin voz', () => {
    const tts = byId(checkRequirements(probes({ platform: 'linux' })), 'tts');

    expect(tts.status).toBe('degraded');
    expect(tts.severity).toBe('opcional');
  });

  it('un provider no implementado degrada en lugar de romper', () => {
    const tts = byId(checkRequirements(probes({ platform: 'win32', configuredTtsProvider: 'edge-tts' })), 'tts');

    expect(tts.status).toBe('degraded');
    expect(tts.detail).toMatch(/todavía no implementado/);
  });
});

describe('resumen para el usuario', () => {
  it('con todo resuelto lo dice en una línea', () => {
    const checks = checkRequirements(
      probes({
        platform: 'win32',
        findInPath: binary => `/usr/bin/${binary}`,
        exists: () => true,
        chromiumPath: 'C:\\ms-playwright\\chrome.exe'
      })
    );

    const summary = summarizeRequirements(checks);
    expect(summary.ok).toBe(true);
    expect(summary.blocking).toEqual([]);
    expect(summary.text).toBe('Requisitos completos.');
  });

  it('marca lo que degrada sin bloquear', () => {
    const existentes = ['/usr/bin/ffmpeg', '/usr/bin/ffprobe', '/opt/chrome'];
    const checks = checkRequirements(
      probes({
        platform: 'linux',
        findInPath: binary => `/usr/bin/${binary}`,
        exists: filePath => existentes.includes(filePath),
        chromiumPath: '/opt/chrome'
      })
    );
    const summary = summarizeRequirements(checks);

    expect(summary.ok).toBe(true);
    expect(summary.degraded.map(check => check.id)).toEqual(['tts']);
    expect(summary.text).toMatch(/funcionará degradado/);
  });

  it('nombra el bloqueo y su arreglo', () => {
    const summary = summarizeRequirements(checkRequirements(probes()));

    expect(summary.ok).toBe(false);
    expect(summary.blocking.map(check => check.id)).toEqual(['ffmpeg', 'chromium']);
    expect(summary.text).toMatch(/Faltan requisitos/);
    expect(summary.text).toMatch(/npx playwright install chromium/);
  });

  it('formatea cada requisito en una línea con su comando', () => {
    const chromium = byId(checkRequirements(probes()), 'chromium');

    expect(formatRequirement(chromium)).toMatch(/^❌ Navegador \(Playwright\): /);
    expect(formatRequirement(chromium)).toContain('npx playwright install chromium');
    expect(formatRequirement({ id: 'tts', label: 'Narración (TTS)', severity: 'opcional', status: 'ok', detail: 'listo' })).toMatch(/^✅ /);
  });
});

describe('premisa real: por qué existe este chequeo', () => {
  it('sin navegador instalado, Playwright falla con un error crudo', async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvc-pw-empty-'));
    const previous = process.env.PLAYWRIGHT_BROWSERS_PATH;
    process.env.PLAYWRIGHT_BROWSERS_PATH = emptyDir;

    try {
      const { chromium } = await import('@playwright/test');

      // La misma sonda que usa el host para saber dónde espera el navegador.
      const expected = chromium.executablePath();
      expect(expected.startsWith(emptyDir)).toBe(true);
      expect(fs.existsSync(expected)).toBe(false);

      // Y sin navegador, lanzar revienta: esto es lo que el chequeo evita.
      await expect(chromium.launch({ headless: true })).rejects.toThrow(/Executable doesn't exist|playwright install/i);
    } finally {
      if (previous === undefined) {
        delete process.env.PLAYWRIGHT_BROWSERS_PATH;
      } else {
        process.env.PLAYWRIGHT_BROWSERS_PATH = previous;
      }
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  }, 60000);
});
