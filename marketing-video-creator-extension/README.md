# Marketing Video Creator — Extensión de VS Code

Genera vídeos de demo (marketing) de aplicaciones web desde VS Code: captura las
fases reales con Playwright, genera la narración con TTS local, escribe los
subtítulos SRT y monta el MP4 con FFmpeg, en dos variantes (desktop 16:9 y
mobile 9:16).

## Estado verificado

| Comprobación | Resultado |
|---|---|
| `npm run compile` | ✅ limpio (tsc + vite build) |
| `npm test` (vitest) | ✅ 118/118 tests (10 ficheros) |
| `npm run check:requirements` | ✅ verde en Linux (FFmpeg/FFprobe/navegador) y ❌ correctamente si falta el navegador |
| `npm run test:e2e` (Linux, navegador + FFmpeg reales) | ✅ 18/18 comprobaciones |
| `npm run test:vscode` (VS Code real) | ✅ 7/7 |
| `demo-video-desktop.mp4` | ✅ 1920x1080, con audio |
| `demo-video-mobile.mp4` | ✅ 1080x1920, con audio |

Los tests de integración y el E2E ejecutan **FFmpeg y Chromium reales** y
verifican la resolución, la duración y la pista de audio de los MP4 generados con
`ffprobe`.

## Requisitos (satélites del pipeline)

La extensión **no es autónoma**: necesita binarios y servicios que no viajan en
el VSIX. Se comprueban antes de grabar (comando *Comprobar requisitos* o botón en
la pestaña Configuración), así que un requisito que falta da un mensaje
accionable, no un error crudo a mitad de faena.

| Satélite | ¿Obligatorio? | Cómo se resuelve | Detalle |
|---|---|---|---|
| **FFmpeg** | Sí (sin él no hay MP4) | `PATH` → `ffmpeg.path` → descarga automática | La descarga sola (`ffmpeg.autoDownload`) existe **solo en Windows** (`gyan.dev`, ~80 MB, en `%APPDATA%\MarketingVideoCreator`). En Linux/macOS: `apt install ffmpeg` / `brew install ffmpeg` |
| **FFprobe** | No (degrada) | Se busca junto a FFmpeg | Sin él la duración de los clips se estima desde la configuración en vez de medirse |
| **Navegador (Chromium de Playwright)** | Sí (sin él no hay captura) | Chromium descargado → navegador propio (`playwright.browserPath`, p. ej. `chrome.exe`) → **instalación desde la propia extensión** | El navegador no viaja en el VSIX. La instalación usa el CLI que sí viaja dentro (`node_modules/playwright/cli.js`), sin pedirte npm |
| **PowerShell + `System.Speech` (SAPI)** | No (degrada: vídeo sin voz) | Voz del sistema operativo | Solo Windows; no usa API key ni conexión. En Linux/macOS el vídeo se genera con pista de audio silenciosa y los SRT igualmente |
| `tar` / `unzip` / `bsdtar` | No | Solo si hay que descomprimir el ZIP de FFmpeg | En Windows se usa `Expand-Archive` de PowerShell; en Linux nunca se llega a usar (no hay descarga) |
| **Node.js 18+** | Sí | Es el runtime del Extension Host | `engines.vscode: ^1.90.0` |
| **Python** | ❌ **No se usa** | — | No hay ni una invocación a Python en `src/` ni en `package.json` |

Todo el vídeo se produce con **FFmpeg** (argumentos construidos en
`src/utils/ffmpeg-args.ts`, siempre con `shell: false` y args en array): la voz
SAPI se sintetiza a WAV, la duración se mide con `ffprobe`, los SRT se generan en
TypeScript (`src/utils/srt.ts`) y el montaje es un `concat`/`filter_complex` de
FFmpeg. Los únicos procesos externos que lanza la extensión son `ffmpeg`,
`ffprobe`, `node` (instalador de Playwright) y `powershell` (SAPI).

Comprobación desde terminal, con el mismo código que usa la extensión:

```bash
npm run check:requirements
```

## Instalación

```bash
npm install
npx playwright install chromium
npm run compile
```

Para probar en VS Code: `F5` (Run Extension) o `npx @vscode/test-cli`.

## Uso

1. Abre una **carpeta de workspace** (la configuración del proyecto vive en
   `mvc-config.json`; los ajustes de la extensión, en el `settings.json` de VS Code).
2. Decide **qué se graba y qué se narra**. La extensión ejecuta, pero no adivina las
   pantallas de tu app: eso se redacta con el pack de prompts
   (`Marketing Video Creator: Crear pack de prompts` → `.mvc/prompts/`), que tiene los
   dos modos que pediste:
   - **Wizard (con preguntas)**: adjunta `.mvc/prompts/00-leeme.md` al chat
     (`#file:.mvc/prompts/00-leeme.md`) y el agente pregunta (para quién es, qué
     destacar, qué pantallas, qué datos) y espera tus respuestas.
   - **Autónomo (`hazlo todo tú`)**: los mismos prompts en *modo autónomo*: el agente
     investiga la app por su cuenta (código, rutas, e2e, URL), redacta guion y pasos,
     marca lo que ha supuesto y escribe `mvc-config.json` sin preguntar. Tú lo revisas
     después y cambias lo que quieras.
3. Revisa o ajusta en el panel: `Abrir Panel` → **Configuración** (URL, voz, variante) y
   **Fases** (por fase: nombre, duración, URL, **guion** de la narración y **pasos de
   captura** en JSON). Botón **Guardar fases**.
4. `Marketing Video Creator: Iniciar Demo` → el progreso se ve en la pestaña
   **Progreso** (barra + estado por fase + log de eventos).
5. `Marketing Video Creator: Exportar Mobile` / `Exportar Desktop` → genera el MP4
   final. También existen `Cancelar Demo` y `Abrir carpeta de salida`.

### Para que una fase tenga voz y haga algo

- **`script`** (guion): es el texto que se narra y el origen de los subtítulos. Sin
  guion, la fase se graba sin voz.
- **`steps`** (pasos): acciones de captura de esa fase. Sin pasos, la fase se graba
  pero no hace nada visible.

Acciones soportadas en `steps`: `goto {url}`, `click {selector}`, `fill {selector,text}`,
`press {selector,key}`, `waitForSelector {selector,timeoutMs}`, `wait {ms}`. Los pasos
mal escritos se descartan con un aviso (no tumba la ejecución) y quedan registrados en
el log del panel.

### Pack de prompts (`marketing-video-creator.createPromptPack`)

Escribe en el proyecto (sin pisar nada que ya exista):

| Fichero | Para qué |
|---|---|
| `.mvc/prompts/00-leeme.md` | Índice: orden de uso y los dos modos |
| `.mvc/prompts/01-descubrimiento.md` | Inventario de pantallas, flujo, selectores y datos de ejemplo |
| `.mvc/prompts/02-guion.md` | Narración por fase (tono, duración, español) |
| `.mvc/prompts/03-pasos-captura.md` | Pasos Playwright por fase con selectores estables |
| `.mvc/prompts/04-ensamblar-config.md` | Escribe y valida `mvc-config.json` |

### Formato de `mvc-config.json`

```json
{
  "version": "1.0.0",
  "project": {
    "name": "mi-app",
    "url": "https://app-a-demostrar",
    "outputDir": "./output/demo-video",
    "variant": "desktop",
    "phases": [
      {
        "id": "01-presentacion",
        "label": "Presentación",
        "duration": 5,
        "script": "Texto que se narra.",
        "steps": [{ "action": "goto", "url": "https://app-a-demostrar/", "waitUntil": "load" }]
      }
    ]
  }
}
```

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
npm test            # 118 tests: unitarios, contrato del manifiesto, esquema de config, cableado de ajustes, pack de prompts, requisitos externos, panel (jsdom) e integración con FFmpeg real
npm run check:requirements # estado de FFmpeg/navegador/voz en esta máquina (mismo código que la extensión)
npm run test:e2e    # E2E en Linux: navegador real + MP4 1920x1080 y 1080x1920 verificados con ffprobe
npm run test:vscode # Extension Host: carga la extensión en un VS Code real (Linux sin display: xvfb-run -a)
npm run package:vsix # genera el .vsix instalable
```

| Nivel | Resultado verificado |
|---|---|
| `npm run compile` | limpio (tsc + `vite build`) |
| `npm test` | 118/118 en 10 ficheros |
| `npm run check:requirements` | verde en Linux; ❌ correcto cuando el navegador no está (probado con `PLAYWRIGHT_BROWSERS_PATH` vacío) |
| `npm run test:e2e` | 18/18 comprobaciones |
| `npm run test:vscode` | 7/7 en VS Code real (1.141.1), salida 0 — incluye la creación del pack de prompts en disco y la comprobación de los 8 comandos registrados |
| `npm run package:vsix` | VSIX de 6,68 MB (964 ficheros) con `dist/` y dependencias de ejecución (`node_modules/playwright/cli.js` incluido, para poder instalar el navegador sin npm) |

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
├── config/               # Ajustes de la extensión, esquema y config del proyecto
├── prompts/              # Pack de prompts (wizard / autónomo) que escribe el comando
├── utils/                # ffmpeg-args, srt, logger, validators
└── types/                # Tipos de fase y de configuración
test/                     # Vitest: unitarios + contrato del manifiesto + panel (jsdom) + integración FFmpeg
test/vscode/              # Extension Host: la extensión dentro de un VS Code real
scripts/e2e-linux.mjs     # E2E con navegador y FFmpeg reales
scripts/vscode-test.mjs   # Lanzador de los tests del Extension Host
scripts/check-requirements.mjs # Estado de los requisitos externos sin abrir VS Code
```

`src/services/requirements.ts` es la pieza que responde a «¿qué necesita esto
aparte de la extensión?»: comprueba FFmpeg, FFprobe, el navegador y el motor de
voz, y devuelve por cada uno si está, si falta y **cómo resolverlo** (comando o
ajuste concreto).

## Licencia

MIT
