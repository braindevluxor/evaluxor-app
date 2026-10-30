import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { from: fromMock } }))

const {
  UMBRAL_AMONESTACION,
  UMBRAL_LLAMADO,
  nivelDeNota,
  unidadDeAlerta,
  mapaDeAlertas,
  filasDeAlertas,
  listarAlertas,
  registrarAlerta,
  marcarAtendida
} = await import('./alertasCargo')
import type { AlertaCargo } from './alertasCargo'
import type { SeguimientoResponsables } from './indicadores'

/**
 * DOS CAPAS, DOS TIPOS DE PRUEBA
 * ------------------------------
 * · `nivelDeNota` / `mapaDeAlertas` / `filasDeAlertas` son cálculo puro sobre
 *   la matriz: los umbrales, el cruce nivel ↔ registro y el orden del panel.
 * · `listarAlertas` / `registrarAlerta` / `marcarAtendida` son la red, con
 *   supabase mockeado: lo que se prueba es el payload y las guarda de
 *   transición, no Supabase.
 */

describe('nivelDeNota', () => {
  it('los cortes son exactamente 80 y 70, y el símbolo es «por debajo de»', () => {
    expect(UMBRAL_AMONESTACION).toBe(80)
    expect(UMBRAL_LLAMADO).toBe(70)
    expect(nivelDeNota(100)).toBeNull()
    expect(nivelDeNota(80)).toBeNull() // 80% exacto aún no es amonestación
    expect(nivelDeNota(79)).toBe('AMONESTACION')
    expect(nivelDeNota(70)).toBe('AMONESTACION') // 70% exacto sigue en amonestación
    expect(nivelDeNota(69)).toBe('LLAMADO')
    expect(nivelDeNota(0)).toBe('LLAMADO')
  })

  it('sin nota no hay nivel: no haber sido medido no es estar en alerta', () => {
    expect(nivelDeNota(null)).toBeNull()
  })
})

/** Fila de matriz a medida, con sólo lo que el cálculo mira. */
function fila(clave: string, cargo: string, porUnidad: Record<string, { logrado: number; posible: number }>) {
  const bases = Object.values(porUnidad)
  const logrado = bases.reduce((s, b) => s + b.logrado, 0)
  const posible = bases.reduce((s, b) => s + b.posible, 0)
  return {
    clave,
    cargo,
    nota: posible > 0 ? Math.round((logrado / posible) * 100) : null,
    logrado,
    posible,
    puntos: 0,
    evaluaciones: 1,
    unidades: Object.keys(porUnidad).length,
    ultima: '2026-01-15',
    porUnidad
  }
}

/** Matriz de prueba: Norte y Sur, tres cargos con notas distintas. */
function matriz(): SeguimientoResponsables {
  return {
    unidades: [
      { id: 'uN', nombre: 'Norte', puntos: 3, tipo: 'sucursal' },
      { id: 'uS', nombre: 'Sur', puntos: 1, tipo: 'sucursal' }
    ],
    filas: [
      fila('cajero', 'Cajero', { uN: { logrado: 75, posible: 100 }, uS: { logrado: 95, posible: 100 } }),
      fila('encargado', 'Encargado', { uN: { logrado: 90, posible: 100 } }),
      fila('depositaria', 'Depositaría', { uN: { logrado: 60, posible: 100 } })
    ],
    nota: 78,
    puntos: 70
  }
}

function alerta(extra: Partial<AlertaCargo>): AlertaCargo {
  return {
    id: 'a1',
    clave_cargo: 'cajero',
    cargo: 'Cajero',
    sucursal_id: 'uN',
    departamento_id: null,
    nivel: 'AMONESTACION',
    nota: 75,
    estado: 'PENDIENTE',
    atendida_en: null,
    atendida_por: null,
    created_at: '2026-01-10T10:00:00Z',
    ...extra
  }
}

describe('unidadDeAlerta', () => {
  it('manda el departamento cuando existe: una alerta nunca tiene las dos unidades', () => {
    const a = alerta({ sucursal_id: null, departamento_id: 'd1', departamento: { nombre: 'Contabilidad' } })
    expect(unidadDeAlerta(a)).toEqual({ id: 'd1', nombre: 'Contabilidad' })
  })

  it('una alerta de sucursal toma el nombre del embed, con su defecto si vino sin él', () => {
    expect(unidadDeAlerta(alerta({ sucursal: { nombre: 'Norte' } }))).toEqual({ id: 'uN', nombre: 'Norte' })
    expect(unidadDeAlerta(alerta({ sucursal: null }))).toEqual({ id: 'uN', nombre: 'Sucursal' })
  })
})

describe('mapaDeAlertas', () => {
  it('con pendiente y atendida para la misma clave manda la pendiente, en el orden que venga', () => {
    const pendiente = alerta({ id: 'ap', estado: 'PENDIENTE' })
    const atendida = alerta({ id: 'aa', estado: 'ATENDIDA' })

    expect(mapaDeAlertas([pendiente, atendida]).get('cajero|uN')?.id).toBe('ap')
    expect(mapaDeAlertas([atendida, pendiente]).get('cajero|uN')?.id).toBe('ap')
  })

  it('entre dos atendidas gana la más nueva (viene primero desde listarAlertas)', () => {
    const vieja = alerta({ id: 'av', estado: 'ATENDIDA', created_at: '2026-01-01T00:00:00Z' })
    const nueva = alerta({ id: 'an', estado: 'ATENDIDA', created_at: '2026-02-01T00:00:00Z' })

    expect(mapaDeAlertas([nueva, vieja]).get('cajero|uN')?.id).toBe('an')
  })

  it('una alerta sin unidad no entra al mapa: no hay clave que armar', () => {
    expect(mapaDeAlertas([alerta({ sucursal_id: null, departamento_id: null })]).size).toBe(0)
  })
})

describe('filasDeAlertas', () => {
  it('sólo cruza cargos × unidades que están en nivel o tienen registro', () => {
    const filas = filasDeAlertas(matriz(), [])

    // Cajero 75% en Norte (amonestación) y Depositaría 60% (llamado) entran;
    // Cajero 95% en Sur y Encargado 90% en Norte no piden nada.
    expect(filas.map((f) => `${f.clave}|${f.unidadId}`)).toEqual(['depositaria|uN', 'cajero|uN'])
    expect(filas[0].nivel).toBe('LLAMADO')
    expect(filas[1].nivel).toBe('AMONESTACION')
    expect(filas[1].unidadTipo).toBe('sucursal')
  })

  it('una celda ya mejorada conserva su registro en el panel, ahora sin nivel', () => {
    const filas = filasDeAlertas(matriz(), [
      alerta({ clave_cargo: 'cajero', sucursal_id: 'uS', nota: 70 })
    ])

    const filaMejorada = filas.find((f) => f.clave === 'cajero' && f.unidadId === 'uS')
    expect(filaMejorada?.nota).toBe(95)
    expect(filaMejorada?.nivel).toBeNull()
    expect(filaMejorada?.registro?.estado).toBe('PENDIENTE')
  })

  it('una alerta cuya unidad hoy no está en la matriz no se pierde del panel', () => {
    const filas = filasDeAlertas(matriz(), [
      alerta({ clave_cargo: 'chofer', cargo: 'Chofer', sucursal_id: 'uX', sucursal: { nombre: 'Cerrada' } })
    ])

    const fila = filas.find((f) => f.clave === 'chofer')
    expect(fila?.unidadNombre).toBe('Cerrada')
    expect(fila?.nota).toBeNull()
    expect(fila?.nivel).toBeNull()
    expect(fila?.registro?.estado).toBe('PENDIENTE')
  })

  it('ordena lo peor primero, sin nota al final y pendiente antes que atendida entre iguales', () => {
    const filas = filasDeAlertas(matriz(), [
      // Encargado mejoró a 90 pero su celda de Sur quedó con alerta pendiente...
      alerta({ clave_cargo: 'encargado', sucursal_id: 'uS', estado: 'PENDIENTE' }),
      // ...y una alerta huérfana (unidad fuera de la matriz) ya atendida.
      alerta({ id: 'a2', clave_cargo: 'otro', cargo: 'Otro', sucursal_id: 'uY', estado: 'ATENDIDA' })
    ])

    expect(filas.map((f) => f.clave)).toEqual(['depositaria', 'cajero', 'encargado', 'otro'])
    expect(filas[3].registro?.estado).toBe('ATENDIDA')
  })
})

// ---------------------------------------------------------------------------
// La red
// ---------------------------------------------------------------------------

beforeEach(() => {
  fromMock.mockReset()
})

describe('listarAlertas', () => {
  it('pide los tres embeds y ordena de más nueva a más vieja (de ahí sale la vigente)', async () => {
    const order = vi.fn().mockResolvedValue({ data: [], error: null })
    const select = vi.fn().mockReturnValue({ order })
    fromMock.mockReturnValue({ select })

    await listarAlertas()

    expect(fromMock).toHaveBeenCalledWith('alertas_cargo')
    expect(String(select.mock.calls[0][0])).toContain('atendida:atendida_por(nombre)')
    expect(String(select.mock.calls[0][0])).toContain('sucursal:sucursales(nombre)')
    expect(String(select.mock.calls[0][0])).toContain('departamento:departamentos_centralizados(nombre)')
    expect(order).toHaveBeenCalledWith('created_at', { ascending: false })
  })

  it('un error de red se vuelve excepción: la pantalla tiene que decir que no sabe', async () => {
    const order = vi.fn().mockResolvedValue({ data: null, error: { message: 'se cayó' } })
    fromMock.mockReturnValue({ select: () => ({ order }) })

    await expect(listarAlertas()).rejects.toThrow('se cayó')
  })
})

describe('registrarAlerta', () => {
  it('una alerta de sucursal lleva sucursal_id y departamento_id en null (y al revés)', async () => {
    const insertado: Record<string, unknown>[] = []
    fromMock.mockImplementation(() => ({
      insert: (payload: Record<string, unknown>) => {
        insertado.push(payload)
        return { error: null }
      }
    }))

    await registrarAlerta({ clave: 'cajero', cargo: 'Cajero', unidadId: 'uN', unidadTipo: 'sucursal', nivel: 'AMONESTACION', nota: 75 })
    await registrarAlerta({ clave: 'cont', cargo: 'Contador', unidadId: 'd1', unidadTipo: 'departamento', nivel: 'LLAMADO', nota: 62 })

    expect(insertado[0]).toEqual({
      clave_cargo: 'cajero',
      cargo: 'Cajero',
      sucursal_id: 'uN',
      departamento_id: null,
      nivel: 'AMONESTACION',
      nota: 75
    })
    expect(insertado[1].sucursal_id).toBeNull()
    expect(insertado[1].departamento_id).toBe('d1')
  })

  it('la carrera de dos pantallas (23505, clave pendiente ya creada) no es error', async () => {
    fromMock.mockReturnValue({ insert: () => ({ error: { message: 'duplicate key', code: '23505' } }) })

    await expect(
      registrarAlerta({ clave: 'cajero', cargo: 'Cajero', unidadId: 'uN', unidadTipo: 'sucursal', nivel: 'AMONESTACION', nota: 75 })
    ).resolves.toBeUndefined()
  })

  it('cualquier otro error sí se propaga', async () => {
    fromMock.mockReturnValue({ insert: () => ({ error: { message: 'rol insuficiente' } }) })

    await expect(
      registrarAlerta({ clave: 'cajero', cargo: 'Cajero', unidadId: 'uN', unidadTipo: 'sucursal', nivel: 'AMONESTACION', nota: 75 })
    ).rejects.toThrow('rol insuficiente')
  })
})

describe('marcarAtendida', () => {
  it('sólo transiciona alertas PENDIENTES y guarda fecha, quién y el estado nuevo', async () => {
    const llamadas: { update: Record<string, unknown>; eq: unknown[][] } = { update: {}, eq: [] }
    const segundaEq = {
      eq: (col: string, valor: unknown) => {
        llamadas.eq.push([col, valor])
        return { error: null }
      }
    }
    fromMock.mockImplementation(() => ({
      update: (payload: Record<string, unknown>) => {
        llamadas.update = payload
        return {
          eq: (col: string, valor: unknown) => {
            llamadas.eq.push([col, valor])
            return segundaEq
          }
        }
      }
    }))

    await marcarAtendida('a1', 'p9')

    expect(llamadas.update.estado).toBe('ATENDIDA')
    expect(llamadas.update.atendida_por).toBe('p9')
    expect(String(llamadas.update.atendida_en)).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    // La segunda guarda es la que impide re-atender (y pisar) una alerta ya atendida.
    expect(llamadas.eq).toEqual([
      ['id', 'a1'],
      ['estado', 'PENDIENTE']
    ])
  })

  it('un error de red se vuelve excepción', async () => {
    fromMock.mockReturnValue({
      update: () => ({ eq: () => ({ eq: () => ({ error: { message: 'permiso denegado' } }) }) })
    })

    await expect(marcarAtendida('a1', 'p9')).rejects.toThrow('permiso denegado')
  })
})
