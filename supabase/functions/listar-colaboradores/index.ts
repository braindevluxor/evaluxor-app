const API_KEY = Deno.env.get('COLABORADORES_API_KEY') ?? 'PBDFeysVkGLa0zRfq5bYEUtNbmV0akhtN3hFakRES3E2cU82TVE9PQ=='

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json'
}

const RESPUESTA = (cuerpo: unknown, httpStatus: number, respuestaStatus = 200, error?: string) =>
  new Response(
    JSON.stringify({ ok: httpStatus >= 200 && httpStatus < 300, status: httpStatus, data: cuerpo, error }),
    {
      status: respuestaStatus,
      headers: CORS
    }
  )

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS })
  }

  try {
    const { branchID } = await req.json()
    if (!branchID) {
      return RESPUESTA(null, 400, 200)
    }

    const url = new URL('https://desarrolloluxor.lat/api/talentohumano/employee/samir')
    url.searchParams.set('branchID', String(branchID))

    const res = await fetch(url.toString(), { headers: { API_KEY } })

    let cuerpo: unknown = null
    try {
      cuerpo = await res.json()
    } catch {
      cuerpo = null
    }

    return RESPUESTA(cuerpo, res.status)
  } catch (e) {
    return RESPUESTA(null, 500, 200, e instanceof Error ? e.message : String(e))
  }
})