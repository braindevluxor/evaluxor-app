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

export type CausaSubida =
  | 'sin_conexion'
  | 'rechazada'
  | 'evaluacion_cerrada'
  | 'item_borrado'
  | 'servidor'
  | 'desconocida'

/**
 * Lo que la pantalla guarda de una subida que falló. No es un `Error`: no se
 * guarda el error, se guarda qué pasó y qué se le puede decir a la persona.
 */
export interface FallaGuardado {
  causa: CausaSubida
  /** Código y mensaje crudo del servidor: sirve para diagnosticar sin adivinar. */
  detalle: string
  /**
   * Por qué lo rechazó el servidor, en una frase que ya sabe el cliente.
   *
   * Opcional a propósito: solo lo llena `offline/sync.ts` cuando pudo comprobar
   * la regla que falló (ver `lib/permisos-guardado.ts`). Si no se sabe, se deja
   * en null y la pantalla usa el texto genérico de `mensajeSubida`, que es menos
   * preciso pero no miente.
   */
  explicacion?: string
}

export interface ErrorSubida extends Error, FallaGuardado {}

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
    if (
      c === 'sin_conexion' ||
      c === 'rechazada' ||
      c === 'evaluacion_cerrada' ||
      c === 'item_borrado' ||
      c === 'servidor'
    ) {
      return c
    }
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
  if (
    /^5\d\d$/.test(code) ||
    /pgrst5|internal server|bad gateway|service unavailable|gateway timeout|slowdown|too many connections|connection pool|database is overloaded|max_connections|remaining connections|rate limit/.test(texto)
  ) {
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
    case 'evaluacion_cerrada':
      return {
        titulo: 'La evaluación ya no acepta respuestas',
        ayuda:
          'El Líder la cerró o la reprogramó, y el servidor rechaza el guardado por esa razón: no es un problema de internet. Lo que ya se había subido sigue ahí; lo que tengas ahora en este teléfono no entra hasta que la vuelvan a abrir. Se reintenta por si la reabren. Avisale al Líder.',
        reintentar: true,
        cadaMs: 300_000
      }
    case 'rechazada':
      return {
        titulo: 'El servidor no aceptó guardar el avance',
        ayuda:
          'La evaluación sigue abierta, así que no es un problema de internet: el servidor te rechaza por permisos. Lo más común es que el ítem se haya desactivado o que te hayan dado de baja el módulo. Tu avance sigue en este teléfono. Avisale al Líder.',
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
