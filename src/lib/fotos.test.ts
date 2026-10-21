import { describe, expect, it, vi } from 'vitest'
import { COLORES_TRAZO, grosorEnImagen, pintarTrazos, puntoAImagen, type Trazo } from './fotos'

/**
 * El lienzo no existe en Node: se usa un contexto de mentira que sólo registra
 * lo que se le manda, que es justo lo que hay que probar del pintado.
 */
function ctxFalso() {
  return {
    lineCap: '',
    lineJoin: '',
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn()
  } as unknown as CanvasRenderingContext2D
}

describe('puntoAImagen', () => {
  const caja = { left: 100, top: 50, ancho: 400, alto: 300 }
  const imagen = { ancho: 800, alto: 600 }

  it('pasa del punto del dedo al píxel de la imagen', () => {
    expect(puntoAImagen({ x: 100, y: 50 }, caja, imagen)).toEqual({ x: 0, y: 0 })
    expect(puntoAImagen({ x: 300, y: 200 }, caja, imagen)).toEqual({ x: 400, y: 300 })
    expect(puntoAImagen({ x: 500, y: 350 }, caja, imagen)).toEqual({ x: 800, y: 600 })
  })

  it('lo que sale de la foto se recorta a sus bordes', () => {
    // Un dedo que arrastra fuera del cuadro no dibuja fuera de la imagen.
    expect(puntoAImagen({ x: -40, y: 900 }, caja, imagen)).toEqual({ x: 0, y: 600 })
    expect(puntoAImagen({ x: 9999, y: -9999 }, caja, imagen)).toEqual({ x: 800, y: 0 })
  })
})

describe('grosorEnImagen', () => {
  it('el trazo se ve del mismo grosor en pantalla pase lo que pase el zoom', () => {
    // La foto se ve a mitad de su tamaño: el píxel de la imagen debe ser doble.
    expect(grosorEnImagen({ ancho: 400, alto: 300 }, { ancho: 800, alto: 600 })).toBe(10)
    expect(grosorEnImagen({ ancho: 800, alto: 600 }, { ancho: 800, alto: 600 })).toBe(5)
    // Miniatura diminuta: no se baja de un píxel o la marca desaparece.
    expect(grosorEnImagen({ ancho: 4000, alto: 3000 }, { ancho: 800, alto: 600 })).toBe(1)
  })
})

describe('pintarTrazos', () => {
  it('pinta cada trazo con su color y grosor, con extremos redondeados', () => {
    const ctx = ctxFalso()
    pintarTrazos(ctx, [
      { color: '#ef4444', grosor: 10, puntos: [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 20 }] }
    ])
    expect(ctx.lineCap).toBe('round')
    expect(ctx.lineJoin).toBe('round')
    expect(ctx.strokeStyle).toBe('#ef4444')
    expect(ctx.lineWidth).toBe(10)
    expect(ctx.moveTo).toHaveBeenCalledWith(0, 0)
    expect(ctx.lineTo).toHaveBeenCalledTimes(2)
    expect(ctx.lineTo).toHaveBeenLastCalledWith(100, 20)
    expect(ctx.stroke).toHaveBeenCalledTimes(1)
  })

  it('un toque seco (un solo punto) deja marca: se pega como punto', () => {
    // Sin esto, apuntar al daño con un dedo no dejaría ninguna huella y el
    // usuario creería que el trazo no sirvió.
    const ctx = ctxFalso()
    pintarTrazos(ctx, [{ color: '#facc15', grosor: 8, puntos: [{ x: 30, y: 40 }] }])
    expect(ctx.arc).toHaveBeenCalledWith(30, 40, 4, 0, Math.PI * 2)
    expect(ctx.fill).toHaveBeenCalledTimes(1)
    expect(ctx.stroke).not.toHaveBeenCalled()
  })

  it('un trazo sin puntos no dibuja nada', () => {
    const ctx = ctxFalso()
    pintarTrazos(ctx, [{ color: '#ffffff', grosor: 5, puntos: [] }])
    expect(ctx.stroke).not.toHaveBeenCalled()
    expect(ctx.arc).not.toHaveBeenCalled()
  })

  it('respeta el orden: lo hecho antes queda debajo de lo hecho después', () => {
    const ctx = ctxFalso()
    const trazos: Trazo[] = [
      { color: '#ef4444', grosor: 6, puntos: [{ x: 0, y: 0 }, { x: 10, y: 10 }] },
      { color: '#facc15', grosor: 6, puntos: [{ x: 20, y: 20 }, { x: 30, y: 30 }] }
    ]
    pintarTrazos(ctx, trazos)
    expect(ctx.stroke).toHaveBeenCalledTimes(2)
    expect(ctx.strokeStyle).toBe('#facc15')
  })
})

describe('paleta de trazo', () => {
  it('está pensada para marcar daño: rojo, amarillo y blanco', () => {
    const ids = COLORES_TRAZO.map((c) => c.id)
    expect(ids).toEqual(['rojo', 'amarillo', 'blanco'])
    for (const c of COLORES_TRAZO) expect(c.hex).toMatch(/^#[0-9a-f]{6}$/i)
  })
})
