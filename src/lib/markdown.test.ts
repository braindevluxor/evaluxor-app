import { describe, it, expect } from 'vitest'
import {
  aTextoPlano,
  conCelda,
  conColumnas,
  conFilas,
  conMarcadoresDeTabla,
  envolverNegrita,
  finDeLinea,
  inicioDeLinea,
  lineaEnValor,
  MAX_COLUMNAS_TABLA,
  MAX_FILAS_TABLA,
  numeroDeTabla,
  parsearMarkdown,
  plantillaTabla,
  prefijarViñetas,
  quitarTabla,
  reemplazarTabla,
  serializarTabla,
  sinMarcadoresDeTabla,
  tablasDe
} from './markdown'

describe('parsearMarkdown · negrita y cursiva', () => {
  it('parte la negrita y deja el resto como texto', () => {
    const [bloque] = parsearMarkdown('Los pasillos **libres de obstáculos** hoy')
    expect(bloque).toEqual({
      t: 'parrafo',
      hijos: [
        { t: 'texto', v: 'Los pasillos ' },
        { t: 'negrita', hijos: [{ t: 'texto', v: 'libres de obstáculos' }] },
        { t: 'texto', v: ' hoy' }
      ]
    })
  })

  it('la negrita gana sobre la cursiva de adentro', () => {
    const [bloque] = parsearMarkdown('**muy *importante* acá**')
    expect(bloque.t).toBe('parrafo')
    if (bloque.t !== 'parrafo') return
    const negrita = bloque.hijos[0]
    expect(negrita.t).toBe('negrita')
    if (negrita.t !== 'negrita') return
    expect(negrita.hijos).toContainEqual({ t: 'cursiva', hijos: [{ t: 'texto', v: 'importante' }] })
  })

  it('sin asteriscos queda un solo texto', () => {
    expect(parsearMarkdown('Texto simple')).toEqual([
      { t: 'parrafo', hijos: [{ t: 'texto', v: 'Texto simple' }] }
    ])
  })

  it('conserva el salto de línea escrito a mano dentro del párrafo', () => {
    expect(parsearMarkdown('primera\nsegunda')).toEqual([
      { t: 'parrafo', hijos: [{ t: 'texto', v: 'primera\nsegunda' }] }
    ])
  })
})

describe('parsearMarkdown · listas', () => {
  it('las viñetas seguidas son una sola lista', () => {
    const bloques = parsearMarkdown('- uno\n- dos\n- tres')
    expect(bloques).toEqual([
      {
        t: 'lista',
        ordenada: false,
        items: [[{ t: 'texto', v: 'uno' }], [{ t: 'texto', v: 'dos' }], [{ t: 'texto', v: 'tres' }]]
      }
    ])
  })

  it('distingue la lista numerada de la de viñetas', () => {
    const [lista] = parsearMarkdown('1. primero\n2. segundo')
    expect(lista).toEqual({
      t: 'lista',
      ordenada: true,
      items: [[{ t: 'texto', v: 'primero' }], [{ t: 'texto', v: 'segundo' }]]
    })
  })

  it('una viñeta con formato adentro se parsea como tal', () => {
    const [lista] = parsearMarkdown('- **obligatorio** para enviar')
    expect(lista.t).toBe('lista')
    if (lista.t !== 'lista') return
    expect(lista.items[0][0]).toEqual({ t: 'negrita', hijos: [{ t: 'texto', v: 'obligatorio' }] })
  })

  it('el párrafo y la lista no se pisan entre sí', () => {
    const bloques = parsearMarkdown('Intro\n- item')
    expect(bloques.map((b) => b.t)).toEqual(['parrafo', 'lista'])
  })
})

describe('parsearMarkdown · tablas', () => {
  const tabla = ['| Zona | Puntos |', '| --- | --- |', '| Almacén | 5 |', '| Caja | 3 |'].join('\n')

  it('lee encabezado, separador y filas', () => {
    const [bloque] = parsearMarkdown(tabla)
    expect(bloque).toEqual({
      t: 'tabla',
      cabecera: [[{ t: 'texto', v: 'Zona' }], [{ t: 'texto', v: 'Puntos' }]],
      filas: [
        [[{ t: 'texto', v: 'Almacén' }], [{ t: 'texto', v: '5' }]],
        [[{ t: 'texto', v: 'Caja' }], [{ t: 'texto', v: '3' }]]
      ]
    })
  })

  it('una tabla interrumpida por un párrafo deja de ser tabla', () => {
    const bloques = parsearMarkdown('| A | B |\n| --- | --- |\n| 1 | 2 |\n\nCierre')
    expect(bloques.map((b) => b.t)).toEqual(['tabla', 'parrafo'])
  })

  it('una fila de pipes sin separador es texto, no tabla', () => {
    const [bloque] = parsearMarkdown('| suelta |')
    expect(bloque.t).toBe('parrafo')
    if (bloque.t !== 'parrafo') return
    expect(bloque.hijos[0]).toEqual({ t: 'texto', v: '| suelta |' })
  })

  it('el texto pegado se queda como texto: nada de HTML', () => {
    const [bloque] = parsearMarkdown('<script>alert(1)</script>')
    expect(bloque).toEqual({ t: 'parrafo', hijos: [{ t: 'texto', v: '<script>alert(1)</script>' }] })
  })
})

describe('aTextoPlano', () => {
  it('saca el formato para las vistas donde no cabe (fila de Config, title)', () => {
    const md = ['**Revisar** al cerrar:', '- puertas', '- luces', '| Zona | Pts |', '| --- | --- |', '| A | 5 |'].join('\n')
    expect(aTextoPlano(md)).toBe('Revisar al cerrar: · • puertas · luces · Zona / Pts · A / 5')
  })

  it('sin formato devuelve el texto tal cual', () => {
    expect(aTextoPlano('  Texto simple  ')).toBe('Texto simple')
  })
})

describe('caja de texto · la tabla se oculta tras un marcador', () => {
  const tabla = serializarTabla({ cabecera: ['A', 'B'], filas: [['1', '2']] })
  const md = ['Intro', '', ...tabla, '', 'Fin'].join('\n')
  const modelos = () => tablasDe(md).map((t) => t.modelo)

  it('en la caja la tabla es una línea [[Tabla N]], sin pipes', () => {
    expect(conMarcadoresDeTabla(md)).toBe('Intro\n\n[[Tabla 1]]\n\nFin')
    expect(conMarcadoresDeTabla(md)).not.toContain('|')
  })

  it('ida y vuelta: la caja devuelve el texto real con la tabla', () => {
    expect(sinMarcadoresDeTabla(conMarcadoresDeTabla(md), modelos())).toBe(md)
  })

  it('sin tablas, la caja es idéntica al texto', () => {
    expect(conMarcadoresDeTabla('Hola\nmundo')).toBe('Hola\nmundo')
    expect(sinMarcadoresDeTabla('Hola\nmundo', [])).toBe('Hola\nmundo')
  })

  it('el marcador huérfano queda como texto (no inventa tabla)', () => {
    expect(sinMarcadoresDeTabla('X\n[[Tabla 7]]', [])).toBe('X\n[[Tabla 7]]')
    expect(numeroDeTabla('[[Tabla 7]]')).toBe(7)
    expect(numeroDeTabla('[[Tabla 7]] a secas')).toBeNull()
  })

  it('si el usuario escribe un marcador a mano, entra la tabla', () => {
    expect(sinMarcadoresDeTabla('A\n[[Tabla 1]]', modelos())).toBe(`A\n${tabla.join('\n')}`)
  })

  it('lineaEnValor traduce la línea de la caja a la del texto real', () => {
    // Caja: 0 Intro · 1 vacío · 2 [[Tabla 1]] · 3 vacío · 4 Fin
    // Real: 0 Intro · 1 vacío · 2-4 tabla · 5 vacío · 6 Fin
    expect(lineaEnValor(md, 0)).toBe(0)
    expect(lineaEnValor(md, 2)).toBe(2)
    expect(lineaEnValor(md, 3)).toBe(5)
    expect(lineaEnValor(md, 4)).toBe(6)
  })

  it('inicioDeLinea y finDeLinea ubican los bordes de cada línea', () => {
    const texto = 'ab\ncd'
    expect(inicioDeLinea(texto, 0)).toBe(0)
    expect(inicioDeLinea(texto, 1)).toBe(3)
    expect(finDeLinea(texto, 0)).toBe(2)
    expect(finDeLinea(texto, 1)).toBe(5)
    expect(finDeLinea(texto, 9)).toBe(texto.length)
  })
})

describe('botón Negrita', () => {
  it('envuelve lo seleccionado y deja el cursor dentro', () => {
    const r = envolverNegrita('abc def', 0, 3)
    expect(r).toEqual({ texto: '**abc** def', inicio: 2, fin: 5 })
  })

  it('sin selección abre y cierra los marcadores con el cursor en el medio', () => {
    const r = envolverNegrita('abc', 3, 3)
    expect(r).toEqual({ texto: 'abc****', inicio: 5, fin: 5 })
  })

  it('una selección que cruza una tabla envuelve el texto y deja el marcador', () => {
    const texto = 'A\n[[Tabla 1]]\nB'
    const r = envolverNegrita(texto, 0, texto.length)
    expect(r.texto).toBe('**A**\n[[Tabla 1]]\n**B**')
    expect(r.texto).toContain('[[Tabla 1]]')
  })

  it('sin selección sobre el marcador no hace nada (no lo rompe)', () => {
    const texto = 'A\n[[Tabla 1]]'
    const pos = texto.indexOf('[[')
    expect(envolverNegrita(texto, pos, pos)).toEqual({ texto, inicio: pos, fin: pos })
  })
})

describe('botón Viñeta', () => {
  it('prefija cada línea seleccionada', () => {
    const r = prefijarViñetas('uno\ndos', 0, 7)
    expect(r.texto).toBe('- uno\n- dos')
    expect(r.inicio).toBe(0)
    expect(r.fin).toBe(r.texto.length)
  })

  it('no duplica el marcador si la línea ya es viñeta', () => {
    expect(prefijarViñetas('- uno', 0, 5).texto).toBe('- uno')
  })

  it('sin selección sobre una línea vacía inserta el marcador en el cursor', () => {
    const r = prefijarViñetas('', 0, 0)
    expect(r).toEqual({ texto: '- ', inicio: 2, fin: 2 })
  })

  it('no viñetea la línea del marcador (se llevaría la tabla)', () => {
    const texto = 'A\n[[Tabla 1]]\nB'
    expect(prefijarViñetas(texto, 0, texto.length).texto).toBe('- A\n[[Tabla 1]]\n- B')
  })

  it('sólo toca las líneas que toca la selección', () => {
    const texto = 'uno\ndos\ntres'
    // Selección sólo sobre la segunda línea.
    expect(prefijarViñetas(texto, 4, 7).texto).toBe('uno\n- dos\ntres')
  })
})

describe('botón Tabla', () => {
  const grilla3x2 = [
    '| Columna 1 | Columna 2 | Columna 3 |',
    '| --- | --- | --- |',
    '|  |  |  |',
    '|  |  |  |'
  ].join('\n')

  it('planta una grilla de 3 columnas y 2 filas con el cursor en la primera celda', () => {
    const r = plantillaTabla('', 0, 0)
    expect(r.texto).toBe(grilla3x2)
    expect(r.texto.slice(r.inicio, r.fin)).toBe('Columna 1')
    expect(r.linea).toBe(0)
  })

  it('si el cursor está en medio de una línea, la tabla entra en renglón aparte', () => {
    const r = plantillaTabla('intro', 5, 5)
    expect(r.texto).toBe(`intro\n\n${grilla3x2}`)
    expect(r.texto.slice(r.inicio, r.fin)).toBe('Columna 1')
    expect(r.linea).toBe(2)
  })

  it('deja línea en blanco alrededor para que no se pegue al bloque de arriba', () => {
    const tablaVieja = ['| a | b |', '| --- | --- |', '| 1 | 2 |'].join('\n')
    const r = plantillaTabla(tablaVieja, tablaVieja.length, tablaVieja.length)
    expect(r.texto.startsWith(`${tablaVieja}\n\n`)).toBe(true)
    // Dos tablas seguidas sin blanco se leerían como una sola: acá hay dos.
    expect(tablasDe(r.texto)).toHaveLength(2)
  })
})

describe('grilla de tablas · del modelo al texto y vuelta', () => {
  const md = ['| Zona | Pts |', '| --- | --- |', '| Almacén | 5 |'].join('\n')

  it('tablasDe devuelve el rango de líneas y las celdas crudas', () => {
    expect(tablasDe(md)).toEqual([
      {
        desde: 0,
        hasta: 2,
        modelo: {
          cabecera: ['Zona', 'Pts'],
          filas: [['Almacén', '5']]
        }
      }
    ])
    expect(tablasDe('sin tablas\nacá')).toEqual([])
  })

  it('reemplazarTabla reescribe sólo ese bloque', () => {
    const texto = `Antes\n\n${md}\n\nDespués`
    const tabla = tablasDe(texto)[0]
    const ampliada = reemplazarTabla(texto, tabla.desde, tabla.hasta, conFilas(tabla.modelo, 2))
    expect(ampliada).toBe(
      ['Antes', '', '| Zona | Pts |', '| --- | --- |', '| Almacén | 5 |', '|  |  |', '', 'Después'].join('\n')
    )
  })

  it('quitarTabla se lleva el bloque entero', () => {
    const texto = `Antes\n\n${md}\n\nDespués`
    expect(quitarTabla(texto, 2, 4)).toBe('Antes\n\n\nDespués')
  })

  it('serializa y vuelve a leer igual (ida y vuelta estable)', () => {
    const modelo = { cabecera: ['A', 'B'], filas: [['1', '2'], ['3', '4']] }
    const salida = serializarTabla(modelo).join('\n')
    expect(tablasDe(salida)[0].modelo).toEqual(modelo)
  })

  it('una celda con pipe no rompe el renglón', () => {
    const salida = serializarTabla({ cabecera: ['A | B'], filas: [] }).join('\n')
    expect(salida).toBe('| A B |\n| --- |')
    expect(tablasDe(salida)[0].modelo.cabecera).toEqual(['A B'])
  })

  it('conCelda cambia una celda sin tocar las demás (fila 0 = encabezado)', () => {
    const m = { cabecera: ['A', 'B'], filas: [['1', '2']] }
    expect(conCelda(m, 0, 1, 'Zona')).toEqual({ cabecera: ['A', 'Zona'], filas: [['1', '2']] })
    expect(conCelda(m, 1, 0, '9')).toEqual({ cabecera: ['A', 'B'], filas: [['9', '2']] })
    // Índices fuera de rango se ignoran.
    expect(conCelda(m, 5, 0, 'x')).toBe(m)
  })

  it('conFilas y conColumnas crecen y encogen con tope', () => {
    const m = { cabecera: ['A', 'B'], filas: [['1', '2']] }
    expect(conFilas(m, 3).filas).toEqual([['1', '2'], ['', ''], ['', '']])
    expect(conFilas(m, 0).filas).toHaveLength(1)
    expect(conColumnas(m, 3).cabecera).toEqual(['A', 'B', 'Columna 3'])
    expect(conColumnas(m, 3).filas[0]).toEqual(['1', '2', ''])
    expect(conColumnas(m, 1).cabecera).toEqual(['A'])
    expect(conColumnas(conFilas(m, 5), 4).filas).toHaveLength(5)
  })

  it('el tope de filas es generoso: se puede pasar de 12', () => {
    const m = { cabecera: ['A'], filas: [['1']] }
    expect(conFilas(m, 40).filas).toHaveLength(40)
    expect(conFilas(m, 5000).filas).toHaveLength(MAX_FILAS_TABLA)
    expect(conColumnas(m, 50).cabecera).toHaveLength(MAX_COLUMNAS_TABLA)
  })
})
