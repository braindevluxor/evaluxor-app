import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Descripcion } from './Descripcion'

const pintar = (texto?: string | null) => renderToStaticMarkup(<Descripcion texto={texto} />)

describe('Descripción · formato', () => {
  it('la negrita sale como <strong> y más oscura que el resto', () => {
    const html = pintar('Todo **obligatorio** para enviar')
    expect(html).toContain('<strong class="font-semibold text-slate-700">obligatorio</strong>')
    expect(html).toContain('Todo ')
  })

  it('las viñetas salen como lista con sus ítems', () => {
    const html = pintar('- puertas\n- luces')
    expect(html).toContain('<ul')
    expect(html.match(/<li/g)?.length).toBe(2)
    expect(html).toContain('>puertas</li>')
    expect(html).toContain('>luces</li>')
  })

  it('la tabla sale con encabezado y filas', () => {
    const html = pintar('| Zona | Pts |\n| --- | --- |\n| Almacén | 5 |')
    expect(html).toContain('<table')
    expect(html).toContain('<th')
    expect(html).toContain('Almacén')
    expect(html).toContain('5')
  })

  it('el HTML pegado se pinta como texto, no se ejecuta', () => {
    const html = pintar('<script>alert(1)</script>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('sin descripción no pinta nada', () => {
    expect(pintar(undefined)).toBe('')
    expect(pintar('')).toBe('')
    expect(pintar('   ')).toBe('')
  })
})
