import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { from: fromMock } }))

const {
  UMBRAL_AMONESTACION,
  UMBRAL_LLAMADO,
  nivelDeNota,
  unidadDeAlerta,
  claveAlerta,
  mapaDeAlertas,
  filasDeAlertas,
  filtrarFilas,
  gruposPorUnidad,
  listarAlertas,
  registrarAlerta,
  marcarAtendida
} = await import('./alertasCargo')
import type { AlertaCargo, FilaAlerta } from './alertasCargo'
import type { CeldaSeguimiento } from './seguimientoEvaluaciones'

/**
 * DOS CAPAS, DOS TIPOS DE PRUEBA
 * ------------------------------
 * · `nivelDeNota` / `mapaDeAlertas` / `filasDeAlertas` / `gruposPorUnidad` son
 *   cálculo puro sobre las celdas por evaluación: los umbrales, el cruce
 *   nivel ↔ registro y el orden del panel.
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

/** Celda del seguimiento, con sólo lo que el cálculo mira. */
function celda(
  clave: string,
  cargo: string,
  evaluacion_id: string,
  fecha: string,
  nota: number | null,
  unidad: { id: string; nombre: string; tipo: 'sucursal' | 'departamento' } = { id: 'uN', nombre: 'Norte', tipo: 'sucursal' }
): CeldaSeguimiento {
  return { evaluacion_id, fecha, unidad, clave, cargo, nota, puntos: 0 }
}

function alerta(extra: Partial<AlertaCargo>): AlertaCargo {
  return {
    id: 'a1',
    clave_cargo: 'cajero',
    cargo: 'Cajero',
    sucursal_id: 'uN',
    departamento_id: null,
    evaluacion_id: 'ev1',
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

describe('claveAlerta y mapaDeAlertas', () => {
  it('la clave incluye la evaluación: dos visitas del mismo cargo no se pisan', () => {
    expect(claveAlerta('cajero', 'uN', 'ev1')).toBe('cajero|uN|ev1')
    expect(claveAlerta('cajero', 'uN', 'ev2')).not.toBe(claveAlerta('cajero', 'uN', 'ev1'))
  })

  it('con pendiente y atendida para la misma celda manda la pendiente, en el orden que venga', () => {
    const pendiente = alerta({ id: 'ap', estado: 'PENDIENTE' })
    const atendida = alerta({ id: 'aa', estado: 'ATENDIDA' })

    expect(mapaDeAlertas([pendiente, atendida]).get('cajero|uN|ev1')?.id).toBe('ap')
    expect(mapaDeAlertas([atendida, pendiente]).get('cajero|uN|ev1')?.id).toBe('ap')
  })

  it('cada evaluación guarda su propio registro: la pendiente de ev2 no tapa la de ev1', () => {
    const deEv1 = alerta({ id: 'a-ev1', evaluacion_id: 'ev1', estado: 'ATENDIDA' })
    const deEv2 = alerta({ id: 'a-ev2', evaluacion_id: 'ev2', estado: 'PENDIENTE' })
    const mapa = mapaDeAlertas([deEv2, deEv1])

    expect(mapa.get('cajero|uN|ev1')?.id).toBe('a-ev1')
    expect(mapa.get('cajero|uN|ev1')?.estado).toBe('ATENDIDA')
    expect(mapa.get('cajero|uN|ev2')?.estado).toBe('PENDIENTE')
  })

  it('una alerta sin unidad no entra al mapa: no hay clave que armar', () => {
    expect(mapaDeAlertas([alerta({ sucursal_id: null, departamento_id: null })]).size).toBe(0)
  })
})

describe('filasDeAlertas', () => {
  it('sólo lista las celdas en nivel, lo peor primero', () => {
    const filas = filasDeAlertas(
      [
        celda('cajero', 'Cajero', 'ev1', '2026-03-15', 75),
        celda('depositaria', 'Depositaría', 'ev1', '2026-03-15', 60),
        celda('encargado', 'Encargado', 'ev1', '2026-03-15', 92)
      ],
      []
    )

    // Depositaría 60% (llamado) y Cajero 75% (amonestación) entran; Encargado
    // 92% no pide nada.
    expect(filas.map((f) => f.clave)).toEqual(['depositaria', 'cajero'])
    expect(filas[0].nivel).toBe('LLAMADO')
    expect(filas[1].nivel).toBe('AMONESTACION')
  })

  it('cada evaluación del mismo cargo es su propia fila, con su registro', () => {
    const filas = filasDeAlertas(
      [
        celda('cajero', 'Cajero', 'ev1', '2026-03-01', 65),
        celda('cajero', 'Cajero', 'ev2', '2026-03-15', 68)
      ],
      [alerta({ evaluacion_id: 'ev1', estado: 'ATENDIDA', atendida_en: '2026-03-05T10:00:00Z' })]
    )

    // Lo peor primero: la visita 1 (65%) va antes que la 2 (68%), y cada una
    // lleva SU registro — el de ev1 no tapa a ev2.
    expect(filas.map((f) => `${f.evaluacionId}:${f.registro?.estado ?? 'sin'}`)).toEqual([
      'ev1:ATENDIDA',
      'ev2:sin'
    ])
    // La de ev2 quedó limpia después de atender la de ev1: pide acción nueva.
    expect(filas[1].registro).toBeNull()
  })

  it('una celda cuya evaluación salió del conjunto no pierde su registro', () => {
    const filas = filasDeAlertas(
      [],
      [alerta({ clave_cargo: 'chofer', cargo: 'Chofer', sucursal_id: 'uX', sucursal: { nombre: 'Cerrada' } })]
    )

    expect(filas[0].unidadNombre).toBe('Cerrada')
    expect(filas[0].nota).toBeNull()
    expect(filas[0].nivel).toBeNull()
    expect(filas[0].registro?.estado).toBe('PENDIENTE')
  })

  it('ordena lo peor primero y pendiente antes que atendido entre notas iguales', () => {
    const filas = filasDeAlertas(
      [
        celda('cajero', 'Cajero', 'ev1', '2026-03-15', 60),
        celda('depositaria', 'Depositaría', 'ev1', '2026-03-15', 60),
        celda('encargado', 'Encargado', 'ev1', '2026-03-15', 40)
      ],
      [alerta({ clave_cargo: 'cajero', estado: 'ATENDIDA' })]
    )

    expect(filas.map((f) => f.clave)).toEqual(['encargado', 'depositaria', 'cajero'])
    expect(filas[1].registro).toBeNull()
    expect(filas[2].registro?.estado).toBe('ATENDIDA')
  })
})

describe('gruposPorUnidad', () => {
  it('agrupa por unidad y ordena las evaluaciones de más nueva a más vieja', () => {
    const grupos = gruposPorUnidad(
      filasDeAlertas(
        [
          celda('cajero', 'Cajero', 'ev1', '2026-03-01', 60),
          celda('cajero', 'Cajero', 'ev2', '2026-03-15', 55),
          celda('dep', 'Depositaría', 'ev3', '2026-03-10', 50, { id: 'uS', nombre: 'Sur', tipo: 'sucursal' })
        ],
        []
      )
    )

    expect(grupos.map((g) => g.nombre)).toEqual(['Norte', 'Sur'])
    expect(grupos[0].evaluaciones.map((e) => e.evaluacionId)).toEqual(['ev2', 'ev1'])
    expect(grupos[0].evaluaciones[0].filas[0].nota).toBe(55)
    expect(grupos[0].pendientes).toBe(2)
  })

  it('las unidades cuyos llamados ya fueron atendidos quedan debajo de las que siguen pidiendo acción', () => {
    const celdas = [
      celda('a', 'Atendido', 'ev1', '2026-03-01', 60, { id: 'uA', nombre: 'A', tipo: 'sucursal' }),
      celda('b', 'Pendiente', 'ev2', '2026-03-01', 60, { id: 'uB', nombre: 'B', tipo: 'sucursal' })
    ]

    // Sin registros las dos piden acción: empatan y manda el nombre.
    expect(gruposPorUnidad(filasDeAlertas(celdas, [])).map((g) => g.nombre)).toEqual(['A', 'B'])

    // Atendida la de A, la única que sigue esperando es B: va arriba.
    const conRegistro = gruposPorUnidad(
      filasDeAlertas(celdas, [alerta({ id: 'x', clave_cargo: 'a', sucursal_id: 'uA', evaluacion_id: 'ev1', estado: 'ATENDIDA' })])
    )
    expect(conRegistro.map((g) => g.nombre)).toEqual(['B', 'A'])
    expect(conRegistro[0].pendientes).toBe(1)
    expect(conRegistro[1].pendientes).toBe(0)
  })
})

describe('filtrarFilas', () => {
  const filaDe = (extra: Partial<FilaAlerta>): FilaAlerta => ({
    clave: 'cajero',
    cargo: 'Cajero',
    unidadId: 'uN',
    unidadNombre: 'Norte',
    unidadTipo: 'sucursal',
    evaluacionId: 'ev1',
    fecha: '2026-03-01',
    nota: 60,
    nivel: 'LLAMADO',
    registro: null,
    ...extra
  })
  const filas: FilaAlerta[] = [
    filaDe({}),
    filaDe({
      clave: 'encargado',
      cargo: 'Encargado de turno',
      unidadId: 'uS',
      unidadNombre: 'Sur',
      evaluacionId: 'ev2',
      registro: alerta({ id: 'a2', clave_cargo: 'encargado', estado: 'PENDIENTE' })
    }),
    filaDe({
      clave: 'depositaria',
      cargo: 'Depositaría',
      evaluacionId: 'ev3',
      nota: 90,
      nivel: null,
      registro: alerta({ id: 'a3', clave_cargo: 'depositaria', estado: 'ATENDIDA' })
    })
  ]

  it('«sin registrar» es la fila en nivel SIN registro, no la que tiene alerta pendiente', () => {
    // Confundir las dos cambiaría el sentido del contador del encabezado.
    expect(filtrarFilas(filas, { estado: 'sin_registrar' }).map((f) => f.clave)).toEqual(['cajero'])
    expect(filtrarFilas(filas, { estado: 'pendientes' }).map((f) => f.clave)).toEqual(['encargado'])
    expect(filtrarFilas(filas, { estado: 'atendidas' }).map((f) => f.clave)).toEqual(['depositaria'])
  })

  it('la búsqueda es contra el cargo, normalizada y sin importar mayúsculas ni tildes', () => {
    expect(filtrarFilas(filas, { busqueda: 'deposita' }).map((f) => f.clave)).toEqual(['depositaria'])
    expect(filtrarFilas(filas, { busqueda: 'de turno' }).map((f) => f.clave)).toEqual(['encargado'])
    expect(filtrarFilas(filas, { busqueda: 'CAJERO' }).map((f) => f.clave)).toEqual(['cajero'])
  })

  it('el filtro de unidad recorta a esa unidad y sin filtro queda todo', () => {
    expect(filtrarFilas(filas, { unidadId: 'uN' }).map((f) => f.clave)).toEqual(['cajero', 'depositaria'])
    expect(filtrarFilas(filas)).toHaveLength(3)
  })
})

// ---------------------------------------------------------------------------
// La red
// ---------------------------------------------------------------------------

beforeEach(() => {
  fromMock.mockReset()
})

describe('listarAlertas', () => {
  it('pide los embeds —incluidos los trabajadores— y ordena de más nueva a más vieja', async () => {
    const order = vi.fn().mockResolvedValue({ data: [], error: null })
    const select = vi.fn().mockReturnValue({ order })
    fromMock.mockReturnValue({ select })

    await listarAlertas()

    expect(fromMock).toHaveBeenCalledWith('alertas_cargo')
    expect(String(select.mock.calls[0][0])).toContain('atendida:atendida_por(nombre)')
    expect(String(select.mock.calls[0][0])).toContain('sucursal:sucursales(nombre)')
    expect(String(select.mock.calls[0][0])).toContain('departamento:departamentos_centralizados(nombre)')
    expect(String(select.mock.calls[0][0])).toContain('trabajadores:alerta_trabajadores(nacionalidad, dni, nombre)')
    expect(order).toHaveBeenCalledWith('created_at', { ascending: false })
  })

  it('un error de red se vuelve excepción: la pantalla tiene que decir que no sabe', async () => {
    const order = vi.fn().mockResolvedValue({ data: null, error: { message: 'se cayó' } })
    fromMock.mockReturnValue({ select: () => ({ order }) })

    await expect(listarAlertas()).rejects.toThrow('se cayó')
  })
})

/** La cadena de la inserción: `.insert(...).select('id').single()`. */
function mockInsercion(
  respuesta: { data?: unknown; error?: unknown },
  capturar?: (tabla: string, payload: Record<string, unknown> | Record<string, unknown>[]) => void
) {
  fromMock.mockImplementation((tabla: string) => ({
    insert: (payload: Record<string, unknown> | Record<string, unknown>[]) => {
      capturar?.(tabla, payload)
      return {
        select: () => ({ single: () => Promise.resolve(respuesta) })
      }
    }
  }))
}

describe('registrarAlerta', () => {
  it('una alerta de sucursal lleva sucursal_id y departamento_id en null (y al revés)', async () => {
    const insertados: { tabla: string; payload: unknown }[] = []
    mockInsercion({ data: { id: 'a9' }, error: null }, (tabla, payload) => insertados.push({ tabla, payload }))

    await registrarAlerta({ clave: 'cajero', cargo: 'Cajero', unidadId: 'uN', unidadTipo: 'sucursal', evaluacionId: 'ev7', nivel: 'AMONESTACION', nota: 75 })
    await registrarAlerta({ clave: 'cont', cargo: 'Contador', unidadId: 'd1', unidadTipo: 'departamento', evaluacionId: 'ev8', nivel: 'LLAMADO', nota: 62 })

    const deSucursal = insertados[0].payload
    expect(deSucursal).toEqual({
      clave_cargo: 'cajero',
      cargo: 'Cajero',
      sucursal_id: 'uN',
      departamento_id: null,
      evaluacion_id: 'ev7',
      nivel: 'AMONESTACION',
      nota: 75
    })
    const deDepartamento = insertados[1].payload as Record<string, unknown>
    expect(deDepartamento.sucursal_id).toBeNull()
    expect(deDepartamento.departamento_id).toBe('d1')
    expect(deDepartamento.evaluacion_id).toBe('ev8')
  })

  it('los trabajadores elegidos quedan guardados contra ESA alerta', async () => {
    const insertados: { tabla: string; payload: unknown }[] = []
    mockInsercion({ data: { id: 'a-nueva' }, error: null }, (tabla, payload) => insertados.push({ tabla, payload }))

    await registrarAlerta({
      clave: 'cajero',
      cargo: 'Cajero integral',
      unidadId: 'uN',
      unidadTipo: 'sucursal',
      evaluacionId: 'ev7',
      nivel: 'AMONESTACION',
      nota: 75,
      trabajadores: [
        { dni: 111, nacionalidad: 'V', nombre: 'Ana Pérez' },
        { dni: 222, nacionalidad: 'E', nombre: 'Beto Gómez' }
      ]
    })

    expect(insertados[1].tabla).toBe('alerta_trabajadores')
    expect(insertados[1].payload).toEqual([
      { alerta_id: 'a-nueva', nacionalidad: 'V', dni: 111, nombre: 'Ana Pérez' },
      { alerta_id: 'a-nueva', nacionalidad: 'E', dni: 222, nombre: 'Beto Gómez' }
    ])
  })

  it('sin trabajadores no se toca la tabla hija (los departamentos no tienen nómina)', async () => {
    const insertados: { tabla: string }[] = []
    mockInsercion({ data: { id: 'a9' }, error: null }, (tabla) => insertados.push({ tabla }))

    await registrarAlerta({ clave: 'cont', cargo: 'Contador', unidadId: 'd1', unidadTipo: 'departamento', evaluacionId: 'ev8', nivel: 'LLAMADO', nota: 62 })

    expect(insertados.map((i) => i.tabla)).toEqual(['alertas_cargo'])
  })

  it('la carrera de dos pantallas (23505, clave pendiente ya creada) no es error y no duplica trabajadores', async () => {
    const insertados: { tabla: string }[] = []
    mockInsercion({ data: null, error: { message: 'duplicate key', code: '23505' } }, (tabla) => insertados.push({ tabla }))

    await expect(
      registrarAlerta({
        clave: 'cajero',
        cargo: 'Cajero',
        unidadId: 'uN',
        unidadTipo: 'sucursal',
        evaluacionId: 'ev7',
        nivel: 'AMONESTACION',
        nota: 75,
        trabajadores: [{ dni: 111, nacionalidad: 'V', nombre: 'Ana Pérez' }]
      })
    ).resolves.toBeUndefined()
    expect(insertados.map((i) => i.tabla)).toEqual(['alertas_cargo'])
  })

  it('cualquier otro error sí se propaga', async () => {
    mockInsercion({ data: null, error: { message: 'rol insuficiente' } })

    await expect(
      registrarAlerta({ clave: 'cajero', cargo: 'Cajero', unidadId: 'uN', unidadTipo: 'sucursal', evaluacionId: 'ev7', nivel: 'AMONESTACION', nota: 75 })
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
