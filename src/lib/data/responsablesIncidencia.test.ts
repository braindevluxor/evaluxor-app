import { describe, expect, it } from 'vitest'
import {
  agregarResponsable,
  branchesDeIncidencia,
  confirmarConCatalogo,
  normalizarResponsables,
  pendientesDeValidar,
  quitarResponsable,
  responsablesAColumna,
  type ResponsableIncidencia
} from './responsablesIncidencia'

describe('normalizarResponsables', () => {
  it('aguanta que no haya nada', () => {
    // Las incidencias guardadas antes de esta columna no la tienen, y el jsonb
    // del servidor puede venir como null. Nada de eso puede romper el render.
    expect(normalizarResponsables(undefined)).toEqual([])
    expect(normalizarResponsables(null)).toEqual([])
    expect(normalizarResponsables('Soldador')).toEqual([])
    expect(normalizarResponsables({ cargo: 'Soldador' })).toEqual([])
    expect(normalizarResponsables(42)).toEqual([])
  })

  it('lee los tres formatos que puede encontrar', () => {
    // Tres orígenes distintos, mismo resultado: la base local del teléfono
    // (camelCase), el jsonb del servidor (`por_validar`), y una versión vieja
    // que los tenía como texto suelto.
    expect(normalizarResponsables([' Soldador '])).toEqual([{ cargo: 'Soldador', porValidar: false }])
    expect(normalizarResponsables([{ cargo: 'Soldador', porValidar: true }])).toEqual([
      { cargo: 'Soldador', porValidar: true }
    ])
    expect(normalizarResponsables([{ cargo: 'Soldador', por_validar: true }])).toEqual([
      { cargo: 'Soldador', porValidar: true }
    ])
  })

  it('descarta lo que no es un cargo', () => {
    expect(normalizarResponsables(['', '   ', null, undefined, 7, {}, { cargo: '' }, { cargo: '  ' }])).toEqual([])
  })

  it('no repite el mismo cargo escrito distinto', () => {
    // Sin acentos, sin mayúsculas: para el usuario son el mismo cargo, y si
    // quedaran dos no podría quitarlos bien ni contarlos bien.
    const entrada = ['Soldador', 'soldador', 'SOLDADOR', ' Soldador ']
    expect(normalizarResponsables(entrada)).toEqual([{ cargo: 'Soldador', porValidar: false }])
  })

  it('cuenta como repetido un cargo que solo cambia en acentos o signos', () => {
    expect(normalizarResponsables(['Enc. de turno', 'enc de turno'])).toEqual([
      { cargo: 'Enc. de turno', porValidar: false }
    ])
  })
})

describe('agregarResponsable', () => {
  const base: ResponsableIncidencia[] = [{ cargo: 'Soldador', porValidar: false }]

  it('agrega uno nuevo con la marca que le corresponde', () => {
    expect(agregarResponsable([], 'Soldador', false)).toEqual([{ cargo: 'Soldador', porValidar: false }])
    expect(agregarResponsable([], 'Soldador', true)).toEqual([{ cargo: 'Soldador', porValidar: true }])
  })

  it('no agrega dos veces el mismo cargo', () => {
    expect(agregarResponsable(base, 'soldador', false)).toEqual(base)
    expect(agregarResponsable(base, ' SOLDADOR ', false)).toHaveLength(1)
  })

  it('confirma el que estaba marcado, sin pedir que lo saquen y lo vuelvan a poner', () => {
    // El caso real: se escribió a mano sin señal, y después el catálogo lo
    // confirmó. Si al confirmar no se destraba, el cargo queda marcado para
    // siempre aunque esté verificado.
    const marcado = [{ cargo: 'soldador', porValidar: true }]
    expect(agregarResponsable(marcado, 'Soldador', false)).toEqual([{ cargo: 'Soldador', porValidar: false }])
  })

  it('no vuelve a marcar un cargo que ya estaba confirmado', () => {
    // Al revés no pasa: agregar de nuevo un cargo del catálogo no puede
    // convertir un confirmado en "por validar".
    expect(agregarResponsable(base, 'Soldador', true)).toEqual(base)
  })

  it('ignora un cargo vacío o que no se puede comparar', () => {
    expect(agregarResponsable(base, '', false)).toBe(base)
    expect(agregarResponsable(base, '   ', false)).toBe(base)
    // Sin letras ni números no hay clave normalizada, así que no hay forma de
    // saber si ya está en la lista: mejor no entra.
    expect(agregarResponsable(base, '***', false)).toBe(base)
  })

  it('no le cambia el texto al que ya está confirmado', () => {
    expect(agregarResponsable(base, 'SOLDADOR', true)).toEqual([{ cargo: 'Soldador', porValidar: false }])
  })
})

describe('quitarResponsable', () => {
  const lista: ResponsableIncidencia[] = [
    { cargo: 'Soldador', porValidar: false },
    { cargo: 'Cajero', porValidar: true }
  ]

  it('quita el cargo aunque esté escrito distinto', () => {
    expect(quitarResponsable(lista, 'SOLDADOR')).toEqual([{ cargo: 'Cajero', porValidar: true }])
  })

  it('no toca nada si el cargo no está', () => {
    expect(quitarResponsable(lista, 'Encargado')).toBe(lista)
  })
})

describe('confirmarConCatalogo', () => {
  const catalogo = ['Soldador', 'Cajero']

  it('confirma los que coinciden con el catálogo', () => {
    const entrada: ResponsableIncidencia[] = [
      { cargo: 'soldador', porValidar: true },
      { cargo: 'Cajero', porValidar: true }
    ]
    expect(confirmarConCatalogo(entrada, catalogo)).toEqual([
      { cargo: 'soldador', porValidar: false },
      { cargo: 'Cajero', porValidar: false }
    ])
  })

  it('deja marcado el que NO está en el catálogo', () => {
    // Esto es lo importante: un cargo que no existe no se puede confirmar solo.
    // Alguien tiene que decidir si el nombre está mal o si el cargo no existe.
    const entrada: ResponsableIncidencia[] = [{ cargo: 'Sueldor', porValidar: true }]
    expect(confirmarConCatalogo(entrada, catalogo)).toEqual(entrada)
  })

  it('no cambia los que ya estaban confirmados', () => {
    const entrada: ResponsableIncidencia[] = [{ cargo: 'Soldador', porValidar: false }]
    expect(confirmarConCatalogo(entrada, catalogo)).toBe(entrada)
  })

  it('no hace nada si no hay catálogo', () => {
    // Sin catálogo no hay con qué contrastar: confirmar todo a ciegas sería peor
    // que dejar los cargos marcados.
    const entrada: ResponsableIncidencia[] = [{ cargo: 'Soldador', porValidar: true }]
    expect(confirmarConCatalogo(entrada, [])).toBe(entrada)
  })

  it('devuelve la misma lista si no confirmó nada', () => {
    // El editor lo usa para decidir si llamar a `onChange`: si devolviera una
    // lista nueva siempre, se re-renderizaría en loop.
    const entrada: ResponsableIncidencia[] = [{ cargo: 'Sueldor', porValidar: true }]
    expect(confirmarConCatalogo(entrada, catalogo)).toBe(entrada)
  })

  it('confirma contra el catálogo sin importar acentos ni mayúsculas', () => {
    const entrada: ResponsableIncidencia[] = [{ cargo: 'SOLDADOR', porValidar: true }]
    expect(confirmarConCatalogo(entrada, catalogo)[0].porValidar).toBe(false)
  })
})

describe('pendientesDeValidar', () => {
  it('cuenta solo los marcados', () => {
    const lista: ResponsableIncidencia[] = [
      { cargo: 'Soldador', porValidar: false },
      { cargo: 'Cajero', porValidar: true },
      { cargo: 'Sueldor', porValidar: true }
    ]
    expect(pendientesDeValidar(lista)).toBe(2)
    expect(pendientesDeValidar([])).toBe(0)
  })
})

describe('branchesDeIncidencia', () => {
  it('siempre mete la central, más la sucursal de la incidencia', () => {
    expect(branchesDeIncidencia('12')).toEqual(['5', '12'])
  })

  it('con la sucursal sin branch solo consulta la central', () => {
    expect(branchesDeIncidencia(null)).toEqual(['5'])
    expect(branchesDeIncidencia(undefined)).toEqual(['5'])
    expect(branchesDeIncidencia('  ')).toEqual(['5'])
  })

  it('no pide la central dos veces si la sucursal es la central', () => {
    expect(branchesDeIncidencia('5')).toEqual(['5'])
  })

  it('limpia espacios que vienen sueltos', () => {
    expect(branchesDeIncidencia(' 12 ')).toEqual(['5', '12'])
  })
})

describe('responsablesAColumna', () => {
  it('pasa el nombre de la columna al que la base usa', () => {
    // El código habla en camelCase y la columna en snake_case. Si se mandara
    // `porValidar`, Postgres no rechazaría el insert (jsonb acepta cualquier
    // clave), pero la marca se perdería en silencio y el Líder vería el cargo
    // como verificado.
    expect(
      responsablesAColumna([
        { cargo: 'Soldador', porValidar: false },
        { cargo: 'Cajero', porValidar: true }
      ])
    ).toEqual([
      { cargo: 'Soldador', por_validar: false },
      { cargo: 'Cajero', por_validar: true }
    ])
  })

  it('una lista vacía es un array vacío, no null', () => {
    expect(responsablesAColumna([])).toEqual([])
  })
})

describe('el ciclo completo', () => {
  it('texto libre sin señal, luego el catálogo lo confirma', () => {
    // Es el escenario que motiva la columna: se reporta en la tienda sin señal,
    // se escribe el cargo a mano, y cuando vuelve la señal se contrasta.
    let lista = agregarResponsable([], 'soldador', true)
    expect(lista).toEqual([{ cargo: 'soldador', porValidar: true }])
    expect(pendientesDeValidar(lista)).toBe(1)

    // Con catálogo: uno coincide, el otro no.
    lista = confirmarConCatalogo(lista, ['Soldador', 'Cajero'])
    expect(lista).toEqual([{ cargo: 'soldador', porValidar: false }])
    expect(pendientesDeValidar(lista)).toBe(0)
  })

  it('un cargo mal escrito sobrevive a la validación para que alguien lo corrija', () => {
    let lista = agregarResponsable([], 'Sueldor', true)
    lista = confirmarConCatalogo(lista, ['Soldador'])
    expect(pendientesDeValidar(lista)).toBe(1)
    // Se saca el que no existe y se pone el bueno: el pendiente desaparece.
    lista = quitarResponsable(lista, 'Sueldor')
    lista = agregarResponsable(lista, 'Soldador', false)
    expect(lista).toEqual([{ cargo: 'Soldador', porValidar: false }])
  })

  it('aguanta varios responsables sin pisarse', () => {
    let lista: ResponsableIncidencia[] = []
    for (const cargo of ['Soldador', 'Cajero', 'Encargado', 'Soldador']) {
      lista = agregarResponsable(lista, cargo, cargo === 'Encargado')
    }
    expect(lista).toEqual([
      { cargo: 'Soldador', porValidar: false },
      { cargo: 'Cajero', porValidar: false },
      { cargo: 'Encargado', porValidar: true }
    ])
    expect(pendientesDeValidar(lista)).toBe(1)
  })
})