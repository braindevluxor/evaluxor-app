import { claveNormalizada, listarResponsables, type ResponsableCatalogo } from './responsables'

/**
 * Un responsable de una incidencia es un CARGO (un puesto: Soldador, Encargado
 * de turno), no una persona. Es el mismo catálogo que usan los ítems, para que un
 * incumplimiento de un ítem y una incidencia puedan hablar del mismo cargo.
 *
 * POR QUÉ CADA UNO LLEVA SU PROPIA MARCA
 * --------------------------------------
 * El catálogo viene de una Edge Function, así que sin señal no hay nada que
 * buscar. En una tienda es el caso normal: la incidencia se reporta sin conexión
 * y el cargo se escribe a mano. Ese cargo no se puede dar por bueno, porque
 * puede estar mal escrito o no existir.
 *
 * Por eso `porValidar`: lo que se escribió sin catálogo queda marcado, y en
 * cuanto hay señal se contrasta contra el catálogo y se da por confirmado solo si
 * coincide de verdad. Los que no coinciden siguen marcados, porque alguien tiene
 * que decidir qué hacer con ellos (corregir el nombre, o el cargo corresponde a
 * otro caso).
 *
 * La marca no es cosmética en el servidor: viaja a la tabla `incidencias` en la
 * columna `responsables`, para que el Líder vea desde la nube que ese cargo
 * todavía no está verificado.
 */

export interface ResponsableIncidencia {
  cargo: string
  /** Se agregó a mano porque no había catálogo. Espera confirmación. */
  porValidar: boolean
}

/** La oficina central siempre entra: hay cargos que no pertenecen a una tienda. */
export const BRANCH_CENTRAL = '5'

/**
 * De qué branches se pide el catálogo de una incidencia: el de la sucursal donde
 * pasó, más la central. Son dos consultas, no una por sucursal como en la
 * configuración de ítems: en el teléfono esas consultas se notan.
 */
export function branchesDeIncidencia(branchId: string | null | undefined): string[] {
  return Array.from(new Set([BRANCH_CENTRAL, (branchId ?? '').trim()].filter(Boolean)))
}

/**
 * Lee los responsables venga de donde venga: del JSONB del servidor (que usa
 * `por_validar`), de la base local del teléfono, o de una versión vieja que los
 * tenía como texto suelto. Descarta vacíos y repetidos.
 */
export function normalizarResponsables(valor: unknown): ResponsableIncidencia[] {
  if (!Array.isArray(valor)) return []
  const salida: ResponsableIncidencia[] = []
  const vistos = new Set<string>()
  for (const entrada of valor) {
    const cargo =
      typeof entrada === 'string'
        ? entrada.trim()
        : entrada && typeof entrada === 'object'
          ? String((entrada as { cargo?: unknown }).cargo ?? '').trim()
          : ''
    if (!cargo) continue
    const clave = claveNormalizada(cargo)
    // Sin clave no hay forma de deduplicar: mejor no agregar un cargo que no se
    // puede comparar con los de la lista.
    if (!clave || vistos.has(clave)) continue
    vistos.add(clave)
    const crudo = entrada as { porValidar?: unknown; por_validar?: unknown } | null
    const marca = crudo && typeof crudo === 'object' ? (crudo.porValidar ?? crudo.por_validar) : undefined
    salida.push({ cargo, porValidar: marca === true })
  }
  return salida
}

/**
 * Agrega un cargo. Si ya estaba pero venía marcado, y ahora lo confirmamos, se
 * destraba: así validar el catálogo no obliga a sacarlo y volver a ponerlo.
 */
export function agregarResponsable(
  lista: ResponsableIncidencia[],
  cargo: string,
  porValidar: boolean
): ResponsableIncidencia[] {
  const limpio = cargo.trim()
  if (!limpio) return lista
  const clave = claveNormalizada(limpio)
  if (!clave) return lista
  const existe = lista.findIndex((r) => claveNormalizada(r.cargo) === clave)
  if (existe === -1) return [...lista, { cargo: limpio, porValidar }]
  if (lista[existe].porValidar && !porValidar) {
    return lista.map((r, i) => (i === existe ? { ...r, cargo: limpio, porValidar: false } : r))
  }
  return lista
}

/**
 * Como las otras dos: si no hay nada que quitar devuelve la MISMA lista, no una
 * copia. Los tres devuelven la referencia original cuando no cambian nada, para
 * que el componente no se re-renderice por tocar un cargo que no estaba.
 */
export function quitarResponsable(lista: ResponsableIncidencia[], cargo: string): ResponsableIncidencia[] {
  const clave = claveNormalizada(cargo)
  if (!clave) return lista
  if (!lista.some((r) => claveNormalizada(r.cargo) === clave)) return lista
  return lista.filter((r) => claveNormalizada(r.cargo) !== clave)
}

/**
 * Contrasta los cargos marcados contra el catálogo: los que coinciden de verdad
 * quedan confirmados. Los que no coinciden siguen marcados, porque no hay forma
 * de saber si el nombre está mal escrito o si el cargo no existe.
 *
 * Solo se devuelven los que cambian, para no rehacer el objeto entero.
 */
export function confirmarConCatalogo(
  lista: ResponsableIncidencia[],
  catalogo: string[]
): ResponsableIncidencia[] {
  const enCatalogo = new Set(catalogo.map(claveNormalizada).filter(Boolean))
  if (!enCatalogo.size) return lista
  let cambio = false
  const salida = lista.map((r) => {
    if (!r.porValidar || !enCatalogo.has(claveNormalizada(r.cargo))) return r
    cambio = true
    return { ...r, porValidar: false }
  })
  return cambio ? salida : lista
}

export function pendientesDeValidar(lista: ResponsableIncidencia[]): number {
  return lista.filter((r) => r.porValidar).length
}

/** De la forma del código (camelCase) a la de la columna JSONB (snake_case). */
export function responsablesAColumna(lista: ResponsableIncidencia[]): { cargo: string; por_validar: boolean }[] {
  return lista.map((r) => ({ cargo: r.cargo, por_validar: r.porValidar }))
}

/**
 * Catálogo de cargos de una sucursal, con cache solo en memoria y solo durante
 * la sesión: el modal de reportar se abre y se cierra varias veces seguidas, y
 * pegarle dos llamadas a la Edge Function en cada apertura se nota en un
 * teléfono con datos.
 *
 * No se persiste a disco a propósito: sin señal el catálogo no está, y el
 * campo pasa a texto libre marcado, que es lo que se pidió. La cache solo evita
 * repetir el pedido dentro de la misma sesión.
 */
const cacheEnMemoria = new Map<string, ResponsableCatalogo[]>()

export async function catalogoDeIncidencia(branchId: string | null | undefined): Promise<ResponsableCatalogo[]> {
  const branches = branchesDeIncidencia(branchId)
  const clave = branches.join(',')
  const guardado = cacheEnMemoria.get(clave)
  if (guardado) return guardado
  const { responsables, mensaje } = await listarResponsables(branches)
  if (!responsables.length) throw new Error(mensaje ?? 'No se encontró el catálogo de cargos.')
  cacheEnMemoria.set(clave, responsables)
  return responsables
}

/** Vacía la cache de la sesión. Para las pruebas: no debe filtrarse entre casos. */
export function limpiarCacheCatalogoIncidencia(): void {
  cacheEnMemoria.clear()
}