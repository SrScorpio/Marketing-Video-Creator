# Marketing Video Creator — Extensión de VS Code

Genera vídeos de demo (marketing) de aplicaciones web desde VS Code: captura las
fases reales con Playwright, genera la narración con TTS local, escribe los
subtítulos SRT y monta el MP4 con FFmpeg, en dos variantes (desktop 16:9 y
mobile 9:16).

## Estado verificado

| Comprobación | Resultado |
|---|---|
| `npm run compile` | ✅ limpio (tsc + vite build) |
| `npm test` (vitest) | ✅ 65/65 tests |
| `npm run test:e2e` (Linux, navegador + FFmpeg reales) | ✅ 18/18 comprobaciones |
| `npm run test:vscode` (VS Code real) | ✅ 6/6 |
| `demo-video-desktop.mp4` | ✅ 1920x1080, con audio |
| `demo-video-mobile.mp4` | ✅ 1080x1920, con audio |

Los tests de integración y el E2E ejecutan **FFmpeg y Chromium reales** y
verifican la resolución, la duración y la pista de audio de los MP4 generados con
`ffprobe`.

## Requisitos

- Node.js 18+ y npm
- FFmpeg y FFprobe en el `PATH` (en Windows la extensión puede descargarlo
  automáticamente con `marketingVideoCreator.ffmpeg.autoDownload`)
- Chromium de Playwright: `npx playwright install chromium`
- Narración TTS: SAPI de Windows (`System.Speech.Synthesis`, voz *Microsoft
  Pablo*). **En Linux/macOS el pipeline funciona sin voz** (degradación
  controlada, ver más abajo)

## Instalación

```bash
npm install
npx playwright install chromium
npm run compile
```

Para probar en VS Code: `F5` (Run Extension) o `npx @vscode/test-cli`.

## Uso

1. Abre una **carpeta de workspace** (la configuración se guarda en
   `.marketing-video-creator.json` del workspace).
2. `Marketing Video Creator: Abrir Panel` → pestaña **Configuración**: define la
   URL de la app a demostrar, la voz TTS y la variante de grabación.
3. Pestaña **Fases**: define las fases (id, nombre, duración). Por defecto se
   usan las 7 fases de `marketingVideoCreator.phases.list`.
4. `Marketing Video Creator: Iniciar Demo` → el progreso se ve en la pestaña
   **Progreso** (barra + estado por fase + log de eventos).
5. `Marketing Video Creator: Exportar Mobile` / `Exportar Desktop` → genera el
   MP4 final. También existe `Cancelar Demo` y `Abrir carpeta de salida`.

### Salida

```
output/demo-video/
├── clips/       # clip normalizado por fase (MP4 1920x1080 o 1080x1920)
├── audio/       # narración WAV por fase
├── srt/         # subtítulos SRT por fase
├── demo-video.mp4                  # vídeo maestro (concat de clips)
├── desktop/demo-video-desktop.mp4  # variante 1920x1080
└── mobile/demo-video-mobile.mp4    # variante 1080x1920
```

## Pipeline

```
por fase:  Playwright (webm) → TTS (wav, opcional) → FFmpeg (clip normalizado MP4) → SRT
final:     concat de clips (sin recodificar) → variante desktop 1920x1080 / mobile 1080x1920
```

Detalles de implementación relevantes:

- **Extracción de utilidades puras** (`src/utils/ffmpeg-args.ts`, `src/utils/srt.ts`)
  sin dependencias de VS Code: el pipeline es ejecutable y testeable en Node puro.
- **FFmpeg se ejecuta con `shell: false`** y los argumentos viajan como array:
  no hay comillas manuales, funciona con rutas con espacios y no hay inyección de
  comandos.
- **Grabación determinista por fase**: se resuelve el webm concreto de la fase
  (`page.video().path()`), no "el .webm más reciente del directorio".
- **Un solo Chromium por ejecución**: cada fase abre su propio contexto (su
  propia grabación) y el navegador se cierra al terminar.
- **Clips homogéneos** (misma resolución, fps 30, `libx264`, `yuv420p`, audio
  `aac` 48 kHz estéreo): permite concatenar con `-c copy`.
- **Narración más larga que el vídeo**: se clona el último fotograma (`tpad`)
  hasta cubrir el audio; si el vídeo es más largo, se añade silencio (`apad`).
- **Si no hay voz, el vídeo se genera igual**: la fase añade una pista de audio
  silenciosa y el pipeline continúa (necesario en Linux/macOS).
- **Errores por fase aislados**: una fase que falla no aborta el resto; queda
  marcada en `error` con su mensaje y el resumen final lo indica.

## Configuración

Todas las claves cuelgan de `marketingVideoCreator.*`:

| Clave | Descripción | Defecto |
|---|---|---|
| `apiKey` | API key de Nan.Builders (Fase 2). Se guarda siempre en ajustes **de usuario**, nunca en el workspace | `""` |
| `tts.provider` | `sapi` (implementado), `edge-tts`, `external` (pendientes) | `sapi` |
| `tts.voice` | Voz TTS | `Microsoft Pablo` |
| `tts.rate`, `tts.volume` | Velocidad y volumen | `1.0` / `1.0` |
| `playwright.headless` | Grabar sin interfaz | `true` |
| `playwright.viewportWidth/Height` | Viewport de la variante desktop | `1920x1080` |
| `playwright.fps` | FPS de captura | `30` |
| `ffmpeg.path` | Ruta a FFmpeg (vacío = PATH o descarga) | `""` |
| `ffmpeg.autoDownload` | Descarga automática en Windows | `true` |
| `output.directory` | Directorio de salida | `./output/demo-video` |
| `variants.mobile.width/height` | Variante mobile | `1080x1920` |
| `variants.desktop.width/height` | Variante desktop | `1920x1080` |
| `phases.list` | Fases del vídeo | 7 fases por defecto |

## Tests y verificación

```bash
npm test            # 65 tests: unitarios, contrato del manifiesto, cableado de ajustes, panel (jsdom) e integración con FFmpeg real
npm run test:e2e    # E2E en Linux: navegador real + MP4 1920x1080 y 1080x1920 verificados con ffprobe
npm run test:vscode # Extension Host: carga la extensión en un VS Code real (Linux sin display: xvfb-run -a)
npm run package:vsix # genera el .vsix instalable
```

| Nivel | Resultado verificado |
|---|---|
| `npm run compile` | limpio (tsc + `vite build`) |
| `npm test` | 65/65 en 7 ficheros |
| `npm run test:e2e` | 18/18 comprobaciones |
| `npm run test:vscode` | 6/6 en VS Code real (1.141.1), salida 0 |
| `npm run package:vsix` | VSIX de 6,67 MB con `dist/` y dependencias de ejecución |

El E2E levanta una página HTML local de prueba, graba dos fases con Playwright,
monta el vídeo y comprueba con `ffprobe` resolución, audio y duración. Genera los
artefactos en un directorio temporal; con `MVC_E2E_KEEP=1` no se borra para poder
inspeccionarlos.

Los tests del Extension Host (`test/vscode/`) son JS plano porque VS Code los
ejecuta sin transpilar; `scripts/vscode-test.mjs` fija un `--user-data-dir` corto
(el de por defecto supera el límite de 107 caracteres del socket UNIX).

Evidencia detallada, incluida la salida real de cada comando y lo que queda fuera
de la verificación: `../docs/verification.md`.

## Fuera de alcance (Fase 2)

- Nan.Builders **Kokoro** (TTS en la nube) e **Whisper** (STT/SRT automático).
- Publicación en el Marketplace de VS Code.
- Edición manual de subtítulos en el panel.

Estas piezas están descritas en `../docs/ralph/prd.json` como ISSUE-006/ISSUE-007.

## Estructura

```
src/
├── extension.ts          # Activación, comandos, webview, persistencia de config
├── panel/                # Panel React (config, fases, progreso)
├── services/
│   ├── phase-manager.ts      # Orquestación del pipeline por fases
│   ├── playwright-capture.ts # Grabación webm + pasos de captura
│   ├── tts-service.ts        # Narración TTS (SAPI)
│   └── ffmpeg-builder.ts     # Clip, concat, variantes, probing
├── config/               # Ajustes de la extensión y config del proyecto
├── utils/                # ffmpeg-args, srt, logger, validators
└── types/                # Tipos de fase y de configuración
test/                     # Vitest: unitarios + contrato del manifiesto + panel (jsdom) + integración FFmpeg
test/vscode/              # Extension Host: la extensión dentro de un VS Code real
scripts/e2e-linux.mjs     # E2E con navegador y FFmpeg reales
scripts/vscode-test.mjs   # Lanzador de los tests del Extension Host
```

## Licencia

MIT
