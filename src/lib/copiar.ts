/**
 * Copiar texto al portapapeles, con respaldo.
 *
 * `navigator.clipboard` solo existe en contextos seguros y con permiso del
 * usuario. Una PWA servida por HTTP (o un WebView viejo) no lo tiene, y ahí lo
 * único que funciona es el atajo clásico con `execCommand('copy')`. Por eso el
 * orden importa: primero lo moderno, y el atajo solo como red de seguridad.
 *
 * Devuelve si se copió de verdad, para que quien lo llame pueda avisar en vez
 * de asumirlo.
 */
export async function copiarAlPortapapeles(texto: string): Promise<boolean> {
  if (!texto) return false

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(texto)
      return true
    } catch {
      // Permiso negado o contexto inseguro: pasa al respaldo.
    }
  }

  return copiaConAtajo(texto)
}

/**
 * El atajo viejo. Se monta un `textarea` fuera de pantalla, se selecciona todo
 * y se dispara `copy`; el `readonly` evita que en móvil se abra el teclado al
 * hacerle `focus()`.
 */
function copiaConAtajo(texto: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false

  const caja = document.createElement('textarea')
  caja.value = texto
  caja.setAttribute('readonly', '')
  caja.style.position = 'fixed'
  caja.style.top = '0'
  caja.style.left = '0'
  caja.style.opacity = '0'
  document.body.appendChild(caja)

  const focoPrevio = document.activeElement
  caja.focus()
  caja.select()
  try {
    caja.setSelectionRange(0, texto.length)
  } catch {
    // Algunos navegadores no lo permiten en inputs numéricos: `select()` basta.
  }

  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }

  document.body.removeChild(caja)
  if (focoPrevio instanceof HTMLElement) focoPrevio.focus()
  return ok
}
