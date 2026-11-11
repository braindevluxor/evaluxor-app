import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SelectorPdf } from './SelectorPdf'
import type { OpcionesPdf } from '../lib/pdf/opciones'

const modulos = [
  { id: 'm1', nombre: 'Higiene y salubridad' },
  { id: 'm2', nombre: 'Cumplimiento normativo' }
]

const noop = () => undefined

function html(abierto: boolean, props: Partial<{ modulos: typeof modulos; cargandoModulos: boolean; descargando: boolean }> = {}): string {
  return renderToStaticMarkup(
    <SelectorPdf
      abierto={abierto}
      onClose={noop}
      modulos={props.modulos ?? modulos}
      cargandoModulos={props.cargandoModulos}
      onConfirmar={noop as (opciones: OpcionesPdf) => void}
      descargando={props.descargando}
    />
  )
}

/** Los `checked` del HTML, en orden: uno por casilla. */
const marcadas = (markup: string): string[] =>
  [...markup.matchAll(/<input[^>]*type="checkbox"[^>]*checked=""/g)].map((m) => m[0])

describe('selector de qué va al PDF', () => {
  it('no pinta nada mientras está cerrado', () => {
    expect(html(false)).toBe('')
  })

  it('arranca con todo marcado: el informe entero es el que se venía mandando', () => {
    const markup = html(true)
    // 2 módulos + 4 bloques. Que el default sea "todo" importa más de lo que
    // parece: si arrancara en cero, el botón de descargar ya no haría lo de
    // siempre sin que nadie lo pidiera.
    expect(marcadas(markup)).toHaveLength(6)
    expect(markup).toContain('2 de 2 módulos · 4 de 4 bloques')
  })

  it('ofrece los módulos y los cuatro bloques que pidió poder elegir', () => {
    const markup = html(true)
    for (const modulo of modulos) expect(markup).toContain(modulo.nombre)
    for (const etiqueta of ['Cargos de la sucursal', 'Cargos de central', 'Incidencias registradas', 'Hoja de compromiso']) {
      expect(markup).toContain(etiqueta)
    }
  })

  it('aclara que los puntajes no cambian', () => {
    // Sin esta línea, alguien desmarca un módulo y entiende que el porcentaje
    // impreso se recalcula, que es justo lo que no pasa.
    expect(html(true)).toContain('Los puntajes no cambian')
  })

  it('avisa que está buscando los módulos y no deja descargar en el vacío', () => {
    const markup = html(true, { modulos: [], cargandoModulos: true })
    expect(markup).toContain('Buscando los módulos…')
    expect(marcadas(markup)).toHaveLength(4)
  })

  it('una evaluación sin módulos lo dice en vez de mostrar una lista vacía', () => {
    expect(html(true, { modulos: [] })).toContain('Esta evaluación no tiene módulos con respuestas')
  })

  it('mientras genera no se le puede volver a pedir', () => {
    const markup = html(true, { descargando: true })
    expect(markup).toContain('Generando…')
    expect(markup).toContain('disabled=""')
  })
})