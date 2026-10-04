import { describe, expect, it } from 'vitest'
import {
  buildPdfDocument,
  clasificarResultadosCargos,
  filtrarDetallePdf,
  type IncidenciaPdf
} from './index'
import type { DetalleEvaluacion } from '../data/indicadores'
import type { ValorResponsable } from '../scoring'
import type { Item, Modulo, Respuesta, VistaEvaluacion } from '../types'
import { veredictoItem } from '../scoring'

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
    respondido_por: 'p2', created_at: ''
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

describe('informe imprimible de resultados', () => {
  it('separa resultados entre cargos de sucursal y central, del mayor porcentaje al menor', () => {
    const resultados: ValorResponsable[] = [
      { responsable: 'Cajero', items: 1, posible: 10, logrado: 8, porciento: 80 },
      { responsable: 'Gerente', items: 1, posible: 10, logrado: 10, porciento: 100 },
      { responsable: 'Mantenimiento', items: 1, posible: 10, logrado: 5, porciento: 50 },
      { responsable: 'Cargo manual', items: 1, posible: 10, logrado: 9, porciento: 90 }
    ]
    const grupos = clasificarResultadosCargos(
      resultados,
      [{ departamento: 'Tienda', cargo: 'Cajero' }, { departamento: 'Tienda', cargo: 'Gerente' }],
      [{ departamento: 'Central', cargo: 'Mantenimiento' }]
    )

    expect(grupos.sucursal.map(({ responsable }) => responsable)).toEqual(['Gerente', 'Cajero'])
    expect(grupos.central.map(({ responsable }) => responsable)).toEqual(['Mantenimiento'])
    expect([...grupos.sucursal, ...grupos.central].some(({ responsable }) => responsable === 'Cargo manual')).toBe(false)
  })

  it('muestra solo cargos clasificados y sustituye logrado/posible por puntos incumplidos', () => {
    const detalleConCargo: DetalleEvaluacion = {
      ...detalle,
      respuestas: [{
        id: 'fallo-gerencia',
        evaluacion_id: 'ev1',
        item_id: 'it-cn1',
        instancia_id: null,
        valor: { value: false, evidencias: [], responsables: ['Gerencia'] },
        respondido_por: 'p1',
        created_at: ''
      }]
    }
    const output = buildPdfDocument(
      detalleConCargo,
      undefined,
      {},
      [],
      {
        sucursal: [],
        central: [{ departamento: 'Central', cargo: 'Gerencia' }]
      }
    ).output()

    expect(output).toContain('Puntos incumplidos')
    expect(output).not.toContain('Logrado')
    expect(output).not.toContain('Posible')
    expect(output).not.toContain('Cargos sin clasificar')
  })

  it('genera un PDF A4 monocromo con portada, puntajes y resultados', () => {
    const detalleConCodigo: DetalleEvaluacion = {
      ...detalle,
      evaluacion: {
        ...evaluacion,
        id: '12345678-1234-1234-1234-123456789abc'
      }
    }
    const pdf = buildPdfDocument(detalleConCodigo, undefined, {
      p1: { nombre: 'María Pérez', rol: 'LIDER' },
      p2: { nombre: 'Carlos Gómez', rol: 'EVALUADOR' }
    })
    const output = pdf.output()
    expect(output).toContain('%PDF-')
    expect(pdf.internal.pageSize.getWidth()).toBeCloseTo(210)
    expect(pdf.internal.pageSize.getHeight()).toBeCloseTo(297)
    expect(pdf.getNumberOfPages()).toBeGreaterThanOrEqual(2)
    expect(output).toContain('Puntuación general')
    expect(output).toContain('Código de evaluación')
    expect(output).toContain('12345678-1234-****-****-123456789abc')
    expect(output).not.toContain('Evaluador responsable')
    expect(output).not.toContain('Evaluación de sucursal')
    expect(output).not.toContain('Euromaxx Villas de Aragua')
    expect(output).toContain('Personal evaluador')
    expect(output).toContain('2 usuarios subieron información.')
    expect(output).toContain('Carlos Gómez')
    expect(output).toContain('Evaluador')
    expect(output).toContain('Líder')
    expect(output).toContain('Firma')
    expect(output).toContain('Gerente de Talento Humano')
    expect(output).toContain('Gerente Corporativo')
    expect(output).toContain('Puntaje final por módulo')
    expect(output).toContain('Higiene y salubridad')
    expect(output).toContain('Equipos de refrigeración en condiciones operativas')
    expect(output).toContain('Pérdida estimada')
    expect(output).toContain('Pérdida estimada por faltantes')
  })

  it('muestra solo el porcentaje de conciliación y oculta los IDs de sucursal y central', () => {
    const detalleConBranchId: DetalleEvaluacion = {
      ...detalle,
      evaluacion: {
        ...evaluacion,
        sucursal: { ...evaluacion.sucursal!, branch_id: '9' }
      }
    }
    const output = buildPdfDocument(detalleConBranchId).output()

    expect(output).not.toContain('% concilia')
    expect(output).not.toContain('ID 9')
    expect(output).not.toContain('ID 5')
  })

  it.each(['ambos', 'cumple', 'no-cumple'] as const)('filtra las respuestas del PDF según el selector %s', (filtro) => {
    const resultado = filtrarDetallePdf(detalle, filtro)
    const veredictos = resultado.respuestas.map((respuesta) => {
      const item = items.find((candidato) => candidato.id === respuesta.item_id)!
      return veredictoItem(item, respuesta.valor)
    })

    expect(veredictos).toHaveLength(resultado.respuestas.length)
    expect(veredictos.every((veredicto) => filtro === 'ambos'
      ? veredicto === 'cumple' || veredicto === 'no-cumple'
      : veredicto === filtro)).toBe(true)
    expect(resultado.modulos.every((modulo) => resultado.respuestas.some((respuesta) =>
      items.some((item) => item.id === respuesta.item_id && item.modulo_id === modulo.id)
    ))).toBe(true)
    expect(resultado.instancias.every((instancia) => resultado.respuestas.some((respuesta) =>
      respuesta.instancia_id === instancia.id
    ))).toBe(true)
  })

  it.each(['ambos', 'cumple', 'no-cumple'] as const)('genera PDF filtrado en modo %s', (filtro) => {
    const output = buildPdfDocument(detalle, filtro).output()
    expect(output).toContain('Filtro del informe')
    expect(output).toContain('%PDF-')
  })

  it('no incluye fotos ni códigos QR en el PDF', () => {
    const detalleConRutas: DetalleEvaluacion = {
      ...detalle,
      respuestas: respuestas.map((respuesta) => respuesta.item_id === 'it-cn1'
        ? {
            ...respuesta,
            valor: {
              value: true,
              evidencias: [{ paths: ['ev/evaluacion/evidencia/foto.jpg'], comentario: 'Evidencia subida' }]
            }
          }
        : respuesta)
    }

    const output = buildPdfDocument(detalleConRutas, 'cumple').output()
    expect(output).not.toContain('ev/evaluacion/evidencia/foto.jpg')
    expect(output).toContain('Evidencia subida')
  })

  it('usa tabla para checklist y ordena primero las opciones cumplidas, sin fotos', () => {
    const detalleConFotosChecklist: DetalleEvaluacion = {
      ...detalle,
      respuestas: respuestas.map((respuesta) => respuesta.item_id === 'it-cl1'
        ? {
            ...respuesta,
            valor: {
              selected: ['o2', 'o1'],
              informativos: ['o5'],
              valores: { o4: -21 },
              evidencias: {
                o1: { paths: ['ev/ev1/evidencia/check-ok.jpg'] },
                o2: { paths: ['ev/ev1/evidencia/check-ok-2.jpg'] },
                o3: { paths: ['ev/ev1/evidencia/check-fail.jpg'] }
              }
            }
          }
        : respuesta)
    }

    const output = buildPdfDocument(detalleConFotosChecklist).output()
    const firstCheck = output.indexOf('Estructura de cámaras en buen estado')
    const firstFail = output.indexOf('Limpieza interior de cámaras')
    expect(firstCheck).toBeGreaterThan(-1)
    expect(firstCheck).toBeLessThan(firstFail)
    expect(output).toContain('Descripción')
    expect(output).not.toContain('check-ok.jpg')
  })

  it('mantiene comentarios largos en el PDF sin desbordar páginas', () => {
    const detalleLargo: DetalleEvaluacion = {
      ...detalle,
      respuestas: respuestas.map((respuesta) => respuesta.item_id === 'it-cn1'
        ? {
            ...respuesta,
            valor: {
              value: true,
              evidencias: [{ paths: [], comentario: `<Observación detallada ${'nota '.repeat(900)}>` }]
            }
          }
        : respuesta)
    }

    const pdf = buildPdfDocument(detalleLargo, 'cumple')
    const output = pdf.output()
    expect(output).toContain('Observación detallada')
    expect(pdf.getNumberOfPages()).toBeGreaterThanOrEqual(2)
  })

  it('agrega al final una hoja con incidencias, descripciones y responsables', () => {
    const incidencias: IncidenciaPdf[] = [
      { descripcion: 'Fuga en el área de refrigeración', responsables: [{ cargo: 'Mantenimiento', porValidar: false }] },
      { descripcion: 'Falta señalización en depósito', responsables: [] }
    ]
    const pdf = buildPdfDocument(detalle, undefined, {}, incidencias)
    const output = pdf.output()

    expect(pdf.getNumberOfPages()).toBeGreaterThanOrEqual(3)
    expect(output).toContain('Incidencias registradas')
    expect(output).toContain('Fuga en el área de refrigeración')
    expect(output).toContain('Mantenimiento')
    expect(output).toContain('Falta señalización en depósito')
    expect(output).toContain('Descripción')
    expect(output).toContain('Responsable')
  })

  it('mantiene títulos largos en líneas separadas sin cortar el nombre del módulo', () => {
    const detalleTituloLargo: DetalleEvaluacion = {
      ...detalle,
      modulos: [{
        ...modulos[0],
        nombre: 'Módulo de cumplimiento operativo y estándares generales de seguridad de sucursal'
      }]
    }
    const output = buildPdfDocument(detalleTituloLargo).output()
    expect(output).toContain('Módulo de cumplimiento operativo')
    expect(output).toContain('estándares generales de seguridad')
    expect(output).toContain('Cargos de la sucursal')
  })

  it('indica en la hoja final cuando no hay incidencias registradas', () => {
    const pdf = buildPdfDocument(detalle)
    const output = pdf.output()
    expect(output).toContain('No hay incidencias registradas para esta evaluación.')
    expect(output).toContain('Incidencias registradas')
  })

  it('ubica los cargos de central en una página independiente', () => {
    const pdf = buildPdfDocument(detalle)
    const paginas = (pdf.internal.pages as unknown as Array<string[] | undefined>)
      .filter((pagina): pagina is string[] => Array.isArray(pagina))
    const paginaSucursal = paginas.findIndex((pagina) => pagina.join('').includes('Cargos de la sucursal'))
    const paginaCentral = paginas.findIndex((pagina) => pagina.join('').includes('Cargos de central'))

    expect(paginaSucursal).toBeGreaterThan(-1)
    expect(paginaCentral).toBeGreaterThan(paginaSucursal)
  })
})