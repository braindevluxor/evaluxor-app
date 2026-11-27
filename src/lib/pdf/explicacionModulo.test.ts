import { describe, expect, it } from 'vitest'
import type { Item } from '../types'
import { buildExplicacionModulo, calcularComposicionModulo, resumenPesosModulo, textoPeso } from './explicacionModulo'

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

  it('calcularComposicionModulo con 4 secciones de 100 pts y 4 items de 25 pts en cada una (16 items suman 100%)', () => {
    const items: Item[] = []
    for (let s = 1; s <= 4; s++) {
      items.push(baseItem({ id: `sec${s}`, tipo: 'CONTENEDOR', texto: `Sección ${s}`, puntaje: 100, orden: s * 10 }))
      for (let h = 1; h <= 4; h++) {
        items.push(baseItem({
          id: `sec${s}_h${h}`,
          padre_id: `sec${s}`,
          tipo: 'CUMPLE_NO_CUMPLE',
          texto: `S${s} Item ${h}`,
          puntaje: 25,
          orden: s * 10 + h
        }))
      }
    }

    const { filas, sumaTotalPct } = calcularComposicionModulo(items)
    expect(filas).toHaveLength(16)
    // Cada ítem representa 6.25% del módulo
    for (const f of filas) {
      expect(f.pesoEfectivoModulo).toBe(6.25)
      expect(f.pesoEnSeccion).toBe('25%')
    }
    expect(sumaTotalPct).toBe(100)
  })

  it('calcularComposicionModulo con ítems sueltos ponderados', () => {
    const items: Item[] = [
      baseItem({ id: 'i1', tipo: 'CUMPLE_NO_CUMPLE', texto: 'Item 1', puntaje: 50, orden: 1 }),
      baseItem({ id: 'i2', tipo: 'CUMPLE_NO_CUMPLE', texto: 'Item 2', puntaje: 30, orden: 2 }),
      baseItem({ id: 'i3', tipo: 'CUMPLE_NO_CUMPLE', texto: 'Item 3', puntaje: 20, orden: 3 })
    ]

    const { filas, sumaTotalPct } = calcularComposicionModulo(items)
    expect(filas).toHaveLength(3)
    expect(filas[0].pesoEfectivoModulo).toBe(50)
    expect(filas[1].pesoEfectivoModulo).toBe(30)
    expect(filas[2].pesoEfectivoModulo).toBe(20)
    expect(sumaTotalPct).toBe(100)
  })

  it('calcularComposicionModulo sin pesos asignados reparte equitativamente', () => {
    const items: Item[] = [
      baseItem({ id: 'i1', tipo: 'CUMPLE_NO_CUMPLE', texto: 'Item 1', puntaje: 0, orden: 1 }),
      baseItem({ id: 'i2', tipo: 'CUMPLE_NO_CUMPLE', texto: 'Item 2', puntaje: 0, orden: 2 }),
      baseItem({ id: 'i3', tipo: 'CUMPLE_NO_CUMPLE', texto: 'Item 3', puntaje: 0, orden: 3 }),
      baseItem({ id: 'i4', tipo: 'CUMPLE_NO_CUMPLE', texto: 'Item 4', puntaje: 0, orden: 4 })
    ]

    const { filas, sumaTotalPct } = calcularComposicionModulo(items)
    expect(filas).toHaveLength(4)
    for (const f of filas) {
      expect(f.pesoEfectivoModulo).toBe(25)
    }
    expect(sumaTotalPct).toBe(100)
  })
})

describe('explicacionModulo · la descripción del ítem en el papel', () => {
  const salidaDe = (descripcion: string): string =>
    buildExplicacionModulo({
      moduloNombre: 'Higiene y salubridad',
      items: [baseItem({ id: 'i1', texto: 'Los pasillos están libres', descripcion })]
    }).output()

  it('la descripción sale en el detalle del ítem, con su texto', () => {
    const salida = salidaDe('Se revisa al cerrar el local: sin personas en la zona.')
    expect(salida).toContain('Se revisa al cerrar el local: sin personas en la zona.')
    // El enunciado y la ficha del ítem siguen donde estaban.
    expect(salida).toContain('Los pasillos están libres')
    expect(salida).toContain('Tipo:')
  })

  it('el formato no deja asteriscos en el papel', () => {
    const salida = salidaDe('Todo **obligatorio** para enviar el cierre.')
    // La negrita se pinta con su estilo: lo que sobra es el marcador.
    expect(salida).toContain('obligatorio')
    expect(salida).not.toContain('**obligatorio**')
  })

  it('las viñetas salen con su punto y la tabla como tabla (sin pipes)', () => {
    const salida = salidaDe(['- puertas', '- luces', '', '| Zona | Pts |', '| --- | --- |', '| Almacén | 5 |'].join('\n'))
    // jsPDF escribe `•` con su byte WinAnsi (0x95): se vuelve a Unicode para leerlo.
    const papel = salida.replace(/\u0095/g, '•')
    expect(papel).toContain('• puertas')
    expect(papel).toContain('• luces')
    expect(salida).toContain('Almacén')
    expect(salida).not.toContain('| --- |')
  })

  it('sin descripción el documento sale como antes', () => {
    const salida = salidaDe('')
    expect(salida).toContain('Los pasillos están libres')
    expect(salida).not.toContain('undefined')
  })

  it('una descripción larga corta por renglón y sigue en la siguiente hoja', () => {
    const pdf = buildExplicacionModulo({
      moduloNombre: 'Higiene y salubridad',
      items: [baseItem({ id: 'i1', texto: 'Único ítem', descripcion: 'Renglón de prueba para forzar el corte de hoja. '.repeat(150) })]
    })
        expect(pdf.getNumberOfPages()).toBeGreaterThan(1)
    const hojas = (pdf.internal.pages as unknown as Array<string[]>).map((h) => (Array.isArray(h) ? h.join('\n') : ''))
    // El corte es por renglón: el texto sigue en la hoja 2, no se pierde ni
    // se cae entero a la página siguiente.
    expect(hojas[1]).toContain('Renglón de prueba')
    expect(hojas[2]).toContain('Renglón de prueba')
  })
})
