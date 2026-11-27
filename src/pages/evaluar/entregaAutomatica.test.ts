import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

/**
 * La evaluación se entrega SOLA: no hay botón «Enviar evaluación».
 *
 * Mientras se responde, el autoguardado ya va subiendo respuestas y fotos
 * (y además indexa las evidencias en la tabla `fotos`, que es lo que mira el
 * detalle). Al llegar al resumen sin ítems obligatorios pendientes, el cierre
 * —encolar el trabajo y borrar el borrador— ocurre solo.
 */
describe('evaluar · la entrega es automática', () => {
  const resumen = fuente('./EvaluarResumen.tsx')
  const sync = fuente('../../lib/offline/sync.ts')

  it('no queda ningún botón de enviar', () => {
    expect(resumen).not.toContain('Enviar evaluación')
    expect(resumen).not.toContain('Listo para enviar')
    // Sí queda la salida para seguir corrigiendo.
    expect(resumen).toContain('<ArrowLeft className="h-4 w-4" />')
  })

  it('cuando no falta nada, el resumen entrega solo, con una pausa para verse', () => {
    expect(resumen).toContain('if (detalles.incompletos > 0) return')
    expect(resumen).toContain('window.setTimeout(() => {')
    expect(resumen).toContain('void enviar()')
    // Una sola vez por visita al resumen.
    expect(resumen).toContain('const entregadoRef = useRef(false)')
    // El cierre sigue siendo el de siempre: cola local + borrador borrado.
    expect(resumen).toContain('await encolarRespuestas(draft)')
  })

  it('si falta algo obligatorio, no se entrega y se vuelve a editar', () => {
    expect(resumen).toContain('ítems obligatorios pendientes')
    expect(resumen).toContain('Volver a editar')
  })

  it('si el cierre local falla, avisa y deja reintentar', () => {
    expect(resumen).toContain('No se pudo registrar la entrega en este dispositivo')
    expect(resumen).toContain('entregadoRef.current = false')
    expect(resumen).toContain('Reintentar')
  })

  it('el texto explica lo que pasa de verdad, sin mentir sobre las fotos', () => {
    // El texto viejo decía «Las fotos de evidencia se sincronizan al enviar»,
    // pero el autoguardado las sube mientras se responde.
    expect(resumen).not.toContain('se sincronizan al enviar')
    expect(resumen).toContain('Tus respuestas y fotos se suben solas mientras respondes')
    expect(resumen).toContain('la evaluación se entrega sola')
  })

  it('el autoguardado también indexa las evidencias, que es lo que mira el detalle', () => {
    // Sin esto, la foto se veía en el teléfono pero no en el detalle hasta que
    // corría la cola del envío.
    expect(sync).toContain('async function indexarFotos(')
    expect(sync).toContain('await indexarFotos(evaluacionId, respuestas, fotos)')
    // Pide las ya registradas antes de insertar: el autoguardado es muy
    // repetido y reintentar las mismas filas sería puro ruido.
    expect(sync).toContain(".select('path')")
    expect(sync).toContain("if (error && error.code !== '23505') return")
  })
})
