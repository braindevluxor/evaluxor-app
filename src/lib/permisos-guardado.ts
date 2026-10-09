/**
 * Por qué el servidor le rechaza el avance a un evaluador, sin adivinar.
 *
 * `puede_responder` y `puede_manejar_instancia` (supabase/schema.sql) le exigen
 * al EVALUADOR, sobre una evaluación ACTIVA, dos cosas a la vez:
 *
 *   1. que el módulo del ítem tenga asignación viva para él
 *      (`asignaciones_modulos.activa`);
 *   2. que ese módulo esté habilitado en la unidad de la evaluación
 *      (`sucursal_modulos.activa` o `departamento_modulos.activa`), pero solo si
 *      la unidad tiene algún módulo activo: si no tiene ninguno, le aplican todos.
 *
 * El 42501 de Postgres no dice cuál de las dos falló, así que la app terminaba
 * mostrando `new row violates row-level security policy for table
 * "instancias_grupo"` en letra de 11 px, que no es un mensaje: es una interna.
 * Estas funciones repiten las dos reglas con los datos que el evaluador sí puede
 * leer (`items`, `modulos` y `sucursal_modulos` están abiertos a autenticados, y
 * de `asignaciones_modulos` cada uno ve las suyas) para poder decir la verdad.
 *
 * Lo que NO se replica, a propósito:
 *
 * · `es_lider()`: un Líder no tiene ninguna de las dos reglas, así que si a un
 *   Líder le rechazan una fila el problema es otro y estas funciones callan.
 * · `items.activo`: `puede_responder` lo exige pero `puede_manejar_instancia` no.
 *   Como el rechazo que nos llega puede ser de cualquiera de las dos tablas,
 *   nombrarlo sería decir "esto" cuando el servidor falló por aquello. El texto
 *   genérico ya lo menciona entre las posibilidades.
 * · `evaluaciones.estado`: se comprueba aparte, porque es la única que se puede
 *   afirmar con certeza y porque tiene su propio mensaje (ver `subida.ts`).
 */

export interface ReglasGuardado {
  /** Módulos con `asignaciones_modulos.activa` para quien está guardando. */
  asignados: ReadonlySet<string>
  /** `modulo_id` con fila activa en la configuración de la unidad (`sucursal_modulos` o `departamento_modulos`). */
  habilitadosUnidad: ReadonlySet<string>
  /** `modulo_id` de cada ítem rechazado. `null` = no se pudo leer su módulo. */
  moduloDeItem: ReadonlyMap<string, string | null>
  /** Nombre de cada módulo, para que el mensaje diga cuál y no un UUID. */
  nombreDeModulo: ReadonlyMap<string, string>
}

export type MotivoPermiso = 'asignacion_dada_de_baja' | 'modulo_no_aplica_a_la_unidad'

export interface BloqueoPermiso {
  motivo: MotivoPermiso
  modulo_id: string
  /** Nombre del módulo, o su id si el catálogo no lo trajo. */
  modulo: string
  /** Ítems del módulo que el servidor rechazó. */
  item_ids: string[]
}

function nombreDe(reglas: ReglasGuardado, moduloId: string): string {
  return reglas.nombreDeModulo.get(moduloId) ?? moduloId
}

/**
 * Qué módulos de los ítems rechazados no cumplen una de las dos reglas.
 *
 * Devuelve todos los que fallan, no el primero: un lote se rechaza entero y
 * puede fallar por más de un módulo, así que con el primero nomás el mensaje
 * arreglaría la mitad y el resto seguiría sin subir sin que nadie lo sepa.
 */
export function bloqueosDeGuardado(reglas: ReglasGuardado): BloqueoPermiso[] {
  const porModulo = new Map<string, string[]>()
  for (const [itemId, moduloId] of reglas.moduloDeItem) {
    if (!moduloId) continue // ítem que no se pudo resolver: no se afirma nada
    const items = porModulo.get(moduloId)
    if (items) items.push(itemId)
    else porModulo.set(moduloId, [itemId])
  }

  const bloqueos: BloqueoPermiso[] = []
  for (const [moduloId, itemIds] of porModulo) {
    const modulo = nombreDe(reglas, moduloId)
    // Mismo orden que el `exists` del servidor: primero la asignación, después
    // la sucursal. Si no hay asignación el módulo tampoco puede estar
    // habilitado, así que casi siempre salen los dos y el primero es el que hay
    // que arreglar.
    if (!reglas.asignados.has(moduloId)) {
      bloqueos.push({ motivo: 'asignacion_dada_de_baja', modulo_id: moduloId, modulo, item_ids: itemIds })
    }
    if (reglas.habilitadosUnidad.size > 0 && !reglas.habilitadosUnidad.has(moduloId)) {
      bloqueos.push({
        motivo: 'modulo_no_aplica_a_la_unidad',
        modulo_id: moduloId,
        modulo,
        item_ids: itemIds
      })
    }
  }
  return bloqueos
}

/** Una línea por bloqueo, en el idioma de quien la lee en el teléfono. */
export function textoBloqueo(b: BloqueoPermiso): string {
  return b.motivo === 'asignacion_dada_de_baja'
    ? `«${b.modulo}» ya no lo tenés asignado`
    : `«${b.modulo}» no está habilitado en esta evaluación`
}

/**
 * El mensaje que se muestra en vez de la interna de Postgres. Si no hay
 * bloqueos se devuelve `null` y la pantalla sigue con el texto genérico: es
 * preferible decir "el servidor te rechaza por permisos" a inventar un motivo.
 */
export function explicacionBloqueos(bloqueos: BloqueoPermiso[]): string | null {
  if (!bloqueos.length) return null
  const lista = bloqueos.map(textoBloqueo).join(' y ')
  return (
    `El servidor no te deja guardar: ${lista}. No es un problema de internet ni del teléfono. ` +
    `Tu avance sigue en este teléfono y sube solo cuando el Líder lo corrija. Avisale al Líder.`
  )
}