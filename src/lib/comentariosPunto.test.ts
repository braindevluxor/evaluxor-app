import { describe, expect, it } from 'vitest'
import { escribirComentario, leerComentario, lineasDeComentario, textoDeComentarios } from './comentariosPunto'

const OPCIONES = [
  { id: 'o1', etiqueta: 'Góndola de panadería' },
  { id: 'o2', etiqueta: 'Góndola de bebidas' }
]

describe('comentariosPunto · leer y escribir', () => {
  it('guarda el comentario del punto', () => {
    expect(escribirComentario(undefined, 'o1', 'falta la góndola')).toEqual({ o1: 'falta la góndola' })
    expect(escribirComentario({ o2: 'ok' }, 'o1', 'falta la góndola')).toEqual({ o2: 'ok', o1: 'falta la góndola' })
  })

  it('borra el comentario cuando el texto queda en blanco', () => {
    // Un comentario vacío guardado es ruido: después sale en los informes como
    // si el evaluador hubiera anotado algo.
    expect(escribirComentario({ o1: 'nota', o2: 'otra' }, 'o1', '')).toEqual({ o2: 'otra' })
    expect(escribirComentario({ o1: 'nota' }, 'o1', '   ')).toEqual({})
  })

  it('no inventa una clave cuando no hay nada que borrar', () => {
    expect(escribirComentario(undefined, 'o1', '')).toEqual({})
    expect(escribirComentario({ o2: 'ok' }, 'o1', '  ')).toEqual({ o2: 'ok' })
  })

  it('guarda el texto tal cual, sin recortarle los espacios', () => {
    // El campo es editable: si se recortara mientras se escribe, no se podría
    // escribir "punto " con el espacio al final (el input volvería el texto).
    expect(escribirComentario(undefined, 'o1', 'punto ')).toEqual({ o1: 'punto ' })
  })

  it('lee el comentario del punto y vacío si no hay', () => {
    expect(leerComentario({ o1: 'nota' }, 'o1')).toBe('nota')
    expect(leerComentario({ o1: 'nota' }, 'o2')).toBe('')
    expect(leerComentario(undefined, 'o1')).toBe('')
  })
})

describe('comentariosPunto · las líneas que salen en los informes', () => {
  it('arman las líneas en el orden del checklist, no en el de escritura', () => {
    const comentarios = { o2: 'nota de bebidas', o1: 'nota de panadería' }
    expect(lineasDeComentario(comentarios, OPCIONES)).toEqual([
      { id: 'o1', punto: 'Góndola de panadería', texto: 'nota de panadería' },
      { id: 'o2', punto: 'Góndola de bebidas', texto: 'nota de bebidas' }
    ])
  })

  it('saltean los puntos sin comentario y los que están en blanco', () => {
    expect(lineasDeComentario({ o1: 'nota', o2: '   ' }, OPCIONES)).toEqual([
      { id: 'o1', punto: 'Góndola de panadería', texto: 'nota' }
    ])
  })

  it('saltean los puntos marcados «no aplica»', () => {
    // Un punto que no aplica no entra al puntaje y su comentario no es un
    // hallazgo: no sale en el informe.
    expect(lineasDeComentario({ o1: 'nota', o2: 'otra' }, OPCIONES, ['o1'])).toEqual([
      { id: 'o2', punto: 'Góndola de bebidas', texto: 'otra' }
    ])
  })

  it('saltean el comentario de un punto que ya no existe en el ítem', () => {
    // Si el Líder borró el check del ítem, su comentario no sale en ningún
    // informe: hablaría de un punto que ya no está.
    expect(lineasDeComentario({ o9: 'nota vieja' }, OPCIONES)).toEqual([])
  })

  it('arman la línea de texto con el nombre del punto', () => {
    const lineas = lineasDeComentario({ o1: 'falta', o2: 'ok' }, OPCIONES)
    expect(textoDeComentarios(lineas)).toBe('Góndola de panadería: falta · Góndola de bebidas: ok')
    expect(textoDeComentarios([])).toBe('')
  })
})
