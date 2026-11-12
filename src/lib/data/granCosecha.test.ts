import { describe, expect, it } from 'vitest'
import {
  ESTADOS,
  TIPOS_BITACORA,
  candidatosDeEquipo,
  etiquetaPeriodo,
  historialAvances,
  periodoDe,
  periodosRecientes,
  validarEquipo,
  type FilaBitacora,
  type MiembroEquipo
} from './granCosecha'
import type { ProfileVista } from './usuarios'

/**
 * Gran Cosecha: lo que se puede decir sin tocar la red.
 *
 * El SQL cubre las mismas reglas desde el otro lado (`granCosecha-sql.test.ts`);
 * éste cubre la parte que sólo vive en el cliente: el formato del trimestre,
 * el mensaje del equipo incompleto y qué filas de la bitácora son avances.
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
