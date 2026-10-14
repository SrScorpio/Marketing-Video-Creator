#!/usr/bin/env node
/**
 * Estado de los requisitos externos (FFmpeg, FFprobe, navegador, voz) en la
 * máquina actual, sin abrir VS Code.
 *
 * Usa el MISMO código que la extensión (`dist/services/requirements.js`), no una
 * copia: si aquí sale verde, el chequeo de la extensión sale verde.
 *
 * Uso:
 *   npm run check:requirements
 *
 * Salida: una línea por requisito. Código de salida 1 si falta algo bloqueante.
 */

import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

if (!fs.existsSync(path.join(root, 'dist', 'services', 'requirements.js'))) {
  console.error('Falta dist/. Ejecuta antes: npm run compile');
  process.exit(2);
}

const { checkRequirements, formatRequirement, summarizeRequirements } = require(
  path.join(root, 'dist', 'services', 'requirements.js')
);
const { FfmpegBuilder } = require(path.join(root, 'dist', 'services', 'ffmpeg-builder.js'));

/** La misma sonda que usa el host de la extensión (Playwright → dist de Chromium). */
function detectChromiumPath() {
  try {
    const resolved = require('@playwright/test').chromium.executablePath();
    return typeof resolved === 'string' && resolved.length > 0 ? resolved : null;
  } catch {
    return null;
  }
}

const checks = checkRequirements({
  platform: process.platform,
  findInPath: binary => FfmpegBuilder.findInPath(binary),
  exists: filePath => {
    try {
      return fs.existsSync(filePath);
    } catch {
      return false;
    }
  },
  chromiumPath: detectChromiumPath(),
  configuredFfmpegPath: process.env.MVC_FFMPEG_PATH ?? '',
  configuredBrowserPath: process.env.MVC_BROWSER_PATH ?? '',
  configuredTtsProvider: process.env.MVC_TTS_PROVIDER ?? 'sapi',
  ffmpegAutoDownload: process.env.MVC_FFMPEG_AUTODOWNLOAD !== 'false'
});

console.log(`Requisitos en ${process.platform} (node ${process.version}):\n`);
for (const check of checks) {
  console.log(formatRequirement(check));
}

const summary = summarizeRequirements(checks);
console.log(`\n${summary.ok ? '✅' : '❌'} ${summary.text}`);

if (summary.blocking.length > 0) {
  console.log(`\nBloquean la generación: ${summary.blocking.map(check => check.label).join(', ')}`);
}

process.exit(summary.ok ? 0 : 1);
