import type { Item, Opcion, SucursalPermiso } from './types'
import { estadoPermiso, hoyLocal } from './data/sucursalParametros'

/**
 * Configuración de una unidad que cambia las opciones de sus ítems: las marcadas
 * a mano en `sucursal_opciones`/`departamento_opciones` y los permisos de la
 * sucursal. `indicadores`, el PDF y la evaluación la comparten para que el
 * puntaje se recalcule siempre con la misma lista que vio el evaluador.
 */
export interface ConfigOpciones {
  sucursalOpciones?: { sucursal_id: string; item_id: string; opcion_id: string; activa?: boolean }[]
  sucursalPermisos?: SucursalPermiso[] | null
}

/**
 * Etiqueta de un permiso generado como opción: el nombre y, si tiene, el número
 * de expediente. La fecha no va acá sino en el badge de estado, para no repetir
 * dato en cada fila.
 */
export function etiquetaPermiso(p: Pick<SucursalPermiso, 'nombre' | 'numero'>): string {
  const numero = (p.numero ?? '').trim()
  return numero ? `${p.nombre.trim()} · ${numero}` : p.nombre.trim()
}

/**
 * Opciones de un CHECKLIST cuyo origen son los permisos de la sucursal.
 *
 * La lista es **viva**: se arma en cada pantalla contra los permisos actuales de
 * la unidad y la fecha de hoy, así que una evaluación vieja muestra lo mismo que
 * cualquier otra vista y no hace falta guardar una copia. Sólo entran los
 * permisos ACTIVOS (la marca `vigente`): un inactivo quedó retirado de la tienda
 * y se conserva por historial, así que no aparece en la evaluación.
 *
 * El orden va por vencimiento (lo más urgente primero) y los que no tienen fecha
 * cierran la lista.
 */
export function opcionesDePermisos(
  permisos: SucursalPermiso[],
  filtro: 'TODOS' | 'VENCIDOS',
  hoy: string
): Opcion[] {
  return permisos
    .filter((p) => p.vigente)
    .map((p) => ({ p, estado: estadoPermiso(p.vence, hoy) }))
    .filter(({ estado }) => filtro === 'TODOS' || estado === 'VENCIDO')
    .sort((a, b) => (a.p.vence ?? '9999-12-31').localeCompare(b.p.vence ?? '9999-12-31'))
    .map(({ p, estado }) => ({
      id: p.id,
      etiqueta: etiquetaPermiso(p),
      // Todos con el mismo peso: la puntuación del ítem se reparte a partes
      // iguales entre los permisos que se muestran.
      puntos: 1,
      tipo_respuesta: 'CHECK' as const,
      vence: p.vence,
      estado_permiso: estado
    }))
}

/**
 * Recorta las opciones de un ítem CHECKLIST a las marcadas para la unidad y, si
 * el ítem está configurado con origen en permisos, las reemplaza por las que se
 * generan desde los permisos ACTIVOS de esa sucursal.
 *
 * `unidadId` es el id de la sucursal o del departamento de la evaluación (ver
 * `unidadDe`); los permisos sólo existen para sucursales, así que una
 * evaluación de departamento queda con la lista vacía.
 */
export function aplicarPermisosChecklist(
  item: Item,
  unidadId: string,
  conf: Pick<ConfigOpciones, 'sucursalPermisos'>,
  hoy: string = hoyLocal()
): Item {
  if (item.tipo !== 'CHECKLIST' || !item.permisos_sucursal || !unidadId) return item
  const propios = (conf.sucursalPermisos ?? []).filter((p) => p.sucursal_id === unidadId)
  return { ...item, opciones: opcionesDePermisos(propios, item.permisos_sucursal, hoy) }
}
