# Marketing Video Creator

Extensión de VS Code para generar **vídeos de demo de aplicaciones web**
automáticamente: captura los flujos reales con Playwright, genera la narración
con TTS local, escribe los subtítulos SRT y monta el vídeo final con FFmpeg.

Salidas soportadas:

- **Desktop 16:9** — 1920x1080 (`output/demo-video/desktop/demo-video-desktop.mp4`)
- **Mobile 9:16** — 1080x1920 (`output/demo-video/mobile/demo-video-mobile.mp4`)

## Estructura del repositorio

```
marketing-video-creator-extension/   # La extensión (código, tests, E2E)
docs/ralph/prd.json                  # PRD / issues del producto
docs/adr/                            # Decisiones de arquitectura
media/                               # Recursos de la extensión
```

El detalle de uso, configuración, pipeline y verificación está en
[`marketing-video-creator-extension/README.md`](marketing-video-creator-extension/README.md).

## Puesta en marcha rápida

```bash
cd marketing-video-creator-extension
npm install
npx playwright install chromium   # navegador de Playwright
npm run compile
```

Abre la carpeta en VS Code y pulsa `F5` para lanzar la extensión en modo
desarrollo.

## Verificación

```bash
cd marketing-video-creator-extension
npm run compile      # tsc + build del panel React
npm test             # 118 tests (unitarios + contrato del manifiesto + panel + FFmpeg real)
npm run check:requirements # qué necesita la extensión aparte de sí misma (FFmpeg, navegador, voz)
npm run test:e2e     # E2E: navegador real + MP4 verificados con ffprobe
```

Estado de la última verificación: `npm run compile` limpio, `npm test` 118/118 y
`npm run test:e2e` 18/18, con MP4 de 1920x1080 y 1080x1920 verificados con
`ffprobe` (ver [`docs/verification.md`](docs/verification.md)).

## Requisitos

La extensión **no es autónoma**: el vídeo lo produce FFmpeg, la captura la hace el
navegador de Playwright y la voz la pone SAPI de Windows. Nada de eso viaja en el
VSIX, así que la propia extensión los comprueba antes de empezar y ofrece cómo
resolverlo (`marketing-video-creator.checkRequirements`, o
`npm run check:requirements` desde terminal). Tabla completa:
[`marketing-video-creator-extension/README.md`](marketing-video-creator-extension/README.md#requisitos-satélites-del-pipeline).

Resumen:

- Node.js 18+ (runtime del Extension Host)
- FFmpeg y FFprobe (según `PATH`, `ffmpeg.path` o descarga automática en Windows)
- Navegador: Chromium de Playwright, un Chrome/Edge ya instalado, o instalarlo
  desde la propia extensión
- Windows para la narración SAPI; en Linux/macOS el pipeline genera el vídeo sin
  voz (degradación controlada)
- **Python no se usa**: todo el pipeline es TypeScript + FFmpeg

## Fuera de alcance

- Nan.Builders Kokoro (TTS en la nube) y Whisper (STT / SRT automático) — Fase 2.
- Publicación en el Marketplace de VS Code.

## Licencia

MIT
