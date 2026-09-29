// =============================================================================
// EvaLuxor - App puente del biométrico Anviz D100
// -----------------------------------------------------------------------------
// Servidor HTTP local que expone los marcajes del lector para que la web de
// EvaLuxor los sincronice hacia Supabase.
//
//   GET /dispositivo  -> estado del lector: { conectado, modelo, serial, mensaje }
//   GET /marcajes     -> { marcajes: [{ dni, fecha, tipo }] }
//                        (filtros por query: ?desde=ISO&hasta=ISO)
//   GET /health       -> { ok, nombre, version, mock }
//
// Modo: MOCK está activo por defecto (datos de ejemplo) hasta integrar el SDK
// de Anviz. Para usar el lector real:    (Windows)  $env:MOCK='0'; node server.js
//                                         (POSIX)    MOCK=0 node server.js
// =============================================================================

import { createServer } from 'node:http'
import { leerDispositivo, leerMarcajes } from './lib/anviz-d100.js'

const PORT = Number(process.env.PORT ?? 8787)
const MOCK = process.env.MOCK !== '0'

const CABECERAS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8'
}

function responder(res, codigo, cuerpo) {
  res.writeHead(codigo, CABECERAS)
  res.end(JSON.stringify(cuerpo))
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    responder(res, 204, {})
    return
  }

  const url = new URL(req.url, `http://${req.headers.host ?? '127.0.0.1'}`)

  try {
    if (url.pathname === '/health') {
      responder(res, 200, { ok: true, nombre: 'EvaLuxor biométrico bridge', version: '0.1.0', mock: MOCK })
      return
    }

    if (url.pathname === '/dispositivo') {
      const info = await leerDispositivo({ mock: MOCK })
      responder(res, 200, info)
      return
    }

    if (url.pathname === '/marcajes') {
      const desde = url.searchParams.get('desde') ?? undefined
      const hasta = url.searchParams.get('hasta') ?? undefined
      const marcajes = await leerMarcajes(desde, hasta, { mock: MOCK })
      responder(res, 200, { marcajes })
      return
    }

    responder(res, 404, { error: `Ruta no encontrada: ${url.pathname}` })
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : 'Error interno del puente'
    responder(res, 500, { error: mensaje })
  }
})

// Solo escucha en loopback: los marcajes no deben quedar expuestos a la red.
server.listen(PORT, '127.0.0.1', () => {
  const modo = MOCK ? 'MOCK (datos de ejemplo)' : 'LECTURA REAL del D100 (SDK de Anviz)'
  console.log(`[EvaLuxor puente biométrico] http://127.0.0.1:${PORT} | modo: ${modo}`)
  if (MOCK) {
    console.log('  (Mock activo: configurá MOCK=0 cuando integres el SDK real de Anviz.)')
  }
})