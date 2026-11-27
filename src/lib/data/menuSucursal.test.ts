import { describe, expect, it, vi } from 'vitest'
import readXlsxFile from 'read-excel-file/browser'
import { filasDesdeMatriz, leerFilasMenuExcel, turnosDe, turnosDeCelda } from './menuSucursal'

// La librería del .xlsx se mockea: lo que se prueba acá es LO NUESTRO —
// qué hoja se elige, de qué celda sale cada cosa y cómo se leen las
// letras—, no el parser de un archivo binario.
vi.mock('read-excel-file/browser', () => ({ default: vi.fn() }))

/**
 * La importación de la carta desde Excel, sin archivo y sin red: lo que se
 * decide ACÁ es lo que después ejecuta `importarMenuExcel`.
 */
describe('menú · las letras de configuración', () => {
  it('lee las letras sueltas, las palabras y también "todo el día"', () => {
    expect(turnosDeCelda('MTN')).toBe('MTN')
    expect(turnosDeCelda('M, N')).toBe('MN')
    expect(turnosDeCelda('tn')).toBe('TN')
    // La PALABRA manda: «Mañana» no se convierte en M+N por la N de adentro.
    expect(turnosDeCelda('Mañana')).toBe('M')
    expect(turnosDeCelda('Noche')).toBe('N')
    expect(turnosDeCelda('Tarde y noche')).toBe('TN')
    // "Todo el día" es las tres, y una celda vacía también.
    expect(turnosDeCelda('Todo el día')).toBe('MTN')
    expect(turnosDeCelda('')).toBe('MTN')
  })

  it('la cadena siempre sale canónica: orden M, T, N y sin repetir', () => {
    expect(turnosDe(['N', 'M'])).toBe('MN')
    expect(turnosDe(['T', 'T', 'N'])).toBe('TN')
    // Sin letras no se guarda: el producto no aparecería en ninguna parte.
    expect(() => turnosDe([])).toThrow(/al menos un turno/)
  })
})

describe('menú · las columnas del archivo', () => {
  it('lee los encabezados con o sin acentos, en el orden que estén', () => {
    const filas = filasDesdeMatriz([
      ['Configuración (MTN)', 'ID del producto', 'COMENTARIOS'],
      ['MN', '7790001', 'Recién horneado']
    ])
    expect(filas).toEqual([{ id: '7790001', comentario: 'Recién horneado', configuracion: 'MN' }])
  })

  it('«NOMBRE DEL PRODUCTO» no se roba la columna del ID', () => {
    const filas = filasDesdeMatriz([
      ['NOMBRE DEL PRODUCTO', 'ID', 'Comentario'],
      ['Pan', '7790001', 'bueno']
    ])
    // El ID es el ancla y va en la columna que dice «ID»; sin columna de
    // configuración, el producto queda para todo el día.
    expect(filas).toEqual([{ id: '7790001', comentario: 'bueno', configuracion: '' }])
  })

  it('sin encabezados asume A, B, C y la primera fila ya es producto', () => {
    const filas = filasDesdeMatriz([
      ['7790001', 'bueno', 'TN'],
      ['7790002', '', 'M']
    ])
    expect(filas).toHaveLength(2)
    expect(filas[0]).toEqual({ id: '7790001', comentario: 'bueno', configuracion: 'TN' })
    expect(filas[1]).toEqual({ id: '7790002', comentario: '', configuracion: 'M' })
  })

  it('tira las filas en blanco y deja las que vienen sin ID', () => {
    const filas = filasDesdeMatriz([
      ['ID del producto', 'Comentario', 'Configuración'],
      ['7790001', 'ok', 'M'],
      [null, null, null],
      ['', 'comentario huérfano', 'N']
    ])
    // La de en medio es ruido de Excel —un archivo real trae miles de
    // columnas y filas vacías—; la última se queda para que
    // `importarMenuExcel` la cuente como "sin ID" y la informe.
    expect(filas).toHaveLength(2)
    expect(filas[1].id).toBe('')
    expect(filas[1].comentario).toBe('comentario huérfano')
  })

  it('una hoja vacía se explica en vez de importar nada', () => {
    expect(() => filasDesdeMatriz([])).toThrow(/vacío/)
  })
})

describe('menú · leer el archivo', () => {
  it('elige la hoja que trae encabezado de ID, no sólo la primera', async () => {
    vi.mocked(readXlsxFile).mockResolvedValue([
      { sheet: 'Instrucciones', data: [['paso 1', 'abrir el archivo']] },
      {
        sheet: 'Carta',
        data: [
          ['ID del producto', 'COMENTARIOS', 'Configuración (MTN)'],
          ['7790001', 'Recién horneado', 'MN']
        ]
      }
    ])
    const filas = await leerFilasMenuExcel(new File(['x'], 'carta.xlsx'))
    expect(filas).toEqual([{ id: '7790001', comentario: 'Recién horneado', configuracion: 'MN' }])
  })

  it('un archivo que no es Excel se explica antes de tocar el menú', async () => {
    vi.mocked(readXlsxFile).mockRejectedValueOnce(new Error('bad zip'))
    await expect(leerFilasMenuExcel(new File(['no'], 'nota.txt'))).rejects.toThrow(/Excel/)
  })
})
