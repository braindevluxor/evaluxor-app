import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, ExternalLink, Plus, Search, Trash2, Upload } from 'lucide-react'
import { avisar } from '../lib/aviso'
import { useAuth } from '../context/AuthContext'
import {
  agregarProducto,
  cargarMenu,
  guardarCategoria,
  guardarDescripcion,
  precioDeMenu,
  quitarProducto,
  reordenarMenu,
  subirFotoMenu,
  sucursalesActivas,
  visitasMenu,
  type ProductoMenu,
  type SucursalMenu,
  type VisitaPorHora
} from '../lib/data/menuSucursal'
import { buscarProducto, type ResultadoScan } from '../lib/data/precios'
import { formatearPrecioBase } from '../lib/scoring'
import { Button, ButtonIcon, Field, Input, SkeletonFilas, Spinner } from '../components/ui'
import { PortalCabecera } from '../components/PortalCabecera'

/** Fecha local en clave 'YYYY-MM-DD': el formato que espera la RPC. */
function isoDe(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * EL EDITOR DEL MENÚ
 * ------------------
 * La pantalla con la que el encargado —Gerente de Sucursal, o el Líder de
 * cualquier tienda— llena el menú público de su sucursal:
 *
 *  1. Busca por ID o código de barra contra la API de precios (el scan que
 *     ya usa la conciliación), con el `shop_id` de la sucursal.
 *  2. Agrega: nombre, PVP (`finalBase + finalTax`) y departamento quedan en
 *     `menu_productos`; re-agregar el mismo SKU refresca esos datos.
 *  3. Sube la foto (se convierte a WebP antes de subir) y reordena.
 *
 * La ruta pide `LIDER` o `GERENTE_S`, y la RLS vuelve a pedir lo mismo:
 * el encargado sólo escribe en SU sucursal (`es_encargado_menu`).
 */
export function MenuEditorPage() {
  const { profile } = useAuth()
  const esLider = profile?.rol === 'LIDER'
  const sucursalPropia = profile?.rol === 'GERENTE_S' ? (profile.sucursal_id ?? null) : null

  const [sucursales, setSucursales] = useState<SucursalMenu[] | null>(null)
  const [sucursalId, setSucursalId] = useState<string | null>(sucursalPropia)
  const [productos, setProductos] = useState<ProductoMenu[] | null>(null)
  const [codigo, setCodigo] = useState('')
  const [consultando, setConsultando] = useState(false)
  const [resultado, setResultado] = useState<{ sku: string; r: ResultadoScan } | null>(null)
  /** La categoría que se le asigna al agregar (con las ya usadas en el list). */
  const [categoriaNueva, setCategoriaNueva] = useState('')
  const [subiendoFoto, setSubiendoFoto] = useState<string | null>(null)
  /** Las aperturas de la página, de los últimos 7 días (`null` = cargando). */
  const [visitas, setVisitas] = useState<VisitaPorHora[] | null>(null)

  const sucursal = sucursales?.find((s) => s.id === sucursalId) ?? null
  // Las categorías que ya se están usando: son las sugerencias del input
  // (el encargado puede escribir una nueva o elegir una existente).
  const categoriasExistentes = [
    ...new Set(
      (productos ?? [])
        .map((p) => p.categoria?.trim())
        .filter((c): c is string => !!c)
    )
  ]

  // Las sucursales activas: el Líder elige entre todas y de ahí sale el
  // shop ID con el que se busca; el encargado entra directo en la suya.
  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        const lista = await sucursalesActivas()
        if (!vivo) return
        setSucursales(lista)
        setSucursalId(
          (actual) =>
            actual ??
            (esLider
              ? (lista[0]?.id ?? null)
              : (lista.find((s) => s.id === sucursalPropia)?.id ?? null))
        )
      } catch (e) {
        if (!vivo) return
        setSucursales([])
        avisar(e instanceof Error ? e.message : 'No se pudieron cargar las sucursales.', 'error')
      }
    })()
    return () => {
      vivo = false
    }
  }, [esLider, sucursalPropia])

  // El menú de la sucursal elegida.
  useEffect(() => {
    if (!sucursalId) return
    let vivo = true
    setProductos(null)
    cargarMenu(sucursalId)
      .then((l) => {
        if (vivo) setProductos(l)
      })
      .catch((e) => {
        if (!vivo) return
        setProductos([])
        avisar(e instanceof Error ? e.message : 'No se pudo cargar el menú.', 'error')
      })
    return () => {
      vivo = false
    }
  }, [sucursalId])

  // Las aperturas de la página del menú: los últimos 7 días, por hora.
  useEffect(() => {
    if (!sucursalId) return
    let vivo = true
    setVisitas(null)
    const hoy = new Date()
    const desde = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 6)
    visitasMenu(sucursalId, isoDe(desde), isoDe(hoy))
      .then((v) => {
        if (vivo) setVisitas(v)
      })
      .catch((e) => {
        if (!vivo) return
        setVisitas([])
        avisar(e instanceof Error ? e.message : 'No se pudieron cargar las visitas.', 'error')
      })
    return () => {
      vivo = false
    }
  }, [sucursalId])

  const buscar = async () => {
    const consulta = codigo.trim()
    if (!consulta || !sucursal) return
    if (!sucursal.shopId) {
      avisar(
        'La sucursal no tiene Nº de tienda (shop ID) configurado para consultar productos.',
        'error'
      )
      return
    }
    setConsultando(true)
    setResultado(null)
    try {
      const r = await buscarProducto(consulta, sucursal.shopId)
      if (r.nombre) {
        setResultado({ sku: consulta, r })
      } else {
        avisar(r.mensaje ?? 'No se encontró ningún producto con ese código.', 'aviso')
      }
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'Falló la consulta del producto.', 'error')
    } finally {
      setConsultando(false)
    }
  }

  const recargar = async () => {
    if (!sucursalId) return
    try {
      setProductos(await cargarMenu(sucursalId))
    } catch {
      avisar('No se pudo actualizar la lista.', 'error')
    }
  }

  const agregar = async () => {
    if (!resultado || !sucursalId) return
    try {
      await agregarProducto(sucursalId, resultado.sku, resultado.r, categoriaNueva)
      setResultado(null)
      setCodigo('')
      setCategoriaNueva('')
      await recargar()
      avisar('Producto agregado al menú.')
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo agregar el producto.', 'error')
    }
  }

  const quitar = async (producto: ProductoMenu) => {
    try {
      await quitarProducto(producto.id)
      setProductos((l) => (l ?? []).filter((p) => p.id !== producto.id))
      avisar('Producto quitado del menú.')
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo quitar el producto.', 'error')
    }
  }

  const mover = async (i: number, delta: -1 | 1) => {
    const lista = productos ?? []
    const j = i + delta
    if (j < 0 || j >= lista.length) return
    const nueva = [...lista]
    ;[nueva[i], nueva[j]] = [nueva[j], nueva[i]]
    setProductos(nueva)
    try {
      await reordenarMenu(nueva)
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo guardar el orden.', 'error')
      await recargar()
    }
  }

  const subirFoto = async (producto: ProductoMenu, archivo: File | undefined) => {
    if (!archivo || !sucursalId) return
    setSubiendoFoto(producto.id)
    try {
      const url = await subirFotoMenu(sucursalId, producto.sku, archivo)
      setProductos((l) => (l ?? []).map((p) => (p.id === producto.id ? { ...p, fotoUrl: url } : p)))
      avisar('Foto del producto actualizada.')
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo subir la foto.', 'error')
    } finally {
      setSubiendoFoto(null)
    }
  }

  // La descripción se guarda al salir del campo: el estado local se va
  // actualizando con cada tecla y sólo se persiste cuando se termina de
  // escribir (un error sí se avisa; el guardado exitoso no interrumpe).
  const persistirDescripcion = async (producto: ProductoMenu) => {
    try {
      await guardarDescripcion(producto.id, producto.descripcion ?? '')
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo guardar la descripción.', 'error')
      await recargar()
    }
  }

  // La categoría, con el mismo pacto que la descripción: se escribe y se
  // guarda al salir del campo. Mover un producto de pestaña es esto.
  const persistirCategoria = async (producto: ProductoMenu) => {
    try {
      await guardarCategoria(producto.id, producto.categoria ?? '')
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo guardar la categoría.', 'error')
      await recargar()
    }
  }

  /** Hoy y los 6 días previos, de mayor a menor, para el reporte. */
  const ultimos7Dias = (): { clave: string; etiqueta: string }[] => {
    const hoy = new Date()
    const dias: { clave: string; etiqueta: string }[] = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - i)
      dias.push({
        clave: isoDe(d),
        etiqueta:
          i === 0
            ? 'Hoy'
            : i === 1
              ? 'Ayer'
              : d.toLocaleDateString('es-VE', { day: 'numeric', month: 'short' })
      })
    }
    return dias
  }

  if (!sucursales) {
    return (
      <div className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-4">
        <SkeletonFilas n={4} />
      </div>
    )
  }

  // Un Gerente de Sucursal sin sucursal en el perfil no tiene dónde pararse.
  if (!esLider && !sucursalPropia) {
    return (
      <div className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <p className="text-sm font-bold text-slate-700">
          Tu perfil no tiene una sucursal asignada.
        </p>
        <p className="mt-1 text-sm text-slate-500">
          Pedile al Líder que te asigne la tienda desde Usuarios para poder cargar el menú.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PortalCabecera>
        {sucursalId ? (
          <a
            href={`/menu/${sucursalId}`}
            target="_blank"
            rel="noreferrer"
            title="Abrir el menú público de clientes en otra pestaña"
            className="inline-flex min-h-[34px] items-center gap-1.5 rounded-full border border-primary-200 bg-primary-50 px-3 py-1.5 text-xs font-semibold text-primary-700 transition-colors hover:bg-primary-100"
          >
            <ExternalLink className="h-4 w-4" />
            <span className="hidden sm:inline">Ver menú público</span>
          </a>
        ) : null}
      </PortalCabecera>

      {/* Las categorías ya usadas, como sugerencias de los dos inputs:
          el encargado escribe una nueva o elige una existente. */}
      <datalist id="categorias-menu">
        {categoriasExistentes.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      {esLider ? (
        <Field label="Sucursal" hint="El encargado siempre ve la suya; el Líder elige de qué tienda editar.">
          <select
            value={sucursalId ?? ''}
            onChange={(e) => {
              setSucursalId(e.target.value || null)
              setResultado(null)
              setCodigo('')
            }}
            className="w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-[#0a1e5e] focus:border-[#dc2626] focus:outline-none"
          >
            {sucursales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <span className="inline-block rounded-full bg-[#0a1e5e] px-4 py-1.5 text-xs font-black uppercase tracking-widest text-[#facc15]">
          {sucursal?.nombre ?? 'Mi sucursal'}
        </span>
      )}

      {/* Buscador: escanear o pegar el código, como lo pide el encargado. */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void buscar()
          }}
          className="flex flex-col gap-3 sm:flex-row"
        >
          <Input
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            placeholder="Código de barra o ID del producto"
            aria-label="Código de barra o ID del producto"
            disabled={consultando || !sucursal?.shopId}
            className="flex-1"
          />
          <Button type="submit" disabled={consultando || !codigo.trim() || !sucursal?.shopId}>
            {consultando ? <Spinner size={16} light /> : <Search className="h-4 w-4" />}
            <span>Buscar</span>
          </Button>
        </form>

        {!sucursal?.shopId ? (
          <p className="mt-2 text-xs font-semibold text-amber-700">
            Esta sucursal no tiene Nº de tienda (shop ID) configurado: no se puede consultar la
            API de precios hasta que el Líder lo cargue en Unidades.
          </p>
        ) : null}

        {resultado ? (
          <div className="mt-4 rounded-xl border-2 border-primary-100 bg-primary-50 p-3">
            <p className="text-sm font-extrabold text-[#0a1e5e]">{resultado.r.nombre}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-[#facc15] px-2.5 py-0.5 font-black text-[#0a1e5e]">
                {(() => {
                  const pvp = precioDeMenu(resultado.r)
                  return pvp != null ? formatearPrecioBase(pvp) : 'Sin precio'
                })()}
              </span>
              {resultado.r.departamento ? (
                <span className="rounded-full bg-[#dc2626]/10 px-2.5 py-0.5 font-bold text-[#dc2626]">
                  {resultado.r.departamento}
                </span>
              ) : null}
              <span className="text-slate-500">SKU {resultado.sku}</span>
            </div>
            <div className="mt-3 rounded-lg border border-transparent bg-white px-2 py-1.5 focus-within:border-[#dc2626]/40">
              <input
                list="categorias-menu"
                type="text"
                value={categoriaNueva}
                onChange={(e) => setCategoriaNueva(e.target.value)}
                placeholder="Categoría de la carta (ej. Entradas)"
                aria-label="Categoría del producto"
                className="w-full bg-transparent text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none"
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={() => void agregar()}>
                <Plus className="h-4 w-4" />
                <span>Agregar al menú</span>
              </Button>
              <button
                type="button"
                onClick={() => setResultado(null)}
                className="rounded-full border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 transition-colors hover:bg-slate-50"
              >
                Descartar
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* El menú tal como queda publicado. */}
      {productos === null ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <SkeletonFilas n={3} />
        </div>
      ) : productos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="text-sm font-bold text-slate-600">El menú está vacío.</p>
          <p className="mt-1 text-sm text-slate-500">
            Buscá un producto por código de barra o ID y agregalo para empezar.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {productos.map((p, i) => (
            <li
              key={p.id}
              className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"
            >
              <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-slate-100">
                {p.fotoUrl ? (
                  <img src={p.fotoUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-[10px] font-bold uppercase text-slate-400">
                    Sin foto
                  </span>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-extrabold text-[#0a1e5e]">{p.nombre}</p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className="rounded-full bg-[#facc15] px-2 py-0.5 font-black text-[#0a1e5e]">
                    {p.precio != null ? formatearPrecioBase(p.precio) : '—'}
                  </span>
                  {p.departamento ? <span>{p.departamento}</span> : null}
                  <span>SKU {p.sku}</span>
                </p>
                <input
                  type="text"
                  value={p.descripcion ?? ''}
                  placeholder="Descripción para la carta (opcional)"
                  aria-label={`Descripción de ${p.nombre}`}
                  onChange={(e) => {
                    const texto = e.target.value
                    setProductos((l) =>
                      (l ?? []).map((x) => (x.id === p.id ? { ...x, descripcion: texto || null } : x))
                    )
                  }}
                  onBlur={() => void persistirDescripcion(p)}
                  className="mt-1.5 w-full rounded-lg border border-transparent bg-slate-50 px-2 py-1 text-xs text-slate-600 placeholder:text-slate-400 focus:border-[#dc2626]/40 focus:bg-white focus:outline-none"
                />
                <input
                  list="categorias-menu"
                  type="text"
                  value={p.categoria ?? ''}
                  placeholder="Categoría (pestaña de la carta)"
                  aria-label={`Categoría de ${p.nombre}`}
                  onChange={(e) => {
                    const texto = e.target.value
                    setProductos((l) =>
                      (l ?? []).map((x) => (x.id === p.id ? { ...x, categoria: texto || null } : x))
                    )
                  }}
                  onBlur={() => void persistirCategoria(p)}
                  className="mt-1.5 w-full rounded-lg border border-transparent bg-slate-50 px-2 py-1 text-xs text-slate-600 placeholder:text-slate-400 focus:border-[#dc2626]/40 focus:bg-white focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-1">
                <ButtonIcon
                  onClick={() => void mover(i, -1)}
                  disabled={i === 0}
                  title="Subir en el orden"
                  aria-label={`Subir ${p.nombre}`}
                >
                  <ArrowUp className="h-4 w-4" />
                </ButtonIcon>
                <ButtonIcon
                  onClick={() => void mover(i, 1)}
                  disabled={i === productos.length - 1}
                  title="Bajar en el orden"
                  aria-label={`Bajar ${p.nombre}`}
                >
                  <ArrowDown className="h-4 w-4" />
                </ButtonIcon>
                <label
                  className={`inline-flex cursor-pointer items-center gap-1 rounded-full border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-600 transition-colors hover:bg-slate-50 ${
                    subiendoFoto === p.id ? 'opacity-60' : ''
                  }`}
                  title="Subir la foto del producto"
                >
                  {subiendoFoto === p.id ? <Spinner size={14} /> : <Upload className="h-4 w-4" />}
                  <span className="hidden sm:inline">Foto</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={subiendoFoto === p.id}
                    onChange={(e) => {
                      void subirFoto(p, e.target.files?.[0])
                      e.target.value = ''
                    }}
                  />
                </label>
                <ButtonIcon
                  variant="danger"
                  onClick={() => void quitar(p)}
                  title="Quitar del menú"
                  aria-label={`Quitar ${p.nombre}`}
                >
                  <Trash2 className="h-4 w-4" />
                </ButtonIcon>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Las aperturas de la página: por día y por hora (hora de
          Venezuela), que es lo que el encargado quiere ver para saber si
          su carta se está abriendo. Las horas futuras de hoy salen
          atenuadas —todavía no transcurrieron. */}
      {sucursalId ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <h3 className="text-sm font-black uppercase tracking-wider text-[#0a1e5e]">
              Visitas al menú
            </h3>
            <span className="text-[11px] text-slate-400">
              Últimos 7 días · hora de Venezuela
            </span>
          </div>

          {visitas === null ? (
            <p className="mt-3 text-xs text-slate-400">Cargando visitas…</p>
          ) : (
            <div className="mt-3 space-y-3">
              {ultimos7Dias().map(({ clave, etiqueta }) => {
                const delDia = visitas.filter((v) => v.fecha === clave)
                const total = delDia.reduce((s, v) => s + v.visitas, 0)
                const mapa = new Map(delDia.map((v) => [v.hora, v.visitas]))
                const esHoy = clave === isoDe(new Date())
                const horaAhora = new Date().getHours()
                return (
                  <div key={clave} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-black uppercase tracking-wider text-[#0a1e5e]">
                        {etiqueta}
                      </span>
                      <span
                        className={
                          total > 0
                            ? 'rounded-full bg-[#facc15] px-2 py-0.5 text-[11px] font-black text-[#0a1e5e]'
                            : 'text-[11px] font-bold text-slate-400'
                        }
                      >
                        {total} {total === 1 ? 'apertura' : 'aperturas'}
                      </span>
                    </div>
                    <div className="grid grid-cols-12 gap-1">
                      {Array.from({ length: 24 }, (_, h) => {
                        const n = mapa.get(h) ?? 0
                        const futuro = esHoy && h > horaAhora
                        return (
                          <span
                            key={h}
                            title={`${String(h).padStart(2, '0')}:00 — ${n} ${
                              n === 1 ? 'apertura' : 'aperturas'
                            }`}
                            className={`flex h-6 items-center justify-center rounded text-[10px] font-black tabular-nums ${
                              n > 0 ? 'bg-[#facc15] text-[#0a1e5e]' : 'bg-slate-100 text-slate-300'
                            } ${futuro ? 'opacity-40' : ''}`}
                          >
                            {n > 0 ? n : '·'}
                          </span>
                        )
                      })}
                    </div>
                    <div
                      className="mt-1 flex justify-between text-[9px] font-bold text-slate-400"
                      aria-hidden="true"
                    >
                      <span>00</span>
                      <span>06</span>
                      <span>12</span>
                      <span>18</span>
                      <span>23</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
