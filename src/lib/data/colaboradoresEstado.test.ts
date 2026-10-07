import { describe, expect, it } from 'vitest'
import {
  aplicarHistorial,
  combinarPorDni,
  estadosAnteriores,
  normalizarListaColaboradores,
  tieneTrabajoRegistrado
} from './colaboradoresEstado'
import { colaboradorCumple, opcionesAplicablesColaborador, type ColaboradorItem } from '../scoring'

const IDS = ['o1', 'o2', 'o3']

function colab(molde: Partial<ColaboradorItem> & { dni: number }): ColaboradorItem {
  return {
    name: 'Nombre',
    lastname: 'Apellido',
    active: true,
    aplica: true,
    selected: [],
    ...molde
  }
}

/** Trabajador con todos los checks aplicables marcados. */
function completo(dni: number, extra: Partial<ColaboradorItem> = {}): ColaboradorItem {
  return colab({ dni, selected: ['o1', 'o2', 'o3'], ...extra })
}

describe('normalizarListaColaboradores', () => {
  it('aguanta que no haya nada', () => {
    expect(normalizarListaColaboradores(undefined)).toEqual([])
    expect(normalizarListaColaboradores(null)).toEqual([])
    expect(normalizarListaColaboradores('colaboradores')).toEqual([])
    expect(normalizarListaColaboradores({})).toEqual([])
    expect(normalizarListaColaboradores({ colaboradores: 'nope' })).toEqual([])
  })

  it('lee el valor guardado y también el arreglo suelto', () => {
    const esperado = [
      {
        dni: 1,
        nationality: 'V-',
        name: 'Ana',
        lastname: 'Gómez',
        role_id: '7',
        role_name: 'Cajera',
        branch_id: 3,
        branch_name: 'La Mora',
        admission_date: '2024-01-02',
        active: true,
        aplica: true,
        selected: ['o1'],
        noAplica: [],
        responsablesPorOpcion: undefined
      }
    ]
    expect(normalizarListaColaboradores({ colaboradores: [{ dni: 1, name: 'Ana', lastname: 'Gómez', nationality: 'V-', role_id: 7, role_name: 'Cajera', branch_id: 3, branch_name: 'La Mora', admission_date: '2024-01-02', selected: ['o1'] }] })).toEqual(esperado)
    expect(normalizarListaColaboradores([{ dni: 1, name: 'Ana', lastname: 'Gómez', nationality: 'V-', role_id: 7, role_name: 'Cajera', branch_id: 3, branch_name: 'La Mora', admission_date: '2024-01-02', selected: ['o1'] }])).toEqual(esperado)
  })

  it('descarta a quien no tiene DNI, porque sin DNI no hay forma de saber si es el mismo', () => {
    // Es el caso que rompe la fusión por DNI: dos personas distintas sin
    // documento se fundirían en una y una de las dos perdería todo.
    expect(normalizarListaColaboradores({ colaboradores: [{ dni: 0, name: 'Sin' }, { dni: -3 }, { dni: 'abc' }, { name: 'Tampoco' }, null, 'x'] })).toEqual([])
  })

  it('los flags ausentes valen true (aplica y activo)', () => {
    const [c] = normalizarListaColaboradores({ colaboradores: [{ dni: 1 }] })
    expect(c.aplica).toBe(true)
    expect(c.active).toBe(true)
    expect(c.selected).toEqual([])
  })

  it('respeta los flags puestos en false', () => {
    const [c] = normalizarListaColaboradores({ colaboradores: [{ dni: 1, aplica: false, active: false }] })
    expect(c.aplica).toBe(false)
    expect(c.active).toBe(false)
  })

  it('descarta el mapa de responsables vacío', () => {
    expect(normalizarListaColaboradores({ colaboradores: [{ dni: 1, responsablesPorOpcion: {} }] })[0].responsablesPorOpcion).toBeUndefined()
    expect(normalizarListaColaboradores({ colaboradores: [{ dni: 1, responsablesPorOpcion: { o1: ['Soldador'] } }] })[0].responsablesPorOpcion).toEqual({ o1: ['Soldador'] })
  })
})

describe('tieneTrabajoRegistrado', () => {
  it('no cuenta como trabajo un trabajador recién cargado', () => {
    expect(tieneTrabajoRegistrado(colab({ dni: 1 }))).toBe(false)
  })

  it('cuenta lo marcado, lo excluido a propósito y los responsables', () => {
    expect(tieneTrabajoRegistrado(colab({ dni: 1, selected: ['o1'] }))).toBe(true)
    expect(tieneTrabajoRegistrado(colab({ dni: 1, aplica: false }))).toBe(true)
    expect(tieneTrabajoRegistrado(colab({ dni: 1, noAplica: ['o1'] }))).toBe(true)
    expect(tieneTrabajoRegistrado(colab({ dni: 1, responsablesPorOpcion: { o2: ['Cajero'] } }))).toBe(true)
  })
})

describe('combinarPorDni', () => {
  it('conserva lo que el evaluador ya marcó', () => {
    // El bug que motivó todo: antes la lista se reemplazaba y todos volvían con
    // las casillas vacías.
    const actuales = [colab({ dni: 1, selected: ['o1', 'o2'] }), colab({ dni: 2, selected: ['o3'] })]
    const frescos = [colab({ dni: 1 }), colab({ dni: 2 })]
    const { colaboradores, perdidos } = combinarPorDni(actuales, frescos)
    expect(colaboradores[0].selected).toEqual(['o1', 'o2'])
    expect(colaboradores[1].selected).toEqual(['o3'])
    expect(perdidos).toEqual([])
  })

  it('toma de la API los datos de la persona, que es donde mandan', () => {
    // El nombre y el rol cambian; el DNI no. Si se conservara el objeto viejo
    // entero, la lista mostraría el apellido de antes.
    const actuales = [colab({ dni: 1, lastname: 'Pérez', role_name: 'Cajero', selected: ['o1'] })]
    const frescos = [colab({ dni: 1, lastname: 'Pérez de López', role_name: 'Supervisor', branch_name: 'La Mora' })]
    const { colaboradores } = combinarPorDni(actuales, frescos)
    expect(colaboradores[0].lastname).toBe('Pérez de López')
    expect(colaboradores[0].role_name).toBe('Supervisor')
    expect(colaboradores[0].branch_name).toBe('La Mora')
  })

  it('conserva la exclusión y los responsables por check, que la API nunca trae', () => {
    const actuales = [colab({ dni: 1, aplica: false, selected: [], noAplica: ['o2'], responsablesPorOpcion: { o1: ['Cajero'] } })]
    const { colaboradores } = combinarPorDni(actuales, [colab({ dni: 1 })])
    expect(colaboradores[0].aplica).toBe(false)
    expect(colaboradores[0].noAplica).toEqual(['o2'])
    expect(colaboradores[0].responsablesPorOpcion).toEqual({ o1: ['Cajero'] })
  })

  it('trae a los que entraron nuevos y saca a los que ya no están', () => {
    const actuales = [colab({ dni: 1, selected: ['o1'] }), colab({ dni: 2, selected: ['o2'] })]
    const frescos = [colab({ dni: 1 }), colab({ dni: 3 })]
    const { colaboradores, perdidos } = combinarPorDni(actuales, frescos)
    expect(colaboradores.map((c) => c.dni)).toEqual([1, 3])
    expect(perdidos.map((c) => c.dni)).toEqual([2])
  })

  it('solo reporta perdidos los que tenían algo revisado', () => {
    // Si nunca se tocó al trabajador, que se vaya no es perder nada y no vale
    // la pena preguntar.
    const actuales = [colab({ dni: 1 }), colab({ dni: 2, selected: ['o1'] })]
    const { perdidos } = combinarPorDni(actuales, [])
    expect(perdidos.map((c) => c.dni)).toEqual([2])
  })

  it('no funde a dos personas sin DNI en una', () => {
    const actuales = [colab({ dni: 0, name: 'Sin documento A', selected: ['o1'] })]
    const frescos = [colab({ dni: 0, name: 'Sin documento B' })]
    const { colaboradores, perdidos } = combinarPorDni(actuales, frescos)
    expect(colaboradores).toHaveLength(1)
    expect(colaboradores[0].name).toBe('Sin documento B')
    expect(colaboradores[0].selected).toEqual([])
    expect(perdidos).toEqual([])
  })

  it('respeta el orden que trae la API', () => {
    const actuales = [colab({ dni: 1, selected: ['o1'] }), colab({ dni: 2 })]
    const frescos = [colab({ dni: 2 }), colab({ dni: 1 })]
    expect(combinarPorDni(actuales, frescos).colaboradores.map((c) => c.dni)).toEqual([2, 1])
  })

  it('no copia el arreglo de la lista actual: son independientes', () => {
    // Si compartieran el mismo `selected`, marcar un check en el render mutaría
    // el objeto viejo del estado anterior de React.
    const actuales = [colab({ dni: 1, selected: ['o1'] })]
    const { colaboradores } = combinarPorDni(actuales, [colab({ dni: 1 })])
    colaboradores[0].selected.push('o2')
    expect(actuales[0].selected).toEqual(['o1'])
  })
})

describe('estadosAnteriores', () => {
  it('con las listas de más nueva a más vieja', () => {
    const historial = estadosAnteriores([{ fecha: '2026-02-01', listas: [[completo(1)]] }], IDS)
    expect(historial.has(1)).toBe(true)
    expect(historial.get(1)?.selected).toEqual(['o1', 'o2', 'o3'])
  })

  it('devuelve también a los incompletos, con lo tildado y lo que faltaba', () => {
    // El motivo de heredar a todos y no solo a los completos: con 25 de los 30
    // documentos, esos 25 tildes son la única manera de corroborar en la próxima
    // evaluación si los 5 faltantes ya están bien. Antes se perdían.
    const historial = estadosAnteriores(
      [{ fecha: '2026-02-01', listas: [[colab({ dni: 1, selected: ['o1', 'o2'] })]] }],
      IDS
    )
    expect(historial.get(1)?.selected).toEqual(['o1', 'o2'])
  })

  it('sin historial no oculta a nadie', () => {
    expect(estadosAnteriores([], IDS).size).toBe(0)
  })

  it('gana la evaluación más reciente, aunque antes estuviera completo', () => {
    // El caso importante: si en la última reapareció la falla, el problema sigue
    // ahí y heredar el estado completo de antes lo dejaría pasar.
    const historial = estadosAnteriores(
      [
        { fecha: '2026-02-01', listas: [[colab({ dni: 1, selected: ['o1'] })]] },
        { fecha: '2026-01-01', listas: [[completo(1)]] }
      ],
      IDS
    )
    expect(historial.get(1)?.selected).toEqual(['o1'])
  })

  it('no vuelve a una evaluación vieja si en la última no estaba', () => {
    // Si el trabajador no aparece en la última evaluación, la que manda es la
    // anterior donde sí estaba: no hay dato más reciente.
    const historial = estadosAnteriores(
      [
        { fecha: '2026-02-01', listas: [[completo(2)]] },
        { fecha: '2026-01-01', listas: [[completo(1)]] }
      ],
      IDS
    )
    expect([...historial.keys()].sort()).toEqual([1, 2])
  })

  it('si en algún registro del ítem repetible no cumplió, manda ese estado', () => {
    // Un ítem repetible guarda una lista por registro. Cumplir en uno y no en
    // otro no es estar completo, y heredar el completo lo escondería de la
    // revisión sin que nadie lo haya decidido.
    const historial = estadosAnteriores(
      [{ fecha: '2026-02-01', listas: [[completo(1)], [colab({ dni: 1, selected: ['o1'] })]] }],
      IDS
    )
    expect(historial.get(1)?.selected).toEqual(['o1'])
    expect(colaboradorCumple(historial.get(1)!, IDS.map((id) => ({ id })))).toBe(false)
  })

  it('y lo devuelve completo si lo está en todos los registros', () => {
    const historial = estadosAnteriores(
      [{ fecha: '2026-02-01', listas: [[completo(1)], [completo(1)]] }],
      IDS
    )
    expect(historial.get(1)?.selected).toEqual(['o1', 'o2', 'o3'])
  })

  it('no confunde "no le aplica nada" con "cumplió"', () => {
    // Al que el evaluador le marcó "no aplica" en todo no se lo evaluó. No hay
    // nada que heredar de ahí: tiene que volver a decidirse.
    const todosNoAplican = colab({ dni: 1, selected: [], noAplica: ['o1', 'o2', 'o3'] })
    expect(opcionesAplicablesColaborador(todosNoAplican, IDS.map((id) => ({ id })))).toEqual([])
    expect(estadosAnteriores([{ fecha: '2026-02-01', listas: [[todosNoAplican]] }], IDS).size).toBe(0)
  })

  it('no cuenta a quien el evaluador excluyó a propósito', () => {
    const excluido = colab({ dni: 1, aplica: false, selected: ['o1', 'o2', 'o3'] })
    expect(estadosAnteriores([{ fecha: '2026-02-01', listas: [[excluido]] }], IDS).size).toBe(0)
  })

  it('manda sobre el estado guardado, no sobre el del checklist de hoy', () => {
    // Si se heredara lo viejo sin mirar los checks de hoy, un check nuevo quedaría
    // sin revisar para siempre. Con los checks de hoy, uno nuevo sin marcar hace
    // que el trabajador deje de estar completo: hereda lo que tenía y vuelve a la
    // lista a completarlo.
    const antes = colab({ dni: 1, selected: ['o1', 'o2'] })
    const conCheckNuevo = estadosAnteriores(
      [{ fecha: '2026-02-01', listas: [[antes]] }],
      [...IDS, 'o4']
    )
    expect(conCheckNuevo.get(1)?.selected).toEqual(['o1', 'o2'])
    expect(colaboradorCumple(conCheckNuevo.get(1)!, [...IDS, 'o4'].map((id) => ({ id })))).toBe(false)
  })

  it('ignora un check que ya no existe en el ítem de hoy', () => {
    // Al revés: si le sacaron un check, el `selected` viejo lo tiene guardado pero
    // ya no puntúa, así que el trabajador sigue estando completo.
    const antes = colab({ dni: 1, selected: ['o1', 'o2', 'o99'] })
    expect(estadosAnteriores([{ fecha: '2026-02-01', listas: [[antes]] }], ['o1', 'o2']).size).toBe(1)
  })
})

describe('aplicarHistorial', () => {
  it('carga el estado que tenía en la evaluación anterior', () => {
    const historial = new Map([[1, colab({ dni: 1, selected: ['o1', 'o2', 'o3'], noAplica: [] })]])
    const listos = aplicarHistorial([colab({ dni: 1, lastname: 'Nuevo' }), colab({ dni: 2 })], historial)
    expect(listos[0].selected).toEqual(['o1', 'o2', 'o3'])
    expect(listos[0].lastname).toBe('Nuevo')
    expect(listos[1].selected).toEqual([])
  })

  it('sin historial devuelve la lista tal cual', () => {
    const frescos = [colab({ dni: 1 })]
    expect(aplicarHistorial(frescos, new Map())).toBe(frescos)
  })

  it('el oculto NO hunde el puntaje: el que estaba bien sigue contando como bien', () => {
    // Este es el motivo de guardar en el valor y no solo en la pantalla. Si al
    // que ya salió bien se le cargara el historial con las casillas vacías,
    // `colaboradorCumple` daría false, el ítem se caería y la tienda mejorada
    // parecería en rojo. El incompleto (dni 2) tampoco se inventa: hereda lo que
    // tenía tildado, no un avance que no correspondía.
    const historial = estadosAnteriores(
      [{ fecha: '2026-02-01', listas: [[completo(1), colab({ dni: 2, selected: ['o1'] })]] }],
      IDS
    )
    const nuevos = aplicarHistorial([colab({ dni: 1 }), colab({ dni: 2 })], historial)
    const cumplidos = nuevos.filter((c) => c.aplica && colaboradorCumple(c, IDS.map((id) => ({ id }))))
    expect(cumplidos.map((c) => c.dni)).toEqual([1])
  })

  it('el oculto sale de la pantalla pero sigue en el valor guardado', () => {
    const historial = new Map([[1, completo(1)]])
    const guardados = aplicarHistorial([colab({ dni: 1 }), colab({ dni: 2 })], historial)
    const ocultos = new Set(historial.keys())
    expect(guardados.filter((c) => !ocultos.has(c.dni)).map((c) => c.dni)).toEqual([2])
    // Lo que se oculta son 1 de 2, pero los dos siguen en el valor.
    expect(guardados).toHaveLength(2)
  })
})