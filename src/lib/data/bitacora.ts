/**
 * BITÁCORA DE ASIGNACIONES: LEERLA Y CONTARLA EN CLARO
 * ----------------------------------------------------
 * La tabla la escribe el trigger (`bitacora-asignaciones.sql` en
 * `supabase/schema.sql`); éste es sólo el lado de lectura.
 *
 * Lo que guarda la fila es crudo: ids y los `datos_previos`/`datos_nuevos` en
 * jsonb. Eso está bien para auditar y mal para leer — nadie entiende un uuid.
 * Acá se traduce a una frase, resolviendo cada id contra el catálogo y los
 * perfiles.
 *
 * El traductor es PURO (`describirBitacora`): toma la fila y dos mapas, no
 * toca la red. Así se prueba con filas armadas a mano, que es la única manera
 * de cubrir las cuatro tablas sin montar una base para cada una.
 *
 * Sólo el LÍDER entra a esta pantalla: lo decide el RLS de la tabla (política
 * `bitacora_asignaciones_select`) y lo replica la ruta con `SoloLider`.
 */
import { supabase } from '../supabase'

/** Lo que el trigger registró. Es el `accion` del check de la tabla. */
export type AccionBitacora = 'CREADO' | 'MODIFICADO' | 'ELIMINADO'

/** Fila cruda de `bitacora_asignaciones`. */
export interface FilaBitacora {
  id: string
  /** Una de las cuatro tablas del alcance. */
  tabla: string
  registro_id: string | null
  accion: AccionBitacora
  datos_previos: Record<string, unknown> | null
  datos_nuevos: Record<string, unknown> | null
  /** `auth.uid()` de quien estaba en sesión; null si no había. */
  actor: string | null
  created_at: string
}

/**
 * Las cuatro tablas del alcance, con el rótulo con el que se nombran en la
 * pantalla. Es texto y no un enum a propósito: si mañana se agrega una tabla
 * al trigger, la bitácora la muestra aunque este mapa no la conozca todavía
 * (cae en el nombre crudo, que es mejor que no mostrar nada).
 */
export const TABLAS_BITACORA: Record<string, string> = {
  asignaciones: 'Evaluador por sucursal',
  asignaciones_modulos: 'Módulo por evaluador',
  sucursal_modulos: 'Módulo por sucursal',
  departamento_modulos: 'Módulo por departamento'
}

/** Cómo se le cada id. Mapas armados por la pantalla desde el catálogo. */
export interface NombresBitacora {
  modulos: Map<string, string>
  sucursales: Map<string, string>
  departamentos: Map<string, string>
  /** `profiles.id` → nombre. Cubre al actor y al evaluador asignado. */
  personas: Map<string, string>
}

/** Mapas vacíos: sirve para no null-checkear en cada fila. */
export const nombresVacios = (): NombresBitacora => ({
  modulos: new Map(),
  sucursales: new Map(),
  departamentos: new Map(),
  personas: new Map()
})

/** Un id resuelto, o el aviso de que ya no existe. Siempre hay algo que leer. */
function nombreEn(mapa: Map<string, string>, id: unknown): string {
  if (typeof id !== 'string' || !id) return 'registro eliminado'
  return mapa.get(id) ?? 'registro eliminado'
}

function persona(n: NombresBitacora, id: unknown): string {
  if (typeof id !== 'string' || !id) return 'persona desconocida'
  return n.personas.get(id) ?? 'persona eliminada'
}

/**
 * El estado de `activa` antes y después, o `null` cuando esa orilla no
 * existe: un CREADO no tiene previo y un ELIMINADO no tiene siguiente.
 *
 * Se leen las dos orillas por separado porque la app no borra filas — hace
 * `update activa = false` (ver `configurarSucursalModulos`)—, así que el
 * cambio que más importa ver es precisamente ese flip.
 */
function transicion(f: FilaBitacora): { antes: boolean | null; ahora: boolean | null } {
  const leer = (r: Record<string, unknown> | null): boolean | null =>
    r && typeof r.activa === 'boolean' ? r.activa : null
  return { antes: leer(f.datos_previos), ahora: leer(f.datos_nuevos) }
}

/**
 * La frase de la fila, en el idioma de quien la va a leer.
 *
 * Cuatro tablas y tres acciones: el cruce no es 4×3 porque el sentido de la
 * frase depende de QUÉ lado es el sujeto. En `asignaciones` se asigna una
 * persona a un lugar; en `*_modulos` se habilita un módulo en una unidad.
 * Por eso cada tabla arma su propia frase en vez de usar una plantilla.
 */
export function describirBitacora(f: FilaBitacora, n: NombresBitacora): string {
  const fila = f.datos_nuevos ?? f.datos_previos ?? {}
  // Sólo se necesita la orilla nueva: el verbo de la frase depende de si
  // quedó activa o no. La previa la lee `estadoDe`, que es la que decide si
  // hubo giro.
  const { ahora } = transicion(f)

  switch (f.tabla) {
    case 'asignaciones': {
      const quien = persona(n, fila.evaluador_id)
      const donde = nombreEn(n.sucursales, fila.sucursal_id)
      if (f.accion === 'CREADO') return `Se asignó ${quien} a ${donde}`
      if (f.accion === 'ELIMINADO') return `Se eliminó la asignación de ${quien} a ${donde}`
      return ahora
        ? `Se volvió a asignar ${quien} a ${donde}`
        : `Se quitó ${quien} de ${donde}`
    }
    case 'asignaciones_modulos': {
      const quien = persona(n, fila.evaluador_id)
      const modulo = nombreEn(n.modulos, fila.modulo_id)
      if (f.accion === 'CREADO') return `Se asignó a ${quien} el módulo «${modulo}»`
      if (f.accion === 'ELIMINADO') return `Se eliminó la asignación de ${quien} a «${modulo}»`
      return ahora
        ? `Se volvió a asignar a ${quien} el módulo «${modulo}»`
        : `Se quitó a ${quien} el módulo «${modulo}»`
    }
    case 'departamento_modulos': {
      const modulo = nombreEn(n.modulos, fila.modulo_id)
      const donde = nombreEn(n.departamentos, fila.departamento_id)
      if (f.accion === 'CREADO') return `Se habilitó «${modulo}» en ${donde}`
      if (f.accion === 'ELIMINADO') return `Se eliminó «${modulo}» de ${donde}`
      return ahora ? `Se habilitó «${modulo}» en ${donde}` : `Se deshabilitó «${modulo}» en ${donde}`
    }
    case 'sucursal_modulos':
    default: {
      const modulo = nombreEn(n.modulos, fila.modulo_id)
      const donde = nombreEn(n.sucursales, fila.sucursal_id)
      if (f.accion === 'CREADO') return `Se habilitó «${modulo}» en ${donde}`
      if (f.accion === 'ELIMINADO') return `Se eliminó «${modulo}» de ${donde}`
      return ahora ? `Se habilitó «${modulo}» en ${donde}` : `Se deshabilitó «${modulo}» en ${donde}`
    }
  }
}

/**
 * El rótulo corto de la tabla, para la columna o el chip del filtro.
 * Caer al nombre crudo si el mapa no la conoce es mejor que un hueco.
 */
export function rotuloTabla(tabla: string): string {
  return TABLAS_BITACORA[tabla] ?? tabla
}

/**
 * El giro de `activa`, para el chip de estado. `null` si no aplica.
 *
 * Tres casos y cada uno manda distinto:
 *
 *  * Un ELIMINADO no tiene orilla siguiente → no hay estado que señalar.
 *  * Un CREADO no tiene previa → manda la nueva: si nació activa, es Alta.
 *  * Si las dos orillas dicen lo mismo → no hubo giro, no hay chip. (El
 *    trigger ni siquiera registra ese caso, pero si llegara, no se inventa.)
 */
export function estadoDe(f: FilaBitacora): 'Alta' | 'Baja' | null {
  const { antes, ahora } = transicion(f)
  if (ahora === null) return null
  if (antes !== null && antes === ahora) return null
  return ahora ? 'Alta' : 'Baja'
}

/**
 * La bitácora, de la más nueva a la más vieja.
 *
 * El límite es un techo y no paginación: una sesión de configuración deja
 * pocas filas y el techo evita traer años de historial a un teléfono. Si se
 * llega al tope, la pantalla lo dice en vez de insinuar que no hay más.
 */
export async function listarBitacora(
  opciones: { tabla?: string; limite?: number } = {}
): Promise<FilaBitacora[]> {
  let consulta = supabase
    .from('bitacora_asignaciones')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(opciones.limite ?? 200)
  if (opciones.tabla) consulta = consulta.eq('tabla', opciones.tabla)

  const { data, error } = await consulta
  // 42P01 = la tabla no existe: el bloque todavía no se corrió en la base.
  // Se traduce a algo que se pueda leer en vez de tirar el error crudo.
  if (error) {
    if (error.code === '42P01') {
      throw new Error(
        'La bitácora todavía no está creada. Ejecuta el bloque bitacora-asignaciones.sql en el SQL Editor de Supabase.'
      )
    }
    throw new Error('No se pudo cargar la bitácora de asignaciones.')
  }
  return (data ?? []) as FilaBitacora[]
}
