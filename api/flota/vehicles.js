// Edge Function (Vercel): consulta una placa en el API de flota con un fetch
// limpio desde el servidor. Sin env de Node ni serverless AWS: corre en el
// edge de Vercel, con otra IP de salida.
//
// Si Cloudflare sigue bloqueando, el dueño de dev-logix debe permitir el acceso
// desde la IP de egress de Vercel (WAF rule) para /api/v1/vehicles/.
export const config = { runtime: 'edge' }

const API_KEY = process.env.VEHICLES_API_KEY ?? 'rba4OhQPqe5INOcz4UyyCyOw4vrD6uFnhn0yjaVqz5EkWwCIK_ZZ9Q'
const BACKEND = 'https://dev-logix.tusupermercadoluxor.com/api/v1/vehicles/'

export default async function handler(request) {
  const url = new URL(request.url)
  const placa = (url.searchParams.get('search') ?? '').trim()

  try {
    const dest = new URL(BACKEND)
    if (placa) dest.searchParams.set('search', placa)
    const r = await fetch(dest.toString(), {
      headers: {
        Accept: 'application/json',
        Authorization: `Api-Key ${API_KEY}`
      }
    })
    return new Response(await r.text(), { status: r.status, headers: { 'Content-Type': 'application/json' } })
  } catch {
    return Response.json({ detail: 'Sin conexión con el API de flota.' }, { status: 502 })
  }
}