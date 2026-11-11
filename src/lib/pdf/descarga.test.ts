import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { jsPDF } from 'jspdf'
import type { DetalleEvaluacion } from '../data/indicadores'

const obtenerEvaluacion = vi.fn()
const listarPerfilesSync = vi.fn()
const listarResponsables = vi.fn()
const tablasConsultadas: string[] = []
/** Nombres con los que se intentó guardar el archivo. */
const guardados: string[] = []

vi.mock('jspdf', async (importOriginal) => {
  const real = await importOriginal<typeof import('jspdf')>()
  // En `jspdf`, `save` se cuelga en cada instancia y cae a `fs.writeFileSync`
  // cuando no hay navegador: sin esto el test escribe un PDF en el disco.
  class JsPDFSinGuardar extends real.jsPDF {
    constructor(...args: ConstructorParameters<typeof real.jsPDF>) {
      super(...args)
      this.save = ((nombre?: string) => {
        guardados.push(nombre ?? '')
      }) as jsPDF['save']
    }
  }
  return { ...real, jsPDF: JsPDFSinGuardar }
})
vi.mock('../data/indicadores', async (importOriginal) => {
  const real = await importOriginal<typeof import('../data/indicadores')>()
  return { ...real, obtenerEvaluacion, listarPerfilesSync }
})
vi.mock('../data/responsables', () => ({ listarResponsables }))
vi.mock('../supabase', () => ({
  supabase: {
    from: (tabla: string) => {
      tablasConsultadas.push(tabla)
      // La consulta se arma en cadena y aquí no se ejecuta: la promesa tiene que
      // ser "entregable" para que `descargarInformePdf` la pueda esperar.
      const cadena = {
        select: () => cadena,
        eq: () => cadena,
        order: () => Promise.resolve({ data: [], error: null })
      }
      return cadena
    }
  }
}))

const { descargarInformePdf } = await import('./index')
const { TODOS_LOS_BLOQUES } = await import('./opciones')

const detalle: DetalleEvaluacion = {
  evaluacion: {
    id: '12345678-1234-1234-1234-123456789abc',
    sucursal_id: 's1',
    departamento_id: null,
    fecha: '2026-09-10',
    estado: 'CERRADA',
    puntuacion: 76,
    comentario_general: '',
    offline_uuid: '',
    aperturada_por: '',
    abierta_en: '2026-09-10T08:00:00',
    cerrada_en: '2026-09-10T11:30:00',
    created_at: '2026-09-10T08:00:00',
    // Con `branch_id` para que apliquen los dos catálogos: sin él, el de la
    // sucursal ni se pide y la prueba contaría menos llamadas de las que hay.
    sucursal: { id: 's1', nombre: 'Sucursal Centro', shop_id: '102', branch_id: '9', direccion: 'Av. Bolívar 120' },
    aperturador: null
  },
  respuestas: [],
  items: [],
  modulos: [],
  fotos: [],
  sucursalOpciones: [],
  instancias: []
}

beforeEach(() => {
  tablasConsultadas.length = 0
  guardados.length = 0
  obtenerEvaluacion.mockReset().mockResolvedValue(detalle)
  listarPerfilesSync.mockReset().mockResolvedValue({})
  listarResponsables.mockReset().mockResolvedValue({ responsables: [], mensaje: null })
})

describe('descarga del informe', () => {
  it('no pide incidencias ni catálogos de cargos si no se van a imprimir', async () => {
    await descargarInformePdf(detalle.evaluacion.id, undefined, {
      modulos: [],
      bloques: { cargosSucursal: false, cargosCentral: false, incidencias: false, compromiso: true }
    })

    // Tres pedidos que antes salían siempre y acá no sirven para nada: son el
    // costo de descargar "solo la hoja de compromiso".
    expect(tablasConsultadas).not.toContain('incidencias')
    expect(listarResponsables).not.toHaveBeenCalled()
    expect(guardados).toHaveLength(1)
  })

  it('con el bloque de incidencias apagado igual lo pide con el resto', async () => {
    await descargarInformePdf(detalle.evaluacion.id, undefined, {
      modulos: [],
      bloques: { ...TODOS_LOS_BLOQUES, incidencias: false }
    })

    expect(tablasConsultadas).not.toContain('incidencias')
    // Apagar las incidencias no puede llevarse por delante los cargos: el reparto
    // entre sucursal y central necesita los dos catálogos.
    expect(listarResponsables).toHaveBeenCalledTimes(2)
  })

  it('sin opciones los consulta todos, como antes del selector', async () => {
    await descargarInformePdf(detalle.evaluacion.id)

    expect(tablasConsultadas).toContain('incidencias')
    expect(listarResponsables).toHaveBeenCalledTimes(2)
    expect(guardados).toHaveLength(1)
  })

  it('el nombre del archivo sale de la sucursal y de la fecha', async () => {
    await descargarInformePdf(detalle.evaluacion.id)
    expect(guardados[0]).toBe('informe-sucursal-centro-2026-09-10.pdf')
  })

  it('falla claro cuando la evaluación ya no está', async () => {
    obtenerEvaluacion.mockResolvedValue(null)
    await expect(descargarInformePdf('no-existe')).rejects.toThrow('No se encontró la evaluación.')
    expect(guardados).toHaveLength(0)
  })
})