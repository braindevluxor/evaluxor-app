import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Package, RefreshCw } from 'lucide-react'
import {
  cargarMenuPublico,
  esUuid,
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
 * Identidad: los colores corporativos de Supermercados Luxor —navy, amarillo
 * y rojo— con el logo real en la cabecera.
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
    <div className="mx-auto mt-14 max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <h1 className="text-lg font-extrabold text-[#0a1e5e]">{titulo}</h1>
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

export function MenuPublico() {
  const { sucursalId } = useParams<{ sucursalId: string }>()
  const [estado, setEstado] = useState<Estado>('cargando')
  const [menu, setMenu] = useState<MenuPublicoDatos | null>(null)
  const [intento, setIntento] = useState(0)

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
      })
      .catch(() => {
        if (vivo) setEstado('fallo')
      })
    return () => {
      vivo = false
    }
  }, [sucursalId, intento])

  // Los productos se agrupan por departamento en el orden en que llegan
  // (la RPC ya los manda por `orden`); sin departamento van a "Productos".
  const grupos: { departamento: string; items: NonNullable<MenuPublicoDatos['productos']> }[] = []
  if (estado === 'listo' && menu) {
    for (const p of menu.productos) {
      const clave = p.departamento?.trim() || 'Productos'
      const grupo = grupos.find((g) => g.departamento === clave)
      if (grupo) grupo.items.push(p)
      else grupos.push({ departamento: clave, items: [p] })
    }
  }

  return (
    <div className="min-h-screen bg-[#f4f6fb] text-[#0a1e5e]">
      {/* Cabecera corporativa: navy con el logo real sobre blanco y el
          chip amarillo de la marca. */}
      <header className="border-b-4 border-[#facc15] bg-[#0a1e5e]">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <img
            src="/supermercados-luxor.png"
            alt="Supermercados Luxor"
            className="h-10 w-auto rounded-lg bg-white px-2 py-1 shadow-sm"
          />
          <span className="rounded-full bg-[#facc15] px-3 py-1 text-[11px] font-black uppercase tracking-widest text-[#0a1e5e]">
            Menú
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-20">
        {estado === 'cargando' ? (
          <div className="space-y-3 py-14">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-2xl bg-white shadow-sm" />
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
          <>
            <div className="pb-6 pt-9 text-center">
              <h1 className="text-3xl font-black uppercase leading-tight tracking-tight">
                {menu.sucursal.nombre}
              </h1>
              <p className="mt-1.5 text-xs font-black uppercase tracking-[0.2em] text-[#dc2626]">
                Supermercados Luxor
              </p>
            </div>

            {menu.productos.length === 0 ? (
              <Aviso
                titulo="Este menú todavía no tiene productos"
                detalle="El encargado de la sucursal está cargando la carta. Volvé a mirar en un rato."
              />
            ) : (
              grupos.map((g) => (
                <section key={g.departamento} className="mb-9">
                  <h2 className="mb-3 inline-block rounded-full bg-[#0a1e5e] px-4 py-1.5 text-xs font-black uppercase tracking-widest text-[#facc15]">
                    {g.departamento}
                  </h2>
                  <ul className="space-y-3">
                    {g.items.map((p, i) => (
                      <li
                        key={`${p.nombre}-${i}`}
                        className="flex gap-4 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"
                      >
                        <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#0a1e5e]/5">
                          {p.foto ? (
                            <img
                              src={p.foto}
                              alt={p.nombre}
                              loading="lazy"
                              decoding="async"
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <Package className="h-8 w-8 text-[#0a1e5e]/30" aria-hidden="true" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1 self-center">
                          <p className="font-bold leading-snug">{p.nombre}</p>
                          {p.precio != null ? (
                            <span className="mt-2 inline-block rounded-full bg-[#facc15] px-3 py-1 text-sm font-black tabular-nums text-[#0a1e5e]">
                              {formatearPrecioBase(p.precio)}
                            </span>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            )}
          </>
        ) : null}
      </main>

      <footer className="border-t border-slate-200 bg-white py-5 text-center text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">
        Supermercados Luxor
      </footer>
    </div>
  )
}
