# Marketing Demo Video

Carpeta operativa para grabar, narrar y reexportar el vídeo de presentación de JudgePREAI.

Objetivo actual:
- dos variantes del mismo guion: `mobile` y `desktop`
- mismo texto, mismos audios y mismos subtítulos en ambas variantes
- flujo en producción: login -> ficha -> evaluación -> resultado -> PDF -> historial -> cuenta
- reutilizable en futuras releases sin mezclarlo con tests ni código de producto

Activos incluidos:
- `config/demo-prod.json` — configuración editable del flujo
- `assets/narration.es-ES.txt` — texto base de locución en español de España
- `scripts/record-demo.mjs` — automatiza el flujo con Playwright y graba vídeo
- `scripts/render-voice.ps1` — genera WAV con voz local masculina `Microsoft Pablo`
- `scripts/build-video.ps1` — transcodifica WEBM -> MP4 y mezcla narración

Uso recomendado:
1. Ajustar `config/demo-prod.json` con los datos reales del caballo demo.
2. Ejecutar captura de la variante deseada.
   Mobile: `node marketing/demo-video/scripts/record-demo.mjs marketing/demo-video/config/demo-prod.json`
   Desktop: mismo guion, pero usando la configuración/dimensiones de escritorio cuando se rehaga la captura.
3. Generar voz:
   `pwsh -File marketing/demo-video/scripts/render-voice.ps1 -ScriptFile marketing/demo-video/assets/narration.es-ES.txt -OutputFile marketing/output/demo-video/narration.wav`
4. Montar por variante:
   `pwsh -File marketing/demo-video/scripts/build-phased.ps1 -ConfigFile marketing/demo-video/config/demo-prod.json -Variant mobile -MasterWebm marketing/output/demo-video/raw/mobile/<archivo>.webm`
   `pwsh -File marketing/demo-video/scripts/build-phased.ps1 -ConfigFile marketing/demo-video/config/demo-prod.json -Variant desktop -MasterWebm marketing/output/demo-video/raw/desktop/<archivo>.webm`

Notas:
- Los artefactos generados salen a `marketing/output/demo-video/mobile/` y `marketing/output/demo-video/desktop/`.
- Los clips por fase quedan en `.../<variant>/clips/`.
- Si en el futuro se usa Qwen TTS u otro modelo local, guardar pesos en `marketing/models/`.
- La voz local detectada en esta máquina es `Microsoft Pablo` (`es-ES`, male).
