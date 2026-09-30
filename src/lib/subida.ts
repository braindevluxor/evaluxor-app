/**
 * Por qué falló una subida.
 *
 * Antes, cualquier error al guardar se mostraba como "revisá tu conexión" y se
 * reintentaba cada 12 s para siempre. El caso más común no era la conexión: era el
 * servidor rechazando el guardado por las políticas de RLS (evaluación cerrada,
 * módulo sin asignar, ítem desactivado). Eso no se arregla reconectando, así que
 * el mensaje mentía y el reintento era infinito.
 *
 * `causaSubida` clasifica el error y `mensajeSubida` dice qué pasó, cada cuánto
 * reintentar y qué tiene que hacer la persona.
 */

export type CausaSubida = 'sin_conexion' | 'rechazada' | 'item_borrado' | 'servidor' | 'desconocida'

export interface ErrorSubida extends Error {
  causa: CausaSubida
  /** Código y mensaje crudo del servidor: sirve para diagnosticar sin adivinar. */
  detalle: string
}

interface Partes {
  code: string
  message: string
  details: string
}

function partes(e: unknown): Partes {
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>
    return {
      code: typeof o.code === 'string' ? o.code : String(o.code ?? ''),
      message: typeof o.message === 'string' ? o.message : String(o.message ?? o.error ?? ''),
      details: typeof o.details === 'string' ? o.details : String(o.details ?? '')
    }
  }
  return { code: '', message: typeof e === 'string' ? e : String(e ?? ''), details: '' }
}

/** Texto corto y técnico del error, para mostrarlo y que lo puedan mandar. */
export function detalleTecnico(e: unknown): string {
  if (e && typeof e === 'object' && 'detalle' in e && e.detalle) return String((e as { detalle: unknown }).detalle)
  const p = partes(e)
  const codigo = p.code ? `${p.code} · ` : ''
  return `${codigo}${p.message}`.trim() || 'Error desconocido'
}

/** Clasifica el error de una subida o lectura contra Supabase. */
export function causaSubida(e: unknown): CausaSubida {
  if (e && typeof e === 'object' && 'causa' in e) {
    const c = (e as { causa: unknown }).causa
    if (c === 'sin_conexion' || c === 'rechazada' || c === 'item_borrado' || c === 'servidor') return c
  }
  const { code, message, details } = partes(e)
  const texto = `${message} ${details}`.toLowerCase()

  // Se comprueba antes que el rechazo por política: el texto de Postgres para
  // una clave foránea insatisfecha dice "violates foreign key constraint", que
  // entraba en el patrón de RLS. No es lo mismo. Un 23503 significa que la fila
  // que mandamos apunta a un ítem que no está en el catálogo (lo borraron al
  // editar la plantilla), así que ninguna cantidad de reintentos la va a
  // insertar: es dato obsoleto, no un permiso denegado.
  if (code === '23503' || /violates foreign key constraint|foreign key violation/.test(texto)) {
    return 'item_borrado'
  }
  // Rechazo de política: no se arregla con internet.
  if (code === '42501' || /row-level security|row level security|violates|not authorized|permission denied|forbidden|pgrst301/.test(texto)) {
    return 'rechazada'
  }
  // Sin red: fetch falla con TypeError, o el proxy corta la conexión.
  if (!code && (e instanceof TypeError || /failed to fetch|fetch failed|networkerror|load failed|conexi|connection|timeout|timed out/.test(texto))) {
    return 'sin_conexion'
  }
  // Caída o saturación del servidor / de la base: suele aflojar solo.
  if (/^5\d\d$/.test(code) || /pgrst5|internal server|bad gateway|service unavailable|gateway timeout/.test(texto)) {
    return 'servidor'
  }
  return 'desconocida'
}

export function esErrorSubida(e: unknown): e is ErrorSubida {
  return e instanceof Error && 'causa' in e
}

/** Envuelve el error original conservando la causa y el detalle técnico. */
export function errorSubida(e: unknown, contexto: string): ErrorSubida {
  const causa = causaSubida(e)
  const err = new Error(`${contexto}: ${detalleTecnico(e)}`) as ErrorSubida
  err.causa = causa
  err.detalle = `${contexto} · ${detalleTecnico(e)}`
  return err
}

export interface MensajeSubida {
  /** Qué pasó, en una línea. */
  titulo: string
  /** Qué tiene que hacer la persona. */
  ayuda: string
  /** Si vale la pena seguir reintentando en el segundo plano. */
  reintentar: boolean
  /** Cada cuánto reintentar (0 = no reintentar). */
  cadaMs: number
}

/** Qué mostrar según la causa. La conexión pierde el privilegio del título. */
export function mensajeSubida(causa: CausaSubida, contexto = 'guardar el avance'): MensajeSubida {
  switch (causa) {
    case 'rechazada':
      return {
        titulo: 'El servidor no aceptó guardar el avance',
        ayuda:
          'No es un problema de internet: la evaluación puede haberse cerrado, el ítem puede estar desactivado o el módulo ya no te está asignado. Tu avance sigue en este teléfono. Avisale al Líder.',
        reintentar: true,
        cadaMs: 120_000
      }
    case 'item_borrado':
      return {
        titulo: 'Una parte del avance ya no existe en el servidor',
        ayuda:
          'Lo que mandaste apunta a algo que fue borrado del cuestionario (típicamente un ítem que se eliminó al editar la plantilla). No se arregla reconectando, así que no se reintenta solo. Lo que sí sigue vigente ya se subió; avisale al Líder qué ítem faltó.',
        reintentar: false,
        cadaMs: 0
      }
    case 'servidor':
      return {
        titulo: 'El servidor está con problemas',
        ayuda: `No se pudo ${contexto} porque la base o la API fallaron. Se reintenta solo; tu avance sigue en este teléfono.`,
        reintentar: true,
        cadaMs: 30_000
      }
    case 'sin_conexion':
      return {
        titulo: 'Sin conexión',
        ayuda: `No se pudo ${contexto} porque el teléfono no llegó al servidor. Se reintenta solo y el avance queda guardado acá.`,
        reintentar: true,
        cadaMs: 12_000
      }
    default:
      return {
        titulo: 'No se pudo guardar el avance',
        ayuda: `Ocurrió un problema al ${contexto}. El detalle técnico está abajo. Se reintenta solo.`,
        reintentar: true,
        cadaMs: 60_000
      }
  }
}
