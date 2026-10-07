# ADR-003: FFmpeg on-demand download vs bundled

## Contexto

FFmpeg es necesario para el montaje final del vídeo (cut, mux, concat → MP4). Dos opciones:

1. **Bundlear FFmpeg en el VSIX**: Incluir los binarios de FFmpeg (Windows, macOS, Linux) en la extensión.
2. **Descargar FFmpeg on-demand**: Descargar FFmpeg la primera vez que se necesita, almacenar en caché local.

## Decisión

Se elige **Descarga on-demand con caché local**.

## Justificación

- **Tamaño del VSIX**: FFmpeg son ~80MB por plataforma. Bundlearlo triplicaría el tamaño de la extensión.
- **Actualizaciones**: FFmpeg se actualiza frecuentemente. On-demand garantiza que el usuario siempre tiene la versión más reciente.
- **Caché local**: Una vez descargado, FFmpeg se almacena en la carpeta de datos de la extensión y no se vuelve a descargar.
- **Configurable**: El usuario puede proporcionar su propia ruta a FFmpeg si ya lo tiene instalado.

## Consecuencias

- **Positivas**:
  - VSIX ligero (~5MB vs ~250MB).
  - Siempre la versión más reciente de FFmpeg.
  - El usuario puede usar su propia instalación.
- **Negativas**:
  - Primer uso más lento (descarga ~80MB).
  - Requiere conexión a internet la primera vez.
  - El usuario debe esperar la descarga antes de usar la extensión.

## Alternativas rechazadas

- **Bundlear FFmpeg**: VSIX de ~250MB, innecesariamente pesado para una herramienta que no todos usan inmediatamente.
- **Requerir instalación manual de FFmpeg**: Friction de instalación demasiado alto para un MVP.
