import { describe, expect, it } from 'vitest'
import { cargosDelCentro, centroDisponible, separacionDisponible, type CatalogosCentro } from './cargosCentro'
import { BRANCH_CENTRAL } from './responsablesIncidencia'
import { claveNormalizada } from './responsables'

function catalogo(...cargos: string[]) {
  return new Set(cargos.map(claveNormalizada))
}

const CARGOS = [
  { responsable: 'Encargado de turno' },
  { responsable: 'Soldador' },
  { responsable: 'Coordinador de tienda' },
  { responsable: 'Auditor de calidad' }
]

/** Sucursal con los dos primeros; central con los dos últimos. */
const AMBOS: CatalogosCentro = {
  sucursal: { cargos: catalogo('Encargado de Turno', 'Soldador'), fallo: false },
  central: { cargos: catalogo('Coordinador de tienda', 'Auditor de calidad'), fallo: false },
  cargando: false
}

describe('cargos por centro de operaciones', () => {
  it('deja solo los cargos del centro elegido', () => {
    expect(cargosDelCentro(CARGOS, 'sucursal', AMBOS).map((c) => c.responsable)).toEqual([
      'Encargado de turno',
      'Soldador'
    ])
    expect(cargosDelCentro(CARGOS, 'central', AMBOS).map((c) => c.responsable)).toEqual([
      'Coordinador de tienda',
      'Auditor de calidad'
    ])
  })

  /* El cargo de la tarjeta sale de la configuración de ítems y el del catálogo
     viene de `listar-colaboradores`. Escriben el mismo puesto de más de una forma
     —con y sin mayúsculas, con tildes— y con comparación literal el cargo se
     escondería del centro al que pertenece. */
  it('el cruce no depende de cómo se escribió el cargo', () => {
    const conTilde: CatalogosCentro = {
      sucursal: { cargos: catalogo('Técnico de Mantención'), fallo: false },
      central: { cargos: new Set<string>(), fallo: false },
      cargando: false
    }
    expect(cargosDelCentro([{ responsable: 'tecnico de mantencion' }], 'sucursal', conTilde)).toHaveLength(1)
    expect(cargosDelCentro([{ responsable: 'TÉCNICO DE MANTENCIÓN' }], 'sucursal', conTilde)).toHaveLength(1)
  })

  /* Un cargo puede estar en los dos catálogos (muchos roles existen en la tienda y
     en la central). Se muestra en los dos, porque pertenece a los dos: esconderlo
     de uno sería inventarse una pertenencia que nadie nos dio. */
  it('un cargo que está en los dos catálogos aparece en los dos centros', () => {
    const compartido: CatalogosCentro = {
      sucursal: { cargos: catalogo('Jefe de proyecto'), fallo: false },
      central: { cargos: catalogo('Jefe de proyecto'), fallo: false },
      cargando: false
    }
    const cargo = [{ responsable: 'Jefe de proyecto' }]
    expect(cargosDelCentro(cargo, 'sucursal', compartido)).toHaveLength(1)
    expect(cargosDelCentro(cargo, 'central', compartido)).toHaveLength(1)
  })

  /* La regla más importante del archivo. Una lista vacía puede ser "aquí no
     responde nadie" o "se cayó la consulta", y en pantalla se ven igual. Filtrar
     con el catálogo caído convierte un problema de conexión en un veredicto sobre
     las personas. */
  it('si el catálogo no se pudo leer, no se esconde ningún cargo', () => {
    const caido: CatalogosCentro = {
      sucursal: { cargos: new Set<string>(), fallo: true },
      central: { cargos: new Set<string>(), fallo: true },
      cargando: false
    }
    expect(cargosDelCentro(CARGOS, 'sucursal', caido)).toHaveLength(CARGOS.length)
    expect(cargosDelCentro(CARGOS, 'central', caido)).toHaveLength(CARGOS.length)
    expect(separacionDisponible(caido)).toBe(false)
  })

  /* `fallo` va POR CENTRO justo para esto: que se caiga el de central no deja sin
     servicio al de la sucursal, que es el que casi siempre se está mirando. */
  it('si solo falla un centro, el otro sigue filtrando', () => {
    const soloCentralCayo: CatalogosCentro = {
      sucursal: AMBOS.sucursal,
      central: { cargos: new Set<string>(), fallo: true },
      cargando: false
    }
    expect(centroDisponible('sucursal', soloCentralCayo)).toBe(true)
    expect(centroDisponible('central', soloCentralCayo)).toBe(false)
    expect(cargosDelCentro(CARGOS, 'sucursal', soloCentralCayo)).toHaveLength(2)
    expect(cargosDelCentro(CARGOS, 'central', soloCentralCayo)).toHaveLength(CARGOS.length)
    expect(separacionDisponible(soloCentralCayo)).toBe(false)
  })

  /* Mientras los catálogos vuelan todavía no se sabe nada. Filtrar ahí mostraría
     un cartel de «ningún cargo pertenece a esta sucursal» durante los 15 s que
     tarda la consulta. */
  it('mientras carga no se filtra, para no mostrar un vacío que después se llena', () => {
    const cargando: CatalogosCentro = { sucursal: { cargos: new Set(), fallo: false }, central: { cargos: new Set(), fallo: false }, cargando: true }
    expect(cargosDelCentro(CARGOS, 'sucursal', cargando)).toHaveLength(CARGOS.length)
    expect(centroDisponible('sucursal', cargando)).toBe(false)
  })

  /* Un centro vacío de verdad se recorta a cero: ese es el dato, no una falla. Y
     sigue siendo elegible, porque entrar y ver «0 cargos» informa más que
     esconder la opción. */
  it('un centro leído y vacío se recorta a cero, y se puede entrar', () => {
    const sinCentral: CatalogosCentro = { ...AMBOS, central: { cargos: new Set<string>(), fallo: false } }
    expect(cargosDelCentro(CARGOS, 'central', sinCentral)).toHaveLength(0)
    expect(centroDisponible('central', sinCentral)).toBe(true)
    expect(centroDisponible('sucursal', sinCentral)).toBe(true)
  })

  it('la oficina central se identifica con el branch de siempre', () => {
    // Si este valor se duplicara adentro, un día dejarían de coincidir con el que
    // usa el catálogo de incidencias y el filtro de central no encontraría nada.
    expect(BRANCH_CENTRAL).toBe('5')
  })
})