/**
 * Instrumentación del fixture E2E.
 *
 * Cualquier submit de un formulario deja DOS rastros independientes:
 *   1. una línea en la consola del navegador (`[e2e-fixture] FORM_SUBMIT ...`);
 *   2. un POST a `/__form-submit`, que el servidor de pruebas cuenta y registra.
 *
 * El segundo rastro es el que permite afirmar desde fuera del navegador del
 * crawler que el descubrimiento NO envió el formulario (el crawler abre su
 * propio navegador y no expone su consola).
 */
(function () {
  'use strict';

  function marcarSubmit(form) {
    var id = form && form.id ? form.id : '(sin id)';
    var marca = '[e2e-fixture] FORM_SUBMIT ' + id + ' ' + new Date().toISOString();

    // Rastro 1: consola del navegador.
    console.log(marca);

    // Rastro 2: POST observable por el servidor de pruebas.
    try {
      fetch('/__form-submit', {
        method: 'POST',
        headers: { 'content-type': 'text/plain;charset=UTF-8' },
        body: marca
      }).catch(function () {
        /* El E2E no depende de que el fetch termine: el servidor ya lo cuenta. */
      });
    } catch (error) {
      console.log('[e2e-fixture] FORM_SUBMIT_BEACON_ERROR ' + String(error));
    }

    // El fixture no navega: así el E2E no sale de la app de prueba.
    return false;
  }

  document.addEventListener('submit', function (event) {
    event.preventDefault();
    marcarSubmit(event.target);
  }, true);

  // Botones del fixture: acción visible en consola, sin salir de la página.
  document.addEventListener('click', function (event) {
    var boton = event.target && event.target.closest ? event.target.closest('button') : null;
    if (!boton || boton.type === 'submit') {
      return;
    }
    console.log('[e2e-fixture] CLICK ' + (boton.id || boton.getAttribute('aria-label') || boton.textContent.trim()));
  });
})();
