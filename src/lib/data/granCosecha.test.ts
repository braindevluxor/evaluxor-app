import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { rpc: rpcMock } }))

import {
  ESTADOS,
  TIPOS_BITACORA,
  candidatosDeEquipo,
  claveDeMiembro,
  etiquetaPeriodo,
  historialAvances,
  periodoDe,
  periodosRecientes,
  regarProyecto,
  riegosDeLaCosecha,
  validarEquipo,
  type FilaBitacora,
  type MiembroEquipo
} from './granCosecha'
import type { ProfileVista } from './usuarios'

/**
 * Gran Cosecha: lo del cliente, con supabase mockeado.
 *
 * El SQL cubre las mismas reglas desde el otro lado (`granCosecha-sql.test.ts`);
 * éste cubre lo que sólo vive acá: el formato del trimestre, el mensaje del
 * equipo incompleto, qué filas de la bitácora son avances, y CÓMO se piden
 * los riegos (qué manda la pantalla y qué hace ante una RPC ausente — el
 * bloque de riegos recién aplicado — sin enseñar ceros inventados).
 */

const equipo = (...ids: string[]): MiembroEquipo[] =>
  ids.map((id, i) => ({ usuario_id: id, nombre: `Persona ${i + 1}` }))

describe('periodoDe · el trimestre del concurso', () => {
  it('cae en el trimestre que le corresponde a la fecha', () => {
    expect(periodoDe(new Date(2026, 0, 1))).toBe('2026-T1') // enero
    expect(periodoDe(new Date(2026, 3, 15))).toBe('2026-T2') // abril
    expect(periodoDe(new Date(2026, 6, 1))).toBe('2026-T3') // julio
    expect(periodoDe(new Date(2026, 11, 31))).toBe('2026-T4') // diciembre
  })

  it('el año va adelante para que el período se pueda ordenar como texto', () => {
    // Es la razón del formato `2026-T1`: un `order by periodo` sobre texto
    // ordena los años solo, sin tener que parsear nada.
    const ordenados = ['2027-T1', '2026-T4', '2026-T1'].sort()
    expect(ordenados).toEqual(['2026-T1', '2026-T4', '2027-T1'])
    expect(etiquetaPeriodo('2026-T1')).toBe('T1 2026')
  })

  it('los periodos recientes salen del más nuevo al más viejo, sin repetir', () => {
    const lista = periodosRecientes(4, new Date(2026, 5, 1)) // junio → T2
    expect(lista).toEqual(['2026-T2', '2026-T1', '2025-T4', '2025-T3'])
    expect(new Set(lista).size).toBe(lista.length)
  })

  it('una fecha rota no inventa un trimestre', () => {
    // `etiquetaPeriodo` es la que pinta el selector: si le llega basura,
    // devuelve tal cual en vez de mostrar «T  undefined».
    expect(etiquetaPeriodo('cualquier cosa')).toBe('cualquier cosa')
  })
})

describe('validarEquipo · el mínimo de tres', () => {
  it('con menos de tres no deja presentar', () => {
    expect(validarEquipo([])).toBe('El equipo necesita al menos 3 personas.')
    expect(validarEquipo(equipo('a'))).toBe('El equipo necesita al menos 3 personas.')
    expect(validarEquipo(equipo('a', 'b'))).toBe('El equipo necesita al menos 3 personas.')
    expect(validarEquipo(equipo('a', 'b', 'c'))).toBeNull()
  })

  it('sin repetidos: la misma persona no cuenta dos veces', () => {
    // Un `check` de SQL no puede mirar dentro de un array, así que ésta es la
    // única capa que lo garantiza (la base sólo cubre el mínimo).
    expect(validarEquipo(equipo('a', 'a', 'b'))).toBe('Hay integrantes repetidos en el equipo.')
    expect(validarEquipo(equipo('a', 'b', 'b'))).toBe('Hay integrantes repetidos en el equipo.')
    expect(validarEquipo(equipo('a', 'b', 'c', 'a'))).toBe('Hay integrantes repetidos en el equipo.')
    expect(validarEquipo(equipo('a', 'b', 'c', 'd'))).toBeNull()
  })
})

describe('candidatosDeEquipo · quién se puede elegir', () => {
  const perfil = (extra: Partial<ProfileVista>): ProfileVista =>
    ({ id: 'u1', email: 'a@x.com', usuario: 'ana', nombre: 'Ana', rol: 'EVALUADOR', activo: true, ...extra }) as ProfileVista

  it('sólo los activos y con rol: SIN_ROL todavía no puede entrar a la app', () => {
    const lista = [
      perfil({}),
      perfil({ id: 'u2', activo: false }),
      perfil({ id: 'u3', rol: 'SIN_ROL' }),
      perfil({ id: 'u4', rol: 'JUEZ' })
    ]
    expect(candidatosDeEquipo(lista).map((p) => p.id)).toEqual(['u1', 'u4'])
  })
})

describe('la bitácora de avances', () => {
  const fila = (extra: Partial<FilaBitacora>): FilaBitacora => ({
    id: 'b1',
    proyecto_id: 'p1',
    tipo: 'AVANCE',
    porcentaje: 40,
    detalle: '',
    autor_id: 'u1',
    created_at: '2026-11-01T10:00:00Z',
    ...extra
  })

  it('de los avances salen sólo las filas de avance, con su porcentaje', () => {
    const filas = [
      fila({ id: 'a', tipo: 'ALTA', porcentaje: null }),
      fila({ id: 'b', tipo: 'AVANCE', porcentaje: 40 }),
      fila({ id: 'c', tipo: 'ESTADO', porcentaje: null }),
      fila({ id: 'd', tipo: 'AVANCE', porcentaje: 75 })
    ]
    const avances = historialAvances(filas)
    expect(avances.map((f) => f.id)).toEqual(['b', 'd'])
    expect(avances.map((f) => f.porcentaje)).toEqual([40, 75])
  })

  it('cada tipo tiene su rótulo, para que la fila se lea sin código', () => {
    for (const tipo of ['ALTA', 'AVANCE', 'ESTADO', 'EDICION', 'MIEMBROS'] as const) {
      expect(TIPOS_BITACORA[tipo], tipo).toBeTruthy()
    }
  })

  it('cada estado tiene etiqueta y chip pastel', () => {
    // Sin chip la lista se leería como texto suelto; sin etiqueta, el valor
    // crudo de la base (`EN_CURSO`) aparecería en pantalla.
    for (const estado of Object.keys(ESTADOS) as (keyof typeof ESTADOS)[]) {
      expect(ESTADOS[estado].etiqueta, estado).toBeTruthy()
      expect(['cumple', 'riesgo', 'noCumple', 'sinDato']).toContain(ESTADOS[estado].chip)
    }
    // El orden importa para el `select` de estado de la pantalla.
    expect(Object.keys(ESTADOS)).toEqual(['PROPUESTA', 'EN_CURSO', 'COMPLETADO', 'CANCELADO'])
  })
})

describe('riegos · lo que la pantalla manda y lo que hace sin el bloque', () => {
  beforeEach(() => rpcMock.mockReset())

  it('el conteo se pide entero, por la RPC y sin tocar la tabla', async () => {
    rpcMock.mockResolvedValue({ data: { p1: { riegos: 3, mio: true } }, error: null })
    expect(await riegosDeLaCosecha()).toEqual({ p1: { riegos: 3, mio: true } })
    expect(rpcMock).toHaveBeenCalledWith('riegos_de_la_cosecha')
  })

  it('si la RPC no existe devuelve null: la pantalla no pinta ceros', async () => {
    // Bloque de riegos todavía no aplicado en la base.
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: '42883', message: 'function public.riegos_de_la_cosecha() does not exist' }
    })
    expect(await riegosDeLaCosecha()).toBeNull()

    // O sin red: supabase-js lo devuelve como `error` (Failed to fetch) y
    // el resultado es el mismo —null, no un cero—. (El `catch` de la
    // función es la red de seguridad para un rechazo real de la promesa.)
    rpcMock.mockResolvedValue({ data: null, error: { message: 'Failed to fetch' } })
    expect(await riegosDeLaCosecha()).toBeNull()
  })

  it('regar manda SÓLO el proyecto y devuelve el conteo nuevo', async () => {
    rpcMock.mockResolvedValue({ data: { ya_regado: false, riegos: 5 }, error: null })
    expect(await regarProyecto('p1')).toEqual({ ya_regado: false, riegos: 5 })
    // Sin identidad en el payload: quién riega lo decide la base.
    expect(rpcMock).toHaveBeenCalledWith('regar_proyecto', { p_proyecto_id: 'p1' })
  })

  it('la RPC ausente se explica en castellano, no con un 42883', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: '42883', message: 'function public.regar_proyecto(uuid) does not exist' }
    })
    await expect(regarProyecto('p1')).rejects.toThrow(/bloque en el SQL Editor/)
  })

  it('lo que la base dice (cancelado, sin usuario) se propaga tal cual', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'Ese proyecto ya no participa en el concurso.' }
    })
    await expect(regarProyecto('p1')).rejects.toThrow(/ya no participa/)
  })
})

describe('validarEquipo · integrantes sin cuenta', () => {
  const trabajador = (dni: number, nombre = `Trabajador ${dni}`): MiembroEquipo => ({
    usuario_id: '',
    nombre,
    nacionalidad: 'V',
    dni
  })

  it('dos trabajadores de la nómina NO son «el mismo repetido»', () => {
    // Antes la identidad era sólo `usuario_id`: los dos sin cuenta chocaban
    // en la cadena vacía y parecían un integrante repetido.
    expect(validarEquipo([...equipo('a', 'b'), trabajador(1), trabajador(2)])).toBeNull()
  })

  it('la misma cédula dos veces SÍ es repetido', () => {
    expect(validarEquipo([...equipo('a', 'b'), trabajador(1), trabajador(1)])).toMatch(/repetidos/)
  })

  it('nadie entra sin nombre ni sin identidad', () => {
    expect(validarEquipo([...equipo('a', 'b'), { usuario_id: '', nombre: '   ' }])).toMatch(/nombre/)
    expect(validarEquipo([...equipo('a', 'b'), { usuario_id: '', nombre: 'Sin cédula' }])).toMatch(
      /usuario ni cédula/
    )
  })
})

describe('claveDeMiembro · la identidad de un integrante', () => {
  it('usa el usuario si tiene cuenta y la cédula si no', () => {
    expect(claveDeMiembro({ usuario_id: 'u1', nombre: 'Ana Líder' })).toBe('u:u1')
    expect(claveDeMiembro({ usuario_id: '', nombre: 'José Pérez', nacionalidad: 'V', dni: 12345678 })).toBe(
      'w:V-12345678'
    )
  })
})
