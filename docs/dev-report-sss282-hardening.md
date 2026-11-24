# Informe DEV — SSS-282 · Endurecimiento del descubrimiento (F1–F5)

Tarjeta: `t_0952bc12` (hija de `t_9fb94da5`, SSS-282)
Rama: `fix/sss-282-discovery-hardening` (desde `feat/sss-282` @ `dd44a4b`, base del PR #2)
Origen de los hallazgos: QA `t_97881136` (`INFORME-QA-SSS282-TESTS.md`, `evidence-sondas.txt`)
Alcance: 1 defecto MEDIUM (patrón destructivo) + 4 LOW (calidad de selectores). Sin plan nuevo: el
contrato lo fija SSS-282. No se toca `DiscoveryElement`, ni `mvc-config.json`, ni el defecto hermano
`t_4f981345` (selectores `kind=status`).

## Resumen

| # | Antes (QA) | Después (medido) |
|---|---|---|
| F1 | `includeSafeClicks: true` proponía clic en `Cancelar cuenta`, `Anular pedido`, `Desactivar usuario`, `Cerrar sesión`, `Salir` | Patrón en `src/discovery/destructive.ts` (fuente única; `crawler` lo reexporta y `phases-proposer` lo importa): **0 clics** sobre esos textos ni sobre 14 variantes sensibles |
| F2 | `path` `/redir?next=http://externo.test/a` → `/redir?next=http:/externo.test/a` | El colapso de `//` se aplica **sólo al pathname**; la query queda intacta y `url` sigue igual |
| F3 | dos formularios idénticos sin etiqueta se quedaban como `formulario 1` y `formulario 2` | El dedupe va **antes** de la etiqueta por defecto: queda uno (`formulario 1`); el índice original se conserva para los que sobreviven (`formulario 3`) |
| F4 | `selectorStrategyOf('button#guardar')` → `css` | → `id` (id en compuesto simple); `form#alta button.guardar` sigue `css` |
| F5 | dos controles distintos con el mismo texto colapsaban en uno **sin aviso**; la reescritura perdía el formulario | Control dentro de formulario se reescribe `form >> role=…[name=…]`; si dos controles de **origen distinto** colapsan, se emite aviso `colisión:` explícito |

## F1 · patrón destructivo compartido

- **Una sola fuente de verdad**: nuevo `src/discovery/destructive.ts` con `DESTRUCTIVE_PATTERN` e
  `isDestructiveAction`. `crawler.ts` lo reexporta (compatibilidad de imports) y `phases-proposer.ts`
  lo importa de ahí; el test comprueba **identidad de objeto** (`CRAWLER_PATTERN === DESTRUCTIVE_PATTERN`)
  y de función, así que no pueden divergir.
- **Patrón ampliado**: `pagar|comprar|borrar|eliminar|delete|pay|checkout|subscri…|suscrib…|suscrip…|cancel…|anul…|desactiv…|cerrar sesión|log out|salir|reset…|restablec…|archivar|baja`.
- Se mantiene **conservador**: un falso positivo sólo evita un clic en la demo; un falso negativo
  pulsaría «Cancelar cuenta»/«Cerrar sesión» en la app real. Efecto colateral declarado: botones
  genéricos «Cancelar»/«Resetear filtros» tampoco se proponen (se añaden a mano).
- Fixture versionado: `test/fixtures/discovery/destructive-actions.json` (14 sensibles + 12 seguras).
- Test de conversión: inventario con los 5 textos del informe + acción segura → `includeSafeClicks: true`
  propone **sólo** `[data-testid="abrir-ayuda"]`; los 5 quedan listados en `warnings` como «NUNCA pulsadas».

## F2–F5 · normalizador

- **F2** `normalizePath`: separa `pathname` y `search` antes de colapsar `/\/{2,}/`; la barra final se
  recorta sólo del pathname (`/filtros/?x=1` → `/filtros?x=1`); si llega una URL absoluta se usa su
  `pathname+search`.
- **F3** `normalizeForm` devuelve `{ label crudo, fields }`; el dedupe (`JSON.stringify` de etiqueta
  cruda + campos) ocurre en `normalizePage` y la etiqueta `formulario N` se pone después, con el índice
  original del crudo. Ajuste equivalente para `unstableFields`: sólo cuentan los formularios conservados.
- **F4** `selectorStrategyOf`: `COMPOUND_SELECTOR` (sin combinadores) + `idTokens()` → `id` en
  `button#guardar`/`button#guardar.primario`; se mantiene el orden `id > data-testid > aria-label > role+name > css`.
- **F5** `normalizeElement` devuelve `{ element, rewritten, sourceSelector }`. Si el control vive en un
  formulario, el selector reescrito es `form >> role=<rol>[name="<texto>"]` (Playwright resuelve el
  encadenado CSS→role). En el dedupe, si dos controles con **selector crudo distinto** colapsan en el
  mismo selector reescrito, se cuenta la colisión y se emite
  `normalización: <path> — colisión: N control(es) de origen distinto reescrito(s) al mismo selector (…); desambigua…`.
  Mismo selector crudo repetido = el mismo control leído dos veces: no avisa.

## Tests en ROJO vistos antes del fix

Spec nuevo `test/discovery-hardening.test.ts` (40 tests) ejecutado contra `dd44a4b` (sólo existía el
módulo `destructive.ts` con el patrón viejo, para que el import resolviera):

```text
$ npx vitest run test/discovery-hardening.test.ts
 Test Files  1 failed (1)
      Tests  20 failed | 20 passed (40)
```

Fallos rojos, uno por defecto: identidad de patrón, 12 textos sensibles (`Cancelar cuenta`, `Anular
pedido`, `Desactivar usuario`, `Cerrar sesión`, `Salir`, `Logout`, `Dar de baja`, `Restablecer
contraseña`, `Archivar cliente`…), 2 de inventario F1, 2 de F2, 2 de F3, 1 de F4 y 2 de F5. Log
completo: `/tmp/red-final.log` (y `/tmp/red-b.log`, primera pasada con la lista inline).

## Verificación ejecutada (comandos y resultado real)

```text
$ npm test
Test Files  17 passed (17)
     Tests  279 passed (279)          # 239 previos + 40 nuevos; 0 regresiones

$ npx tsc -p ./tsconfig.json --noEmit
exit 0

$ npm run test:e2e                  # compile + e2e-linux + aceptación del descubrimiento
compile: tsc + vite build → OK (dist/panel/index.js 343.16 kB)
pipeline: 18/18 comprobaciones OK
aceptación: 65 PASS · 0 FAIL · 1 XFAIL   (XFAIL = defecto abierto t_4f981345, igual que antes)
E2E_EXIT=0

$ npm audit --omit=dev
found 0 vulnerabilities
```

## Diff real

```text
 src/discovery/crawler.ts            |  10 +-    (patrón → reexport de destructive.ts)
 src/discovery/normalizer.ts         | 144 +++++++++++++++++++++-----
 src/discovery/phases-proposer.ts    |   2 +-    (import desde destructive.ts)
 test/discovery-fixtures.test.ts     |   2 +-    (1 expectativa: role+name → form >> role+name)
 4 files changed, 118 insertions(+), 40 deletions(-)
 + src/discovery/destructive.ts                 (25 líneas, nuevo)
 + test/discovery-hardening.test.ts             (295 líneas, 40 tests, nuevo)
 + test/fixtures/discovery/destructive-actions.json (32 líneas, nuevo)
```

Único cambio en una expectativa existente: `test/discovery-fixtures.test.ts:150` pasa de
`role=button[name="Guardar"]` a `form >> role=button[name="Guardar"]` porque ese botón del fixture
declara `formLabel: 'Alta de cliente'` y F5 exige conservar el ámbito. El resto de specs de QA
(normalizador, convertidor, fixtures, panel) siguen verdes sin tocarlos.

## Límites, riesgos y pendientes

- **No tocado**: contrato de `DiscoveryElement`, selectores de `button`/`link`/`input` del `page-reader`,
  `mvc-config.json`, `npm test`/scripts del `package.json`, defecto `t_4f981345` (`kind=status`).
- **Riesgo residual F5**: `form >> role=…` distingue dentro/fuera del formulario, pero **no** entre dos
  formularios distintos con el mismo texto; en ese caso queda uno y el aviso de colisión lo dice. Para
  desambiguar de forma automática haría falta que el lector expusiera el selector del formulario, lo que
  cambia el contrato: fuera de alcance.
- **F1 conservador**: bloquea también «Cancelar»/«Resetear» genéricos (documentado arriba).
- E2E de aceptación sólo ejerce la variante desktop; `npm run test:vscode` (Extension Host real) sigue
  fuera de esta verificación (requiere VS Code + xvfb).
