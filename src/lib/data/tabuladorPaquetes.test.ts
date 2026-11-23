import { describe, expect, it } from 'vitest'
import { paqueteDeCargo, type PaqueteCargo } from './tabuladorPaquetes'

/**
 * `paqueteDeCargo`: el cruce entre un cargo de BONOS y el Paquete
 * aprobado (USD) del tabulador.
 *
 * Es puro (sin red), así que se prueba de verdad: la normalización tiene
 * que ser la de `claveNormalizada` —la misma con la que Bonos cruza contra
 * la nómina—, las filas repetidas del mismo cargo devuelven el RANGO, y lo
 * que no está da `null` para que la celda pinte «—».
 */
const PAQUETES: PaqueteCargo[] = [
  { cargo: 'ASISTENTE DE GERENCIA', paquete: 995.64 },
  { cargo: 'AUXILIAR DE PRECIOS', paquete: 309.83 },
  { cargo: 'COORDINADOR DE LOGÍSTICA', paquete: 984.61 },
  // El mismo cargo en otra hoja/departamento, con otro número.
  { cargo: 'Auxiliar de precios', paquete: 315 }
]

describe('paqueteDeCargo — el cruce con la vista de Bonos', () => {
  it('cruza por nombre normalizado: acentos, mayúsculas y espacios da igual', () => {
    expect(paqueteDeCargo(PAQUETES, 'asistente de gerencia')).toEqual({ min: 995.64, max: 995.64 })
    expect(paqueteDeCargo(PAQUETES, 'ASISTENTE  DE GERENCIA')).toEqual({ min: 995.64, max: 995.64 })
    expect(paqueteDeCargo(PAQUETES, 'Coordinador de Logística')).toEqual({ min: 984.61, max: 984.61 })
  })

  it('con varias filas del mismo cargo devuelve el RANGO, no un número inventado', () => {
    expect(paqueteDeCargo(PAQUETES, 'AUXILIAR DE PRECIOS')).toEqual({ min: 309.83, max: 315 })
  })

  it('null cuando el cargo no está, el texto queda vacío o no hay datos', () => {
    expect(paqueteDeCargo(PAQUETES, 'GERENTE GENERAL')).toBeNull()
    expect(paqueteDeCargo(PAQUETES, '   ')).toBeNull()
    expect(paqueteDeCargo([], 'ASISTENTE DE GERENCIA')).toBeNull()
  })
})
