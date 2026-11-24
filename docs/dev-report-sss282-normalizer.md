# Informe DEV — SSS-282 · Normalizador y persistencia de `discovery.json`/`.md`

Tarjeta: `t_33685052` (descomposición de SSS-282)
Rama: `feat/sss-282-normalizer` (desde `feat/sss-282-crawler` @ `1c6181d`, que a su vez sale de `origin/main` @ `1a538f5`)
Base declarada: esta fase **depende** del crawler de `t_a9495716`; el PR debe ir encadenado tras el de la rama del crawler.

## Hecho

| Pieza | Qué hace |
|---|---|
| `src/discovery/normalizer.ts` | `normalizeDiscovery(raw, { now })`: función **pura** (no muta la entrada, reloj inyectable) que devuelve el contrato FIJO ya limpio. Dedupe de elementos por selector, descarte/reescritura de selectores inestables, `selectorStrategy` RECALCULADA desde el selector, rutas normalizadas, páginas ordenadas por path, duplicados fuera, `stats.pageCount` recalculado, `skipped` deduplicado y ordenado, `warnings` deduplicados + avisos de normalización. |
| | `renderDiscoveryMarkdown(doc)`: una sección por página (título, URL, encabezados, **tabla de acciones texto → selector** con estrategia y formulario, **tabla de formularios** campo/tipo/selector, estados), más índice, descartes y avisos. |
| | `serializeDiscoveryJson(doc)`: JSON estable con 2 espacios y salto final; claves en el orden del contrato. |
| | `writeDiscoveryArtifacts(doc, outDir)`: crea el directorio y escribe **sólo** `discovery.json` y `discovery.md` (temporal + `rename` por fichero: sin restos a medias). Nunca toca `guion.md`, `prompts/` ni el resto de `.mvc/`. |
| `src/discovery/index.ts` | Exporta el normalizador, el renderizador, el serializador, el escritor y los helpers `isUnstableSelector`/`selectorStrategyOf`. |
| `src/extension.ts` | `marketing-video-creator.discoverApp` normaliza el inventario y escribe `<workspace>/.mvc/discovery.json` y `.mvc/discovery.md`; deja las rutas y el JSON normalizado en el canal de salida. Si el crawl falla no se escribe nada. |
| `test/discovery-normalizer.test.ts` | 21 tests puros (sin navegador ni jsdom): 6 de páginas, 7 de elementos, 1 de formularios, 3 de markdown, 1 del contrato JSON, 3 de persistencia (incluye «reemplaza sólo sus artefactos» y «no deja temporales»). |
| `scripts/e2e-discovery-normalize.mjs` | E2E real: app de 3 pantallas servida en local → crawler compilado → normalización → escritura en un `.mvc/` que ya tenía `guion.md` y `prompts/00-leeme.md`. 40 comprobaciones. Script `npm run test:e2e:discovery:normalize`. |

### Reglas de selector inestable

- **Fuera**: clases autogeneradas (`css-1x2y3z`, `sc-…`, `jsx-…`, `emotion-…`, `Mui…`, `tw-…`, hashes tipo `foo-1a2b3c`/`a1b2c3d4`) y selectores posicionales (`:nth-of-type`, `:nth-child`, `:first-child`…) o por subcadena de clase (`[class*=…]`).
- **Reescritura antes que descarte**: si el elemento es `button`/`link` y tiene texto, se reescribe a `role=<rol>[name="<texto>"]` (`selectorStrategy: role+name`).
- **Descarte** sólo cuando no hay texto ni rol del que derivar un selector: se anota en `warnings` con la página y el número.
- Los campos de formulario **no se descartan** (romperían el formulario): se deduplican y, si su selector es inestable, se avisa en `warnings` para revisarlo antes de grabar.
- `css` se conserva cuando el selector es estable (`#id` inexistente, clase semántica tipo `.btn-icono`, `:has-text` de un `output` sin rol inferible) — es lo que ya decidió el lector de página aplicando la prioridad `id → data-testid → aria-label → role+name → css`.

## Verificación ejecutada (comandos exactos y resultado real)

```
$ npm run compile
tsc -p ./tsconfig.json && vite build → OK (dist/panel/index.js 335.02 kB)

$ npx vitest run test/discovery-normalizer.test.ts
Test Files  1 passed (1) · Tests  21 passed (21)      # visto ROJO antes: "Failed to load url ../src/discovery/normalizer"

$ npm test
Test Files  13 passed (13) · Tests  169 passed (169)    # eran 148; +21 nuevos, 0 regresiones

$ node ./scripts/e2e-discovery-normalize.mjs
40 PASS · 0 FAIL — E2E de normalización de descubrimiento

$ node ./scripts/e2e-discovery.mjs        # E2E del crawler (padre), sin regresión
50 PASS · 0 FAIL — E2E de descubrimiento: OK

$ npm audit --omit=dev
found 0 vulnerabilities
```

Qué cubre el E2E (todo contra el crawler real, sin mocks del navegador):

- 3 pantallas devueltas y ordenadas por path (`/detalle.html`, `/index.html`, `/informe.html`), 0 mutaciones HTTP.
- Contrato comprobado clave a clave: raíz `[generatedAt, baseUrl, pages, stats, warnings]`, página (7 claves), `stats` (3), elemento (5), formulario (2), campo (3).
- **Ningún selector final inestable** (`isUnstableSelector(selector) === false` para los 29 elementos y 6 campos reales) y todas las `selectorStrategy` dentro del enum del contrato.
- Markdown: cabecera con host, una sección numerada por página, tabla de acciones y tabla de formularios con una fila por elemento real.
- Persistencia: `discovery.md` previo reemplazado; `guion.md` y `prompts/00-leeme.md` **intactos**; sin ficheros `.tmp-*`; conjunto de ficheros exacto `['discovery.json','discovery.md','guion.md','prompts']`.
- `.mvc/` ignorado por git: `git check-ignore -v .mvc/discovery.json .mvc/discovery.md` → `.gitignore:6:.mvc/` para ambos (el `.gitignore` ya ignoraba `.mvc/` completo desde la fase del crawler, así que cubre los dos artefactos y cualquier otro inventario local).

Muestra real del artefacto (crawl de la app de prueba, 3 pantallas): acciones como `Guardar → #guardar (id)`, `Abrir detalle → [data-testid="abrir-detalle"]`, `Ver más → role=button[name="Ver más"]`, formulario `Alta de cliente` con `Nombre/text/#nombre`, `Plan/select/#plan`, y descartes `#ayuda (ancla)`, `mailto:… (no-http)`, `https://externo.example.com/… (externo)`, `profundo.html (max-profundidad)`.

## Decisiones y desviaciones declaradas

1. **Rama base**: el encargo cita `feat/pipeline-e2e`, ya mergeada; esta fase sale de `feat/sss-282-crawler` porque consume sus tipos y su salida. El PR va encadenado (o se reordena el merge) — lo coordina el orquestador.
2. **`baseUrl`** se conserva tal cual la entrega el crawler (es la URL de arranque, p. ej. `…/index.html`), sólo se le quita el hash y la barra final cuando la ruta es `/`. No se degrada a origen: es la referencia con la que el agente construye URLs relativas.
3. **`generatedAt`**: se respeta el del crawler si es ISO-8601 válido; sólo se regenera (con el reloj inyectable) si falta o no es ISO. Así el JSON y el markdown de una misma captura son consistentes.
4. **Duplicados de página**: gana la primera aparición por path normalizado y se anota en `warnings`; el crawler no debería producirlos, pero el normalizador es defensivo (contrato consumido por otras tareas).
5. **Idempotencia de escritura**: cada artefacto se escribe a un temporal y se renombra. Si el segundo rename falla, el primero ya está sustituido: los dos ficheros no son atómicos entre sí (no hay transacción de dos ficheros en POSIX). El fallo se propaga y no quedan temporales; lo anoto como limitación conocida.
6. **`.gitignore`**: no se añadieron entradas redundantes; `.mvc/` (línea 6) ya cubre `discovery.json` y `discovery.md`, verificado con `git check-ignore -v`.
7. **Elementos `status` con `output`**: su selector final sigue siendo `output:has-text("…")` (css) porque el lector de página no infiere rol para `output`. Es estable respecto al texto y el normalizador no inventa roles que no pueda verificar sin navegador.

## Pendiente

- Commit y push de la rama; PR encadenado al del crawler lo coordina el orquestador (`local-only`).
- Tarjetas hermanas: convertidor a fases, asistente del panel.
