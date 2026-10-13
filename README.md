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
npm test             # 46 tests (unitarios + integración con FFmpeg real)
npm run test:e2e     # E2E: navegador real + MP4 verificados con ffprobe
```

Estado de la última verificación: `npm run compile` limpio, `npm test` 46/46 y
`npm run test:e2e` 18/18, con MP4 de 1920x1080 y 1080x1920 verificados con
`ffprobe` (ver [`docs/verification.md`](docs/verification.md)).

## Requisitos

- Node.js 18+
- FFmpeg y FFprobe en el `PATH` (la extensión puede descargar FFmpeg en Windows)
- Chromium de Playwright
- Windows para la narración SAPI; en Linux/macOS el pipeline genera el vídeo sin
  voz (degradación controlada)

## Fuera de alcance

- Nan.Builders Kokoro (TTS en la nube) y Whisper (STT / SRT automático) — Fase 2.
- Publicación en el Marketplace de VS Code.

## Licencia

MIT
