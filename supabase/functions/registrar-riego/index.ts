// registrar-riego: REGAR un proyecto de la Gran Cosecha — el "like" de
// jardín, con regadera en vez de pulgar.
//
// Quién lo llama: LOS PORTALES HERMANOS — Academia Luxor y Desarrollo Luxor.
// Ellos tienen sus propios usuarios y NO tienen sesión en EvaLuxor, así que
// mandan la clave estable de su usuario (`usuario`: cédula, id o email de SU
// sistema) junto con la API key compartida `RIEGO_API_KEY`.
//
// UNA VEZ POR USUARIO Y PROYECTO, como un post de Facebook: la PRIMARY KEY de
// `gran_cosecha_riego` es (proyecto_id, usuario), así que un riego repetido
// no agrega fila — se contesta 200 igual con `ya_regado: true`. Es
// idempotente a propósito: un reintento de red no puede duplicar riegos ni
// castigar al portal.
//
// Dos rutas, la misma autorización:
//   POST  { proyecto_id, usuario }  → registra el riego (o reconoce el ya hecho).
//   GET   ?usuario=…                → los proyectos que ese usuario ya regó,
//                                    para que el portal pinte sus botones.
//
// La API key viaja en `x-riego-api-key`, o en `Authorization: Bearer …` si
// prefieren un solo header (mismo doble camino que el cron de
// `actualizar-nomina`). OJO con la verificación de JWT de la función: si está
// ENCENDIDA, el gateway de Supabase exige además un JWT válido ANTES de que
// este código corra — en ese caso manden `Authorization: Bearer <anon key>`
// (la anon key es pública, está en cualquier landing) y la API key en
// `x-riego-api-key`.
//
// El TOTAL de riegos no sale de acá: la página pública lo lee armado en
// `ver_concurso_publico`, que devuelve `riegos` por proyecto.
import { createClient } from 'npm:@supabase/supabase-js@2'

const API_KEY = Deno.env.get('RIEGO_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-riego-api-key',
  'Content-Type': 'application/json'
}

const RESPUESTA = (cuerpo: unknown, status: number, error?: string) =>
  new Response(JSON.stringify({ ok: status < 400, status, data: cuerpo, error }), {
    status,
    headers: CORS
  })

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// El mismo límite que el `check` de la columna: acá se explica en criollo,
// allá es el límite de confianza.
const LIMITE_USUARIO = 120

/** El usuario tal cual queda guardado, o `null` si no es usable. */
function usuarioDe(valor: unknown): string | null {
  if (typeof valor !== 'string') return null
  const u = valor.trim()
  return u.length > 0 && u.length <= LIMITE_USUARIO ? u : null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS })
  }

  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return RESPUESTA(null, 500, 'Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en los secretos de la función.')
  }
  if (!API_KEY) {
    return RESPUESTA(null, 500, 'Falta el secreto RIEGO_API_KEY: supabase secrets set RIEGO_API_KEY=…')
  }

  // --- Autorización: la API key compartida con los portales ---------------
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const clave = req.headers.get('x-riego-api-key') ?? bearer
  if (!clave || clave !== API_KEY) {
    return RESPUESTA(null, 401, 'API key inválida.')
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

  // --- GET: qué proyectos regó ese usuario (el estado de sus botones) -----
  if (req.method === 'GET') {
    const usuario = usuarioDe(new URL(req.url).searchParams.get('usuario'))
    if (!usuario) {
      return RESPUESTA(null, 400, `Falta usuario: texto de 1 a ${LIMITE_USUARIO} caracteres.`)
    }
    const { data, error } = await admin
      .from('gran_cosecha_riego')
      .select('proyecto_id')
      .eq('usuario', usuario)
    if (error) return RESPUESTA(null, 500, error.message)
    return RESPUESTA({ proyectos: (data ?? []).map((f) => f.proyecto_id) }, 200)
  }

  if (req.method !== 'POST') {
    return RESPUESTA(null, 405, 'Usá POST para regar (o GET ?usuario=… para consultar).')
  }

  // --- El cuerpo ----------------------------------------------------------
  let cuerpo: { proyecto_id?: unknown; usuario?: unknown }
  try {
    cuerpo = await req.json()
  } catch {
    return RESPUESTA(null, 400, 'El cuerpo no es JSON.')
  }
  const proyectoId =
    typeof cuerpo.proyecto_id === 'string' && UUID.test(cuerpo.proyecto_id) ? cuerpo.proyecto_id : null
  const usuario = usuarioDe(cuerpo.usuario)
  if (!proyectoId) return RESPUESTA(null, 400, 'proyecto_id tiene que ser un uuid.')
  if (!usuario) {
    return RESPUESTA(null, 400, `usuario tiene que ser texto de 1 a ${LIMITE_USUARIO} caracteres.`)
  }

  // --- ¿Existe y sigue participando? --------------------------------------
  // La landing no lista los CANCELADOS (ya no son participantes), así que
  // regar uno tampoco tendría dónde mostrarse: se contesta con lo que pasa
  // en pantalla. La FK es la red de seguridad para lo inexistente.
  const { data: proyecto, error: errorProyecto } = await admin
    .from('gran_cosecha_proyecto')
    .select('id, estado')
    .eq('id', proyectoId)
    .maybeSingle()
  if (errorProyecto) return RESPUESTA(null, 500, errorProyecto.message)
  if (!proyecto) return RESPUESTA(null, 404, 'No existe ese proyecto.')
  if (proyecto.estado === 'CANCELADO') {
    return RESPUESTA(null, 409, 'Ese proyecto ya no participa en el concurso.')
  }

  // --- El riego -----------------------------------------------------------
  // `ignoreDuplicates` es `ON CONFLICT DO NOTHING`: si el par ya existe no se
  // toca la fila (queda su fecha original) y `data` viene vacío — de ahí sale
  // `ya_regado`. Corridas en paralelo del mismo usuario no pueden pasar dos.
  const { data: fila, error: errorRiego } = await admin
    .from('gran_cosecha_riego')
    .upsert({ proyecto_id: proyectoId, usuario }, { onConflict: 'proyecto_id,usuario', ignoreDuplicates: true })
    .select('proyecto_id')
  if (errorRiego) {
    // FK corrida: el proyecto se fue entre la consulta de arriba y ésta.
    if (errorRiego.code === '23503') return RESPUESTA(null, 404, 'No existe ese proyecto.')
    return RESPUESTA(null, 500, errorRiego.message)
  }

  const { count, error: errorCuenta } = await admin
    .from('gran_cosecha_riego')
    .select('proyecto_id', { count: 'exact', head: true })
    .eq('proyecto_id', proyectoId)
  if (errorCuenta) return RESPUESTA(null, 500, errorCuenta.message)

  return RESPUESTA(
    {
      proyecto_id: proyectoId,
      usuario,
      ya_regado: !fila || fila.length === 0,
      riegos: count ?? 0
    },
    200
  )
})
