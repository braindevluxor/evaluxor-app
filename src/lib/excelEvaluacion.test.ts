import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { DetalleEvaluacion } from './data/indicadores'
import type { ResponsableIncidencia } from './data/responsablesIncidencia'
import { hojasDeEvaluacion, nombreArchivoEvaluacion, type IncidenciaExcel } from './excelEvaluacion'
import type { Item, Modulo, Opcion, Respuesta, VistaEvaluacion, Foto, InstanciaGrupo } from './types'
import { crearXlsx } from './xlsx'

const EV = '0af7a1b2-c3d4-4e5f-8a9b-0c1d2e3f4a5b'

const evaluacion: VistaEvaluacion = {
  id: EV,
  offline_uuid: 'offline-1',
  sucursal_id: 's1',
  departamento_id: null,
  aperturada_por: 'u1',
  fecha: '2026-10-15',
  estado: 'CERRADA',
  puntuacion: null,
  comentario_general: 'Todo bien en general',
  abierta_en: null,
  cerrada_en: null,
  created_at: '',
  sucursal: { id: 's1', nombre: 'Sucursal Mérida', shop_id: 'T-105', branch_id: '1', direccion: 'Av. Felipe Carrillo Puerto s/n' },
  aperturador: null
}

const modulos: Modulo[] = [
  { id: 'm1', nombre: 'Estética', descripcion: '', orden: 0, activo: true, created_at: '' },
  { id: 'm2', nombre: 'Mecánica', descripcion: '', orden: 1, activo: true, created_at: '' }
]

const op = (id: string, etiqueta: string, puntos: number): Opcion => ({ id, etiqueta, puntos })

const items: Item[] = [
  { id: 'i1', modulo_id: 'm1', tipo: 'CUMPLE_NO_CUMPLE', texto: 'Pintura sin rayones', opciones: [], orden: 0, requerido: false, activo: true, puntaje: 100, created_at: '' },
  { id: 'i2', modulo_id: 'm1', tipo: 'CHECKLIST', texto: 'Góndola de despensa', opciones: [op('o1', 'Limpio', 1), op('o2', 'Etiquetas puestas', 1)], orden: 1, requerido: false, activo: true, puntaje: 100, created_at: '' },
  { id: 'i6', modulo_id: 'm1', tipo: 'CUMPLE_NO_CUMPLE', texto: 'Luminaria exterior', opciones: [], orden: 2, requerido: false, activo: true, puntaje: 100, created_at: '' },
  { id: 'i3', modulo_id: 'm2', tipo: 'CONTENEDOR', texto: 'Sección de equipos', opciones: [], orden: 0, requerido: false, activo: true, puntaje: 100, created_at: '' },
  { id: 'i4', modulo_id: 'm2', tipo: 'CUMPLE_NO_CUMPLE', texto: 'Refrigerador', opciones: [], orden: 1, requerido: false, activo: true, puntaje: 100, padre_id: 'i3', created_at: '' }
]

const instancias: InstanciaGrupo[] = [
  { id: 'in1', evaluacion_id: EV, item_id: 'i3', etiqueta: 'Placa ABC-123', orden: 0, created_at: '' }
]

const respuestas: Respuesta[] = [
  {
    id: 'r1',
    evaluacion_id: EV,
    item_id: 'i1',
    instancia_id: null,
    valor: { value: true, evidencias: [{ photoIds: [], comentario: 'Se reparó el estante' }] },
    respondido_por: 'u1',
    created_at: ''
  },
  { id: 'r2', evaluacion_id: EV, item_id: 'i2', instancia_id: null, valor: { selected: ['o1'] }, respondido_por: 'u2', created_at: '' },
  { id: 'r3', evaluacion_id: EV, item_id: 'i6', instancia_id: null, valor: { value: true, informativo: true }, respondido_por: null, created_at: '' },
  // Respuesta sobre el propio contenedor: la pantalla la saltea y el Excel también.
  { id: 'r4', evaluacion_id: EV, item_id: 'i3', instancia_id: null, valor: { value: true }, respondido_por: 'u1', created_at: '' },
  { id: 'r5', evaluacion_id: EV, item_id: 'i4', instancia_id: 'in1', valor: { value: false }, respondido_por: 'u1', created_at: '' }
]

const fotos: Foto[] = [
  { id: 'f1', evaluacion_id: EV, item_id: 'i1', instancia_id: null, path: 'ev/ev1/i1.jpg', created_at: '' },
  { id: 'f2', evaluacion_id: EV, item_id: 'i4', instancia_id: 'in1', path: 'ev/ev1/i4-1.jpg', created_at: '' },
  { id: 'f3', evaluacion_id: EV, item_id: 'i4', instancia_id: 'in1', path: 'ev/ev1/i4-2.jpg', created_at: '' }
]

const detalle: DetalleEvaluacion = {
  evaluacion,
  respuestas,
  items,
  modulos,
  fotos,
  sucursalOpciones: [],
  instancias
}

const responsables: ResponsableIncidencia[] = [
  { cargo: 'Cajero', porValidar: false },
  { cargo: 'Aseo', porValidar: true }
]

const incidencias: IncidenciaExcel[] = [
  {
    descripcion: 'Foco roto en pasillo 3',
    responsables,
    fecha: '2026-10-15T15:00:00Z',
    modulo: 'Estética',
    fotos: 2
  }
]

const perfiles = { u1: { nombre: 'Ana García' }, u2: { nombre: 'Luis Pérez' } }

describe('hojasDeEvaluacion', () => {
  const hojas = hojasDeEvaluacion(detalle, incidencias, perfiles)
  const filasDe = (nombre: string): (string | number | null)[][] => {
    const hoja = hojas.find((h) => h.nombre === nombre)
    expect(hoja, `falta la pestaña ${nombre}`).toBeTruthy()
    return hoja!.filas
  }

  it('arma las cuatro pestañas en orden', () => {
    expect(hojas.map((h) => h.nombre)).toEqual(['Resumen', 'Módulos', 'Resultados', 'Incidencias'])
    // Sin incidencias la pestaña igual existe, sólo con su encabezado.
    expect(hojasDeEvaluacion(detalle)[3].filas).toHaveLength(1)
  })

  it('resume con el código enmascarado, los conteos y el comentario general', () => {
    const resumen = filasDe('Resumen')
    expect(resumen[1]).toEqual(['Código de evaluación', '0af7a1b2-c3d4-****-****-0c1d2e3f4a5b'])
    const valorDe = (etiqueta: string): string | number | null | undefined =>
      resumen.find((fila) => fila[0] === etiqueta)?.[1]
    expect(valorDe('Sucursal')).toBe('Sucursal Mérida')
    expect(valorDe('Código de tienda')).toBe('T-105')
    expect(valorDe('Fecha de evaluación')).toBe('2026-10-15')
    expect(valorDe('Puntaje general')).toBe(37.5)
    expect(valorDe('Ítems puntuables')).toBe(3)
    expect(valorDe('Ítems que cumplen')).toBe(1)
    expect(valorDe('Incidencias')).toBe(1)
    expect(valorDe('Comentario general')).toBe('Todo bien en general')
  })

  it('cuenta por módulo con el mismo puntaje que la pantalla', () => {
    expect(filasDe('Módulos')).toEqual([
      ['Módulo', 'Puntaje %', 'Ítems puntuables', 'Ítems que cumplen'],
      ['Estética', 75, 2, 1],
      ['Mecánica', 0, 1, 0]
    ])
  })

  it('lista los resultados con estado, nota, comentarios, fotos y quién respondió', () => {
    const resultados = filasDe('Resultados')
    expect(resultados[0]).toEqual([
      'Módulo', 'Ítem', 'Registro', 'Estado', 'Nota %', 'Peso', 'Respuesta', 'Comentarios', 'Fotos', 'Tipo', 'Respondió'
    ])
    // Encabezado + cuatro: la respuesta sobre el contenedor queda fuera.
    expect(resultados).toHaveLength(5)
    expect(resultados.slice(1).map((fila) => fila[1])).toEqual([
      'Pintura sin rayones',
      'Góndola de despensa',
      'Luminaria exterior',
      'Refrigerador'
    ])
    const porTexto = new Map(resultados.slice(1).map((fila) => [fila[1], fila]))
    expect(porTexto.get('Pintura sin rayones')).toEqual([
      'Estética', 'Pintura sin rayones', null, 'Cumple', 100, 100, 'Cumple', 'Se reparó el estante', 1, 'CUMPLE_NO_CUMPLE', 'Ana García'
    ])
    expect(porTexto.get('Góndola de despensa')).toEqual([
      'Estética', 'Góndola de despensa', null, 'No cumple', 50, 100, '1 de 2 opciones · Limpio', '', 0, 'CHECKLIST', 'Luis Pérez'
    ])
    expect(porTexto.get('Luminaria exterior')).toEqual([
      'Estética', 'Luminaria exterior', null, 'No aplica', null, 100, 'Cumple · No aplica', '', 0, 'CUMPLE_NO_CUMPLE', null
    ])
    expect(porTexto.get('Refrigerador')).toEqual([
      'Mecánica', 'Refrigerador', 'Placa ABC-123', 'No cumple', 0, 100, 'No cumple', '', 2, 'CUMPLE_NO_CUMPLE', 'Ana García'
    ])
  })

  it('lleva el comentario de cada punto del check list en la columna de comentarios', () => {
    // La columna "Comentarios" es la misma que ya usaba el comentario de la
    // evidencia: ahora también recibe la nota que el evaluador dejó en cada
    // punto de la lista.
    const conNotas: DetalleEvaluacion = {
      ...detalle,
      respuestas: detalle.respuestas.map((r) =>
        r.id === 'r2'
          ? { ...r, valor: { selected: ['o1'], comentarios: { o2: 'faltan las etiquetas' } } }
          : r
      )
    }
    const resultados = hojasDeEvaluacion(conNotas, incidencias, perfiles).find((h) => h.nombre === 'Resultados')!.filas
    const fila = resultados.find((f) => f[1] === 'Góndola de despensa')!
    expect(fila[7]).toBe('Etiquetas puestas: faltan las etiquetas')
  })

  it('pisa las incidencias con hora local, cargos unidos y conteo de fotos', () => {
    const filas = filasDe('Incidencias')
    expect(filas).toHaveLength(2)
    expect(String(filas[1][0])).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    expect(filas[1].slice(1)).toEqual(['Estética', 'Foco roto en pasillo 3', 'Cajero · Aseo', 2])
  })

  it('el libro completo sale armado con las cuatro pestañas', () => {
    const bytes = crearXlsx(hojas)
    expect(bytes.length).toBeGreaterThan(1000)
    // Las entradas van sin comprimir: el XML se lee tal cual dentro de los bytes.
    const crudo = new TextDecoder().decode(bytes)
    expect(crudo).toContain('<sheet name="Resumen"')
    expect(crudo).toContain('<sheet name="Incidencias"')
  })
})

describe('nombreArchivoEvaluacion', () => {
  it('sluggifica la sucursal y baja la acentuación', () => {
    expect(nombreArchivoEvaluacion(evaluacion)).toBe('resultados-sucursal-merida-2026-10-15.xlsx')
  })

  it('usa el departamento cuando la evaluación no es de sucursal', () => {
    expect(
      nombreArchivoEvaluacion({
        fecha: '2026-10-15',
        sucursal: null,
        departamento: { id: 'd1', nombre: 'Compras Central' }
      })
    ).toBe('resultados-compras-central-2026-10-15.xlsx')
  })
})

describe('botón en EvaluacionDetalle', () => {
  const pagina = readFileSync(fileURLToPath(new URL('../pages/EvaluacionDetalle.tsx', import.meta.url)), 'utf8')

  it('ofrece el Excel junto al PDF y le pasa el detalle con las incidencias', () => {
    expect(pagina).toContain('aria-label="Descargar Excel"')
    expect(pagina).toContain('<FileSpreadsheet className="h-5 w-5" />')
    expect(pagina).toContain('descargarExcelEvaluacion(detalle, incidenciasExcel)')
    expect(pagina).toContain('fila.modulo?.[0]?.nombre ?? null')
  })
})
