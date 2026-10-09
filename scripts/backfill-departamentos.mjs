// Backfill de `departamento` para los productos que ya estaban conciliados.
//
// Los productos viven dentro de `respuestas.valor->'productos'` (jsonb), y el
// departamento se empezó a guardar después de que muchas conciliaciones ya
// estuvieran escaneadas. Este script no escribe en la base: arma el mapa
// código de barras → departamento consultando la API de precios, y escribe el
// SQL que sí lo aplica (eso lo corre a mano en el SQL Editor, con
// `supabase/departamentos-backfill.sql` ya instalado).
//
//   1. Corré `scripts/exportar-productos-conciliados.sql` en el SQL Editor y
//      exportá el resultado a `scripts/productos-conciliados.csv`.
//   2. npm run backfill:departamentos
//   3. Revisá `scripts/backfill/departamentos.csv`.
//   4. Pegá `scripts/backfill/departamentos.sql` en el SQL Editor.
//
// No hace falta service_role: el script solo lee un CSV y habla con la API.
//
// La API_KEY sale del entorno (PRECIOS_API_KEY o VITE_PRECIOS_API_KEY) y, si no
// está, se intenta leer de `.env`. Sin key la API responde 401.

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const aqui = dirname(fileURLToPath(import.meta.url))
const raiz = resolve(aqui, '..')

// El CSV de entrada y la carpeta de salida se pueden pasar por argumento, para
// probar el script sin pisar los archivos del backfill real:
//
//   node scripts/backfill-departamentos.mjs [entrada.csv] [carpeta-salida]
const ENTRADA = resolve(process.argv[2] || resolve(aqui, 'productos-conciliados.csv'))
const SALIDA_DIR = resolve(process.argv[3] || resolve(aqui, 'backfill'))
const SALIDA_CSV = resolve(SALIDA_DIR, 'departamentos.csv')
const SALIDA_SQL = resolve(SALIDA_DIR, 'departamentos.sql')

const API = 'https://deliveryluxor.store/api/pricing/samir/scan'

// Se van de a uno, con pausa. La API es un Express detrás de Cloudflare: pedirle
// miles de códigos pegados al cuete la tira abajo y no vale la pena.
const PAUSA_MS = 150
const REINTENTOS = 3

// El mapa puede quedar con miles de entradas. Se parte en trozos para que ninguna
// sentencia sea gigantesca y, si algo falla, se sepa en qué tramo fue.
const POR_LOTE = 500

// Tienda que se usa cuando la sucursal del producto no tiene shop_id cargado. El
// departamento del producto es del catálogo, no de la tienda, así que el código
// sale igual. La API rechaza un shop_id inexistente con "FUERA DE SERVICIO!".
const TIENDA_POR_DEFECTO = process.env.BACKFILL_SHOP_ID || '1'

// ---------------------------------------------------------------- API key ----

async function apiKey() {
  const delEntorno = process.env.PRECIOS_API_KEY || process.env.VITE_PRECIOS_API_KEY
  if (delEntorno && delEntorno.trim()) return delEntorno.trim()

  try {
    const env = await readFile(resolve(raiz, '.env'), 'utf8')
    const m = env.match(/^\s*(?:VITE_)?PRECIOS_API_KEY\s*=\s*(.*)$/m)
    if (m) {
      const valor = m[1].trim().replace(/^["']|["']$/g, '')
      if (valor) return valor
    }
  } catch {
    // Sin .env tampoco es el fin: el error de abajo lo dice.
  }

  throw new Error(
    'Falta la API key. Definí PRECIOS_API_KEY en el entorno, o VITE_PRECIOS_API_KEY en .env'
  )
}

// ------------------------------------------------------------------- CSV -----

// Parser mínimo para el CSV que exporta el SQL Editor: campos entre comillas
// dobles, comillas dobles duplicadas adentro, saltos de línea dentro del campo.
// Lo justo, porque el archivo lo genera Postgres y no lo editamos a mano.
function leerCsv(txt) {
  const filas = []
  let campo = ''
  let fila = []
  let enComillas = false

  for (let i = 0; i < txt.length; i++) {
    const c = txt[i]

    if (enComillas) {
      if (c === '"') {
        if (txt[i + 1] === '"') {
          campo += '"'
          i++
        } else {
          enComillas = false
        }
      } else {
        campo += c
      }
      continue
    }

    if (c === '"') {
      enComillas = true
    } else if (c === ',') {
      fila.push(campo)
      campo = ''
    } else if (c === '\n') {
      fila.push(campo)
      filas.push(fila)
      fila = []
      campo = ''
    } else if (c !== '\r') {
      campo += c
    }
  }

  if (campo !== '' || fila.length > 0) {
    fila.push(campo)
    filas.push(fila)
  }

  return filas.filter((f) => f.some((x) => x.trim() !== ''))
}

function quitarBom(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}

function escaparCsv(valor) {
  const s = valor == null ? '' : String(valor)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// --------------------------------------------------------------- Consulta ----

const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

async function consultar(apiKeyValor, sku, shopId) {
  const url = `${API}?barcode=${encodeURIComponent(sku)}&shop_id=${encodeURIComponent(shopId)}`
  let ultimoError = null

  for (let intento = 1; intento <= REINTENTOS; intento++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json', API_KEY: apiKeyValor },
        signal: AbortSignal.timeout(30000),
      })

      const texto = await res.text()
      let cuerpo = null
      try {
        cuerpo = texto ? JSON.parse(texto) : null
      } catch {
        cuerpo = null
      }

      if (!res.ok) {
        const mensaje = (cuerpo && cuerpo.message) || texto.slice(0, 200) || `HTTP ${res.status}`

        // Ojo: la API responde 400 para dos cosas distintas. Un shop_id que no
        // existe da "FUERA DE SERVICIO! No se indentificó la tienda", y un código
        // que no está en el catálogo da "No se encontró el producto". El status
        // solo no las separa: hay que mirar el mensaje.
        if (/fuera de servicio|indentific|tienda/i.test(mensaje)) {
          return { estado: 'tienda-invalida', detalle: mensaje }
        }

        if (res.status === 404 || /no se encontr|not found/i.test(mensaje)) {
          return { estado: 'no-encontrado', detalle: mensaje }
        }

        // 401/403: la key está mal o no se mandó. Reintentar lo repite igual.
        if (res.status === 401 || res.status === 403) {
          return { estado: 'sin-permiso', detalle: mensaje }
        }

        ultimoError = `HTTP ${res.status}: ${mensaje}`
      } else if (cuerpo && cuerpo.department && cuerpo.department.name) {
        return { estado: 'ok', departamento: String(cuerpo.department.name).trim() }
      } else {
        // 200 pero sin departamento. Vale la pena ver qué vino, porque un 200 sin
        // producto rarejo suele ser el síntoma de otra cosa.
        return {
          estado: 'sin-departamento',
          detalle: `HTTP ${res.status}, cuerpo=${cuerpo ? Object.keys(cuerpo).join('/') : 'vacio'}`,
        }
      }
    } catch (err) {
      ultimoError = err && err.message ? err.message : String(err)
    }

    if (intento < REINTENTOS) await dormir(PAUSA_MS * intento * 3)
  }

  return { estado: 'error', detalle: ultimoError }
}

// ------------------------------------------------------------------ Main -----

async function main() {
  const key = await apiKey()

  let csv
  try {
    csv = quitarBom(await readFile(ENTRADA, 'utf8'))
  } catch {
    throw new Error(
      `No se encontró ${ENTRADA}.\n` +
        'Corré scripts/exportar-productos-conciliados.sql en el SQL Editor y exportá el CSV ahí.'
    )
  }

  const filas = leerCsv(csv)
  if (filas.length < 2) throw new Error('El CSV no tiene filas de datos.')

  const encabezado = filas[0].map((h) => h.trim().toLowerCase())
  const colShop = encabezado.indexOf('shop_id')
  const colSku = encabezado.indexOf('sku')
  if (colShop === -1 || colSku === -1) {
    throw new Error(
      `El CSV tiene que traer las columnas shop_id y sku. Encontró: ${filas[0].join(', ')}`
    )
  }

  // Una fila por combinación código + tienda. El mismo código en dos sucursales
  // se consulta una vez por tienda, que es lo que la API necesita.
  //
  // Si la sucursal no tiene shop_id cargado no se puede resolver con su tienda, pero
  // el departamento es del catálogo y no de la tienda: sale igual con la tienda por
  // defecto. Antes se cuenta y se avisa, porque si muchas sucursales están así lo
  // probable es que falte configurarlas y no que el dato esté mal.
  const pedidos = []
  const vistos = new Set()
  let sinTienda = 0
  for (const fila of filas.slice(1)) {
    const shopCrudo = (fila[colShop] || '').trim()
    const sku = (fila[colSku] || '').trim()
    if (!sku) continue
    if (!shopCrudo) sinTienda++
    const shopId = shopCrudo || TIENDA_POR_DEFECTO
    const clave = `${shopId}|${sku}`
    if (vistos.has(clave)) continue
    vistos.add(clave)
    pedidos.push({ shopId, sku })
  }

  console.log(`Códigos a consultar: ${pedidos.length}`)
  if (sinTienda > 0) {
    console.log(
      `Aviso: ${sinTienda} filas venían sin shop_id; se consultaron con la tienda ${TIENDA_POR_DEFECTO} por defecto.`
    )
  }

  const mapa = {}
  const sinDepartamento = []
  const conteo = {
    ok: 0,
    'no-encontrado': 0,
    'sin-departamento': 0,
    'tienda-invalida': 0,
    'sin-permiso': 0,
    error: 0,
  }

  for (let i = 0; i < pedidos.length; i++) {
    const { shopId, sku } = pedidos[i]
    const r = await consultar(key, sku, shopId)

    conteo[r.estado] = (conteo[r.estado] || 0) + 1

    if (r.estado === 'ok') {
      // El departamento es del catálogo, no de la tienda: si el mismo código
      // aparece con dos nombres distintos, se gana el primero y se avisa.
      if (mapa[sku] && mapa[sku] !== r.departamento) {
        console.warn(`  ! ${sku}: "${mapa[sku]}" vs "${r.departamento}" — se queda el primero`)
      } else {
        mapa[sku] = r.departamento
      }
    } else if (r.estado === 'sin-permiso') {
      // Si la key está mal no tiene sentido seguir gastando requests.
      throw new Error(`La API rechazó la key: ${r.detalle}`)
    } else {
      // Todo lo que no se pudo resolver va al reporte. Un código que no está en el
      // catálogo es normal (el evaluador lo escaneó de memoria), pero hay que
      // verlo para saber cuánto se quedó sin departamento.
      sinDepartamento.push({ sku, shopId, estado: r.estado, detalle: r.detalle || '' })
    }

    if ((i + 1) % 25 === 0 || i + 1 === pedidos.length) {
      console.log(`  ${i + 1}/${pedidos.length}…`)
    }

    if (i + 1 < pedidos.length) await dormir(PAUSA_MS)
  }

  await mkdir(SALIDA_DIR, { recursive: true })

  // CSV para revisión humana.
  const pares = Object.entries(mapa).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const lineas = ['sku,departamento', ...pares.map(([s, d]) => `${escaparCsv(s)},${escaparCsv(d)}`)]
  if (sinDepartamento.length) {
    lineas.push('')
    lineas.push('# Sin departamento')
    lineas.push('sku,shop_id,estado,detalle')
    for (const f of sinDepartamento) {
      lineas.push(
        [f.sku, f.shopId, f.estado, f.detalle].map(escaparCsv).join(',')
      )
    }
  }
  await writeFile(SALIDA_CSV, lineas.join('\n') + '\n', 'utf8')

  // SQL que arma el mapa y lo pasa a las funciones.
  const lotes = []
  for (let i = 0; i < pares.length; i += POR_LOTE) lotes.push(pares.slice(i, i + POR_LOTE))

  const sql = [
    `-- Backfill de departamento para los productos ya conciliados.`,
    `-- Generado por scripts/backfill-departamentos.mjs — revisá el CSV antes de correr esto.`,
    `--`,
    `-- Requiere supabase/departamentos-backfill.sql instalado (crea las dos funciones).`,
    `--`,
    `-- Cada lote va en dos pasos: primero el preview, que solo lista lo que se va a`,
    `-- tocar sin escribir nada, y después el select que lo escribe. Corré el preview`,
    `-- y mirá que la cantidad de filas sea la que esperás antes de seguir.`,
    `--`,
    `-- Es idempotente: lo que ya tiene departamento no se toca, así que podés`,
    `-- correrlo de nuevo sin miedo.`,
    '',
  ]
  for (const [i, lote] of lotes.entries()) {
    const json = JSON.stringify(Object.fromEntries(lote)).replace(/'/g, "''")
    sql.push(`-- === lote ${i + 1}/${lotes.length} (${lote.length} códigos) ===`)
    sql.push(`-- Preview: productos a los que se les va a poner departamento. No escribe nada.`)
    sql.push(
      `select * from public.previsualizar_departamentos('${json}'::jsonb) order by codigo;`
    )
    sql.push('')
    sql.push(`-- Aplicar: devuelve cuántas respuestas actualizó.`)
    sql.push(`select public.aplicar_departamentos('${json}'::jsonb) as respuestas_actualizadas;`)
    sql.push('')
  }

  if (!lotes.length) {
    sql.push('-- No hay códigos con departamento: nada que aplicar.')
    sql.push('')
  }

  await writeFile(SALIDA_SQL, sql.join('\n'), 'utf8')

  console.log('')
  console.log(`Con departamento:  ${Object.keys(mapa).length}`)
  console.log(`No en el catálogo: ${conteo['no-encontrado'] || 0}  (la API no conoce el código)`)
  console.log(`Sin departamento:  ${conteo['sin-departamento'] || 0}  (respondió 200 pero sin department)`)
  console.log(`Tienda inválida:   ${conteo['tienda-invalida'] || 0}  (shop_id que la API rechaza)`)
  console.log(`Fallos de red:     ${conteo.error || 0}`)
  console.log('')
  console.log(`Revisá: ${SALIDA_CSV}`)
  console.log(`Corré:   ${SALIDA_SQL}`)
}

main().catch((err) => {
  console.error('')
  console.error(err && err.message ? err.message : err)
  process.exitCode = 1
})