import { describe, expect, it } from 'vitest'
import { crc32 } from 'node:zlib'
import { crearXlsx, type HojaExcel } from './xlsx'

interface Entrada {
  nombre: string
  crc: number
  metodo: number
  datos: Uint8Array
}

const decodificar = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)

/**
 * Lee el ZIP con la estructura del formato: se busca el fin del directorio
 * central desde el final, se recorre el directorio y de ahí a cada cabecera
 * local. Si el escritor cambia de formato, este lector se cae primero.
 */
function leerZip(bytes: Uint8Array): Entrada[] {
  const vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let fin = -1
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (vista.getUint32(i, true) === 0x06054b50) {
      fin = i
      break
    }
  }
  expect(fin, 'no encontré el fin del directorio central').toBeGreaterThanOrEqual(0)
  const total = vista.getUint16(fin + 10, true)
  const tamDirectorio = vista.getUint32(fin + 12, true)
  const offsetDirectorio = vista.getUint32(fin + 16, true)
  const entradas: Entrada[] = []
  let cursor = offsetDirectorio
  const finDirectorio = offsetDirectorio + tamDirectorio
  while (cursor < finDirectorio) {
    expect(vista.getUint32(cursor, true), 'registro central corrupto').toBe(0x02014b50)
    const metodo = vista.getUint16(cursor + 10, true)
    const crc = vista.getUint32(cursor + 16, true)
    const tam = vista.getUint32(cursor + 20, true)
    const largoNombre = vista.getUint16(cursor + 28, true)
    const largoExtra = vista.getUint16(cursor + 30, true)
    const largoComentario = vista.getUint16(cursor + 32, true)
    const offsetLocal = vista.getUint32(cursor + 42, true)
    const nombre = decodificar(bytes.subarray(cursor + 46, cursor + 46 + largoNombre))
    expect(vista.getUint32(offsetLocal, true), 'cabecera local corrupta').toBe(0x04034b50)
    const largoNombreLocal = vista.getUint16(offsetLocal + 26, true)
    const largoExtraLocal = vista.getUint16(offsetLocal + 28, true)
    const inicio = offsetLocal + 30 + largoNombreLocal + largoExtraLocal
    entradas.push({ nombre, crc, metodo, datos: bytes.subarray(inicio, inicio + tam) })
    cursor += 46 + largoNombre + largoExtra + largoComentario
  }
  expect(entradas).toHaveLength(total)
  return entradas
}

const hojas: HojaExcel[] = [
  {
    nombre: 'Resumen',
    filas: [
      ['Dato', 'Valor'],
      ['Sucursal', 'Mérida Centro'],
      ['Puntaje', 87.5],
      ['Vacío', null, null]
    ]
  },
  {
    nombre: 'Resultados',
    filas: [
      ['Estado', 'Nota %'],
      ['No cumple', 0],
      ['Cumple', 100],
      ['Raro <y & "más">', null]
    ]
  }
]

function hojaPorNombre(entradas: Entrada[], nombre: string): string {
  const entrada = entradas.find((e) => e.nombre === nombre)
  expect(entrada, `falta la pieza ${nombre}`).toBeTruthy()
  return decodificar(entrada!.datos)
}

describe('crearXlsx', () => {
  const entradas = leerZip(crearXlsx(hojas))

  it('empaqueta las piezas obligatorias con método STORE y CRC verificable', () => {
    expect(entradas.map((e) => e.nombre)).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'docProps/core.xml',
      'docProps/app.xml',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml'
    ])
    for (const entrada of entradas) {
      expect(entrada.metodo, `${entrada.nombre} debe ir sin comprimir`).toBe(0)
      // El CRC lo revisa el CRC de Node, no el mismo código que lo escribió.
      expect(crc32(entrada.datos) >>> 0, `CRC de ${entrada.nombre}`).toBe(entrada.crc >>> 0)
    }
  })

  it('declara cada pieza en [Content_Types].xml y la enlaza desde los .rels', () => {
    const tipos = hojaPorNombre(entradas, '[Content_Types].xml')
    expect(tipos).toContain('PartName="/xl/workbook.xml"')
    expect(tipos).toContain('PartName="/xl/worksheets/sheet1.xml"')
    expect(tipos).toContain('PartName="/xl/worksheets/sheet2.xml"')
    expect(tipos).toContain('PartName="/xl/styles.xml"')
    const raiz = hojaPorNombre(entradas, '_rels/.rels')
    expect(raiz).toContain('Target="xl/workbook.xml"')
    const rels = hojaPorNombre(entradas, 'xl/_rels/workbook.xml.rels')
    expect(rels).toContain('Target="worksheets/sheet1.xml"')
    expect(rels).toContain('Target="styles.xml"')
  })

  it('lista las pestañas en el orden dado', () => {
    const libro = hojaPorNombre(entradas, 'xl/workbook.xml')
    expect(libro).toContain('<sheet name="Resumen" sheetId="1" r:id="rId1"/>')
    expect(libro).toContain('<sheet name="Resultados" sheetId="2" r:id="rId2"/>')
  })

  it('escribe texto escapado, números como número y null como celda ausente', () => {
    const hoja1 = hojaPorNombre(entradas, 'xl/worksheets/sheet1.xml')
    expect(hoja1).toContain('t="inlineStr"')
    expect(hoja1).toContain('Mérida Centro')
    expect(hoja1).toContain('<v>87.5</v>')
    expect(hoja1).toContain('r="B3"')
    // Fila 4 = ['Vacío', null]: la celda B no existe, la fila sí.
    expect(hoja1).toContain('<row r="4">')
    expect(hoja1).not.toContain('r="B4"')
    const hoja2 = hojaPorNombre(entradas, 'xl/worksheets/sheet2.xml')
    expect(hoja2).toContain('Raro &lt;y &amp; &quot;más&quot;&gt;')
    expect(hoja2).not.toContain('Raro <y')
  })

  it('pon el encabezado en negrita, congela la fila 1 y filtra el rango usado', () => {
    const hoja1 = hojaPorNombre(entradas, 'xl/worksheets/sheet1.xml')
    expect(hoja1).toContain('r="A1" s="1"')
    expect(hoja1).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>')
    expect(hoja1).toContain('<autoFilter ref="A1:C4"/>')
    const hoja2 = hojaPorNombre(entradas, 'xl/worksheets/sheet2.xml')
    expect(hoja2).toContain('<autoFilter ref="A1:B4"/>')
  })

  it('acota los anchos de columna entre 8 y 60 caracteres', () => {
    const anchoLargo = leerZip(
      crearXlsx([
        { nombre: 'A', filas: [['Col'], ['x'.repeat(500)], ['corto']] }
      ])
    )
    expect(hojaPorNombre(anchoLargo, 'xl/worksheets/sheet1.xml')).toContain(
      '<col min="1" max="1" width="60" customWidth="1"/>'
    )
    const anchoCorto = leerZip(crearXlsx([{ nombre: 'A', filas: [['Col'], [1]] }]))
    expect(hojaPorNombre(anchoCorto, 'xl/worksheets/sheet1.xml')).toContain(
      '<col min="1" max="1" width="8" customWidth="1"/>'
    )
  })

  it('sanea nombres de pestaña y evita duplicados', () => {
    const libro = leerZip(
      crearXlsx([
        { nombre: 'Res[1]:umen*', filas: [['a']] },
        { nombre: 'Res[1]:umen*', filas: [['b']] },
        { nombre: 'x'.repeat(60), filas: [['c']] }
      ])
    )
    const wb = hojaPorNombre(libro, 'xl/workbook.xml')
    expect(wb).toContain('name="Res 1 umen"')
    expect(wb).toContain('name="Res 1 umen (2)"')
    expect(wb).toContain(`name="${'x'.repeat(31)}"`)
  })

  it('descarta números no finitos en vez de romper el XML', () => {
    const entradasRaras = leerZip(
      crearXlsx([{ nombre: 'A', filas: [['n'], [Number.NaN], [Number.POSITIVE_INFINITY]] }])
    )
    const hoja = hojaPorNombre(entradasRaras, 'xl/worksheets/sheet1.xml')
    expect(hoja).not.toContain('NaN')
    expect(hoja).not.toContain('Infinity')
    expect(hoja).toContain('<row r="2"></row>')
    expect(hoja).toContain('<row r="3"></row>')
  })

  it('con cero hojas produce un libro de una hoja vacía (un libro sin hojas no es válido)', () => {
    const vacio = leerZip(crearXlsx([]))
    expect(hojaPorNombre(vacio, 'xl/workbook.xml')).toContain('<sheet name="Hoja1"')
    expect(hojaPorNombre(vacio, 'xl/worksheets/sheet1.xml')).toContain('<sheetData></sheetData>')
  })
})
