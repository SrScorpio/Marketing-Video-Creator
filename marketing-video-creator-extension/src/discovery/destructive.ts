/**
 * Heurística ÚNICA de acción sensible del descubrimiento (SSS-282).
 *
 * Vive en su propio módulo para que el crawler y el convertidor a fases
 * consuman EXACTAMENTE el mismo patrón (una sola fuente de verdad): si un
 * texto se considera sensible aquí, el borrador nunca lo propondrá como clic.
 *
 * Se es deliberadamente CONSERVADOR: un falso positivo sólo evita un clic en la
 * demo (se añade a mano si interesa); un falso negativo puede pulsar «Cancelar
 * cuenta» o «Cerrar sesión» en la app real del usuario.
 *
 * Cubre:
 *   - pago/compra/suscripción: pagar, comprar, pay, checkout, suscrib…, subscri…
 *   - destrucción de datos: borrar, eliminar, delete
 *   - baja de cuenta/recurso: cancelar, anular, desactivar, dar de baja, archivar
 *   - sesión/estado: cerrar sesión, logout, salir
 *   - reinicio destructivo: reset…, restablec…
 */
export const DESTRUCTIVE_PATTERN =
  /(pagar|comprar|borrar|eliminar|delete|pay|checkout|subscri\w*|suscrib\w*|suscrip\w*|cancel\w*|anul\w*|desactiv\w*|cerrar\s+sesi[oó]n|log\s?-?\s?out|\bsalir\b|reset\w*|restablec\w*|\barchivar\b|\bbaja\b)/i;

/** ¿El texto visible de un control es una acción sensible? */
export function isDestructiveAction(text: string): boolean {
  return DESTRUCTIVE_PATTERN.test(String(text ?? ''));
}
