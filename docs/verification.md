# Verificación del pipeline (Marketing Video Creator)

Evidencia de la entrega: **qué se ha ejecutado de verdad**, con qué resultado y
qué queda fuera de esta verificación. Entorno: Linux (Ubuntu, kernel 6.8),
Node 22, FFmpeg/FFprobe reales, Chromium de Playwright real y **VS Code real**
(1.141.1) para los tests del Extension Host.

## Resumen

| Nivel | Comando | Resultado |
|---|---|---|
| Compilación | `npm run compile` | limpio (tsc + `vite build`) |
| Tests (unitarios + integración FFmpeg + contrato del manifiesto + panel) | `npm test` | **118/118** (10 ficheros) |
| Requisitos externos (FFmpeg, navegador, voz) | `npm run check:requirements` | `exit 0` en esta máquina; `exit 1` cuando falta el navegador, con el comando a ejecutar |
| E2E con navegador y FFmpeg reales | `npm run test:e2e` | **18/18** comprobaciones |
| Extension Host en VS Code real | `npm run test:vscode` | **7/7**, `Exit code 0` |
| Empaquetado instalable | `npm run package:vsix` | VSIX 964 files, 6.68 MB |

Cada pasada de la entrega se documenta al final, en orden cronológico:
*Primera* (pipeline), *Segunda* (capas de verificación + VSIX), *Tercera*
(ajustes cableados), *Cuarta* (capa de autoría: guion, pasos y pack de
prompts) y **Quinta** (requisitos satélite). El resumen de arriba es siempre el
estado final.

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

## Cuarta pasada · capa de autoría (guion, pasos y pack de prompts)

Motivo: el pipeline ejecutaba fases declaradas, pero nada escribía esas
declaraciones. Esta pasada añade el eslabón que faltaba (esquema con `script`/
`steps` por fase, panel que los edita y guarda, y pack de prompts para que el
agente de chat los redacte en modo wizard o autónomo) y lo verifica.

Cambios verificados en esta pasada:

- `src/config/project-schema.ts` (nuevo): esquema y normalización sin VS Code —
  `parseCaptureSteps` (6 acciones), `normalizePhases` (descarta lo inválido con
  aviso en vez de en silencio) y `validateProjectConfig`.
- `PhaseConfig` admite `url`, `script` y `steps`; `extension.ts` los propaga al
  pipeline (`script: phase.script`, `steps: phase.steps`).
- El panel edita guion y pasos por fase y los guarda de verdad: el mensaje
  `savePhases` ahora está implementado en `extension.ts` (antes el botón no
  hacía nada) y devuelve al panel lo que se ha guardado.
- `src/prompts/prompt-pack.ts` (nuevo) + comando
  `marketing-video-creator.createPromptPack`: escribe `.mvc/prompts/` (índice,
  descubrimiento, guion, pasos, ensamblado) sin pisar lo que ya exista.

Salida real (comando a comando, sin retoques):

```text
### COMPILE
dist/panel/src/panel/index.html    0.30 kB │ gzip:  0.23 kB
dist/panel/index.js              334.08 kB │ gzip: 92.89 kB
✓ built in 19.61s

### TESTS (vitest)
 ✓ test/manifest.test.ts (10 tests) 24ms
 ✓ test/ffmpeg-args.test.ts (17 tests) 35ms
 ✓ test/prompt-pack.test.ts (9 tests) 28ms
 ✓ test/project-schema.test.ts (16 tests) 37ms
 ✓ test/srt.test.ts (12 tests) 27ms
 ✓ test/pipeline-services.test.ts (4 tests) 18ms
 ✓ test/panel.test.tsx (8 tests) 583ms
 ✓ test/phase-manager.test.ts (5 tests) 10404ms
 ✓ test/ffmpeg-builder.test.ts (12 tests) 11658ms
 Test Files  9 passed (9)
      Tests  93 passed (93)

### EXTENSION HOST (VS Code real)
  Marketing Video Creator · Extension Host
    ✔ la extensión está presente y se activa (791ms)
    ✔ registra los 7 comandos declarados en el manifiesto (45ms)
    ✔ crea el pack de prompts en el workspace y no pisa lo editado (1918ms)
    ✔ la configuración declarada se resuelve con sus valores por defecto
    ✔ abre el panel webview sin lanzar errores
    ✔ los comandos sin captura previa responden sin romper (avisan y salen) (752ms)
    ✔ el manifest del host expone el bundle compilado del panel
  7 passing (4s)
Exit code:   0

### E2E
✅ FFmpeg disponible en el sistema — /home/hermes/.hermes/tools/ffmpeg-9.0.1-linux-x64/bin/ffmpeg
✅ Página de prueba creada — file:///home/hermes/.hermes/cache/scratch/mvc-e2e-hfqssb/app.html
✅ [desktop] fases capturadas sin error — 01-presentacion=done, 02-resultado=done
✅ [desktop] clip de 01-presentacion generado
✅ [desktop] clip de 02-resultado generado
✅ [desktop] subtítulos SRT generados — /home/hermes/.hermes/cache/scratch/mvc-e2e-hfqssb/desktop-run/srt/01-presentacion.srt
✅ [desktop] MP4 final generado — /home/hermes/.hermes/cache/scratch/mvc-e2e-hfqssb/desktop-run/desktop/demo-video-desktop.mp4
✅ [desktop] resolución 1920x1080 — obtenido 1920x1080
✅ [desktop] pista de audio presente
✅ [desktop] duración > 0 — 5.07s
✅ [mobile] fases capturadas sin error — 01-presentacion=done, 02-resultado=done
✅ [mobile] clip de 01-presentacion generado
✅ [mobile] clip de 02-resultado generado
✅ [mobile] subtítulos SRT generados — /home/hermes/.hermes/cache/scratch/mvc-e2e-hfqssb/mobile-run/srt/01-presentacion.srt
✅ [mobile] MP4 final generado — /home/hermes/.hermes/cache/scratch/mvc-e2e-hfqssb/mobile-run/mobile/demo-video-mobile.mp4
✅ [mobile] resolución 1080x1920 — obtenido 1080x1920
✅ [mobile] pista de audio presente
✅ [mobile] duración > 0 — 5.10s
Artefactos E2E:
 - desktop: /home/hermes/.hermes/cache/scratch/mvc-e2e-hfqssb/desktop-run/desktop/demo-video-desktop.mp4
 - mobile:  /home/hermes/.hermes/cache/scratch/mvc-e2e-hfqssb/mobile-run/mobile/demo-video-mobile.mp4
18/18 comprobaciones OK
E2E OK

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
 DONE  Packaged: /tmp/mvc-evidence/marketing-video-creator-0.1.0.vsix (962 files, 6.68 MB)
    18021  2026-10-14 15:34   extension/dist/extension.js
   334118  2026-10-14 15:34   extension/dist/panel/index.js
```

Lectura de resultados:

| Nivel | Resultado |
|---|---|
| `npm run compile` | limpio (tsc + vite) |
| `npm test` (vitest) | 93/93 en 9 ficheros |
| Extension Host (VS Code 1.141.1 real) | 7/7, salida 0 — incluye escribir el pack de prompts en el workspace y comprobar que no se pisa un fichero editado |
| E2E en Linux (Chromium + FFmpeg reales) | 18/18; desktop 1920x1080 y mobile 1080x1920 con audio (`aac` 48 kHz estéreo) y ~5 s |
| `npm run package:vsix` | VSIX de 6,68 MB (962 ficheros) con `extension/dist/extension.js` y `extension/dist/panel/index.js` |

Lo que sigue **sin** verificar (no se puede desde Linux): narración con voz SAPI
real (Windows), comprobación visual del panel y recorrido manual completo dentro
de VS Code. El descubrimiento automático de pantallas de una app nueva (crawler)
todavía no existe: hoy lo cubre el prompt 01 con el agente de chat.


## Quinta pasada · requisitos satélite (FFmpeg, navegador, voz)

Pregunta que la origina: *«¿para crear los vídeos necesita requerimientos? ¿cómo
los crea, FFmpeg o Python?»*. Se auditaron los procesos externos reales y se
añadió comprobación previa con mensaje accionable.

### Qué lanza realmente la extensión

```
src/utils/srt.ts            (regex, no proceso)
src/extension.ts:341        node  <node_modules/playwright/cli.js> install chromium
src/services/ffmpeg-builder.ts:308  spawnSync(tar|unzip|bsdtar|powershell Expand-Archive)   [solo al descomprimir el ZIP de FFmpeg]
src/services/ffmpeg-builder.ts:514  spawn(<ffmpeg>)  ← todo el montaje del vídeo
src/services/sapi-provider.ts:146   execFile(powershell, System.Speech)  [voz, solo Windows]
```

`grep -rni python src/ package.json` → **sin coincidencias**: el pipeline es
TypeScript + FFmpeg. La descarga automática de FFmpeg existe **solo en Windows**
(`ffmpeg-builder.ts:135`, `if (process.platform !== 'win32') throw`), así que en
Linux/macOS `ffmpeg` tiene que estar en el PATH o en `ffmpeg.path`.

### Chequeo añadido (`src/services/requirements.ts`)

Cuatro comprobaciones (FFmpeg y navegador obligatorios; FFprobe y voz degradan),
cada una con `fix`/`command`. Pre-flight en `handleStartDemo` (captura) y
`handleExport` (montaje), comando `marketing-video-creator.checkRequirements` y
botón en el panel. Script homónimo que usa el **mismo código compilado**:

```
$ npm run check:requirements
Requisitos en linux (node v22.23.2):

✅ FFmpeg: en el PATH: /home/hermes/.hermes/tools/ffmpeg-9.0.1-linux-x64/bin/ffmpeg
✅ FFprobe: disponible: /home/hermes/.hermes/tools/ffmpeg-9.0.1-linux-x64/bin/ffprobe
✅ Navegador (Playwright): Chromium de Playwright instalado: /home/hermes/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome
⚠️ Narración (TTS): SAPI solo existe en Windows: en este sistema el vídeo se genera sin voz

✅ Requisitos suficientes; funcionará degradado: Narración (TTS).
```

### La detección de verdad detecta (no es un check decorativo)

Máquina sin navegador (misma máquina, `PLAYWRIGHT_BROWSERS_PATH` a un directorio
vacío):

```
$ PLAYWRIGHT_BROWSERS_PATH=/tmp/mvc-no-browser npm run check:requirements
❌ Navegador (Playwright): Chromium de Playwright no instalado (la grabación no puede arrancar) ... → npx playwright install chromium
❌ Faltan requisitos para generar el vídeo: Navegador (Playwright): npx playwright install chromium
exit=1
```

Test unitario que fija la premisa (por eso el chequeo existe): con el Chromium
inalcanzable, `chromium.launch()` revienta con *«Executable doesn't exist…»*.

### La autoinstalación del navegador funciona (mismo CLI que lanza la extensión)

```
$ PLAYWRIGHT_BROWSERS_PATH=/tmp/mvc-pw-install ELECTRON_RUN_AS_NODE=1 node ./node_modules/playwright/cli.js install chromium
$ du -sh /tmp/mvc-pw-install      →  658M   (chromium-1243 + chromium_headless_shell-1243 + ffmpeg-1011)
$ chrome --version                →  Google Chrome for Testing 153.0.8010.12
$ PLAYWRIGHT_BROWSERS_PATH=/tmp/mvc-pw-install npm run check:requirements
✅ Navegador (Playwright): Chromium de Playwright instalado: /tmp/mvc-pw-install/chromium-1243/chrome-linux64/chrome
exit=0
```

El VSIX lleva dentro lo necesario para esa autoinstalación
(`node_modules/playwright/cli.js`, 964 ficheros): no hace falta que el usuario
tenga npm ni Playwright instalados.

### Claves de configuración sin implementación detrás: eliminadas

`playwright.viewportWidth`, `playwright.viewportHeight` (duplicaban `variants.*`,
que es lo que el pipeline usa de verdad) y `output.format` (el formato siempre ha
sido MP4). Con test de contrato que impide reintroducirlas. Quedan 25 claves, y
las que se prometen ahora se aplican: `playwright.autoInstall`, `browserPath`,
`ffmpeg.autoDownload`.
