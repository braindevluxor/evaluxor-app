/// <reference types="node" />
import { describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildPdfDocument } from './index'
import type { DetalleEvaluacion } from '../data/indicadores'
import type { Item, Modulo, Respuesta, VistaEvaluacion } from '../types'

// ---------------------------------------------------------------------------
// Datos de ejemplo: una evaluación con todos los tipos de ítem.
// ---------------------------------------------------------------------------

const modulos: Modulo[] = [
  { id: 'm1', nombre: 'Higiene y salubridad', descripcion: '', orden: 1, activo: true, created_at: '' },
  { id: 'm2', nombre: 'Atención y operaciones', descripcion: '', orden: 2, activo: true, created_at: '' },
  { id: 'm3', nombre: 'Cumplimiento normativo', descripcion: '', orden: 3, activo: true, created_at: '' }
]

const opcionesChecklist = [
  { id: 'o1', etiqueta: 'Estructura de cámaras en buen estado', tipo_respuesta: 'CHECK' as const },
  { id: 'o2', etiqueta: 'Sellos de puertas sin fugas', tipo_respuesta: 'CHECK' as const },
  { id: 'o3', etiqueta: 'Limpieza interior de cámaras', tipo_respuesta: 'CHECK' as const },
  { id: 'o4', etiqueta: 'Temperatura de operación', tipo_respuesta: 'RANGO' as const, minimo: -18, maximo: -60, unidad: '°C' },
  { id: 'o5', etiqueta: 'Sensor de alarma conectado', tipo_respuesta: 'CHECK' as const }
]

const items: Item[] = [
  {
    id: 'it-cn1', modulo_id: 'm1', tipo: 'CUMPLE_NO_CUMPLE',
    texto: 'La cocina cuenta con un plan de limpieza vigente y a la vista',
    opciones: null, responsables: ['Gerencia'], orden: 1, requerido: true, activo: true, puntaje: 10, created_at: ''
  },
  {
    id: 'it-cl1', modulo_id: 'm1', tipo: 'CHECKLIST',
    texto: 'Equipos de refrigeración en condiciones operativas',
    opciones: opcionesChecklist, responsables: ['Operaciones'], orden: 2, requerido: true, activo: true, puntaje: 15, created_at: ''
  },
  {
    id: 'it-co1', modulo_id: 'm1', tipo: 'CONCILIACION',
    texto: 'Conteo de productos de la bodega de secos',
    opciones: null, responsables: ['Gerencia', 'Almacén'], orden: 3, requerido: true, activo: true, puntaje: 20, created_at: ''
  },
  {
    id: 'it-lc1', modulo_id: 'm2', tipo: 'LISTA_COLABORADORES',
    texto: 'Verificación de identificación y presentación del personal en piso',
    opciones: [
      { id: 'r1', etiqueta: 'Carnet a la vista' },
      { id: 'r2', etiqueta: 'Uniforme completo' },
      { id: 'r3', etiqueta: 'Gorro y redecilla' }
    ],
    colaboradores_filtro: 'ACTIVOS', responsables: ['Talento Humano'], orden: 1, requerido: true, activo: true, puntaje: 12, created_at: ''
  },
  {
    id: 'it-uc1', modulo_id: 'm2', tipo: 'UNIDAD_CHECKLIST',
    texto: 'Higiene y operatividad de las áreas de patio',
    opciones: [
      { id: 'u1', etiqueta: 'Carretilla operativa' },
      { id: 'u2', etiqueta: 'Kit de limpieza presente' },
      { id: 'u3', etiqueta: 'Nevera de apoyo funcionando' }
    ],
    responsables: ['Patio'], orden: 2, requerido: true, activo: true, puntaje: 10, created_at: ''
  },
  {
    id: 'it-sec1', modulo_id: 'm2', tipo: 'CONTENEDOR',
    texto: 'Revisión de vehículos de flota',
    opciones: null, api_id: 'vehiculos', api_campos: ['placa', 'marca', 'modelo'],
    orden: 3, requerido: true, activo: true, puntaje: 25, created_at: ''
  },
  {
    id: 'it-h1', modulo_id: 'm2', tipo: 'CUMPLE_NO_CUMPLE', padre_id: 'it-sec1',
    texto: 'Chapa y pintura en buen estado', opciones: null, orden: 1, requerido: true, activo: true, created_at: ''
  },
  {
    id: 'it-h2', modulo_id: 'm2', tipo: 'CUMPLE_NO_CUMPLE', padre_id: 'it-sec1',
    texto: 'Extintor vigente y accesible', opciones: null, orden: 2, requerido: true, activo: true, created_at: ''
  },
  {
    id: 'it-h3', modulo_id: 'm2', tipo: 'CHECKLIST', padre_id: 'it-sec1',
    texto: 'Kit de herramientas y elementos de seguridad completo',
    opciones: [
      { id: 'k1', etiqueta: 'Gato hidráulico' },
      { id: 'k2', etiqueta: 'Conos de señalización' },
      { id: 'k3', etiqueta: 'Linterna de emergencia' }
    ],
    orden: 3, requerido: true, activo: true, created_at: ''
  },
  {
    id: 'it-n1', modulo_id: 'm3', tipo: 'CUMPLE_NO_CUMPLE',
    texto: 'Extintor de emergencia con carga y placa vigente',
    opciones: null, responsables: ['Seguridad'], orden: 1, requerido: true, activo: true, puntaje: 8, created_at: ''
  },
  {
    id: 'it-n2', modulo_id: 'm3', tipo: 'CHECKLIST',
    texto: 'Señalización de áreas de riesgo',
    opciones: [
      { id: 'n1', etiqueta: 'Zona de carga señalizada', puntos: 1 },
      { id: 'n2', etiqueta: 'Salidas de emergencia identificadas', puntos: 1 },
      { id: 'n3', etiqueta: 'Botiquín de primeros auxilios visible', puntos: 1 }
    ],
    responsables: ['Seguridad'], orden: 2, requerido: true, activo: true, puntaje: 10, created_at: ''
  }
]

const evaluacion: VistaEvaluacion = {
  id: 'ev1', offline_uuid: 'ou1', sucursal_id: 's1', aperturada_por: 'p1',
  fecha: '2026-09-10', estado: 'CERRADA', puntuacion: 76,
  comentario_general: 'Se observa buena disposición general del equipo. Es prioritario reforzar los sellos de cámaras y la reposición de extintores en flota.',
  abierta_en: '2026-09-10T08:00:00', cerrada_en: '2026-09-10T11:30:00', created_at: '2026-09-10T08:00:00',
  sucursal: {
    id: 's1', nombre: 'Sucursal Centro', shop_id: '102', branch_id: null,
    direccion: 'Av. Bolívar Nº 120, Cagua'
  },
  aperturador: { id: 'p1', nombre: 'María Pérez' }
}

const respuestas: Respuesta[] = [
  {
    id: 'r1', evaluacion_id: 'ev1', item_id: 'it-cn1', instancia_id: null,
    valor: { value: true, evidencias: [{ photoIds: ['f1', 'f2'], comentario: 'Cronograma exhibido junto al mesón de preparación.' }] },
    respondido_por: 'p1', created_at: ''
  },
  {
    id: 'r2', evaluacion_id: 'ev1', item_id: 'it-cl1', instancia_id: null,
    valor: {
      selected: ['o1', 'o4'],
      informativos: ['o5'],
      valores: { o4: -21 },
      evidencias: { o1: { photoIds: ['f3'] } }
    },
    respondido_por: 'p1', created_at: ''
  },
  {
    id: 'r3', evaluacion_id: 'ev1', item_id: 'it-co1', instancia_id: null,
    valor: {
      productos: [
        { sku: 'SKU0001', nombre: 'Harina de trigo 1kg', teorica: 24, fisica: 22, soh: 22, lastSync: '2026-09-08T10:00:00', finalBase: 1.85 },
        { sku: 'SKU0042', nombre: 'Aceite maíz 1L', teorica: 40, fisica: 40, soh: 41 },
        { sku: 'SKU0117', nombre: 'Azúcar 1kg', teorica: 18, fisica: 18 },
        { sku: 'SKU0230', nombre: 'Arroz 5kg', teorica: 12, fisica: 10, lastSync: '2026-09-08T10:05:00', finalBase: 7.5 }
      ]
    },
    respondido_por: 'p1', created_at: ''
  },
  {
    id: 'r4', evaluacion_id: 'ev1', item_id: 'it-lc1', instancia_id: null,
    valor: {
      colaboradores: [
        { dni: 12345678, name: 'Pedro', lastname: 'Gómez', role_name: 'Cajero', aplica: true, active: true, selected: ['r1', 'r2', 'r3'] },
        { dni: 11223344, name: 'Luisa', lastname: 'Ramírez', role_name: 'Repositor', aplica: true, active: true, selected: ['r1', 'r2'] },
        { dni: 99887766, name: 'Jorge', lastname: 'Paz', role_name: 'Carnicero', aplica: false, active: true, selected: [] },
        { dni: 55667788, name: 'Ana', lastname: 'Torres', role_name: 'Atención al cliente', aplica: true, active: true, selected: [] }
      ]
    },
    respondido_por: 'p1', created_at: ''
  },
  {
    id: 'r5', evaluacion_id: 'ev1', item_id: 'it-uc1', instancia_id: null,
    valor: {
      unidades: [
        { codigo: 'PAT-01', selected: ['u1', 'u2', 'u3'] },
        { codigo: 'PAT-02', selected: ['u1'] },
        { codigo: 'PAT-03', selected: ['u1', 'u2', 'u3'] }
      ]
    },
    respondido_por: 'p1', created_at: ''
  },
  {
    id: 'r6', evaluacion_id: 'ev1', item_id: 'it-h1', instancia_id: 'in1',
    valor: { value: true, evidencias: [{ photoIds: [], comentario: 'Sin daños visibles.' }] },
    respondido_por: 'p1', created_at: ''
  },
  {
    id: 'r7', evaluacion_id: 'ev1', item_id: 'it-h2', instancia_id: 'in1',
    valor: { value: false, evidencias: [{ photoIds: ['f4'], comentario: 'Vencido desde agosto.' }] },
    respondido_por: 'p1', created_at: ''
  },
  {
    id: 'r8', evaluacion_id: 'ev1', item_id: 'it-h3', instancia_id: 'in1',
    valor: { selected: ['k1', 'k2'], evidencias: {} },
    respondido_por: 'p1', created_at: ''
  },
  {
    id: 'r9', evaluacion_id: 'ev1', item_id: 'it-h1', instancia_id: 'in2',
    valor: { value: false, evidencias: [{ photoIds: [], comentario: '' }] },
    respondido_por: 'p1', created_at: ''
  },
  {
    id: 'r10', evaluacion_id: 'ev1', item_id: 'it-h2', instancia_id: 'in2',
    valor: { value: true, evidencias: [{ photoIds: [], comentario: '' }] },
    respondido_por: 'p1', created_at: ''
  },
  {
    id: 'r11', evaluacion_id: 'ev1', item_id: 'it-h3', instancia_id: 'in2',
    valor: { selected: ['k1', 'k2', 'k3'], evidencias: {} },
    respondido_por: 'p1', created_at: ''
  },
  {
    id: 'r12', evaluacion_id: 'ev1', item_id: 'it-n1', instancia_id: null,
    valor: { value: true, evidencias: [] },
    respondido_por: 'p1', created_at: ''
  },
  {
    id: 'r13', evaluacion_id: 'ev1', item_id: 'it-n2', instancia_id: null,
    valor: { selected: ['n1', 'n2', 'n3'], evidencias: {} },
    respondido_por: 'p1', created_at: ''
  }
]

const instancias = [
  { id: 'in1', evaluacion_id: 'ev1', item_id: 'it-sec1', etiqueta: 'AA579AC — Renault Clio', orden: 1, api_id: 'vehiculos', datos: { placa: 'AA579AC', marca: 'Renault', modelo: 'Clio' }, created_at: '' },
  { id: 'in2', evaluacion_id: 'ev1', item_id: 'it-sec1', etiqueta: 'BB123CD — Toyota Corolla', orden: 2, api_id: 'vehiculos', datos: { placa: 'BB123CD', marca: 'Toyota', modelo: 'Corolla' }, created_at: '' }
]

const detalle: DetalleEvaluacion = {
  evaluacion,
  respuestas,
  items,
  modulos,
  fotos: [],
  sucursalOpciones: [],
  instancias
}

describe('preview del PDF de resultados', () => {
  it('genera el documento con todos los tipos de ítem y lo guarda', () => {
    const doc = buildPdfDocument(detalle)
    const bytes = new Uint8Array(doc.output('arraybuffer') as ArrayBuffer)
    const dir = join(tmpdir(), 'evaluxor-pdf')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'reporte-preview.pdf')
    writeFileSync(file, bytes)
    console.log('PDF generado:', file, '· páginas:', doc.getNumberOfPages())
    expect(bytes.length).toBeGreaterThan(2000)
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(3)
  })
})