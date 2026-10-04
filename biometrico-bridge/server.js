// =============================================================================
// EvaLuxor - App puente del biométrico Anviz D100
// -----------------------------------------------------------------------------
// Servidor HTTP local que expone los marcajes del lector para que la web de
// EvaLuxor los sincronice hacia Supabase.
//
//   GET /health       -> { ok, nombre, version, modo }
//   GET /dispositivo  -> estado real del lector USB (lo que ve Windows)
//   GET /marcajes     -> { marcajes: [{ dni, fecha, tipo }], origen }
//                        (filtros: ?desde=ISO&hasta=ISO)
//   GET /origen       -> de qué archivo salió cada lote de marcajes
//
// MODO:
//   real   (default) lee los reportes exportados en data/ y consulta el lector
//   demo           genera marcajes de ejemplo (para probar sin el equipo)
//   Ver README.md para el detalle de por qué el USB no entrega los marcajes.
// =============================================================================

import { createServer } from 'node:http'
import { leerDispositivo, leerMarcajes, origenDeMarcajes } from './lib/anviz-d100.js'

const PUERTO = Number(process.env.PORT ?? 8787)
const MODO = process.env.MODO === 'demo' ? 'demo' : 'real'
const ES_DEMO = MODO === 'demo'

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
      responder(res, 200, { ok: true, nombre: 'EvaLuxor biométrico bridge', version: '0.2.0', modo: MODO })
      return
    }

    if (url.pathname === '/dispositivo') {
      // En demo el "lector" está por definición; en real, se lee el USB.
      const info = ES_DEMO
        ? {
            conectado: true,
            modelo: 'D100 (demo)',
            serial: 'D100-DEMO-0001',
            transporte: 'demo',
            transporteEtiqueta: 'Demo',
            sirve: true,
            mensaje: 'Modo demo: marcajes de ejemplo, sin leer el equipo real.'
          }
        : await leerDispositivo()
      responder(res, 200, info)
      return
    }

    if (url.pathname === '/marcajes') {
      const desde = url.searchParams.get('desde') ?? undefined
      const hasta = url.searchParams.get('hasta') ?? undefined
      const marcajes = await leerMarcajes(desde, hasta, { modo: MODO })
      const origen = ES_DEMO ? [{ archivo: '(demo)', leidos: marcajes.length }] : await origenDeMarcajes()
      responder(res, 200, { marcajes, origen })
      return
    }

    if (url.pathname === '/origen') {
      responder(res, 200, { origen: await origenDeMarcajes() })
      return
    }

    responder(res, 404, { error: `Ruta no encontrada: ${url.pathname}` })
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : 'Error interno del puente'
    responder(res, 500, { error: mensaje })
  }
})

// Solo escucha en loopback: los marcajes no deben quedar expuestos a la red.
server.listen(PUERTO, '127.0.0.1', () => {
  console.log(`[EvaLuxor puente biométrico] http://127.0.0.1:${PUERTO} | modo: ${MODO}`)
  if (ES_DEMO) {
    console.log('  Modo demo: marcajes de ejemplo. Para el equipo real: MODO=real node server.js')
  } else {
    console.log('  Leyendo reportes de data/. Conectá el D100 por USB y exportá desde el software de Anviz.')
  }
})
