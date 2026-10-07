# ADR-004: Configuración de proyecto vs configuración global

## Contexto

La extensión necesita configurarse a dos niveles:

1. **Configuración global** (`settings.json` del workspace/user): API Key, rutas de FFmpeg, configuración TTS/STT.
2. **Configuración de proyecto** (archivo en el repo): Fases del vídeo, URL base, estructura de assets.

Pregunta: ¿Dónde se almacena cada tipo de configuración?

## Decisión

Se elige **Configuración global para settings de extensión + archivo `mvc-config.json` en el proyecto**.

## Justificación

- **Separación de preocupaciones**: La configuración de la extensión (API Key, rutas) es global. La configuración del proyecto (fases, URL) es específica del repo.
- **Control de versiones**: `mvc-config.json` se commitea al repo. `settings.json` no.
- **Colaboración**: El equipo comparte la configuración del proyecto. Cada desarrollador tiene su propia API Key.
- **Schema validado**: `settings.json` usa el schema de `contributes.configuration` de VS Code. `mvc-config.json` se valida contra un JSON Schema.

## Consecuencias

- **Positivas**:
  - Separación clara de responsabilidades.
  - Configuración de proyecto versionable.
  - Configuración de extensión por desarrollador.
- **Negativas**:
  - Dos fuentes de configuración que hay que mantener.
  - El usuario debe configurar ambos archivos.

## Alternativas rechazadas

- **Todo en `settings.json`**: No versionable, no colaborativo.
- **Todo en `mvc-config.json`**: No aprovecha el schema de VS Code, no hay validación automática.
