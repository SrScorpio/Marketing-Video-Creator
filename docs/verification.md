# Verificación del pipeline (Marketing Video Creator)

Evidencia de la entrega: **qué se ha ejecutado de verdad**, con qué resultado y
qué queda fuera de esta verificación. Entorno: Linux (Ubuntu, kernel 6.8),
Node 22, FFmpeg/FFprobe reales, Chromium de Playwright real y **VS Code real**
(1.141.1) para los tests del Extension Host.

## Resumen

| Nivel | Comando | Resultado |
|---|---|---|
| Compilación | `npm run compile` | limpio (tsc + `vite build`) |
| Tests (unitarios + integración FFmpeg) | `npm test` | **65/65** (7 ficheros) |
| E2E con navegador y FFmpeg reales | `npm run test:e2e` | **18/18** comprobaciones |
| Extension Host en VS Code real | `npm run test:vscode` | **6/6**, `Exit code 0` |
| Empaquetado instalable | `npm run package:vsix` | VSIX 958 files, 6.67 MB |

## Salida real

```text
### COMPILE
dist/panel/src/panel/index.html    0.30 kB │ gzip:  0.23 kB
dist/panel/index.js              331.87 kB │ gzip: 92.17 kB
✓ built in 19.42s

### TESTS (vitest)
 ✓ test/manifest.test.ts (9 tests) 24ms
 ✓ test/ffmpeg-args.test.ts (17 tests) 29ms
 ✓ test/srt.test.ts (12 tests) 26ms
 ✓ test/pipeline-services.test.ts (4 tests) 13ms
 ✓ test/panel.test.tsx (6 tests) 384ms
 ✓ test/phase-manager.test.ts (5 tests) 9279ms
 ✓ test/ffmpeg-builder.test.ts (12 tests) 10477ms
 Test Files  7 passed (7)
      Tests  65 passed (65)

### E2E
✅ FFmpeg disponible en el sistema — /home/hermes/.hermes/tools/ffmpeg-9.0.1-linux-x64/bin/ffmpeg
✅ Página de prueba creada — file:///home/hermes/.hermes/cache/scratch/mvc-e2e-xIJ3eP/app.html
✅ [desktop] fases capturadas sin error — 01-presentacion=done, 02-resultado=done
✅ [desktop] clip de 01-presentacion generado
✅ [desktop] clip de 02-resultado generado
✅ [desktop] subtítulos SRT generados — /home/hermes/.hermes/cache/scratch/mvc-e2e-xIJ3eP/desktop-run/srt/01-presentacion.srt
✅ [desktop] MP4 final generado — /home/hermes/.hermes/cache/scratch/mvc-e2e-xIJ3eP/desktop-run/desktop/demo-video-desktop.mp4
✅ [desktop] resolución 1920x1080 — obtenido 1920x1080
✅ [desktop] pista de audio presente
✅ [desktop] duración > 0 — 4.90s
✅ [mobile] fases capturadas sin error — 01-presentacion=done, 02-resultado=done
✅ [mobile] clip de 01-presentacion generado
✅ [mobile] clip de 02-resultado generado
✅ [mobile] subtítulos SRT generados — /home/hermes/.hermes/cache/scratch/mvc-e2e-xIJ3eP/mobile-run/srt/01-presentacion.srt
✅ [mobile] MP4 final generado — /home/hermes/.hermes/cache/scratch/mvc-e2e-xIJ3eP/mobile-run/mobile/demo-video-mobile.mp4
✅ [mobile] resolución 1080x1920 — obtenido 1080x1920
✅ [mobile] pista de audio presente
✅ [mobile] duración > 0 — 5.00s
Artefactos E2E:
 - desktop: /home/hermes/.hermes/cache/scratch/mvc-e2e-xIJ3eP/desktop-run/desktop/demo-video-desktop.mp4
 - mobile:  /home/hermes/.hermes/cache/scratch/mvc-e2e-xIJ3eP/mobile-run/mobile/demo-video-mobile.mp4
18/18 comprobaciones OK
E2E OK

### EXTENSION HOST (VS Code real)
  Marketing Video Creator · Extension Host
    ✔ la extensión está presente y se activa (927ms)
    ✔ registra los 6 comandos declarados en el manifiesto (68ms)
    ✔ la configuración declarada se resuelve con sus valores por defecto
    ✔ abre el panel webview sin lanzar errores
    ✔ los comandos sin captura previa responden sin romper (avisan y salen) (753ms)
    ✔ el manifest del host expone el bundle compilado del panel
  6 passing (2s)
Exit code:   0

### ffprobe de los MP4
--- /home/hermes/.hermes/cache/scratch/mvc-e2e-xIJ3eP/desktop-run/desktop/demo-video-desktop.mp4
codec_name=h264
width=1920
height=1080
codec_name=aac
sample_rate=48000
channels=2
duration=4.900000
--- /home/hermes/.hermes/cache/scratch/mvc-e2e-xIJ3eP/mobile-run/mobile/demo-video-mobile.mp4
codec_name=h264
width=1080
height=1920
codec_name=aac
sample_rate=48000
channels=2
duration=5.002667

### VSIX
 DONE  Packaged: /tmp/mvc-evidence/marketing-video-creator-0.1.0.vsix (958 files, 6.67 MB)
    14192  2026-10-14 15:08   extension/dist/extension.js
   331898  2026-10-14 15:08   extension/dist/panel/index.js
```

## Extension Host (VS Code real, vía xvfb)

La extensión se carga con `--extensionDevelopmentPath` y se activa dentro de un
VS Code real: no es una simulación. Se comprueba activación, los 6 comandos
registrados, los valores por defecto de la configuración, la apertura del panel
webview y que los comandos sin captura previa avisan sin romper.

```text
Marketing Video Creator · Extension Host
    ✔ la extensión está presente y se activa (927ms)
    ✔ registra los 6 comandos declarados en el manifiesto (68ms)
    ✔ la configuración declarada se resuelve con sus valores por defecto
    ✔ abre el panel webview sin lanzar errores
    ✔ los comandos sin captura previa responden sin romper (avisan y salen) (753ms)
    ✔ el manifest del host expone el bundle compilado del panel
  6 passing (2s)
Exit code:   0
```

## ffprobe de los MP4 entregados por el E2E

```text
--- /home/hermes/.hermes/cache/scratch/mvc-e2e-xIJ3eP/desktop-run/desktop/demo-video-desktop.mp4
codec_name=h264
width=1920
height=1080
codec_name=aac
sample_rate=48000
channels=2
duration=4.900000
--- /home/hermes/.hermes/cache/scratch/mvc-e2e-xIJ3eP/mobile-run/mobile/demo-video-mobile.mp4
codec_name=h264
width=1080
height=1920
codec_name=aac
sample_rate=48000
channels=2
duration=5.002667
```

## VSIX: contenido verificado

El paquete instalable debe incluir el bundle compilado **y** las dependencias de
ejecución (Playwright, React, webview-ui-toolkit). Se comprueba el contenido real
del archivo (no la salida del comando de empaquetado):

```text
14192  2026-10-14 15:08   extension/dist/extension.js
331898  2026-10-14 15:08   extension/dist/panel/index.js
```

## Qué cubre cada nivel

- **Unitarios** (`test/srt.test.ts`, `test/ffmpeg-args.test.ts`): formato y parseo
  SRT, generación de subtítulos desde el guion y construcción de argumentos de
  FFmpeg (escalado con padding, audio silencioso, `tpad`/`apad`, concat escapado,
  corte, mux, variantes).
- **Contrato del manifiesto** (`test/manifest.test.ts`): cada comando declarado en
  `package.json` está registrado en el código y en `activationEvents`; las claves
  de configuración declaradas son exactamente las que lee la extensión; las fases
  por defecto del manifiesto coinciden con `DEFAULT_PHASES`; rutas de `main` y del
  bundle del panel coherentes con el build; el webview declara CSP y nonce; y los
  ajustes quedan cableados con los servicios del pipeline.
- **Cableado de ajustes** (`test/pipeline-services.test.ts`): provider, voz,
  velocidad y volumen de la narración, y ruta/descarga/códecs de FFmpeg llegan a
  los servicios (regresión: antes se construían con `undefined`).
- **Panel webview** (`test/panel.test.tsx`, jsdom): el panel se renderiza, avisa al
  host con `ready`, aplica la configuración y el progreso recibidos, muestra el
  error de una fase, envía los comandos (`startCapture`, `buildVideo`,
  `exportMobile`, `exportDesktop`, `openOutputFolder`, `cancel`, `saveConfig`) y
  registra eventos y vídeo generado en el log.
- **Integración** (`test/ffmpeg-builder.test.ts`, `test/phase-manager.test.ts`):
  ejecutan FFmpeg de verdad y comprueban con FFprobe resolución, duración y pista
  de audio; verifican clip 1920x1080 y 1080x1920, concatenación, corte, mux y
  descompresión de ZIP (incluido su fallo controlado). El pipeline de fases se
  prueba con dobles deterministas de captura/TTS, incluida la degradación sin voz
  y el aislamiento de errores por fase.
- **E2E** (`scripts/e2e-linux.mjs`): lanza Chromium real, graba dos fases de una
  página local (rellenar campo, pulsar botón, esperar selector), genera clips y
  SRT, concatena y produce las dos variantes finales, comprobando con `ffprobe`
  que el MP4 desktop es 1920x1080 y el mobile 1080x1920, ambos con audio.
- **Extension Host** (`test/vscode/suite/`): VS Code real cargando la extensión.

## Incidencias encontradas y corregidas durante la verificación

- **`.vscodeignore` excluía `node_modules/`**: un VSIX instalado no habría
  arrancado (faltaban Playwright, React y webview-ui-toolkit). Ahora el paquete
  incluye las dependencias de ejecución y se verifica su contenido.
- **Los ajustes de TTS y FFmpeg se ignoraban**: `extension.ts` construía el
  pipeline con `tts: undefined` y `ffmpeg: undefined`, así que cambiar la voz, la
  velocidad o la ruta de FFmpeg no tenía ningún efecto. Ahora se construyen desde
  `createPipelineServices(settings)` y hay tests que lo impiden.
- **El id del comando del panel no coincidía** con el registrado (el panel no
  abría): lo caza `test/manifest.test.ts`.

## Límites de esta verificación (lo que NO cubre)

- **Narración SAPI**: solo existe en Windows. En Linux/macOS se verifica la
  degradación (vídeo sin voz) y el error claro; el audio hablado real no se ha
  podido ejecutar en este entorno.
- **Interfaz del panel renderizada en VS Code**: se verifica en jsdom y que el
  panel abre en el host; no hay comprobación visual (píxeles) del webview.
- **Flujos de usuario completos dentro de VS Code** (captura + montaje + export
  desde el panel, en Windows): el pipeline se verifica por CLI/E2E, no por
  interacción manual en la UI.
- **Claves reservadas para Fase 2** declaradas en el manifiesto pero sin
  implementación: `apiKey`, `nanBuilders.*`, `stt.*`, `images.*`. Además
  `playwright.viewportWidth/Height`, `playwright.autoInstall`, `browserPath`,
  `output.format` y `phases.enabled` están declaradas pero no se consumen (la
  geometría de captura sale de `variants.*`): son candidatas a eliminar del
  manifiesto.
- **Publicación en el Marketplace**: fuera de alcance.
- Los MP4 de la evidencia son de una app de prueba local de 2 fases; no sustituyen
  a una demo real de un producto concreto.
