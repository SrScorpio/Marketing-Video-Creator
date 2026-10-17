/**
 * Pack de prompts para el agente de chat (Copilot, Claude, etc.).
 *
 * La extensión ejecuta el pipeline, pero no puede adivinar qué pantallas tiene la
 * app, qué contar en cada una ni con qué selectores recorrerla. Eso lo redacta el
 * agente de chat a partir de estos prompts, y el resultado se guarda en
 * `mvc-config.json`, que es lo que la extensión lee.
 *
 * Cada prompt ofrece los dos modos:
 *   - WIZARD: pregunta al usuario y espera respuesta antes de seguir.
 *   - AUTÓNOMO: no pregunta, decide con lo que puede observar y marca supuestos.
 */

export interface PromptFile {
  /** Ruta relativa dentro del workspace. */
  path: string;
  content: string;
}

const CABECERA = `> **Modo wizard**: haz las preguntas y espera respuesta antes de continuar.
> **Modo autónomo**: no preguntes; investiga la app (código, rutas, HTML) y decide,
> marcando cada suposición con \`(supuesto)\` para que el usuario la revise después.
> Elige el modo según lo que te pida el usuario; si no dice nada, pregunta una sola
> vez qué modo quiere y sigue con él.`;

export const PROMPT_PACK: PromptFile[] = [
  {
    path: '.mvc/prompts/00-leeme.md',
    content: `# Pack de prompts · Marketing Video Creator

Estos prompts hacen el trabajo que la extensión **no** puede hacer sola: averiguar
qué pantallas tiene la app, escribir la narración de cada una y redactar los pasos
de captura con selectores reales. El resultado es \`mvc-config.json\`, el fichero
que la extensión lee para grabar y montar el vídeo.

## Orden de uso (en el chat, sin salir de VS Code)

1. \`01-descubrimiento.md\` → inventario de pantallas, acciones y datos.
2. \`02-guion.md\` → texto de la narración por fase.
3. \`03-pasos-captura.md\` → pasos Playwright por fase (selectores reales).
4. \`04-ensamblar-config.md\` → escribe \`mvc-config.json\` y lo valida.

Cada prompt es autónomo, pero el 4º usa lo que produzcan los anteriores (los
guardan en \`.mvc/\`). Para lanzarlos:

- Adjúntalos al chat: escribe \`#file:.mvc/prompts/01-descubrimiento.md\` y añade lo
  que quieras precisar.
- O abre el fichero y pulsa *Copiar* / arrástralo al chat.

## Los dos modos

| Modo | Qué hace | Cuándo usarlo |
|---|---|---|
| **Wizard** | Pregunta y espera tus respuestas (qué destacar, tono, qué pantallas, qué datos de ejemplo) | Primera vez, o si quieres controlar el mensaje |
| **Autónomo** | No pregunta nada: explora la app, decide qué contar y marca los supuestos | Cuando sólo quieres un primer borrador que revisar |

${CABECERA}

## Qué sale de aquí

- \`.mvc/discovery.md\` — inventario legible de la app (pantallas, acciones, datos).
- \`.mvc/guion.md\` — narración por fase.
- \`mvc-config.json\` — configuración que ejecuta la extensión (\`Fases\`, \`URL\`,
  \`script\` y \`steps\` por fase).

Después: en VS Code, \`Marketing Video Creator: Abrir Panel\` → pestaña **Fases** para
retocar lo que quieras, y \`Iniciar Demo\` → \`Exportar Mobile\`/\`Exportar Desktop\`.
`
  },
  {
    path: '.mvc/prompts/01-descubrimiento.md',
    content: `# 01 · Descubrimiento de la app

${CABECERA}

## Objetivo

Averiguar qué pantallas y funciones tiene la aplicación para poder grabar una demo
que tenga sentido. Trabaja sobre **este proyecto** (código, plantillas, rutas,
i18n, tests e2e) y, si hay una URL accesible, sobre la app en marcha.

## Qué investigar

1. **Rutas/pantallas** con su URL real y su título: menú de navegación, router,
   \`<title>\`, breadcrumbs.
2. **Flujo principal**: la secuencia que un usuario nuevo recorre para obtener el
   valor de la app (el caso de uso que vende). Enumera los pasos en orden.
3. **Acciones clave** por pantalla: botones y enlaces con su texto visible y un
   **selector estable** (id, \`data-testid\`, \`aria-label\`, texto de botón). Evita
   selectores por posición (\`div > div:nth-child(3)\`) y clases utilitarias.
4. **Formularios**: campos, etiquetas, valores de ejemplo realistas, botón de envío.
5. **Datos de ejemplo** disponibles (fixtures, seeds, demo data) para no inventar.
6. **Autenticación**: si hace falta login, qué credenciales de demo existen o
   dónde se configuran.

## Modo wizard (preguntas al usuario)

Si no puedes deducirlo del código, pregunta **en un solo bloque**: qué app es y a
quién va dirigida, qué tiene que entender quien vea el vídeo, qué función es la
estrella, qué pantallas quiere que salgan (y cuáles no), y a dónde debe llegar el
flujo (registrarse, crear, exportar...).

No preguntes lo que puedas leer tú del proyecto.

## Salida

Escribe \`.mvc/discovery.md\` con esta forma:

\`\`\`markdown
# <nombre de la app>

**Para quién**: ...
**Propuesta de valor**: ...
**Flujo propuesto** (en orden): 1) ... 2) ... 3) ...

## Pantallas
| # | Pantalla | URL | Qué se ve | Acción clave (selector) |
|---|---|---|---|---|
| 1 | Inicio | /  | ... | "Empezar" \`#empezar\` |

## Formularios
| Pantalla | Campo | Etiqueta | Valor de ejemplo |
|---|---|---|---|

## Requisitos de entorno
- URL base: ...
- Login: ...
- Datos de ejemplo: ...

## Supuestos
- (supuesto) ...
\`\`\`

Nada de relleno: si no has podido comprobar algo, dilo y márcato como supuesto.
`
  },
  {
    path: '.mvc/prompts/02-guion.md',
    content: `# 02 · Guion de la narración

${CABECERA}

## Objetivo

Escribir el texto que se narra en cada fase del vídeo. Antes de empezar, lee
\`.mvc/discovery.md\` (si no existe, lánzale antes \`01-descubrimiento.md\`).

## Reglas

- **Idioma**: español de España. Tono claro y directo, sin superlativos ni
  "solución innovadora". Habla de lo que hace la app, no de lo buena que es.
- **Duración**: 1 frase ≈ 2,5 s. Ajusta cada guion a la duración de su fase (por
  defecto: presentación 5 s, pantallas de trabajo 8-10 s, cierre 5 s).
- **Una idea por fase**: entra, explica qué se está viendo y qué consigue el
  usuario. Empieza por el problema o el objetivo, no por "en esta pantalla".
- **Segunda persona** ("creas la ficha", no "se crea la ficha" ni "nosotros").
- **Números y datos concretos** (lo que aparezca en pantalla), nunca "varios" ni
  "muchos".
- Nada de leer en voz alta lo que ya se ve (no narres los clics).
- Sin markdown, sin emojis, sin siglas inventadas: es texto que se locuta.
- Frases cortas, separadas por puntos: así el SRT las reparte bien.

## Modo wizard (preguntas al usuario)

Pregunta en un bloque: a quién va dirigido (cliente, inversor, redes), qué debe
quedar claro al terminar, qué tono quiere (cercano, técnico, comercial) y qué
tiene prohibido decir o prometer. No preguntes más de lo necesario para escribir.

## Salida

Añade a \`.mvc/guion.md\` el guion de cada fase:

\`\`\`markdown
## 01-presentacion (5 s)
Texto de la narración. Una o dos frases.

## 02-crear-ficha (10 s)
...
\`\`\`

Y al terminar, indica cuántas palabras tiene cada fase (para que se vea si cuadra
con su duración) y qué fases han quedado cortas o largas.
`
  },
  {
    path: '.mvc/prompts/03-pasos-captura.md',
    content: `# 03 · Pasos de captura

${CABECERA}

## Objetivo

Traducir cada fase a una lista de pasos que la extensión ejecuta con Playwright,
con selectores que funcionen de verdad. Lee \`.mvc/discovery.md\`.

## Acciones disponibles (no existen otras)

\`\`\`json
{ "action": "goto", "url": "https://app/ruta", "waitUntil": "load | domcontentloaded | networkidle" }
{ "action": "click", "selector": "#nueva-ficha" }
{ "action": "fill", "selector": "#nombre", "text": "Texto de ejemplo" }
{ "action": "press", "selector": "#nombre", "key": "Enter" }
{ "action": "waitForSelector", "selector": ".resultado", "timeoutMs": 5000 }
{ "action": "wait", "ms": 500 }
\`\`\`

## Reglas

- **Selectores estables y verificables**: \`#id\`, \`[data-testid="..."]\`,
  \`[aria-label="..."]\`, \`role=button[name="Guardar"]\`. Prohibido
  \`nth-child\`, \`div > div\`, clases de CSS generadas (\`css-1x2y3z\`).
- **Verifica, no adivines**: si tienes acceso al código o a un e2e existente, saca
  el selector de ahí. Si no puedes comprobarlo, márcalo \`(supuesto)\` y añade un
  \`waitForSelector\` del resultado esperado para que el fallo se vea claro.
- **Empieza cada fase** con \`goto\` (a la ruta de esa pantalla) salvo que la fase
  continúe en la misma pantalla que la anterior.
- **Nada de datos irreales**: usa los fixtures/valores de ejemplo del proyecto.
- **No metas login en todas las fases**: si la app necesita sesión, deja claro en
  \`.mvc/discovery.md\` cómo se resuelve y no lo repitas en cada fase.
- Cada fase debe terminar en un estado estable y visible (sin spinners).

## Modo wizard (preguntas al usuario)

Pregunta sólo lo que no puedas ver: credenciales de demo, si hay que crear datos
antes (una ficha, un informe), y qué resultado debe verse al final de cada fase.

## Salida

Añade a \`.mvc/guion.md\` (o a \`.mvc/pasos.md\`) los pasos por fase, en JSON listo
para pegar:

\`\`\`json
{
  "id": "02-crear-ficha",
  "steps": [
    { "action": "goto", "url": "https://app/fichas/nueva", "waitUntil": "networkidle" },
    { "action": "fill", "selector": "#nombre", "text": "Rocinante" },
    { "action": "click", "selector": "[data-testid=guardar]" },
    { "action": "waitForSelector", "selector": ".ficha-guardada", "timeoutMs": 8000 }
  ]
}
\`\`\`

Enumera al final los selectores que has marcado como supuesto.
`
  },
  {
    path: '.mvc/prompts/04-ensamblar-config.md',
    content: `# 04 · Ensamblar y validar mvc-config.json

${CABECERA}

## Objetivo

Escribir \`mvc-config.json\` en la raíz del proyecto con todo lo anterior, y
comprobarlo antes de dar por hecho que la extensión va a funcionar.

## Formato exacto (es lo que lee la extensión)

\`\`\`json
{
  "version": "1.0.0",
  "project": {
    "name": "nombre-del-proyecto",
    "url": "https://app-a-demostrar",
    "outputDir": "./output/demo-video",
    "variant": "desktop",
    "phases": [
      {
        "id": "01-presentacion",
        "label": "Presentación",
        "duration": 5,
        "url": "https://app-a-demostrar/",
        "script": "Texto que se narra en esta fase.",
        "steps": [
          { "action": "goto", "url": "https://app-a-demostrar/", "waitUntil": "domcontentloaded" },
          { "action": "waitForSelector", "selector": "#empezar" }
        ]
      }
    ]
  }
}
\`\`\`

## Reglas del fichero

- \`version\` siempre \`"1.0.0"\`; si no coincide, la extensión ignora el fichero.
- \`id\` de fase: minúsculas, números y guiones, siempre con prefijo numérico
  (\`01-presentacion\`). Sin espacios ni acentos.
- \`duration\` en segundos: entero y mayor que 0. Cuadra con el guion (≈2,5 s por
  frase); si no cuadra, alarga la duración o acorta el texto, pero no dejes la
  narración cortada a media frase.
- \`script\` es el texto literal: sin markdown, sin comillas de más, sin \`\\n\`.
- \`steps\`: sólo las acciones del prompt 03. Se pueden omitir (la fase se graba
  sin acciones), pero entonces la fase no hace nada visible.
- \`variant\`: \`desktop\`, \`mobile\` o \`both\` según dónde se publique.

## Comprobación antes de entregar

Revisa y di el resultado **explícito** de cada punto:

1. El JSON es válido (sin comas finales, sin comentarios) y \`version\` es \`1.0.0\`.
2. Todas las fases tienen guion y ningún guion queda cortado.
3. Todos los pasos usan acciones de la lista y selectores estables.
4. Los ids de fase son únicos y siguen el formato.
5. Hay una fase de apertura y una de cierre con sentido (no termines en seco).
6. Cada fase acaba en un estado visible (sin spinner).

## Salida

1. \`mvc-config.json\` completo en la raíz del proyecto.
2. Un resumen de la comprobación: fase → duración → frases → selectores supuestos.
3. Lo que el usuario debería revisar a mano (normalmente: selectores supuestos y
   credenciales de demo).
`
  }
];

/** Ruta absoluta relativa al workspace del fichero que se abre al crearlo. */
export const PROMPT_ENTRY_FILE = '.mvc/prompts/00-leeme.md';
