# Marketing Video Creator - VS Code Extension

Genera vídeos de demo para aplicaciones web directamente desde VS Code.

## Características

- **Captura con Playwright**: Graba flujos de demo en formato webm
- **TTS Local**: Narración con Microsoft Pablo (System.Speech.Synthesis)
- **SRT Manual**: Editor inline para subtítulos
- **Montaje FFmpeg**: Cut, mux, concat → MP4
- **Export Mobile**: Variante 1080x1920
- **Fases configurables**: Presentación, crear ficha, evaluación, etc.

## Instalación

1. Compilar: `npm run compile`
2. Instalar Playwright: `npx playwright install chromium`
3. Configurar API Key en `settings.json`

## Configuración

```json
{
  "marketingVideoCreator.apiKey": "tu-api-key",
  "marketingVideoCreator.tts.provider": "sapi",
  "marketingVideoCreator.tts.voice": "Microsoft Pablo"
}
```

## Comandos

- `Marketing Video Creator: Iniciar Demo` - Inicia captura de demo
- `Marketing Video Creator: Abrir Panel` - Abre panel de control
- `Marketing Video Creator: Exportar Mobile` - Exporta variante mobile

## Estructura

```
src/
├── extension.ts          # Entry point
├── panel/                # Webview React
├── services/             # Servicios (Playwright, TTS, FFmpeg)
├── config/               # Configuración
├── utils/                # Utilidades
└── types/                # Tipos TypeScript
```

## Licencia

MIT
