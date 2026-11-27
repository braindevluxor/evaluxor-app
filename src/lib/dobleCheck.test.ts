import { describe, expect, it } from 'vitest'
import {
  checkMarcado,
  estaVacioItem,
  opcionCumplida,
  proporcionChecklist,
  unidadCumple,
  valorBinario,
  type UnidadChecklist,
  type ValorChecklist,
  type ValorUnidadChecklist
} from './scoring'

/**
 * Doble check de los ítems de tipo lista (CHECKLIST / UNIDAD_CHECKLIST): cada
 * punto se marca dos veces — «existe» (presencia) y «correcto» (vigente /
 * funcionamiento) — y sin las dos marcas no puntúa.
 *
 * La regla vive en `checkMarcado`: si el valor (o la unidad) trae el array
 * `existe`, el punto sólo cumple estando en `selected` Y en `existe`. Los valores
 * legados, sin `existe`, siguen midiéndose con `selected` solo.
 */

const op = (id: string, extra: { tipo_respuesta?: 'CHECK' | 'RANGO'; minimo?: number; estado_permiso?: string } = {}) => ({ id, etiqueta: id, ...extra })

describe('checkMarcado', () => {
  it('sin doble check manda sólo selected, como siempre', () => {
    expect(checkMarcado({ selected: ['a'] }, 'a')).toBe(true)
    expect(checkMarcado({ selected: ['a'] }, 'b')).toBe(false)
    expect(checkMarcado(null, 'a')).toBe(false)
    expect(checkMarcado(undefined, 'a')).toBe(false)
  })

  it('con doble check exige las dos marcas', () => {
    expect(checkMarcado({ selected: ['a'], existe: ['a'] }, 'a')).toBe(true)
    // Sólo la presencia: el punto existe pero no está validado → no cumple.
    expect(checkMarcado({ selected: [], existe: ['a'] }, 'a')).toBe(false)
    // Sólo la validación: imposible por la UI, pero tampoco cumple.
    expect(checkMarcado({ selected: ['a'], existe: [] }, 'a')).toBe(false)
    expect(checkMarcado({ selected: ['a', 'b'], existe: ['a'] }, 'b')).toBe(false)
  })

  it('un `existe` vacío sigue exigiendo la segunda marca', () => {
    expect(checkMarcado({ selected: ['a'], existe: [] }, 'a')).toBe(false)
  })
})

describe('opcionCumplida con doble check', () => {
  const o = op('a')

  it('requiere presencia y correcto', () => {
    expect(opcionCumplida(o, { selected: ['a'], existe: ['a'] } as ValorChecklist, 'a')).toBe(true)
    expect(opcionCumplida(o, { selected: [], existe: ['a'] } as ValorChecklist, 'a')).toBe(false)
    expect(opcionCumplida(o, { selected: ['a'], existe: [] } as ValorChecklist, 'a')).toBe(false)
  })

  it('sin `existe` en el valor se comporta como el check simple', () => {
    expect(opcionCumplida(o, { selected: ['a'] } as ValorChecklist, 'a')).toBe(true)
    expect(opcionCumplida(o, { selected: [] } as ValorChecklist, 'a')).toBe(false)
  })

  it('en RANGO el valor mínimo sigue decidiendo el correcto', () => {
    const rango = { id: 'r', etiqueta: 'r', tipo_respuesta: 'RANGO' as const, minimo: 10 }
    expect(opcionCumplida(rango, { selected: ['r'], existe: ['r'], valores: { r: 12 } } as ValorChecklist, 'r')).toBe(true)
    expect(opcionCumplida(rango, { selected: ['r'], existe: ['r'], valores: { r: 8 } } as ValorChecklist, 'r')).toBe(false)
    // Valor alcanzado pero sin la marca de presencia: no puntúa.
    expect(opcionCumplida(rango, { selected: ['r'], existe: [], valores: { r: 12 } } as ValorChecklist, 'r')).toBe(false)
  })

  it('un permiso VENCIDO nunca cumple, ni con las dos marcas', () => {
    const permiso = { id: 'p', etiqueta: 'p', estado_permiso: 'VENCIDO' }
    expect(opcionCumplida(permiso, { selected: ['p'], existe: ['p'] } as ValorChecklist, 'p')).toBe(false)
  })
})

describe('unidadCumple con doble check', () => {
  const opts = [{ id: 'a' }, { id: 'b' }]

  it('cada unidad necesita las dos marcas en todos sus puntos', () => {
    const completa: UnidadChecklist = { codigo: 'U1', selected: ['a', 'b'], existe: ['a', 'b'] }
    const soloPresencia: UnidadChecklist = { codigo: 'U2', selected: [], existe: ['a', 'b'] }
    const mixta: UnidadChecklist = { codigo: 'U3', selected: ['a'], existe: ['a', 'b'] }
    expect(unidadCumple(completa, opts)).toBe(true)
    expect(unidadCumple(soloPresencia, opts)).toBe(false)
    expect(unidadCumple(mixta, opts)).toBe(false)
  })

  it('sin `existe` en la unidad manda sólo selected', () => {
    expect(unidadCumple({ codigo: 'U1', selected: ['a', 'b'] }, opts)).toBe(true)
    expect(unidadCumple({ codigo: 'U1', selected: ['a'] }, opts)).toBe(false)
  })
})

describe('veredicto del CHECKLIST con doble check', () => {
  const item = { tipo: 'CHECKLIST', opciones: [{ id: 'a' }, { id: 'b' }] }

  it('marcar sólo la presencia es respuesta (no cumple), no ítem sin responder', () => {
    const v = { selected: [], existe: ['a', 'b'] }
    expect(valorBinario(item, v)).toBe(false)
    expect(valorBinario(item, null)).toBe(null)
  })

  it('con las dos marcas en todo, cumple', () => {
    expect(valorBinario(item, { selected: ['a', 'b'], existe: ['a', 'b'] })).toBe(true)
  })

  it('no vacío si sólo se marcó la presencia', () => {
    // El evaluador ya respondió: no debe verse bloqueado en "Obligatorio".
    expect(estaVacioItem({ tipo: 'CHECKLIST', opciones: [{ id: 'a' }] }, { selected: [], existe: ['a'] })).toBe(false)
    expect(estaVacioItem({ tipo: 'CHECKLIST', opciones: [{ id: 'a' }] }, { selected: [], existe: [] })).toBe(true)
    expect(estaVacioItem({ tipo: 'CHECKLIST', opciones: [{ id: 'a' }] }, { selected: [] })).toBe(true)
  })
})

describe('proporción del CHECKLIST con doble check', () => {
  const item = {
    tipo: 'CHECKLIST',
    opciones: [
      { id: 'a', puntos: 5 },
      { id: 'b', puntos: 5 }
    ]
  }

  it('sólo presencia: entra al cálculo con 0 puntos (no se excluye)', () => {
    expect(proporcionChecklist(item, { selected: [], existe: ['a', 'b'] })).toBe(0)
  })

  it('una marca de cada: mitad de los puntos', () => {
    expect(proporcionChecklist(item, { selected: ['a'], existe: ['a', 'b'] })).toBe(0.5)
  })

  it('las dos marcas en todo: puntaje completo', () => {
    expect(proporcionChecklist(item, { selected: ['a', 'b'], existe: ['a', 'b'] })).toBe(1)
  })

  it('sin ninguna marca sigue excluyéndose del cálculo', () => {
    expect(proporcionChecklist(item, { selected: [], existe: [] })).toBe(null)
  })
})

describe('veredicto de UNIDAD_CHECKLIST con doble check', () => {
  const item = { tipo: 'UNIDAD_CHECKLIST', repetible: true, opciones: [{ id: 'a' }] }

  it('una unidad sólo con presencia no cumple', () => {
    const v: ValorUnidadChecklist = { unidades: [{ codigo: 'U1', selected: [], existe: ['a'] }] }
    expect(valorBinario(item, v)).toBe(false)
  })

  it('todas las unidades con las dos marcas cumplen', () => {
    const v: ValorUnidadChecklist = {
      unidades: [
        { codigo: 'U1', selected: ['a'], existe: ['a'] },
        { codigo: 'U2', selected: ['a'], existe: ['a'] }
      ]
    }
    expect(valorBinario(item, v)).toBe(true)
  })

  it('carga única vacía con doble check: sólo presencia ya no está vacío', () => {
    const unica = { tipo: 'UNIDAD_CHECKLIST', repetible: false, opciones: [{ id: 'a' }] }
    expect(estaVacioItem(unica, { unidades: [{ codigo: 'Única', selected: [], existe: ['a'] }] })).toBe(false)
    expect(estaVacioItem(unica, { unidades: [{ codigo: 'Única', selected: [], existe: [] }] })).toBe(true)
  })
})
