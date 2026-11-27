import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { jsPDF } from 'jspdf'
import type { ResumenItemModulo } from '../data/indicadores'
import type { Item, Opcion } from '../types'

/** Nombres de archivo con los que se intentó guardar. */
const guardados: string[] = []
/** Todo lo que el documento escribió, en orden (autoTable también pasa por acá). */
const textos: string[] = []

vi.mock('jspdf', async (importOriginal) => {
  const real = await importOriginal<typeof import('jspdf')>()
  // En `jspdf`, `save` se cuelga en cada instancia y cae a `fs.writeFileSync`
  // cuando no hay navegador: sin esto el test escribe un PDF en el disco.
  class JsPDFDePrueba extends real.jsPDF {
    constructor(...args: ConstructorParameters<typeof real.jsPDF>) {
      super(...args)
      const escribir = this.text.bind(this)
      this.text = ((...args: Parameters<jsPDF['text']>) => {
        const contenido = args[0]
        textos.push(Array.isArray(contenido) ? contenido.join(' ') : String(contenido))
        return escribir(...args)
      }) as jsPDF['text']
      this.save = ((nombre?: string) => {
        guardados.push(nombre ?? '')
      }) as jsPDF['save']
    }
  }
  return { ...real, jsPDF: JsPDFDePrueba }
})

const { buildReporteModulo, descargarReporteModulo, filasReincidencia, totalReincidencia } =
  await import('./reporteModulo')

// ---------------------------------------------------------------------------
// Datos de ejemplo: un módulo con dos checklists y un ítem sin puntos.
// ---------------------------------------------------------------------------

const opciones: Opcion[] = [
  { id: 'o1', etiqueta: 'Sellos de puertas sin fugas', tipo_respuesta: 'CHECK' },
  { id: 'o2', etiqueta: 'Temperatura de operación', tipo_respuesta: 'RANGO', minimo: -18, unidad: '°C' },
  { id: 'o3', etiqueta: 'Limpieza interior de cámaras', tipo_respuesta: 'CHECK' }
]

const itemChecklist: Item = {
  id: 'it-cl1',
  modulo_id: 'm1',
  tipo: 'CHECKLIST',
  texto: 'Cámaras refrigeradas en condiciones operativas',
  opciones,
  orden: 1,
  requerido: true,
  activo: true,
  puntaje: 15,
  created_at: ''
}

const itemCumple: Item = {
  id: 'it-cn1',
  modulo_id: 'm1',
  tipo: 'CUMPLE_NO_CUMPLE',
  texto: 'El vehículo cuenta con extintor vigente',
  opciones: null,
  orden: 2,
  requerido: true,
  activo: true,
  puntaje: 10,
  created_at: ''
}

const resumen: ResumenItemModulo[] = [
  {
    item: itemChecklist,
    peso: 15,
    respondidas: 10,
    muestras: 10,
    ok: 8.5,
    promedio: 0.85,
    opciones: [
      { id: 'o1', etiqueta: 'Sellos de puertas sin fugas', tipo_respuesta: 'CHECK', minimo: null, unidad: null, veces: 10, cumplida: 4 },
      { id: 'o2', etiqueta: 'Temperatura de operación', tipo_respuesta: 'RANGO', minimo: -18, unidad: '°C', veces: 10, cumplida: 9 },
      { id: 'o3', etiqueta: 'Limpieza interior de cámaras', tipo_respuesta: 'CHECK', minimo: null, unidad: null, veces: 6, cumplida: 6 }
    ]
  },
  {
    item: itemCumple,
    peso: 10,
    respondidas: 10,
    muestras: 10,
    ok: 7,
    promedio: 0.7
  }
]

const reporte = {
  moduloNombre: 'Flota y puertas',
  desde: '2026-09-01',
  hasta: '2026-10-01',
  alcance: 'Todas las sucursales',
  evaluaciones: 12,
  resumen
}

beforeEach(() => {
  guardados.length = 0
  textos.length = 0
})

describe('reincidencia por punto', () => {
  it('ordena de más faltas a menos y las que nunca fallaron quedan al final', () => {
    const [bloque] = filasReincidencia(resumen)
    expect(bloque.puntos.map((p) => p.punto)).toEqual([
      'Sellos de puertas sin fugas',
      'Temperatura de operación',
      'Limpieza interior de cámaras'
    ])
    expect(bloque.puntos.map((p) => p.faltas)).toEqual([6, 1, 0])
  })

  it('la reincidencia es el % de faltas sobre las veces que el punto estuvo presente', () => {
    const [bloque] = filasReincidencia(resumen)
    const sellos = bloque.puntos[0]
    expect(sellos).toMatchObject({ esperadas: 10, cumplidas: 4, faltas: 6, reincidencia: 60 })

    const limpieza = bloque.puntos[2]
    expect(limpieza).toMatchObject({ esperadas: 6, cumplidas: 6, faltas: 0, reincidencia: 0 })
  })

  it('un punto que nunca estuvo presente no tiene reincidencia (no hay denominador)', () => {
    const bloques = filasReincidencia([
      {
        item: itemChecklist,
        peso: 15,
        respondidas: 1,
        muestras: 1,
        ok: 1,
        promedio: 1,
        opciones: [
          { id: 'o9', etiqueta: 'Nunca aplicó', tipo_respuesta: 'CHECK', minimo: null, unidad: null, veces: 0, cumplida: 0 }
        ]
      }
    ])
    expect(bloques[0].puntos[0].reincidencia).toBeNull()
  })

  it('el total del ítem suma sus puntos', () => {
    const [bloque] = filasReincidencia(resumen)
    expect(bloque.total).toEqual({
      punto: 'Total de Cámaras refrigeradas en condiciones operativas',
      esperadas: 26,
      cumplidas: 19,
      faltas: 7,
      reincidencia: 26.9
    })
  })

  it('el total del módulo suma los ítems que tienen checklist', () => {
    const total = totalReincidencia(filasReincidencia(resumen))
    expect(total).toEqual({
      punto: 'Total del módulo',
      esperadas: 26,
      cumplidas: 19,
      faltas: 7,
      reincidencia: 26.9
    })
  })

  it('los ítems sin puntos de checklist no abren bloque', () => {
    const bloques = filasReincidencia(resumen)
    expect(bloques).toHaveLength(1)
    expect(bloques[0].item.id).toBe('it-cl1')
    expect(filasReincidencia([])).toEqual([])
  })
})

describe('reporte del módulo', () => {
  it('los dos bloques salen en el orden pedido: primero reincidencia, luego resultado por ítem', () => {
    buildReporteModulo(reporte)
    const cuerpo = textos.join('\n')
    const reincidencia = cuerpo.indexOf('Reincidencia en la falta de cada punto (checklist)')
    const porItem = cuerpo.indexOf('Resultado general por ítem')

    expect(reincidencia).toBeGreaterThan(-1)
    expect(porItem).toBeGreaterThan(reincidencia)
    expect(cuerpo).toContain('Reporte del módulo: Flota y puertas')
  })

  it('lista los puntos con sus columnas y cierra con el total del módulo', () => {
    buildReporteModulo(reporte)
    const cuerpo = textos.join('\n')

    expect(cuerpo).toContain('Punto del checklist')
    expect(cuerpo).toContain('% reincidencia')
    expect(cuerpo).toContain('Sellos de puertas sin fugas')
    expect(cuerpo).toContain('Limpieza interior de cámaras')
    expect(cuerpo).toContain('Total del módulo: 7 falta(s) de 26 oportunidades (26.9%) en 1 ítem(s) con checklist.')
  })

  it('el resultado general por ítem lleva el gráfico de barras con el % de cada ítem', () => {
    buildReporteModulo(reporte)
    const cuerpo = textos.join('\n')

    expect(cuerpo).toContain('Cámaras refrigeradas en condiciones operativas')
    expect(cuerpo).toContain('El vehículo cuenta con extintor vigente')
    // Etiquetas del eje, igual que el gráfico de módulos del informe de evaluación.
    for (const tick of ['0', '25', '50', '75', '100']) expect(cuerpo).toContain(tick)
    // Promedio de cada ítem al final de su barra (0.85 → 85%, 0.7 → 70%).
    expect(cuerpo).toContain('85%')
    expect(cuerpo).toContain('70%')
    expect(cuerpo).toContain('Promedio')
  })

  it('sin respuestas en el rango no se rompe: sigue generando el PDF', () => {
    expect(() => buildReporteModulo({ ...reporte, resumen: [], evaluaciones: 0 })).not.toThrow()
    expect(guardados).toHaveLength(0)
  })

  it('el nombre del archivo lleva el módulo y el rango', async () => {
    await descargarReporteModulo(reporte)
    expect(guardados[0]).toBe('reporte-flota-y-puertas-2026-09-01-2026-10-01.pdf')
  })
})
