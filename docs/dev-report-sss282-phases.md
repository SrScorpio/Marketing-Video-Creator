# Informe DEV — SSS-282 · Convertidor `discovery` → borrador de fases

Tarjeta: `t_9bfc880f` (descomposición de SSS-282)
Rama: `feat/sss-282-phases` (desde `feat/sss-282-normalizer` @ `1f8bb86`, que sale de `feat/sss-282-crawler` @ `1c6181d`)
Base declarada: el encargo cita `feat/pipeline-e2e`, ya mergeada en `origin/main`; esta fase **depende** del contrato del normalizador, así que sale de su rama y el PR va encadenado tras ella.

## Hecho

| Pieza | Qué hace |
|---|---|
| `src/discovery/phases-proposer.ts` | `discoveryToPhases(discovery, options?)`: función **pura** (sin IO, no muta la entrada) que devuelve `{ phases, warnings }` con el esquema que ya consume el pipeline (`id/label/duration/url/script/steps`). Una fase por pantalla; la pantalla de arranque (`discovery.baseUrl`) primero; `duration` 5 s la apertura y 8 s el resto (coherente con `DEFAULT_PHASES`); `script` en español con marcador `[borrador]`; pasos con `goto` a la URL observada (a partir de la segunda fase) + `waitForSelector` sobre el primer control estable observado + `wait` de asentamiento. |
| | `slugify`, `pageLabel`, `DRAFT_SCRIPT_MARKER`, `DEFAULT_MAX_PHASES` (10), `DEFAULT_PHASE_DURATION` (8), `DEFAULT_FIRST_DURATION` (5). |
| `src/discovery/phases-draft.ts` | `buildPhasesDraft(proposal, { base, baseUrl })` (misma forma que `mvc-config.json` conservando nombre/URL/salida/variante del proyecto activo), `writePhasesDraft()` (**sólo** `.mvc/mvc-config.borrador.json`, temporal + rename), `readDiscoveryDoc()` (errores accionables), `applyPhasesDraftToProjectConfig({ workspaceRoot, draft, confirm })` con la garantía dura: **sin `confirm() === true` no se escribe `mvc-config.json`** (devuelve `reason: 'cancelled'` y el hash de antes y después). |
| `src/config/config-file.ts` | Serializador y escritura atómica **únicos** de `mvc-config.json`, sin VS Code: `serializeProjectConfigFile`, `writeProjectConfigFile`, `readProjectConfigFile`, `fileHash` (SHA-256, para probar que un fichero no se tocó). |
| `src/config/project-config.ts` | `saveProjectConfig` delega en `writeProjectConfigFile`: el caso `savePhases` del panel y el convertidor comparten el mismo camino de escritura (sin duplicar serialización). |
| `src/extension.ts` | Comando `marketing-video-creator.proposePhases`: lee `.mvc/discovery.json`, propone fases, **siempre** escribe el borrador, y sólo tras el diálogo modal (`showWarningMessage(..., { modal: true }, 'Escribir fases')`) aplica las fases. Cancelar/Escape = `mvc-config.json` intacto. Helper `postProjectState` reutilizado por `savePhases`. |
| `src/discovery/index.ts` | Exporta el convertidor, el borrador y sus tipos. |
| `package.json` | Comando en `contributes.commands` + `activationEvents` y script `test:e2e:discovery:phases`. |
| `test/discovery-phases.test.ts` | 26 tests puros: agrupación/orden/ids/duraciones, selectores sólo del inventario, nunca clics destructivos ni de formulario, guion borrador, pantallas sin controles o sólo con estados, límite de fases, determinismo, forma del borrador, escritura aislada, y **sin confirmación mismo hash / con confirmación se escribe**. |
| `scripts/e2e-discovery-phases.mjs` | E2E real (41 comprobaciones): app de 3 pantallas servida en local → crawler → normalizador → `discovery.json` en disco → convertidor → borrador → **ejecución real de los pasos con Playwright** → aplicación sin/con confirmación → ejecución de las fases guardadas. `npm run test:e2e:discovery:phases`. |

### Muestra real (crawl de la app de prueba)

```json
{
  "id": "01-gestion-de-clientes",
  "label": "Gestión de clientes",
  "duration": 5,
  "url": "http://127.0.0.1:PORT/index.html",
  "script": "Abre la demo en «Gestión de clientes» (pantalla 1 de 3). Sección «Resumen del día». La pantalla pide 4 dato(s): Nombre, Email, Plan, Notas. Ofrece 17 control(es) para recorrer la app. Estado visible: «Todo listo para empezar.». [borrador] Sustituye este texto por la narración real: qué resuelve esta pantalla y por qué le importa al usuario.",
  "steps": [
    { "action": "waitForSelector", "selector": "#guardar", "timeoutMs": 15000 },
    { "action": "wait", "ms": 800 }
  ]
}
```

Avisos del borrador (4): acciones seguras que NO se pulsan (`Abrir ayuda`, `Abrir detalle`, `Ver más`, `Descargar informe`) y acciones sensibles detectadas (`Borrar cuenta`, `Pagar ahora`, `Eliminar cliente`).

## Verificación ejecutada (comandos exactos y resultado real)

```
$ npm run compile
tsc -p ./tsconfig.json && vite build → OK (dist/panel/index.js 335.02 kB)

$ npx vitest run test/discovery-phases.test.ts
Test Files  1 passed (1) · Tests  26 passed (26)

$ npm test
Test Files  14 passed (14) · Tests  195 passed (195)     # eran 169; +26 nuevos, 0 regresiones

$ node ./scripts/e2e-discovery-phases.mjs
41 PASS · 0 FAIL — E2E del convertidor discovery → fases

$ node ./scripts/e2e-discovery.mjs            # E2E del crawler (abuelo), sin regresión
50 PASS · 0 FAIL

$ node ./scripts/e2e-discovery-normalize.mjs  # E2E del normalizador (padre), sin regresión
40 PASS · 0 FAIL

$ npm audit --omit=dev
found 0 vulnerabilities
```

**Comprobación de que los tests muerden** (mutaciones temporales, luego restauradas): con `DEFAULT_FIRST_DURATION = 6` falla el test de duraciones; con la condición de confirmación anulada (`!confirmed && false`) falla el test «sin confirmación deja mvc-config.json EXACTAMENTE igual (mismo hash)». 2 de 26 en rojo en ambos casos.

Qué cubre el E2E, con ejecución real (no sólo generación):

- 3 pantallas, 0 mutaciones HTTP en el crawl; portada primero; ids `01-gestion-de-clientes`, `02-cliente-42`, `03-informe-mensual`; duraciones 5/8/8.
- **Todos** los selectores de `click`/`waitForSelector` existen en el `.mvc/discovery.json` persistido (comparación contra el artefacto, no contra el objeto en memoria); los `goto` usan la URL de su fase.
- El borrador se escribe en `.mvc/mvc-config.borrador.json`; `mvc-config.json`, `guion.md`, `discovery.json` y `discovery.md` quedan intactos; sin ficheros `.tmp-*`; `.mvc/` sigue ignorado por git (también el borrador).
- El borrador pasa `normalizePhases` (0 avisos) y `validateProjectConfig` (0 errores), y **sus pasos se ejecutan con Playwright contra la app real** con 0 mutaciones HTTP.
- Sin confirmación: `reason=cancelled`, hash `antes === después`, contenido byte a byte igual. Con confirmación: hash cambia, 3 fases en `mvc-config.json`, se conservan `name/url/outputDir/variant`, la fase antigua desaparece, los pasos guardados son idénticos a los del borrador, y esas fases guardadas **también se ejecutan** contra la app sin retocar nada.

## Decisiones y desviaciones declaradas

1. **Rama**: sale de `feat/sss-282-normalizer` (no de `feat/pipeline-e2e`, ya mergeada) porque consume su contrato; el PR va encadenado tras el del normalizador. Lo coordina el orquestador.
2. **Una fase por pantalla**, sin agrupar pantallas «simples»: mantiene la relación 1:1 pantalla ↔ narración y evita fases con dos URLs. El encargo admitía ambas opciones; si se quiere agrupar, es un cambio acotado en `discoveryToPhases`.
3. **Orden de fases**: el normalizador ordena las páginas por path (alfabético), así que el convertidor reordena poniendo primero la pantalla de `discovery.baseUrl`. Sin esto, la demo arrancaría en una pantalla interna.
4. **`duration`**: 5 s la apertura y 8 s el resto, igual que los valores 5–10 s de `DEFAULT_PHASES`. Configurable por opciones; no se inventan duraciones por número de controles.
5. **Pasos**: la primera fase no lleva `goto` porque el pipeline ya abre `phase.url` (`PlaywrightCapture.start`); las siguientes sí lo llevan para que cada fase sea autocontenida. La guarda de espera es el primer control estable OBSERVADO (nunca textos de estado, que son transitorios).
6. **`selectorStrategy` no existe en `CaptureStep`**: no se añade un campo nuevo al esquema del pipeline (lo descartaría `parseCaptureSteps` y el borrador mentiría). La estrategia se conserva de forma implícita (el selector se copia verbatim) y, si la guarda cae en `css`, el borrador lo avisa. Si el orquestador quiere la estrategia visible en el fichero, es un cambio de contrato aparte.
7. **Clics**: por defecto el borrador NO pulsa nada (precedente del WIP y criterio de seguridad: no ejecutar acciones de la app del usuario sin pedirlo). `includeSafeClicks: true` añade como máximo un clic por fase, sólo botón estable, fuera de formulario y no destructivo (`isDestructiveAction`); nunca enlaces (podrían salir del origen). Las acciones descartadas se listan en `warnings`.
8. **Escritura única y compartida**: `saveProjectConfig` ahora delega en `src/config/config-file.ts` (misma serialización, temporal + rename). Es el único toque a código existente fuera de `extension.ts` y no cambia el formato del fichero; se hace para que «sin confirmación no se escribe» se pruebe sobre el MISMO camino que usa `savePhases`.
9. **Diálogo modal**: `showWarningMessage(..., { modal: true }, 'Escribir fases')`; Cancelar/Escape devuelve `undefined` y el resultado es `cancelled`. Si no hay `mvc-config.json`, con confirmación se crea a partir del borrador (URL = `discovery.baseUrl`).
10. **UX del panel**: no se añade botón nuevo en la pestaña Fases (fuera de alcance); el comando está en la paleta y sus avisos se vuelcan al panel y al log. Añadir el botón es un follow-up trivial (`send('proposePhases')` + caso en `handleWebviewMessage`).
11. **`.mvc/`**: no se añaden entradas a `.gitignore`; la regla existente ignora también el borrador (verificado con `git check-ignore` en el E2E).

## Pendiente

- Commit y push de la rama; PR encadenado tras el del normalizador (local-only por ahora) lo coordina el orquestador.
- QA `t_97881136` pedirá cobertura ≥80 % de `normalizer` + `converter`: este E2E cubre `phases-proposer`/`phases-draft`/`config-file` con 26 tests y 41 comprobaciones reales.
- Hotspot `extension.ts` compartido con la tarjeta del panel `t_4647ea53`.
