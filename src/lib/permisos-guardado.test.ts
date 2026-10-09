import { describe, expect, it } from 'vitest'
import { bloqueosDeGuardado, explicacionBloqueos, textoBloqueo, type ReglasGuardado } from './permisos-guardado'

/**
 * Reglas de `puede_responder` / `puede_manejar_instancia` para un EVALUADOR sobre
 * una evaluación ACTIVA (supabase/schema.sql): el módulo del ítem tiene que
 * tener asignación viva Y estar habilitado en la sucursal, salvo que la sucursal
 * no tenga ningún módulo activo.
 */
function reglas(extra: Partial<ReglasGuardado> = {}): ReglasGuardado {
  return {
    asignados: new Set(['mod-almacen']),
    habilitadosUnidad: new Set(['mod-almacen', 'mod-venta']),
    moduloDeItem: new Map([['i1', 'mod-almacen']]),
    nombreDeModulo: new Map([
      ['mod-almacen', 'Almacén'],
      ['mod-venta', 'Punto de venta']
    ]),
    ...extra
  }
}

describe('bloqueosDeGuardado', () => {
  it('no bloquea nada cuando el módulo está asignado y habilitado', () => {
    expect(bloqueosDeGuardado(reglas())).toEqual([])
  })

  it('la asignación dada de baja bloquea, aunque el módulo esté habilitado', () => {
    // Es el caso real: le dieron de baja el módulo y el resto sigue igual.
    const bloqueos = bloqueosDeGuardado(reglas({ asignados: new Set<string>() }))

    expect(bloqueos).toHaveLength(1)
    expect(bloqueos[0].motivo).toBe('asignacion_dada_de_baja')
    expect(bloqueos[0].modulo).toBe('Almacén')
    expect(bloqueos[0].item_ids).toEqual(['i1'])
  })

  it('un módulo habilitado en la sucursal pero no asignado no pasa por alto', () => {
    // Al revés del anterior: el Líder lo habilitó en la sucursal pero no se lo
    // asignó a este evaluador.
    const bloqueos = bloqueosDeGuardado(reglas({ moduloDeItem: new Map([['i1', 'mod-venta']]) }))

    expect(bloqueos.map((b) => b.motivo)).toEqual(['asignacion_dada_de_baja'])
  })

  it('el módulo no habilitado en la sucursal bloquea aunque esté asignado', () => {
    // Asignado y con la sucursal restringiendo, pero sin fila activa para él: el
    // `exists` de `puede_manejar_instancia` no lo encuentra.
    const bloqueos = bloqueosDeGuardado(
      reglas({
        asignados: new Set(['mod-almacen', 'mod-venta']),
        habilitadosUnidad: new Set(['mod-almacen']),
        moduloDeItem: new Map([['i1', 'mod-venta']])
      })
    )

    expect(bloqueos.map((b) => b.motivo)).toEqual(['modulo_no_aplica_a_la_unidad'])
    expect(bloqueos[0].modulo).toBe('Punto de venta')
  })

  it('sin módulos activos en la sucursal le aplican todos, como el `not exists` del servidor', () => {
    const bloqueos = bloqueosDeGuardado(
      reglas({
        asignados: new Set(['mod-almacen']),
        habilitadosUnidad: new Set<string>(), // la sucursal no restringe nada
        moduloDeItem: new Map([['i1', 'mod-almacen']])
      })
    )

    expect(bloqueos).toEqual([])
  })

  it('anuncia los dos motivos cuando el módulo no está ni asignado ni habilitado', () => {
    const bloqueos = bloqueosDeGuardado(
      reglas({ asignados: new Set<string>(), habilitadosUnidad: new Set(['mod-venta']) })
    )

    expect(bloqueos.map((b) => b.motivo)).toEqual(['asignacion_dada_de_baja', 'modulo_no_aplica_a_la_unidad'])
  })

  it('junta en un bloqueo los ítems del mismo módulo', () => {
    const bloqueos = bloqueosDeGuardado(
      reglas({
        asignados: new Set<string>(),
        habilitadosUnidad: new Set(['mod-venta']),
        moduloDeItem: new Map([['i1', 'mod-almacen'], ['i2', 'mod-almacen']])
      })
    )

    expect(bloqueos).toHaveLength(2) // un bloqueo por motivo, no uno por ítem
    expect(bloqueos[0].item_ids).toEqual(['i1', 'i2'])
  })

  it('no dice nada de un ítem cuyo módulo no se pudo resolver', () => {
    // Un `null` acá significa que la consulta del catálogo no lo trajo, no que el
    // módulo no exista: afirmar un motivo sobre eso sería inventarlo.
    expect(bloqueosDeGuardado(reglas({ moduloDeItem: new Map([['i1', null]]) }))).toEqual([])
  })

  it('cae al id del módulo cuando el catálogo no trajo el nombre', () => {
    const bloqueos = bloqueosDeGuardado(
      reglas({ asignados: new Set<string>(), nombreDeModulo: new Map(), moduloDeItem: new Map([['i1', 'mod-almacen']]) })
    )

    expect(bloqueos[0].modulo).toBe('mod-almacen')
  })
})

describe('el mensaje que se lee en el teléfono', () => {
  it('nombra el módulo, no un UUID, y dice que no es la conexión', () => {
    const texto = explicacionBloqueos(bloqueosDeGuardado(reglas({ asignados: new Set<string>() })))

    expect(texto).toContain('«Almacén» ya no lo tenés asignado')
    expect(texto).toContain('No es un problema de internet')
    expect(texto).toContain('Avisale al Líder')
  })

  it('arma las dos causas en una sola frase', () => {
    const bloqueos = bloqueosDeGuardado(
      reglas({ asignados: new Set<string>(), habilitadosUnidad: new Set(['mod-venta']) })
    )
    const texto = explicacionBloqueos(bloqueos)

    expect(texto).toBe(
      'El servidor no te deja guardar: «Almacén» ya no lo tenés asignado y «Almacén» no está habilitado en esta evaluación. ' +
        'No es un problema de internet ni del teléfono. Tu avance sigue en este teléfono y sube solo cuando el Líder lo corrija. Avisale al Líder.'
    )
  })

  it('devuelve null cuando no se sabe: mejor el texto genérico que un motivo inventado', () => {
    expect(explicacionBloqueos([])).toBeNull()
  })

  it('textoBloqueo distingue las dos causas', () => {
    expect(textoBloqueo({ motivo: 'asignacion_dada_de_baja', modulo_id: 'm', modulo: 'Almacén', item_ids: [] })).toBe(
      '«Almacén» ya no lo tenés asignado'
    )
    expect(textoBloqueo({ motivo: 'modulo_no_aplica_a_la_unidad', modulo_id: 'm', modulo: 'Almacén', item_ids: [] })).toBe(
      '«Almacén» no está habilitado en esta evaluación'
    )
  })
})