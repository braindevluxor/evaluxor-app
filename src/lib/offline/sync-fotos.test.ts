import { beforeEach, describe, expect, it, vi } from 'vitest'
import { guardarBorradorNube } from './sync'

const { fromMock, rpcMock, uploadMock, getPhotosMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
  uploadMock: vi.fn(),
  getPhotosMock: vi.fn()
}))

vi.mock('../supabase', () => ({
  supabase: {
    from: fromMock,
    rpc: rpcMock,
    storage: { from: () => ({ upload: uploadMock }) }
  }
}))

vi.mock('./db', () => ({
  deleteDraft: vi.fn(),
  getPhotos: getPhotosMock,
  deletePhoto: vi.fn(),
  listQueue: vi.fn(),
  putJob: vi.fn(),
  deleteJob: vi.fn(),
  respuestasConInstancia: vi.fn(),
  incidentesPendientes: vi.fn(),
  eliminarIncidente: vi.fn()
}))

const RUTA = 'ev/evaluacion-1/evidencia/foto-local-1.jpg'
const RUTA_REINTENTO = 'ev/evaluacion-reintento/evidencia/foto-local-1.jpg'

beforeEach(() => {
  fromMock.mockReset()
  rpcMock.mockReset()
  uploadMock.mockReset().mockResolvedValue({ error: null })
  getPhotosMock.mockReset().mockResolvedValue([
    { id: 'foto-local-1', mime: 'image/jpeg', blob: new Blob(['foto']), created_at: 1 }
  ])
  rpcMock.mockImplementation((nombre: string, args?: { rows?: unknown[] }) => {
    if (nombre === 'upsert_respuestas') {
      return Promise.resolve({ error: null, data: args?.rows })
    }
    return Promise.resolve({ error: null, data: null })
  })
  fromMock.mockImplementation((tabla: string) => {
    if (tabla === 'instancias_grupo') return { upsert: () => Promise.resolve({ error: null }) }
    throw new Error(`tabla inesperada: ${tabla}`)
  })
})

describe('guardarBorradorNube · fotos', () => {
  it('sube la foto al bucket y guarda su ruta en una respuesta de Cumple/No cumple', async () => {
    await guardarBorradorNube('evaluacion-1', 'usuario-1', [{
      item_id: 'item-1',
      instancia_id: 'registro-1',
      valor: {
        value: false,
        evidencias: [{ comentario: 'Falla visible', photoIds: ['foto-local-1'] }]
      }
    }])

    expect(uploadMock).toHaveBeenCalledWith(
      RUTA,
      expect.any(Blob),
      { contentType: 'image/jpeg', upsert: false }
    )
    const filas = rpcMock.mock.calls.find(([nombre]) => nombre === 'upsert_respuestas')?.[1].rows
    expect(filas).toEqual([{
      evaluacion_id: 'evaluacion-1',
      item_id: 'item-1',
      instancia_id: 'registro-1',
      valor: {
        value: false,
        evidencias: [{ comentario: 'Falla visible', paths: [RUTA] }]
      },
      respondido_por: 'usuario-1'
    }])
  })

  it('acepta que una foto ya exista para los reintentos automáticos', async () => {
    uploadMock.mockResolvedValue({ error: { message: 'The resource already exists' } })

    await expect(guardarBorradorNube('evaluacion-reintento', 'usuario-1', [{
      item_id: 'item-1',
      instancia_id: null,
      valor: { selected: [], evidencias: { limpieza: { photoIds: ['foto-local-1'] } } }
    }])).resolves.toEqual({ item_ids: [], motivos: [] })

    const filas = rpcMock.mock.calls.find(([nombre]) => nombre === 'upsert_respuestas')?.[1].rows
    expect(uploadMock).toHaveBeenCalledWith(
      RUTA_REINTENTO,
      expect.any(Blob),
      { contentType: 'image/jpeg', upsert: false }
    )
    expect(filas[0].valor.evidencias.limpieza.paths).toEqual([RUTA_REINTENTO])
  })

  it('no guarda una ruta local inexistente como si fuera una foto sincronizada', async () => {
    getPhotosMock.mockResolvedValue([])

    await expect(guardarBorradorNube('evaluacion-foto-perdida', 'usuario-1', [{
      item_id: 'item-1',
      instancia_id: null,
      valor: { selected: [], evidencias: { limpieza: { photoIds: ['foto-perdida'] } } }
    }])).rejects.toThrow('No se encontró la foto local foto-perdida')

    expect(rpcMock).not.toHaveBeenCalledWith('upsert_respuestas', expect.anything())
  })
})
