import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import readXlsxFile from 'read-excel-file/browser'
import { filasDesdeMatriz } from './menuSucursal'

/**
 * La PLANTILLA que se baja desde el editor (`public/plantilla-menu.xlsx`).
 *
 * Su hoja «Carta» tiene que traer EXACTAMENTE los encabezados que después
 * reconoce `filasDesdeMatriz`: si cambia uno de los dos sin el otro, el que
 * llene la plantilla estaría subiendo un archivo que la app no entiende y
 * caería al orden fijo A, B, C, que no es el suyo. Se lee el archivo REAL
 * de public/ con la MISMA librería que usa la app.
 */
describe('la plantilla del menú', () => {
  it('sus encabezados son los que el importador reconoce', async () => {
    const ruta = fileURLToPath(new URL('../../../public/plantilla-menu.xlsx', import.meta.url))
    const buf = readFileSync(ruta)
    const hojas = await readXlsxFile(new Blob([buf]))

    // La hoja que se llena es la que trae encabezado de ID; la otra es el
    // instructivo que trae el archivo.
    expect(hojas.map((h) => h.sheet)).toEqual(['Carta', 'Instrucciones'])
    const carta = hojas.find((h) => h.sheet === 'Carta')
    expect(carta?.data).toHaveLength(1)

    // Con una fila de datos debajo, los tres encabezados se reconocen.
    const filas = filasDesdeMatriz([
      carta?.data[0] ?? [],
      ['7790001', 'Recién horneado', 'MN']
    ])
    expect(filas).toEqual([{ id: '7790001', comentario: 'Recién horneado', configuracion: 'MN' }])
  })
})
