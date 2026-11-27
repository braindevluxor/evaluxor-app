/**
 * Comentario por punto en el PDF de la evaluación.
 *
 * Se intercepta `jspdf-autotable` para mirar las tablas que se dibujan: lo
 * que importa es qué columnas se imprimen y qué dice cada celda, no el PDF
 * binario.
 */
import { describe, expect, it, vi } from 'vitest'
import type { DetalleEvaluacion } from '../data/indicadores'

const { tablas } = vi.hoisted(() => ({ tablas: [] as { head: string[][]; body: unknown[][] }[] }))

vi.mock('jspdf-autotable', () => ({
  default: (_pdf: unknown, opts: { head: string[][]; body: unknown[][] }) => {
    tablas.push({ head: opts.head, body: opts.body })
  }
}))

vi.mock('../supabase', () => ({
  supabase: {
    from: () => {
      const cadena = {
        select: () => cadena,
        eq: () => cadena,
        order: () => Promise.resolve({ data: [], error: null })
      }
      return cadena
    }
  }
}))

const { buildPdfDocument } = await import('./index')

const EV = '12345678-1234-1234-1234-123456789abc'

function detalleCon(valor: unknown): DetalleEvaluacion {
  return {
    evaluacion: {
      id: EV,
      sucursal_id: 's1',
      departamento_id: null,
      fecha: '2026-09-10',
      estado: 'CERRADA',
      puntuacion: 50,
      comentario_general: '',
      offline_uuid: '',
      aperturada_por: '',
      abierta_en: '2026-09-10T08:00:00',
      cerrada_en: '2026-09-10T11:30:00',
      created_at: '2026-09-10T08:00:00',
      sucursal: { id: 's1', nombre: 'Sucursal Centro', shop_id: '102', branch_id: '9', direccion: 'Av. Bolívar 120' },
      aperturador: null
    },
    respuestas: [
      {
        id: 'r1',
        evaluacion_id: EV,
        item_id: 'i1',
        instancia_id: null,
        valor,
        respondido_por: 'u1',
        created_at: ''
      }
    ],
    items: [
      {
        id: 'i1',
        modulo_id: 'm1',
        tipo: 'CHECKLIST',
        texto: 'Góndola de despensa',
        opciones: [
          { id: 'o1', etiqueta: 'Limpio' },
          { id: 'o2', etiqueta: 'Etiquetas puestas' }
        ],
        orden: 0,
        requerido: false,
        activo: true,
        puntaje: 100,
        created_at: ''
      }
    ],
    modulos: [{ id: 'm1', nombre: 'Estética', descripcion: '', orden: 0, activo: true, created_at: '' }],
    fotos: [],
    sucursalOpciones: [],
    instancias: []
  }
}

/** La tabla del check list: la que tiene la columna "Descripción". */
function tablaDelChecklist() {
  return tablas.find((t) => t.head[0]?.includes('Descripción'))
}

describe('PDF · comentario por punto', () => {
  it('imprime la columna del comentario con la nota de cada punto', () => {
    tablas.length = 0
    buildPdfDocument(detalleCon({ selected: ['o1'], comentarios: { o2: 'faltan las etiquetas' } }))
    const tabla = tablaDelChecklist()
    expect(tabla?.head[0]).toContain('Comentario')
    // La nota va en la fila de su punto: «Etiquetas puestas» es el que no está
    // tildado (las que cumplen van primero).
    const fila = tabla!.body.find((r) => r.includes('Etiquetas puestas'))
    expect(fila).toContain('faltan las etiquetas')
  })

  it('sin comentarios no imprime la columna', () => {
    // Una columna de guiones en todas las filas es ruido en el papel.
    tablas.length = 0
    buildPdfDocument(detalleCon({ selected: ['o1'] }))
    const tabla = tablaDelChecklist()
    expect(tabla?.head[0]).not.toContain('Comentario')
  })

  it('el punto sin nota queda con un guion en la columna', () => {
    tablas.length = 0
    buildPdfDocument(detalleCon({ selected: ['o1'], comentarios: { o2: 'faltan las etiquetas' } }))
    const tabla = tablaDelChecklist()
    const columna = tabla!.head[0].indexOf('Comentario')
    const fila = tabla!.body.map((r) => r[columna])
    expect(fila).toContain('faltan las etiquetas')
    expect(fila).toContain('—')
  })
})
