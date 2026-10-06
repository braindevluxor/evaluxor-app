import { describe, expect, it } from 'vitest'
import {
  BLOQUES_PDF,
  TODOS_LOS_BLOQUES,
  imprimeBloque,
  imprimeCargos,
  imprimeModulo,
  imprimePortada,
  opcionesPorDefecto,
  resumenDeOpciones
} from './opciones'

const modulos = ['m1', 'm2', 'm3']

describe('opciones del informe', () => {
  it('sin opciones imprime el informe entero', () => {
    // `undefined` es lo que reciben las llamadas viejas (y las pruebas). Si
    // este test falla, significa que un informe sin selector dejó de salir
    // entero: sería el peor de los regresiones, porque nadie se dio cuenta.
    expect(imprimeModulo(undefined, 'm1')).toBe(true)
    for (const { id } of BLOQUES_PDF) expect(imprimeBloque(undefined, id)).toBe(true)
    expect(imprimeCargos(undefined)).toBe(true)
  })

  it('por omisión marca todos los módulos y todos los bloques', () => {
    const opciones = opcionesPorDefecto(modulos)
    expect(opciones.modulos).toEqual(modulos)
    expect(opciones.bloques).toEqual(TODOS_LOS_BLOQUES)
  })

  it('no muta la lista de módulos que le pasaron', () => {
    const original = [...modulos]
    const opciones = opcionesPorDefecto(modulos)
    opciones.modulos.push('m4')
    expect(modulos).toEqual(original)
  })

  it('imprime solo los módulos marcados', () => {
    const opciones = { ...opcionesPorDefecto(modulos), modulos: ['m2'] }
    expect(imprimeModulo(opciones, 'm1')).toBe(false)
    expect(imprimeModulo(opciones, 'm2')).toBe(true)
    expect(imprimeModulo(opciones, 'm3')).toBe(false)
  })

  it('una lista de módulos vacía no imprime ninguno', () => {
    const opciones = { ...opcionesPorDefecto(modulos), modulos: [] }
    for (const modulo of modulos) expect(imprimeModulo(opciones, modulo)).toBe(false)
  })

  it('la portada sale entera y en su propia hoja', () => {
    expect(imprimePortada(undefined, modulos)).toBe(true)
    expect(imprimePortada(opcionesPorDefecto(modulos), modulos)).toBe(true)
  })

  it('con un módulo menos ya no hay portada', () => {
    const parcial = { ...opcionesPorDefecto(modulos), modulos: ['m1', 'm2'] }
    expect(imprimePortada(parcial, modulos)).toBe(false)
    expect(imprimePortada({ ...opcionesPorDefecto(modulos), modulos: [] }, modulos)).toBe(false)
  })

  it('no confunde "todos" con "la misma cantidad"', () => {
    // Si el módulo 'm3' se dio de baja, el selector puede ofrecer un id que ya no
    // está en el detalle. Con el mismo número de entradas pero sin 'm3', el
    // informe no lleva portada.
    const conIdViejo = { ...opcionesPorDefecto(modulos), modulos: ['m1', 'm2', 'm-fantasma'] }
    expect(imprimePortada(conIdViejo, modulos)).toBe(false)
  })

  it('una evaluación sin módulos igual lleva portada', () => {
    // No hay nada que esté dejando afuera: la hoja es la que dice qué es.
    expect(imprimePortada(opcionesPorDefecto([]), [])).toBe(true)
  })

  it('los módulos que sí van no cuentan para decidir la portada', () => {
    // La portada depende solo de los módulos, no de los bloques: apagar la hoja
    // de compromiso no puede sacar la portada.
    const sinFinal = { modulos: ['m2'], bloques: { cargosSucursal: false, cargosCentral: false, incidencias: false, compromiso: false } }
    expect(imprimePortada(sinFinal, ['m1', 'm2'])).toBe(false)
    expect(imprimePortada({ ...sinFinal, modulos: ['m1', 'm2'] }, ['m1', 'm2'])).toBe(true)
  })

  it('apagar los dos bloques de cargos no imprime ninguno de los dos', () => {
    const opciones = {
      modulos: modulos,
      bloques: { cargosSucursal: false, cargosCentral: false, incidencias: true, compromiso: true }
    }
    expect(imprimeBloque(opciones, 'cargosSucursal')).toBe(false)
    expect(imprimeBloque(opciones, 'cargosCentral')).toBe(false)
    expect(imprimeCargos(opciones)).toBe(false)
  })

  it('con uno solo de los dos bloques de cargos sí hace falta el catálogo', () => {
    // El reparto entre sucursal y central necesita los dos catálogos: con el de
    // la sucursal se reconoce qué cargos son de la tienda. Apagar uno solo no
    // alcanza para saltear la consulta.
    for (const bloque of ['cargosSucursal', 'cargosCentral'] as const) {
      const opciones = {
        modulos,
        bloques: { ...TODOS_LOS_BLOQUES, [bloque]: false }
      }
      expect(imprimeCargos(opciones)).toBe(true)
    }
  })

  it('resume cuántas cosas van, para el pie del selector', () => {
    expect(resumenDeOpciones(opcionesPorDefecto(modulos), 3)).toBe('3 de 3 módulos · 4 de 4 bloques')
    const parcial = {
      modulos: ['m1'],
      bloques: { ...TODOS_LOS_BLOQUES, incidencias: false, compromiso: false }
    }
    expect(resumenDeOpciones(parcial, 3)).toBe('1 de 3 módulos · 2 de 4 bloques')
    expect(resumenDeOpciones(opcionesPorDefecto(['m1']), 1)).toBe('1 de 1 módulo · 4 de 4 bloques')
  })
})