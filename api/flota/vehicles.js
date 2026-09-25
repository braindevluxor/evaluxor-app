// Serverless function (Vercel): consulta una placa en el API de flota con un
// fetch limpio desde el servidor. A diferencia de un rewrite (que reenvía los
// headers del cliente como x-forwarded-for y Cloudflare lo bloquea), acá se
// construye la petición con los únicos headers necesarios.
const API_KEY = process.env.VEHICLES_API_KEY ?? 'rba4OhQPqe5INOcz4UyyCyOw4vrD6uFnhn0yjaVqz5EkWwCIK_ZZ9Q'
const BACKEND = 'https://dev-logix.tusupermercadoluxor.com/api/v1/vehicles/'

export default async function handler(req, res) {
  const placa = String(req.query?.['search'] ?? '').trim()

  try {
    const url = new URL(BACKEND)
    if (placa) url.searchParams.set('search', placa)
    const r = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        Authorization: `Api-Key ${API_KEY}`
      }
    })
    const text = await r.text()
    res.status(r.status)
    res.setHeader('Content-Type', 'application/json')
    res.send(text)
  } catch {
    res.status(502).json({ detail: 'Sin conexión con el API de flota.' })
  }
}