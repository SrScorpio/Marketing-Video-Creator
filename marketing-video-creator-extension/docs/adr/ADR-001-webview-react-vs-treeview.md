# ADR-001: Webview React vs TreeView para la interfaz de usuario

## Contexto

Se necesita una interfaz de usuario para configurar y controlar la generación de vídeos demo. Dos opciones principales:

1. **TreeView con checkboxes**: Interfaz nativa de VS Code, ligera, sin dependencias de frontend.
2. **Webview con React**: Interfaz web moderna, más flexible, permite formularios complejos y feedback visual en tiempo real.

## Decisión

Se elige **Webview con React** como interfaz principal.

## Justificación

- **Complejidad de la interfaz**: El flujo de generación de vídeo requiere múltiples pasos (URL, fases, guiones, configuración TTS/FFmpeg) que se representan mejor con formularios web.
- **Feedback en tiempo real**: La captura con Playwright y el montaje con FFmpeg son operaciones largas que necesitan actualizaciones de progreso visuales (barras de progreso, logs en vivo).
- **Experiencia de usuario**: React permite componentes reutilizables y un diseño más atractivo y responsive.
- **Herramientas existentes**: El proyecto ya usa `@vscode/webview-ui-toolkit` para componentes que imitan el look & feel de VS Code.

## Consecuencias

- **Positivas**:
  - Interfaz moderna y flexible.
  - React ecosistema maduro.
  - Fácil de iterar y mejorar.
- **Negativas**:
  - Mayor tamaño del VSIX (bundle React).
  - Requiere gestión de comunicación extension ↔ webview (postMessage).
  - Depuración más compleja (DevTools del webview).

## Alternativas rechazadas

- **TreeView simple**: No soporta formularios complejos ni feedback visual en tiempo real.
- **Webview vanilla JS**: Menos mantenible que React para una interfaz con múltiples estados y componentes.
