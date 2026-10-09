import { useEffect, useState } from 'react'
import { claveNormalizada, listarResponsables, type ResponsableCatalogo } from './responsables'
import { BRANCH_CENTRAL } from './responsablesIncidencia'

/**
 * Los cargos de un centro de operaciones (sucursal u oficina central) y la forma
 * de quedarse solo con uno de los dos.
 *
 * POR QUÉ HAY QUE IR A BUSCAR EL CATÁLOGO
 * ---------------------------------------
 * El puntaje guarda el cargo como texto suelto (`responsables: string[]`), así que
 * en la tarjeta no se puede leer de qué centro es: «Encargado de turno» puede
 * estar en los dos catálogos o en ninguno. La única fuente que sí sabe es
 * `listar-colaboradores`, que se consulta por branch. Por eso se piden los dos
 * catálogos: son dos consultas, pero solo al abrir la pantalla —no en el refresco
 * en vivo de cada 15 s— y son las que permiten separar la lista.
 *
 * El branch de la oficina central se reusa de `responsablesIncidencia`: es el
 * mismo concepto y el mismo valor, y duplicar el `'5'` sería la forma segura de
 * que un día dejen de coincidir.
 */
export type CentroOperaciones = 'sucursal' | 'central'

/** El catálogo de UN centro. */
export interface CatalogoCentro {
  /** Claves normalizadas de los cargos del centro. */
  cargos: Set<string>
  /**
   * No se pudo leer. Vive acá adentro y no como una bandera general porque
   * "no hay cargos" y "se cayó la consulta" se ven igual en pantalla y no se
   * pueden tratar igual: uno es un dato y el otro es una falla.
   */
  fallo: boolean
}

export interface CatalogosCentro {
  sucursal: CatalogoCentro
  central: CatalogoCentro
  cargando: boolean
}

function vacio(fallo = false): CatalogoCentro {
  return { cargos: new Set<string>(), fallo }
}

export function useCargosPorCentro(branchId: string | null | undefined): CatalogosCentro {
  const [estado, setEstado] = useState<CatalogosCentro>({
    sucursal: vacio(),
    central: vacio(),
    cargando: true
  })

  useEffect(() => {
    let vivo = true
    const idSucursal = (branchId ?? '').trim()
    if (!idSucursal) {
      // Sin branch no hay contra qué separar. Se marca como fallo para que el
      // selector aparezca apagado en vez de prometer una separación que no hay.
      setEstado({ sucursal: vacio(true), central: vacio(true), cargando: false })
      return () => { vivo = false }
    }
    setEstado((anterior) => ({ ...anterior, cargando: true }))

    void (async () => {
      const [deSucursal, deCentral] = await Promise.all([
        listarResponsables([idSucursal]),
        listarResponsables([BRANCH_CENTRAL])
      ])
      if (!vivo) return
      const claves = (entradas: ResponsableCatalogo[]) =>
        new Set(entradas.map((x) => claveNormalizada(x.cargo)))
      setEstado({
        sucursal: { cargos: claves(deSucursal.responsables), fallo: Boolean(deSucursal.mensaje) },
        central: { cargos: claves(deCentral.responsables), fallo: Boolean(deCentral.mensaje) },
        cargando: false
      })
    })()

    return () => { vivo = false }
  }, [branchId])

  return estado
}

/**
 * Los cargos de un solo centro.
 *
 * MIENTRAS CARGA O SI FALLÓ, NO SE FILTRA NADA
 * ---------------------------------------------
 * Una lista vacía puede significar dos cosas muy distintas: que en ese centro nadie
 * responde por nada, o que la consulta se cayó. Mostrarlas todas es la única forma
 * de no mentir: en una pantalla de puntajes, un filtro que se vacía solo parece un
 * veredicto sobre la gente, y acá no lo es. Por eso `fallo` va por centro: si solo
 * se cayó el de central, el de sucursal sigue sirviendo.
 *
 * En cambio, un centro que se leyó bien y no tiene cargos SÍ se recorta a cero,
 * porque eso es el dato real: ahí no hay nadie.
 */
export function cargosDelCentro<T extends { responsable: string }>(
  filas: T[],
  centro: CentroOperaciones,
  catalogos: CatalogosCentro
): T[] {
  const catalogo = centro === 'sucursal' ? catalogos.sucursal : catalogos.central
  if (catalogos.cargando || catalogo.fallo) return filas
  // `claveNormalizada` porque el cargo de la tarjeta y el del catálogo vienen de
  // lugares distintos y escriben el mismo puesto de más de una forma.
  return filas.filter((v) => catalogo.cargos.has(claveNormalizada(v.responsable)))
}

/**
 * Si el centro se puede elegir. No se deshabilita por estar vacío: un centro
 * recién leído y sin cargos es información, y entrar muestra el «0 cargos» en vez
 * de esconderlo.
 */
export function centroDisponible(centro: CentroOperaciones, catalogos: CatalogosCentro): boolean {
  return !catalogos.cargando && !(centro === 'sucursal' ? catalogos.sucursal : catalogos.central).fallo
}

/** ¿Se pudo separar por centro? Es lo que decide si se muestra el aviso de la consulta. */
export function separacionDisponible(catalogos: CatalogosCentro): boolean {
  return centroDisponible('sucursal', catalogos) && centroDisponible('central', catalogos)
}