import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function fuente(): string {
  return readFileSync(fileURLToPath(new URL('./ItemRenderer.tsx', import.meta.url)), 'utf8')
}

/**
 * Borrar un producto escaneado no se borraba: en producción el servidor no
 * reemplaza el valor de la conciliación, lo FUSIONA con el que ya está en la
 * nube por SKU (`mergear_conciliacion`), así que una lista sin el producto no
 * lo borra —lo trae de vuelta desde el valor anterior, en esa misma escritura.
 *
 * Lo que se manda es la marca, y esta es la mitad del arreglo: la otra vive en
 * `supabase/conciliacion-borrar-productos.sql`, que es la que decide qué se hace
 * con esa marca. Las dos tienen que ir juntas; una sin la otra no hace nada.
 */
describe('borrar un producto de la conciliación', () => {
  it('el SKU borrado viaja con su marca', () => {
    const codigo = fuente()
    const i = codigo.indexOf('const eliminar = () => setAEliminar')
    expect(i, 'no encontré el borrado').toBeGreaterThan(-1)
    const confirmacion = codigo.slice(codigo.indexOf('onConfirm', i))
    expect(confirmacion.slice(0, 600)).toContain('aEliminar.producto.sku')
    // Sin el segundo argumento, `actualizar` no sabe qué salió: sólo ve la lista
    // que queda, que ya no trae al producto.
    expect(confirmacion.slice(0, 600)).toContain('actualizar(')
  })

  it('escribe borrados y reabrir en el valor', () => {
    const codigo = fuente()
    expect(codigo).toContain('borrados: borrados.length ? borrados : null')
    expect(codigo).toContain('reabrir: reabrir.length ? reabrir : null')
  })

  it('levanta la marca de un SKU que vuelve a la lista', () => {
    // Es lo que distingue "lo re-escaneé" de "este equipo no se enteró del
    // borrado": los dos suben el mismo SKU.
    const codigo = fuente()
    expect(codigo).toContain('const enLista = new Set(items.map((p) => p.sku))')
    expect(codigo).toContain('const reabrir = [...previas].filter((sku) => enLista.has(sku))')
    expect(codigo).toContain('const borrados = [...previas].filter((sku) => !enLista.has(sku))')
  })

  it('las marcas no se pierden al editar una cantidad o una foto', () => {
    // `actualizarProducto` escribe por la misma puerta, así que lo que ya estaba
    // marcado sigue marcado. Las marcas se leen del `base = prev ?? v`, es decir
    // del draft vivo que entrega `cambiarValor`, no del `v` del render: así un
    // `actualizar` posterior no repone las marcas viejas ni tira los
    // responsables que se eligieron en el mismo ítem.
    const codigo = fuente()
    const fn = codigo.slice(codigo.indexOf('const actualizar = (items'))
    expect(fn.slice(0, 900)).toContain('const base = (prev ?? v) as ValorConciliacion')
    expect(fn.slice(0, 900)).toContain('const previas = new Set(base.borrados ?? [])')
    expect(codigo).toContain('actualizar(productos.map((p, idx) => (idx === i ? { ...p, ...patch } : p)))')
  })
})
