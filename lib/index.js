/**
 * dsh-pdf-native — Host half.
 *
 * The prototype needs no Host services: the browser half only registers a
 * document-preview implementation and its keyed body. Keeping this entry a
 * no-op minimizes the chance that a bad prototype blocks app startup.
 */
export const name = 'dsh-pdf-native';
export const inject = [];

export function apply() {
  // Intentionally empty.
}
