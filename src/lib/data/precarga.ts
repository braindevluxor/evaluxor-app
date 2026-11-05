import { supabase } from '../supabase'

/** Registro de sección (fila de `instancias_grupo`) leído de la visita anterior. */
export interface RegistroPrevio {
  id: string
  item_id: string
  etiqueta: string
  orden: number
  api_id?: string | null
  datos?: Record<string, unknown> | null
}

/** Respuesta (fila de `respuestas`) de la visita anterior. */
export interface RespuestaPrevia {
  item_id: string
  instancia_id: string | null
  valor: unknown
}

/** Lo que trae la última visita de una unidad para precargar en la evaluación nueva. */
export interface UltimaVisita {
  id: string
  fecha: string
  instancias: RegistroPrevio[]
  respuestas: RespuestaPrevia[]
}

/**
 * La evaluación anterior más reciente de la misma unidad (sucursal o
 * departamento), con sus registros de secciones y sus respuestas.
 *
 * Se usa para precargar las secciones al abrir una evaluación nueva: el
 * evaluador no vuelve a cargar equipo por equipo lo que ya estaba en la
 * visita pasada. Devuelve `null` cuando no hay visita previa o el servidor
 * no devuelve datos (p. ej. RLS): la precarga es opcional y su fallo nunca
 * debe impedir abrir la evaluación.
 *
 * El filtro `.lt('fecha', …)` excluye la evaluación actual, así que una
 * reabierta (mismo día) nunca se precarga a sí misma.
 */
export async function ultimaVisitaDeUnidad(
  unidad: { sucursal_id?: string | null; departamento_id?: string | null },
  fecha: string
): Promise<UltimaVisita | null> {
  const esDepto = !!unidad.departamento_id
  const { data, error } = await supabase
    .from('evaluaciones')
    .select('id, fecha, instancias_grupo(*), respuestas(item_id, instancia_id, valor)')
    .eq(esDepto ? 'departamento_id' : 'sucursal_id', (esDepto ? unidad.departamento_id : unidad.sucursal_id) ?? '')
    .is(esDepto ? 'sucursal_id' : 'departamento_id', null)
    .lt('fecha', fecha)
    .order('fecha', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    // El motivo real (RLS, relación rota, red) sólo se ve en la consola: sin
    // esto la precarga falla en silencio y es imposible saber por qué.
    console.warn('[precarga] no se pudo leer la última visita:', error.message)
    return null
  }
  if (!data) {
    console.info('[precarga] sin evaluación anterior previa para la unidad en', fecha)
    return null
  }
  const fila = data as {
    id: string
    fecha: string
    instancias_grupo: RegistroPrevio[] | null
    respuestas: RespuestaPrevia[] | null
  }
  return {
    id: fila.id,
    fecha: fila.fecha,
    instancias: fila.instancias_grupo ?? [],
    respuestas: fila.respuestas ?? []
  }
}
