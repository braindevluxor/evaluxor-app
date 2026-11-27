import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

/**
 * «Deshacer precarga»: limpiar desde la evaluación lo que se trajo de la
 * visita anterior, porque el inventario cambió.
 *
 * Lo que sólo salta al usar la pantalla entera —montarla exige router,
 * offline, Supabase y el catálogo— y que igual se rompe con una línea: que el
 * botón exista mientras haya algo traído, que confirme antes de borrar, y
 * sobre todo que limpie la NUBE y no sólo el borrador. Lo precargado se sube
 * apenas se abre la evaluación (`agendarNube`), así que si sólo se borrara
 * acá volvería en la próxima sincronización y el botón parecería no servir.
 */
describe('deshacer precarga · la pantalla de evaluación', () => {
  const pagina = fuente('./EvaluarSucursal.tsx')

  it('el aviso y el botón quedan mientras haya algo traído', () => {
    expect(pagina).toContain('const [precargado, setPrecargado]')
    expect(pagina).toContain('async function deshacerPrecarga')
    expect(pagina).toContain('Deshacer precarga')
    expect(pagina).toContain('setConfirmarPrecarga(true)')
    // No vive sólo en el toast, que se va en segundos: la decisión puede ser
    // después de haber trabajado un rato.
    expect(pagina).toContain('setPrecargado({')
  })

  it('pide confirmación, porque la limpieza no se puede deshacer', () => {
    expect(pagina).toContain('open={confirmarPrecarga}')
    expect(pagina).toContain('Esta acción no se puede deshacer')
  })

  it('limpia la NUBE y no sólo el borrador', () => {
    // Los registros se borran de `instancias_grupo` y el `on delete cascade`
    // se lleva sus respuestas…
    expect(pagina).toContain("from('instancias_grupo').delete()")
    // …y las respuestas directas, que no tienen cascada, se borran solas.
    expect(pagina).toContain(".from('respuestas')")
    expect(pagina).toContain(".is('instancia_id', null)")
  })

  it('sin conexión no se purga a medias', () => {
    // Borrar sólo en el equipo dejaría la nube intacta y a la próxima
    // sincronización volvería todo: se avisa y se deja para después.
    expect(pagina).toContain('Sin conexión no se puede deshacer')
  })
})
