/**
 * E2E Linux: pipeline completo con navegador real (Playwright) y FFmpeg real.
 *
 * Ejecuta el código COMPILADO (dist/) contra una página local de prueba y
 * comprueba con FFprobe que se generan los dos entregables:
 *   - desktop: 1920x1080
 *   - mobile:  1080x1920
 *
 * Uso: npm run compile && npm run test:e2e
 */

import * as child_process from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');

const { PhaseManager } = require(path.join(projectRoot, 'dist', 'services', 'phase-manager.js'));
const { FfmpegBuilder } = require(path.join(projectRoot, 'dist', 'services', 'ffmpeg-builder.js'));

const results = [];

function check(name, condition, detail = '') {
  results.push({ name, ok: !!condition, detail });
  console.log(`${condition ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

function ffprobe(filePath) {
  const output = child_process.execFileSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'stream=codec_type,width,height',
      '-show_entries',
      'format=duration',
      '-of',
      'json',
      filePath
    ],
    { encoding: 'utf-8' }
  );

  const parsed = JSON.parse(output);
  const video = (parsed.streams ?? []).find(stream => stream.codec_type === 'video');
  const audio = (parsed.streams ?? []).find(stream => stream.codec_type === 'audio');

  return {
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    durationSec: Number.parseFloat(parsed.format?.duration ?? '0'),
    hasAudio: !!audio
  };
}

function writeFixturePage(dir) {
  const page = path.join(dir, 'app.html');

  fs.writeFileSync(
    page,
    `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><title>App de demo</title><style>
body{font-family:sans-serif;margin:24px}button,input{font-size:18px;padding:8px}
#resultado{margin-top:16px;font-weight:bold}
</style></head>
<body>
  <h1>App de demo</h1>
  <input id="nombre" placeholder="Nombre" />
  <button id="empezar">Empezar</button>
  <div id="resultado"></div>
  <script>
    document.getElementById('empezar').addEventListener('click', () => {
      document.getElementById('resultado').textContent = 'Hola ' + (document.getElementById('nombre').value || 'mundo');
    });
  </script>
</body>
</html>`,
    'utf-8'
  );

  return `file://${page}`;
}

const phases = [
  {
    id: '01-presentacion',
    label: 'Presentación',
    duration: 3,
    script: 'Bienvenido a la demo de la aplicación. Esta primera fase presenta la pantalla principal.',
    steps: [
      { action: 'waitForSelector', selector: '#empezar', timeoutMs: 10000 },
      { action: 'fill', selector: '#nombre', text: 'Scorpio' },
      { action: 'wait', ms: 700 }
    ]
  },
  {
    id: '02-resultado',
    label: 'Resultado',
    duration: 3,
    script: 'Al pulsar el botón, la aplicación muestra el resultado del formulario con el nombre indicado.',
    steps: [
      { action: 'click', selector: '#empezar' },
      { action: 'waitForSelector', selector: '#resultado', timeoutMs: 10000 },
      { action: 'wait', ms: 700 }
    ]
  }
];

async function runVariant(variant, url, outputDir) {
  const manager = new PhaseManager({
    outputDir,
    projectUrl: url,
    variant,
    ffmpeg: new FfmpegBuilder(),
    settleMs: 300
  });

  manager.on('log', message => console.log(`   [${variant}] ${message}`));

  manager.setPhases(phases);
  const snapshot = await manager.runAll();

  check(
    `[${variant}] fases capturadas sin error`,
    snapshot.phases.every(phase => phase.status === 'done'),
    snapshot.phases.map(phase => `${phase.id}=${phase.status}`).join(', ')
  );

  for (const phase of snapshot.phases) {
    check(`[${variant}] clip de ${phase.id} generado`, !!phase.clipPath && fs.existsSync(phase.clipPath));
  }

  const srtPath = manager.getSrtPath(phases[0].id);
  check(`[${variant}] subtítulos SRT generados`, fs.existsSync(srtPath), srtPath);

  let finalVideo = '';
  try {
    finalVideo = variant === 'mobile' ? await manager.buildMobileVideo() : await manager.buildDesktopVideo();
  } catch (error) {
    check(`[${variant}] MP4 final generado`, false, error instanceof Error ? error.message : String(error));
    return '';
  }

  check(`[${variant}] MP4 final generado`, fs.existsSync(finalVideo), finalVideo);

  if (!finalVideo || !fs.existsSync(finalVideo)) {
    return '';
  }

  const info = ffprobe(finalVideo);
  const expected = variant === 'mobile' ? '1080x1920' : '1920x1080';

  check(
    `[${variant}] resolución ${expected}`,
    `${info.width}x${info.height}` === expected,
    `obtenido ${info.width}x${info.height}`
  );
  check(`[${variant}] pista de audio presente`, info.hasAudio);
  check(`[${variant}] duración > 0`, info.durationSec > 0, `${info.durationSec.toFixed(2)}s`);

  return finalVideo;
}

async function main() {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvc-e2e-'));

  try {
    const ffmpeg = FfmpegBuilder.findInPath('ffmpeg');
    check('FFmpeg disponible en el sistema', !!ffmpeg, ffmpeg ?? 'no encontrado');

    const url = writeFixturePage(workDir);
    check('Página de prueba creada', fs.existsSync(path.join(workDir, 'app.html')), url);

    const desktopVideo = await runVariant('desktop', url, path.join(workDir, 'desktop-run'));
    const mobileVideo = await runVariant('mobile', url, path.join(workDir, 'mobile-run'));

    console.log(`\nArtefactos E2E:`);
    console.log(` - desktop: ${desktopVideo}`);
    console.log(` - mobile:  ${mobileVideo}`);
  } finally {
    const failed = results.filter(result => !result.ok);
    console.log(`\n${results.length - failed.length}/${results.length} comprobaciones OK`);

    if (failed.length > 0) {
      console.error('Comprobaciones fallidas:');
      for (const result of failed) {
        console.error(` - ${result.name}${result.detail ? `: ${result.detail}` : ''}`);
      }
      process.exitCode = 1;
    } else {
      console.log('E2E OK');
    }

    if (process.env.MVC_E2E_KEEP !== '1') {
      fs.rmSync(workDir, { recursive: true, force: true });
    } else {
      console.log(`Directorio E2E conservado: ${workDir}`);
    }
  }
}

main().catch(error => {
  console.error('E2E falló:', error);
  process.exitCode = 1;
});
