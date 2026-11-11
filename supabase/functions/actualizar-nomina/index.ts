// actualizar-nomina: refresca la tabla espejo `trabajadores_nomina`.
//
// La llaman DOS clientes:
//   · el cron diario (pg_cron + pg_net) con el header `x-cron-secret`;
//   · la app, desde el botón «Actualizar ahora» de la pantalla de Bonos,
//     con el JWT del usuario — y sólo si es LÍDER o GERENTE DE TALENTO
//     HUMANO, las mismas cerraduras que el RLS de la base.
//
// Qué hace, en una línea: por cada sucursal ACTIVA con ID de trabajadores,
// pide su nómina al API externa y la guarda CRUDA en la tabla. Si una tienda
// no responde, SUS FILAS SE QUEDAN COMO ESTABAN (el último estado bueno);
// se reemplazan sólo las de las tiendas que respondieron con gente, y una
// respuesta vacía tampoco borra: puede ser un bache del API y no una tienda
// deshabitada.
import { createClient } from 'npm:@supabase/supabase-js@2'

const API_KEY = Deno.env.get('COLABORADORES_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const SECRETO_CRON = Deno.env.get('NOMINA_CRON_SECRET')

// La misma que usa `listar-colaboradores`: nómina POR SUCURSAL.
const URL_API = 'https://desarrolloluxor.lat/api/talentohumano/employee/samir'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Content-Type': 'application/json'
}

const RESPUESTA = (cuerpo: unknown, httpStatus: number, respuestaStatus = 200, error?: string) =>
  new Response(JSON.stringify({ ok: httpStatus >= 200 && httpStatus < 300, status: httpStatus, data: cuerpo, error }), {
    status: respuestaStatus,
    headers: CORS
  })

interface Sucursal {
  id: string
  nombre: string
  shop_id: string | null
  branch_id: string | null
}

interface Resumen {
  sucursales_ok: number
  sucursales_fallo: number
  sin_id: number
  trabajadores: number
  /** Tiendas cuya nómina no se pudo leer: sus filas NO se tocaron. */
  fallos: string[]
  /** El mismo fallo, pero con el MOTIVO: para diagnosticar sin adivinar. */
  detalles: string[]
  /** Tiendas activas sin branchID: no se les pudo pedir nada. */
  sin_id_nombres: string[]
}

/**
 * El cuerpo que devuelve el API: a veces viene la lista DIRECTA (`[...]`) y
 * a veces envuelta en `{data: [...]}` o `{data: {data: [...]}}`. Los tres
 * formatos se desenvuelven acá — con sólo el envuelto, una lista directa
 * hacía que TODAS las sucursales cayeran en `fallos`.
 */
function listaDe(cuerpo: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(cuerpo)) return cuerpo as Record<string, unknown>[]
  const c = cuerpo as { data?: unknown } | null
  if (Array.isArray(c?.data)) return c.data as Record<string, unknown>[]
  const anidada = (c?.data as { data?: unknown } | undefined)?.data
  return Array.isArray(anidada) ? (anidada as Record<string, unknown>[]) : null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS })
  }

  if (!API_KEY || !SUPABASE_URL || !SERVICE_ROLE) {
    return RESPUESTA(null, 500, 200, 'Faltan secretos: COLABORADORES_API_KEY, SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.')
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

  // --- Autorización: el cron con su secreto, o un usuario con su JWT -----
  // El cron puede mandar su credencial de DOS formas: en el header
  // `x-cron-secret` (si el JWT de verificación de la función está APAGADO)
  // o como `Authorization: Bearer …` (si está ENCENDIDO, porque el gateway
  // exige un JWT válido antes de dejar pasar). Las dos valen lo mismo: el
  // secreto propio (`NOMINA_CRON_SECRET`) o la service role del proyecto,
  // que es la que queda guardada en `nomina_cron.secreto`. Quien tiene
  // cualquiera de las dos ya tiene permisos de servidor: acá no se gana
  // ninguno nuevo.
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const secreto = req.headers.get('x-cron-secret')
  const secretosDelCron = [SECRETO_CRON, SERVICE_ROLE].filter(Boolean)
  const esCron = Boolean(
    (secreto && secretosDelCron.includes(secreto)) || (bearer && secretosDelCron.includes(bearer))
  )
  if (!esCron) {
    if (!bearer) return RESPUESTA(null, 401, 401, 'Sin autorización.')
    const { data } = await admin.auth.getUser(bearer)
    if (!data.user) return RESPUESTA(null, 401, 401, 'Sesión inválida.')
    const { data: perfil } = await admin.from('profiles').select('rol, activo').eq('id', data.user.id).single()
    if (!perfil?.activo || (perfil.rol !== 'LIDER' && perfil.rol !== 'GERENTE_TH')) {
      return RESPUESTA(null, 403, 403, 'Sólo el Líder o el Gerente de Talento Humano actualizan la nómina.')
    }
  }

  // --- Las sucursales con las que se puede pedir nómina -------------------
  const { data: sucursales, error } = await admin
    .from('sucursales')
    .select('id, nombre, shop_id, branch_id')
    .eq('activa', true)
  if (error) return RESPUESTA(null, 500, 200, error.message)

  const resumen: Resumen = {
    sucursales_ok: 0,
    sucursales_fallo: 0,
    sin_id: 0,
    trabajadores: 0,
    fallos: [],
    detalles: [],
    sin_id_nombres: []
  }

  await Promise.all(
    ((sucursales ?? []) as Sucursal[]).map(async (s) => {
      const branch = (s.shop_id ?? s.branch_id ?? '').trim()
      if (!branch) {
        resumen.sin_id += 1
        resumen.sin_id_nombres.push(s.nombre)
        return
      }

      let registros: Record<string, unknown>[] | null = null
      let motivo = ''
      try {
        const r = await fetch(`${URL_API}?branchID=${encodeURIComponent(branch)}`, {
          headers: { API_KEY }
        })
        if (!r.ok) {
          motivo = `HTTP ${r.status}`
          throw new Error(motivo)
        }
        registros = listaDe(await r.json())
        if (!registros) {
          motivo = 'respuesta sin lista'
          throw new Error(motivo)
        }
      } catch (e) {
        if (!motivo) motivo = e instanceof Error ? e.message : String(e)
        resumen.sucursales_fallo += 1
        resumen.fallos.push(s.nombre)
        resumen.detalles.push(`${s.nombre} → ${motivo}`)
        return
      }

      // Vacío o sin personas identificables: no se borra nada. Un bache del
      // API no puede borrar la nómina de una tienda entera.
      const filas = registros
        .map((reg) => ({
          sucursal_id: s.id,
          nacionalidad:
            typeof reg.nationality === 'string' && reg.nationality.trim() ? reg.nationality.trim() : 'V',
          dni: Number(reg.dni),
          datos: reg,
          actualizado_en: new Date().toISOString()
        }))
        .filter((f) => Number.isFinite(f.dni) && f.dni > 0)
      if (!filas.length) {
        resumen.sucursales_ok += 1
        return
      }

      // 1) Se van los que ya no aparecen (se borra ANTES de insertar, para
      //    que un cambio de nacionalidad no se coma la fila nueva).
      const { data: actuales, error: errorLectura } = await admin
        .from('trabajadores_nomina')
        .select('dni, nacionalidad')
        .eq('sucursal_id', s.id)
      if (errorLectura) {
        resumen.sucursales_fallo += 1
        resumen.fallos.push(s.nombre)
        return
      }
      const nuevos = new Set(filas.map((f) => `${f.nacionalidad}|${f.dni}`))
      const aBorrar = ((actuales ?? []) as { dni: number; nacionalidad: string }[]).filter(
        (a) => !nuevos.has(`${a.nacionalidad}|${a.dni}`)
      )
      if (aBorrar.length) {
        const { error: errorBorrado } = await admin
          .from('trabajadores_nomina')
          .delete()
          .eq('sucursal_id', s.id)
          .in('dni', aBorrar.map((a) => a.dni))
        if (errorBorrado) {
          resumen.sucursales_fallo += 1
          resumen.fallos.push(s.nombre)
          return
        }
      }

      // 2) La foto nueva, idempotente por (sucursal, nacionalidad, dni).
      const { error: errorUpsert } = await admin
        .from('trabajadores_nomina')
        .upsert(filas, { onConflict: 'sucursal_id,nacionalidad,dni' })
      if (errorUpsert) {
        resumen.sucursales_fallo += 1
        resumen.fallos.push(s.nombre)
        return
      }

      resumen.sucursales_ok += 1
      resumen.trabajadores += filas.length
    })
  )

  resumen.fallos.sort()
  resumen.detalles.sort()
  resumen.sin_id_nombres.sort()
  resumen.actualizado_en = new Date().toISOString()
  return RESPUESTA(resumen, 200)
})
