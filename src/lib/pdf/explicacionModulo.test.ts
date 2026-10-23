import { describe, expect, it } from 'vitest'
import type { Item } from '../types'
import { resumenPesosModulo, textoPeso } from './explicacionModulo'

const baseItem = (parcial: Partial<Item>): Item => ({
  id: 'i1',
  modulo_id: 'm1',
  tipo: 'CUMPLE_NO_CUMPLE',
  texto: 'Item',
  opciones: null,
  orden: 1,
  requerido: true,
  activo: true,
  created_at: '2026-01-01T00:00:00Z',
  ...parcial
})

describe('explicacionModulo - pesos y jerarquías', () => {
  it('resumenPesosModulo cuando 4 secciones suman 400 pts', () => {
    const items: Item[] = [
      baseItem({ id: 'sec1', tipo: 'CONTENEDOR', texto: 'Sección 1', puntaje: 100, orden: 1 }),
      baseItem({ id: 'sec2', tipo: 'CONTENEDOR', texto: 'Sección 2', puntaje: 100, orden: 2 }),
      baseItem({ id: 'sec3', tipo: 'CONTENEDOR', texto: 'Sección 3', puntaje: 100, orden: 3 }),
      baseItem({ id: 'sec4', tipo: 'CONTENEDOR', texto: 'Sección 4', puntaje: 100, orden: 4 }),
      // Hijos dentro de las secciones
      baseItem({ id: 'h1', padre_id: 'sec1', tipo: 'CUMPLE_NO_CUMPLE', texto: 'Hijo 1', puntaje: 25, orden: 1 })
    ]

    const resumen = resumenPesosModulo(items)
    expect(resumen).toContain('4 secciones suman 400 pts')
    expect(resumen).toContain('escala 0–100%')
  })

  it('resumenPesosModulo cuando los ítems principales suman 100%', () => {
    const items: Item[] = [
      baseItem({ id: 'i1', tipo: 'CUMPLE_NO_CUMPLE', texto: 'Ítem 1', puntaje: 60, orden: 1 }),
      baseItem({ id: 'i2', tipo: 'CUMPLE_NO_CUMPLE', texto: 'Ítem 2', puntaje: 40, orden: 2 })
    ]

    const resumen = resumenPesosModulo(items)
    expect(resumen).toBe('2 ítems sueltos suman el 100% del módulo')
  })

  it('resumenPesosModulo cuando ningún ítem tiene peso', () => {
    const items: Item[] = [
      baseItem({ id: 'i1', tipo: 'CUMPLE_NO_CUMPLE', texto: 'Ítem 1', orden: 1, puntaje: 0 })
    ]

    const resumen = resumenPesosModulo(items)
    expect(resumen).toBe('Ningún ítem tiene peso: el módulo promedia todos sus ítems por igual')
  })

  it('textoPeso para ítem hijo dentro de una sección', () => {
    const seccion = baseItem({
      id: 'sec1', tipo: 'CONTENEDOR', texto: 'Refrigeración', puntaje: 25
    })
    const hijo = baseItem({
      id: 'h1', padre_id: 'sec1', tipo: 'CUMPLE_NO_CUMPLE', texto: 'Temperatura', puntaje: 50
    })

    // Si los hermanos suman 100
    expect(textoPeso(hijo, seccion, 100, 100)).toBe('50% de la sección "Refrigeración"')
    // Si los hermanos suman otra cantidad (ej. 200)
    expect(textoPeso(hijo, seccion, 200, 100)).toBe('50 pts en la sección "Refrigeración" (25% del grupo)')
  })

  it('textoPeso para secciones e ítems principales cuando la suma es distinta a 100', () => {
    const seccion = baseItem({
      id: 'sec1', tipo: 'CONTENEDOR', texto: 'Área 1', puntaje: 100
    })
    const itemSuelto = baseItem({
      id: 'i1', tipo: 'CUMPLE_NO_CUMPLE', texto: 'Check', puntaje: 100
    })

    // Con sumaRaiz = 400: cada uno de 100 pts es un 25% efectivo
    expect(textoPeso(seccion, null, 0, 400)).toBe('100 pts del módulo (25% efectivo, repartido entre sus ítems)')
    expect(textoPeso(itemSuelto, null, 0, 400)).toBe('100 pts del módulo (25% efectivo)')
  })
})
