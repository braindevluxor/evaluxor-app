import { describe, expect, it } from 'vitest'
import {
  RUTA_HISTORIAL,
  evidenciasDe,
  evidenciasDeRespuestas,
  fechaLegible,
  filaHistorial,
  fusionarHistorial,
  registroDesdeServidor,
  seccionarItems
} from './inspeccionVehiculo'
import type { Item, Opcion, RevisionPreEntrega } from './types'

function item(parcial: Partial<Item> & Pick<Item, 'tipo' | 'texto'>): Item {
  return {
    id: 'i1',
    modulo_id: 'm1',
    opciones: null,
    orden: 0,
    requerido: false,
    activo: true,
    created_at: '',
    ...parcial
  }
}

const opciones: Opcion[] = [
  { id: 'o1', etiqueta: 'Sin abolladuras' },
  { id: 'o2', etiqueta: 'Pintura uniforme' }
]

describe('seccionarItems', () => {
  const estetica = item({ id: 's1', tipo: 'CONTENEDOR', texto: 'Estética' })
  const mecanica = item({ id: 's2', tipo: 'CONTENEDOR', texto: 'Mecánica' })
  const carroceria = item({ id: 'c1', tipo: 'CHECKLIST', texto: 'Carrocería', padre_id: 's1' })
  const frenos = item({ id: 'c2', tipo: 'CHECKLIST', texto: 'Frenos', padre_id: 's2' })
  const dictamen = item({ id: 'd1', tipo: 'CUMPLE_NO_CUMPLE', texto: '¿Queda en condiciones?' })

  it('agrupa por sección y deja el dictamen al final', () => {
    const grupos = seccionarItems([estetica, carroceria, mecanica, frenos, dictamen])
    expect(grupos.map((g) => g.seccion)).toEqual(['Estética', 'Mecánica', null])
    expect(grupos[0].items.map((i) => i.id)).toEqual(['c1'])
    expect(grupos[1].items.map((i) => i.id)).toEqual(['c2'])
    // Los sueltos cierran: el dictamen se llena después de las revisiones.
    expect(grupos[2].items.map((i) => i.id)).toEqual(['d1'])
  })

  it('no imprime secciones que quedaron sin hijos activos', () => {
    const vacia = item({ id: 's3', tipo: 'CONTENEDOR', texto: 'Documentación' })
    const grupos = seccionarItems([estetica, carroceria, vacia])
    expect(grupos.map((g) => g.seccion)).toEqual(['Estética'])
  })

  it('un hijo cuya sección ya no existe se imprime igual, con los sueltos', () => {
    // Perder una pregunta de inspección sería mentirle al que firma el PDF.
    const huérfano = item({ id: 'c9', tipo: 'CHECKLIST', texto: 'Perdido', padre_id: 'borrada' })
    const grupos = seccionarItems([estetica, carroceria, huérfano, dictamen])
    expect(grupos.map((g) => g.seccion)).toEqual(['Estética', null])
    expect(grupos[1].items.map((i) => i.id)).toEqual(['c9', 'd1'])
  })
})

describe('evidenciasDe', () => {
  const itemChecklist = item({ tipo: 'CHECKLIST', texto: 'Carrocería', opciones })

  it('en un checklist el pie nombra el ítem y la opción marcada', () => {
    const evs = evidenciasDe(itemChecklist, { evidencias: { o2: { photoIds: ['f1', 'f2'] } } })
    expect(evs).toEqual([{ pie: 'Carrocería · Pintura uniforme', photoIds: ['f1', 'f2'], paths: [] }])
  })

  it('una incidencia escrita se suma al pie', () => {
    const evs = evidenciasDe(itemChecklist, {
      evidencias: { o1: { photoIds: ['f1'], comentario: 'Golpe en el guardabarros' } }
    })
    expect(evs[0].pie).toBe('Carrocería · Sin abolladuras · Golpe en el guardabarros')
  })

  it('en un CUMPLE_NO_CUMPLE la evidencia viene como lista y lleva su comentario', () => {
    const itemCumple = item({ tipo: 'CUMPLE_NO_CUMPLE', texto: '¿Queda en condiciones?' })
    const evs = evidenciasDe(itemCumple, {
      evidencias: [{ photoIds: [], paths: ['pre-entrega/r1/f9.jpg'], comentario: 'Ruido al frenar' }]
    })
    expect(evs).toEqual([{ pie: '¿Queda en condiciones? · Ruido al frenar', photoIds: [], paths: ['pre-entrega/r1/f9.jpg'] }])
  })

  it('descarta las fotos que sólo dicen que están en el equipo (no son del bucket)', () => {
    // `.local/<id>` es el marcador con el que transform.ts nombra una foto que
    // nunca subió: pedirle una URL firmada a eso da 404 en el PDF.
    const evs = evidenciasDe(itemChecklist, { evidencias: { o1: { paths: ['.local/f1'] } } })
    expect(evs).toEqual([])
  })

  it('sin evidencias no devuelve nada', () => {
    expect(evidenciasDe(itemChecklist, { selected: ['o1'] })).toEqual([])
    expect(evidenciasDe(itemChecklist, undefined)).toEqual([])
  })
})

describe('evidenciasDeRespuestas', () => {
  it('recorre sólo los ítems respondibles, nunca los CONTENEDOR', () => {
    const seccion = item({ id: 's1', tipo: 'CONTENEDOR', texto: 'Estética' })
    const conFoto = item({ id: 'c1', tipo: 'CHECKLIST', texto: 'Carrocería', opciones, padre_id: 's1' })
    const sinFoto = item({ id: 'c2', tipo: 'CHECKLIST', texto: 'Frenos', padre_id: 's1' })

    const evs = evidenciasDeRespuestas([seccion, conFoto, sinFoto], {
      c1: { evidencias: { o1: { photoIds: ['f1'] } } },
      c2: { selected: ['x'] }
    })
    expect(evs).toHaveLength(1)
    expect(evs[0].pie).toBe('Carrocería · Sin abolladuras')
  })
})

describe('historial de inspecciones', () => {
  const base = {
    id: 'r1',
    fecha: '2026-10-15',
    placa: ' abc-123 ',
    vehiculo: { marca: 'TOYOTA', modelo: 'HILUX', anio: 2020 },
    chofer: { nombre: 'Ana', apellido: 'Pérez' },
    estado: 'FINALIZADA',
    updated_at: 1000
  }

  it('resume un registro en una fila legible, con la placa en mayúsculas', () => {
    const f = filaHistorial(base)
    expect(f.placa).toBe('ABC-123')
    expect(f.vehiculo).toBe('TOYOTA HILUX 2020')
    expect(f.propietario).toBe('Ana Pérez')
    expect(f.estado).toBe('FINALIZADA')
    expect(fechaLegible(f.fecha)).toBe('15 oct 2026')
    // Sin datos no se rompe: sólo queda vacío el campo.
    expect(filaHistorial({ ...base, vehiculo: {}, chofer: {}, fecha: 'x' }).vehiculo).toBe('')
    expect(fechaLegible('x')).toBe('x')
  })

  it('una fila del servidor no está pendiente: sin `sync` ya subió', () => {
    const servidor = filaHistorial({ ...base, updated_at: '2026-10-15T10:00:00.000Z' })
    expect(servidor.pendiente).toBe(false)
    expect(servidor.ms).toBe(Date.parse('2026-10-15T10:00:00.000Z'))
    // La del equipo sí puede estarlo, y eso se muestra en la lista.
    expect(filaHistorial({ ...base, sync: 'pendiente' }).pendiente).toBe(true)
    expect(filaHistorial({ ...base, sync: 'enviado' }).pendiente).toBe(false)
  })

  it('junta equipo y servidor sin repetir; si coinciden, manda el equipo', () => {
    const servidor = [{ ...base, id: 'r1', updated_at: '2026-10-15T10:00:00.000Z' }]
    const local = [
      { ...base, id: 'r2', estado: 'BORRADOR', sync: 'pendiente', updated_at: 2000 },
      // La misma inspección r1, pero con cambios que todavía no subieron.
      { ...base, id: 'r1', sync: 'pendiente', updated_at: 5000, placa: 'XYZ-999' }
    ]
    const filas = fusionarHistorial(local, servidor)
    expect(filas.map((f) => f.id)).toEqual(['r1', 'r2'])
    expect(filas).toHaveLength(2)
    // La copia local pisa a la remota: es la que lleva lo último.
    expect(filas[0].placa).toBe('XYZ-999')
    expect(filas[0].pendiente).toBe(true)
  })

  it('una finalizada subida se puede abrir de nuevo desde el servidor', () => {
    const fila: RevisionPreEntrega = {
      id: 'r9',
      evaluador_id: 'u1',
      sucursal_id: null,
      modulo_id: 'm1',
      placa: 'ABC-123',
      vehiculo: { marca: 'MAZDA', modelo: 'CX-5' },
      chofer: { nombre: 'Ana' },
      chofer_firma: null,
      observaciones: null,
      respuestas: { c1: { evidencias: { o1: { paths: ['pre-entrega/r9/f1.jpg'] } } } },
      estado: 'FINALIZADA',
      fecha: '2026-10-15',
      created_at: '2026-10-15T09:00:00.000Z',
      updated_at: '2026-10-15T10:00:00.000Z'
    }
    const reg = registroDesdeServidor(fila)
    expect(reg.created_at).toBe(Date.parse('2026-10-15T09:00:00.000Z'))
    expect(reg.updated_at).toBe(Date.parse('2026-10-15T10:00:00.000Z'))
    // El registro local no admite observaciones null.
    expect(reg.observaciones).toBe('')
    expect(reg.sync).toBe('enviado')
    expect(reg.photoIds).toEqual([])
    // Las respuestas conservan las rutas del bucket: el PDF vuelve a salir con
    // las fotos aunque el equipo las haya borrado al subir la inspección.
    expect(reg.respuestas).toEqual(fila.respuestas)
  })

  it('la ruta del historial cuelga de la de la herramienta', () => {
    expect(RUTA_HISTORIAL).toBe('/evaluar/inspeccion-vehiculo/historial')
  })
})
