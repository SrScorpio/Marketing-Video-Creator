# ADR-002: Playwright como dependencia vs child_process

## Contexto

Para capturar el flujo de demo del usuario, se necesita automatizar un navegador web. Dos opciones:

1. **Usar Playwright como dependencia npm**: Instalar `@playwright/test` y gestionar Chromium automáticamente.
2. **Usar child_process para lanzar un navegador existente**: Lanzar Chrome/Edge desde el sistema sin dependencias adicionales.

## Decisión

Se elige **Playwright como dependencia npm** con instalación automática de Chromium.

## Justificación

- **Consistencia**: Playwright garantiza el mismo comportamiento en Windows, macOS y Linux. child_process depende del navegador del sistema.
- **API rica**: Playwright ofrece APIs para esperar elementos, hacer clicks, escribir texto, capturar frames — todo lo necesario para una demo interactiva.
- **Captura nativa**: Playwright soporta grabación de video (webm) directamente, sin herramientas externas.
- **Instalación automática**: `npx playwright install chromium` se ejecuta la primera vez sin intervención del usuario.

## Consecuencias

- **Positivas**:
  - Captura consistente y reproducible.
  - API rica para interacciones.
  - Grabación webm nativa.
- **Negativas**:
  - Primer uso más lento (descarga de Chromium ~100MB).
  - Mayor tamaño del VSIX.
  - Requiere `npx playwright install chromium` inicial.

## Alternativas rechazadas

- **child_process + Chrome local**: No consistente entre sistemas, sin API de interacción, sin grabación nativa.
- **Puppeteer**: Similar a Playwright pero menos mantenible (proyecto original de Google, Playwright es el sucesor).
