# Verificación del pipeline (Marketing Video Creator)

Evidencia de la entrega del pipeline end-to-end. Los comandos se ejecutaron en
Linux (Ubuntu, kernel 6.8) dentro de `marketing-video-creator-extension/`, con
**FFmpeg/FFprobe reales** y **Chromium de Playwright real**.

## Comandos ejecutados y resultado

| Comando | Resultado |
|---|---|
| `npm run compile` | limpieza total (tsc + `vite build` del panel) |
| `npm test` (vitest) | 46/46 tests OK |
| `npm run test:e2e` (`scripts/e2e-linux.mjs`) | 18/18 comprobaciones OK |

```bash
# 1) Compilación
npm run compile

# 2) Tests: unitarios + integración con FFmpeg real
npm test

# 3) E2E: navegador real + montaje + verificación con ffprobe
npm run test:e2e
```

## Salida real

```text
### COMPILE
vite v5.4.21 building for production...
transforming...
✓ 320 modules transformed.
rendering chunks...
computing gzip size...
dist/panel/src/panel/index.html    0.30 kB │ gzip:  0.23 kB
dist/panel/index.js              331.87 kB │ gzip: 92.17 kB
✓ built in 19.93s
### TESTS
 ✓ test/ffmpeg-builder.test.ts (12 tests) 13151ms
   ✓ FfmpegBuilder (integración con FFmpeg real) > buildPhaseClip normaliza a 1920x1080 con pista de audio 1125ms
   ✓ FfmpegBuilder (integración con FFmpeg real) > buildPhaseClip normaliza a 1080x1920 (mobile) 1039ms
   ✓ FfmpegBuilder (integración con FFmpeg real) > concat une clips homogéneos y buildVideo devuelve el maestro 2284ms
   ✓ FfmpegBuilder (integración con FFmpeg real) > buildDesktopVideo genera 1920x1080 y buildMobileVideo 1080x1920 2887ms
   ✓ FfmpegBuilder (integración con FFmpeg real) > cut y mux producen ficheros válidos 2245ms

 Test Files  4 passed (4)
      Tests  46 passed (46)
   Start at  23:42:01
   Duration  14.42s (transform 798ms, setup 0ms, collect 2.29s, tests 24.95s, environment 3ms, prepare 803ms)

### E2E
✅ FFmpeg disponible en el sistema — /home/hermes/.hermes/tools/ffmpeg-9.0.1-linux-x64/bin/ffmpeg
✅ Página de prueba creada — file:///home/hermes/.hermes/cache/scratch/mvc-e2e-VSRkDr/app.html
✅ [desktop] fases capturadas sin error — 01-presentacion=done, 02-resultado=done
✅ [desktop] clip de 01-presentacion generado
✅ [desktop] clip de 02-resultado generado
✅ [desktop] subtítulos SRT generados — /home/hermes/.hermes/cache/scratch/mvc-e2e-VSRkDr/desktop-run/srt/01-presentacion.srt
✅ [desktop] MP4 final generado — /home/hermes/.hermes/cache/scratch/mvc-e2e-VSRkDr/desktop-run/desktop/demo-video-desktop.mp4
✅ [desktop] resolución 1920x1080 — obtenido 1920x1080
✅ [desktop] pista de audio presente
✅ [desktop] duración > 0 — 4.98s
✅ [mobile] fases capturadas sin error — 01-presentacion=done, 02-resultado=done
✅ [mobile] clip de 01-presentacion generado
✅ [mobile] clip de 02-resultado generado
✅ [mobile] subtítulos SRT generados — /home/hermes/.hermes/cache/scratch/mvc-e2e-VSRkDr/mobile-run/srt/01-presentacion.srt
✅ [mobile] MP4 final generado — /home/hermes/.hermes/cache/scratch/mvc-e2e-VSRkDr/mobile-run/mobile/demo-video-mobile.mp4
✅ [mobile] resolución 1080x1920 — obtenido 1080x1920
✅ [mobile] pista de audio presente
✅ [mobile] duración > 0 — 5.00s
Artefactos E2E:
 - desktop: /home/hermes/.hermes/cache/scratch/mvc-e2e-VSRkDr/desktop-run/desktop/demo-video-desktop.mp4
 - mobile:  /home/hermes/.hermes/cache/scratch/mvc-e2e-VSRkDr/mobile-run/mobile/demo-video-mobile.mp4
18/18 comprobaciones OK
E2E OK
```

## ffprobe de los MP4 entregados

```text
DIR=/home/hermes/.hermes/cache/scratch/mvc-e2e-L37wDO
== /home/hermes/.hermes/cache/scratch/mvc-e2e-L37wDO/desktop-run/desktop/demo-video-desktop.mp4 ==
{
    "programs": [

    ],
    "stream_groups": [

    ],
    "streams": [
        {
            "codec_name": "h264",
            "codec_type": "video",
            "width": 1920,
            "height": 1080
        },
        {
            "codec_name": "aac",
            "codec_type": "audio",
            "sample_rate": "48000",
            "channels": 2
        }
    ],
    "format": {
        "format_name": "mov,mp4,m4a,3gp,3g2,mj2",
        "duration": "5.000000",
        "size": "29612"
    }
}
== /home/hermes/.hermes/cache/scratch/mvc-e2e-L37wDO/mobile-run/mobile/demo-video-mobile.mp4 ==
{
    "programs": [

    ],
    "stream_groups": [

    ],
    "streams": [
        {
            "codec_name": "h264",
            "codec_type": "video",
            "width": 1080,
            "height": 1920
        },
        {
            "codec_name": "aac",
            "codec_type": "audio",
            "sample_rate": "48000",
            "channels": 2
        }
    ],
    "format": {
        "format_name": "mov,mp4,m4a,3gp,3g2,mj2",
        "duration": "5.181333",
        "size": "45329"
    }
}
```

## Qué cubre cada nivel

- **Unitarios** (`test/srt.test.ts`, `test/ffmpeg-args.test.ts`): formato y
  parseo SRT, generación de subtítulos desde el guion, construcción de
  argumentos de FFmpeg (escalado/padding, audio silencioso, tpad/apad,
  concat escapado, corte, mux, variantes).
- **Integración** (`test/ffmpeg-builder.test.ts`, `test/phase-manager.test.ts`):
  ejecutan FFmpeg de verdad y comprueban con FFprobe resolución, duración y
  pista de audio; verifican el clip 1920x1080 y 1080x1920, la concatenación, el
  corte, el mux y la descompresión de ZIP (y su fallo controlado). El pipeline de
  fases se prueba con dobles deterministas de captura/TTS, incluida la
  degradación sin voz y el aislamiento de errores por fase.
- **E2E** (`scripts/e2e-linux.mjs`): lanza Chromium real, graba dos fases de una
  página local (rellenar campo, pulsar botón, esperar selector), genera los clips,
  los SRT, concatena y produce las dos variantes finales, comprobando con
  `ffprobe` que el MP4 desktop es 1920x1080 y el mobile 1080x1920, ambos con
  audio y duración > 0.
