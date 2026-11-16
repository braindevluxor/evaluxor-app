import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Package, RefreshCw } from 'lucide-react'
import {
  cargarMenuPublico,
  esUuid,
  registrarVisita,
  type MenuPublicoDatos
} from '../../lib/data/menuSucursal'
import { formatearPrecioBase } from '../../lib/scoring'

/**
 * EL MENÚ DE CLIENTES
 * -------------------
 * `/menu/:sucursalId`: la carta de UNA sucursal, abierta sin sesión (el QR
 * que el cliente escanea en la tienda). Lee por la RPC `ver_menu_publico`
 * —una sola llamada que devuelve la sucursal y sus productos activos— y no
 * trae NADA de edición: los productos los carga el encargado desde la
 * consola (`/menu-editor`).
 *
 * Organización: las CATEGORÍAS que armó el encargado (Entradas, Bebidas…)
 * se pegan arriba como pestañas —como en una carta moderna— y filtran la
 * lista; con una sola categoría (o ninguna) no hay pestañas y todo va
 * plano. Cada apertura se cuenta para el reporte del editor: una por hora
 * por navegador (`registrarVisita`), sin romper nunca la carta.
 *
 * Presentación: identidad corporativa de Supermercados Luxor —navy,
 * amarillo y rojo— con aire de carta gourmet: la tapa navy con el nombre
 * de la sucursal y su rombo, y tarjetas con foto grande, precio en chip
 * dorado y hover suave.
 */

type Estado = 'cargando' | 'listo' | 'no-existe' | 'fallo'

/** El aviso central de los tres estados que no son "con productos". */
function Aviso({
  titulo,
  detalle,
  onReintentar
}: {
  titulo: string
  detalle: string
  onReintentar?: () => void
}) {
  return (
    <div className="mx-auto mt-14 max-w-md rounded-2xl border border-slate-200 border-t-4 border-t-[#facc15] bg-white p-8 text-center shadow-sm">
      <h2 className="text-lg font-extrabold text-[#0a1e5e]">{titulo}</h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-500">{detalle}</p>
      {onReintentar ? (
        <button
          type="button"
          onClick={onReintentar}
          className="mt-5 inline-flex items-center gap-2 rounded-full bg-[#0a1e5e] px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#16266b]"
        >
          <RefreshCw className="h-4 w-4" />
          Reintentar
        </button>
      ) : null}
    </div>
  )
}

/** El rombo entre hilos de oro: el detalle que separa título y secciones. */
function Rombo({ className = '' }: { className?: string }) {
  return (
    <span className={`flex items-center justify-center gap-3 ${className}`} aria-hidden="true">
      <span className="h-px w-16 bg-gradient-to-r from-transparent to-[#facc15] sm:w-24" />
      <span className="block h-2.5 w-2.5 rotate-45 bg-[#dc2626] shadow-[0_0_10px_rgba(220,38,38,0.7)]" />
      <span className="h-px w-16 bg-gradient-to-l from-transparent to-[#facc15] sm:w-24" />
    </span>
  )
}

/** La categoría de un producto sin categoría: su propia pestaña. */
const SIN_CATEGORIA = 'Otros'

export function MenuPublico() {
  const { sucursalId } = useParams<{ sucursalId: string }>()
  const [estado, setEstado] = useState<Estado>('cargando')
  const [menu, setMenu] = useState<MenuPublicoDatos | null>(null)
  const [intento, setIntento] = useState(0)
  const [categoriaActiva, setCategoriaActiva] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    if (!sucursalId || !esUuid(sucursalId)) {
      setEstado('no-existe')
      return () => {
        vivo = false
      }
    }
    setEstado('cargando')
    cargarMenuPublico(sucursalId)
      .then((datos) => {
        if (!vivo) return
        if (!datos.sucursal) {
          setEstado('no-existe')
          return
        }
        setMenu(datos)
        setEstado('listo')
        // La apertura se cuenta aparte y sin esperarla: el contador no
        // retrasa ni puede tumbar la carta.
        void registrarVisita(sucursalId)
      })
      .catch(() => {
        if (vivo) setEstado('fallo')
      })
    return () => {
      vivo = false
    }
  }, [sucursalId, intento])

  const productos = (estado === 'listo' && menu?.productos) || []

  // Las pestañas salen de las categorías que armó el encargado, en el
  // orden en que aparecen los productos (la RPC ya los manda por `orden`);
  // sin categoría va a "Otros". Si hay UNA sola, no hay pestañas: se ve
  // todo plano, que es exactamente la carta de siempre.
  const categorias = [...new Set(productos.map((p) => p.categoria?.trim() || SIN_CATEGORIA))]
  const pestana =
    categoriaActiva && categorias.includes(categoriaActiva) ? categoriaActiva : categorias[0]
  const filtrados = productos.filter(
    (p) => (p.categoria?.trim() || SIN_CATEGORIA) === pestana
  )
  const hayPestanas = categorias.length > 1

  return (
    <div className="flex min-h-screen flex-col bg-[#f4f6fb] font-sans text-[#0a1e5e]">
      {/* TAPA: la banda navy con la marca y el nombre de la sucursal —
          el mismo bookend arriba y abajo que se ve en las cartas de
          restaurante. */}
      <header className="border-b-4 border-[#facc15] bg-gradient-to-b from-[#0a1e5e] to-[#081a47]">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <img
            src="/supermercados-luxor.png"
            alt="Supermercados Luxor"
            className="h-10 w-auto rounded-lg bg-white px-2 py-1 shadow-sm"
          />
          <span className="rounded-full border border-[#facc15]/50 bg-[#facc15]/15 px-3 py-1 text-[11px] font-black uppercase tracking-[0.2em] text-[#facc15]">
            Menú
          </span>
        </div>

        <div className="mx-auto max-w-3xl px-4 pb-9 pt-5 text-center">
          <p className="text-[11px] font-black uppercase tracking-[0.4em] text-[#facc15]/90">
            Supermercados Luxor
          </p>
          <h1 className="mt-2.5 text-4xl font-black uppercase leading-none tracking-tight text-white sm:text-5xl">
            {estado === 'listo' && menu?.sucursal ? menu.sucursal.nombre : 'Menú'}
          </h1>
          <Rombo className="mt-4 justify-center" />
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-20">
        {estado === 'cargando' ? (
          <div className="space-y-3 py-12" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-32 animate-pulse rounded-2xl border border-slate-200/70 bg-white shadow-sm"
              />
            ))}
          </div>
        ) : null}

        {estado === 'no-existe' ? (
          <Aviso
            titulo="Este menú no existe"
            detalle="La sucursal fue desactivada o el enlace está incompleto. Consultá en tienda."
          />
        ) : null}

        {estado === 'fallo' ? (
          <Aviso
            titulo="No pudimos cargar el menú"
            detalle="Revisá tu conexión e intentá de nuevo en un momento."
            onReintentar={() => setIntento((n) => n + 1)}
          />
        ) : null}

        {estado === 'listo' && menu?.sucursal ? (
          productos.length === 0 ? (
            <Aviso
              titulo="Este menú todavía no tiene productos"
              detalle="El encargado de la sucursal está cargando la carta. Volvé a mirar en un rato."
            />
          ) : (
            <div className="pt-6">
              {/* Pestañas de categoría: se quedan pegadas arriba al
                  scrollear, para cambiar de sección sin volver al tope.
                  Sólo botones: la página no tiene campos de edición. */}
              {hayPestanas ? (
                <div className="sticky top-0 z-10 -mx-4 border-b border-slate-200 bg-[#f4f6fb]/95 px-4 py-3 backdrop-blur">
                  <div className="flex gap-2 overflow-x-auto">
                    {categorias.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setCategoriaActiva(c)}
                        aria-pressed={c === pestana}
                        className={`shrink-0 rounded-full px-4 py-2 text-xs font-black uppercase tracking-wider transition-colors ${
                          c === pestana
                            ? 'bg-[#facc15] text-[#0a1e5e] shadow-sm'
                            : 'border border-slate-300 bg-white text-slate-600 hover:border-[#facc15]'
                        }`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <ul className={`space-y-4 ${hayPestanas ? 'mt-4' : ''}`}>
                {filtrados.map((p, i) => (
                  <li
                    key={`${p.nombre}-${i}`}
                    className="group flex gap-4 rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-[0_1px_2px_rgba(10,30,94,0.05)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[#facc15] hover:shadow-[0_10px_28px_rgba(10,30,94,0.12)]"
                  >
                    <div className="h-28 w-28 shrink-0 overflow-hidden rounded-xl">
                      {p.foto ? (
                        <img
                          src={p.foto}
                          alt={p.nombre}
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#0a1e5e] to-[#1d3a8f]">
                          <Package className="h-9 w-9 text-[#facc15]" aria-hidden="true" />
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1 self-center">
                      <div className="flex items-start justify-between gap-3">
                        <p className="min-w-0 text-[15px] font-bold leading-snug text-[#0a1e5e]">
                          {p.nombre}
                        </p>
                        {p.precio != null ? (
                          <span className="shrink-0 rounded-full bg-gradient-to-b from-[#fde68a] to-[#facc15] px-3 py-1 text-[13px] font-black tabular-nums text-[#0a1e5e] shadow-sm ring-1 ring-[#eab308]/50">
                            {formatearPrecioBase(p.precio)}
                          </span>
                        ) : null}
                      </div>
                      {p.descripcion ? (
                        <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500">
                          {p.descripcion}
                        </p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )
        ) : null}
      </main>

      <footer className="border-t-4 border-[#facc15] bg-[#0a1e5e] py-6 text-center">
        <p className="text-[11px] font-black uppercase tracking-[0.3em] text-white/70">
          Supermercados Luxor
        </p>
      </footer>
    </div>
  )
}
