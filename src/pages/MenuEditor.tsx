import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Download, ExternalLink, FileSpreadsheet, Plus, Search, Trash2, Upload } from 'lucide-react'
import { avisar } from '../lib/aviso'
import { useAuth } from '../context/AuthContext'
import {
  agregarProducto,
  cargarMenu,
  guardarCategoria,
  guardarDescripcion,
  guardarTurnos,
  importarMenuExcel,
  leerFilasMenuExcel,
  precioDeMenu,
  quitarProducto,
  reordenarMenu,
  subirFotoMenu,
  sucursalesActivas,
  turnosDe,
  TURNOS,
  type FilaImportMenu,
  type ProductoMenu,
  type ResumenImportMenu,
  type SucursalMenu
} from '../lib/data/menuSucursal'
import { buscarProducto, type ResultadoScan } from '../lib/data/precios'
import { formatearPrecioBase } from '../lib/scoring'
import { Button, ButtonIcon, Confirmar, Input, Modal, ProgressBar, SkeletonFilas, Spinner } from '../components/ui'
import { PortalCabecera } from '../components/PortalCabecera'
import { VisitasMenu } from '../components/VisitasMenu'

/** 1 → "1 creado", 2 → "2 creados": el resumen de la importación. */
function contar(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`
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
 *  4. Marca los TURNOS (M/T/N) en los que cada producto aparece.
 *
 * Las VISITAS viven aparte, en `VisitasMenu`: una tarjeta que abre el
 * modal con la curva de los 7 días y el detalle por hora de cada uno.
 *
 * La ruta pide `LIDER` o `GERENTE_S`, pero el Gerente de Sucursal la abre
 * en SÓLO LECTURA: ve su carta y su reporte de visitas y nada más. Quien
 * altera el menú es el Líder —la RLS (`menu_productos_gestion` y
 * `menu_fotos_encargado`) lo dice desde la base—, y esta pantalla acompaña
 * escondiendo los controles para que no haya un botón que falle.
 */
export function MenuEditorPage() {
  const { profile } = useAuth()
  const esLider = profile?.rol === 'LIDER'
  /** El Gerente de Sucursal sólo mira: no agrega, no edita, no borra. */
  const soloLectura = !esLider
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
  /** La importación desde Excel: filas leídas esperando la confirmación. */
  const [pendienteImport, setPendienteImport] = useState<FilaImportMenu[] | null>(null)
  /** ¿Está corriendo una importación? (barra de avance) */
  const [importando, setImportando] = useState(false)
  /** Avance de la importación: IDs procesados sobre el total. */
  const [avanceImport, setAvanceImport] = useState<{ hecho: number; total: number } | null>(null)
  /** El resumen de la última importación, para el recuadro con los detalles. */
  const [resumenImport, setResumenImport] = useState<ResumenImportMenu | null>(null)
  /** El modal de importación: instrucciones, plantilla y archivo. */
  const [importAbierto, setImportAbierto] = useState(false)

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

  /* ------------------------- IMPORTAR DESDE EXCEL ------------------------- */

  /** Lee el archivo elegido y deja las filas esperando la confirmación. */
  const elegirArchivoImport = async (archivo: File | undefined) => {
    if (!archivo) return
    try {
      const filas = await leerFilasMenuExcel(archivo)
      if (!filas.length) {
        avisar('El archivo no trae filas para importar.', 'aviso')
        return
      }
      setResumenImport(null)
      setPendienteImport(filas)
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo leer el archivo.', 'error')
    }
  }

  /**
   * Corre la importación con la decisión de la pantalla: los TRES
   * movimientos (crear, actualizar y eliminar) o sólo los dos primeros.
   * La confirmación ya se mostró —este es el botón que se apretó—.
   */
  const importar = async (eliminarFaltantes: boolean) => {
    const filas = pendienteImport
    setPendienteImport(null)
    if (!filas || !sucursalId || !sucursal?.shopId) return
    setImportando(true)
    setAvanceImport({ hecho: 0, total: filas.length })
    try {
      const resumen = await importarMenuExcel({
        sucursalId,
        shopId: sucursal.shopId,
        filas,
        eliminarFaltantes,
        alAvanzar: (hecho, total) => setAvanceImport({ hecho, total })
      })
      setResumenImport(resumen)
      await recargar()
      avisar(
        `Menú importado: ${contar(resumen.creados, 'creado', 'creados')}, ${contar(
          resumen.actualizados,
          'actualizado',
          'actualizados'
        )}${
          resumen.dadosDeBaja
            ? `, ${contar(resumen.dadosDeBaja, 'dado de baja', 'dados de baja')}`
            : ''
        }.`
      )
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo importar el menú.', 'error')
    } finally {
      setImportando(false)
      setAvanceImport(null)
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

  // Los TURNOS: se marca con un toque (no hay nada que escribir) y se
  // guarda al instante. La carta pública sólo lo muestra si su cadena
  // contiene el turno del momento (hora de Venezuela), así que dejarlo
  // sin turnos lo escondería de TODA la carta — por eso `turnosDe` tira
  // error con la lista vacía y acá se avisa en vez de guardar.
  const marcarTurno = async (producto: ProductoMenu, letra: string) => {
    const actuales = new Set((producto.turnos || 'MTN').split(''))
    if (actuales.has(letra)) actuales.delete(letra)
    else actuales.add(letra)
    let turnos: string
    try {
      turnos = turnosDe(actuales)
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'Marcá al menos un turno.', 'aviso')
      return
    }
    setProductos((l) => (l ?? []).map((p) => (p.id === producto.id ? { ...p, turnos } : p)))
    try {
      await guardarTurnos(producto.id, turnos)
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudieron guardar los turnos.', 'error')
      await recargar()
    }
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
        {/* El selector de sucursal vive en la BARRA, no en el cuerpo: el
            Líder cambia de tienda sin bajar de la pantalla, y el encargado
            ve la suya como etiqueta —no la puede cambiar—. El porqué está
            en el `title`, que era el hint del campo viejo. */}
        {esLider ? (
          <select
            value={sucursalId ?? ''}
            onChange={(e) => {
              setSucursalId(e.target.value || null)
              setResultado(null)
              setCodigo('')
            }}
            // Mientras corre una importación no se cambia de tienda: los
            // renglones van a la sucursal con la que arrancó.
            disabled={importando}
            aria-label="Sucursal que se está editando"
            title="El encargado siempre ve la suya; el Líder elige de qué tienda editar."
            className="h-[34px] max-w-[7rem] cursor-pointer rounded-full border border-primary-200 bg-primary-50 px-2.5 text-xs font-semibold text-primary-700 focus:border-[#dc2626] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 sm:max-w-[13rem] sm:px-3"
          >
            {sucursales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        ) : sucursalId ? (
          <span
            title="Tu sucursal: la tienda cuyo menú estás editando."
            className="inline-block max-w-[9rem] truncate rounded-full bg-[#0a1e5e] px-3 py-2.5 text-[11px] font-black uppercase tracking-widest text-[#facc15] sm:max-w-[14rem]"
          >
            {sucursal?.nombre ?? 'Mi sucursal'}
          </span>
        ) : null}

        {/* Importar: el botón vive en la barra y TODO el flujo pasa en el
            modal de abajo —instrucciones, plantilla y archivo—. Sólo el
            Líder: el Gerente de Sucursal mira, no altera. */}
        {soloLectura ? null : (
          <button
            type="button"
            onClick={() => setImportAbierto(true)}
            title="Importar la carta desde un archivo Excel"
            className="inline-flex min-h-[34px] items-center gap-1.5 rounded-full border border-primary-200 bg-primary-50 px-3 py-1.5 text-xs font-semibold text-primary-700 transition-colors hover:bg-primary-100"
          >
            <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Importar</span>
          </button>
        )}

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

      {/* Buscador: escanear o pegar el código, como lo pide el encargado.
          Para el Gerente de Sucursal esto es sólo lectura: no hay a quién
          escanear ni a dónde agregar, y el permiso real está en RLS. */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        {soloLectura ? (
          <p className="text-xs font-semibold text-slate-500">
            Vista de sólo lectura: el menú lo carga y lo modifica el Líder.
          </p>
        ) : (
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
        )}

        {!soloLectura && !sucursal?.shopId ? (
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
            {soloLectura
              ? 'Todavía no se cargó ningún producto en esta carta.'
              : 'Buscá un producto por código de barra o ID y agregalo para empezar.'}
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
                {soloLectura ? (
                  /* Sólo lectura: la descripción y la categoría se LEEN, no
                     se editan —el permiso está en RLS y acá no hay botón. */
                  <>
                    <p className="mt-1.5 text-xs text-slate-500">
                      <span className="font-semibold text-slate-400">Descripción:</span>{' '}
                      {p.descripcion || '—'}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      <span className="font-semibold text-slate-400">Categoría:</span>{' '}
                      {p.categoria || '—'}
                    </p>
                  </>
                ) : (
                  <>
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
                  </>
                )}

                {/* Los TURNOS en los que está disponible: M, T y N con su
                    horario en el title. La carta pública sólo lo muestra si
                    le toca —hora de Venezuela—, así que esto decide en qué
                    horario aparece el producto. Nace en los tres. */}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="mr-0.5 text-[10px] font-black uppercase tracking-wider text-slate-400">
                    Turnos
                  </span>
                  {TURNOS.map((t) => {
                    const marcado = (p.turnos || 'MTN').includes(t.letra)
                    const clase = `h-6 w-6 rounded-full border text-[11px] font-black transition-colors ${
                      marcado
                        ? 'border-[#0a1e5e] bg-[#0a1e5e] text-white'
                        : 'border-slate-300 bg-white text-slate-400 hover:border-[#0a1e5e]/50'
                    }`
                    // En sólo lectura son ETIQUETAS: el turno no se toca.
                    if (soloLectura) {
                      return (
                        <span
                          key={t.letra}
                          title={`${t.nombre} · ${t.horario}`}
                          aria-label={`${t.nombre} de ${p.nombre}`}
                          className={`inline-flex items-center justify-center ${clase}`}
                        >
                          {t.letra}
                        </span>
                      )
                    }
                    return (
                      <button
                        key={t.letra}
                        type="button"
                        onClick={() => void marcarTurno(p, t.letra)}
                        aria-pressed={marcado}
                        aria-label={`${t.nombre} de ${p.nombre}`}
                        title={`${t.nombre} · ${t.horario}`}
                        className={clase}
                      >
                        {t.letra}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Las acciones de edición no existen en sólo lectura:
                  reordenar, fotografiar y quitar son del Líder (y si
                  alguien las llamara a la fuerza, RLS las rechaza). */}
              {soloLectura ? null : (
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
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Las VISITAS: el botón se cuelga de la barra y el modal con la
          curva de los 7 días —y, al elegir uno, sus 24 horas en barras—
          vive en `VisitasMenu`, que además hace el pedido recién al
          abrirse. Sin sucursal no hay reporte que mostrar. */}
      {sucursalId ? <VisitasMenu sucursalId={sucursalId} /> : null}

      {/* LA IMPORTACIÓN: el botón está en la barra y todo el flujo pasa
          dentro de este modal —instrucciones, plantilla, archivo, avance
          y resumen—. Encima se monta el Confirmar de los tres movimientos,
          que es el único paso que puede tocar lo que ya hay. */}
      <Modal
        open={importAbierto}
        onClose={() => {
          // Mientras corre no se cierra: el avance y el resumen son lo
          // único que está pasando, y cerrar a mitad de camino deja la
          // lista sin recargar.
          if (!importando) setImportAbierto(false)
        }}
        title="Importar desde Excel"
        wide
      >
        <div className="space-y-4">
          <section>
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-400">
              Las tres columnas
            </h4>
            <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-slate-600">
              <li>
                <b className="text-[#0a1e5e]">ID del producto</b> — el código de barra o el ID que
                busca la consola.
              </li>
              <li>
                <b className="text-[#0a1e5e]">comentario</b> — el texto que muestra la carta
                (opcional).
              </li>
              <li>
                <b className="text-[#0a1e5e]">configuración</b> — las letras que aplican:{' '}
                <b>M</b> mañana (06:00 a 11:59), <b>T</b> tarde (12:00 a 17:59), <b>N</b> noche
                (18:00 a 05:59). Juntas o separadas — «MTN», «M, N», «Noche», «Todo el día» — y
                vacío = todo el día.
              </li>
            </ul>
            <p className="mt-2 text-xs text-slate-500">
              Los encabezados se reconocen solos, en el orden que estén y en la hoja que los
              traiga: la primera fila puede ser sólo de datos.
            </p>
          </section>

          <section className="rounded-xl border border-slate-100 bg-slate-50 p-3">
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-400">
              Qué hace con el menú actual
            </h4>
            <ul className="mt-2 space-y-1 text-xs leading-relaxed text-slate-600">
              <li>
                • Lo que <b>no estaba</b> se crea, buscando el ID en la API de precios.
              </li>
              <li>
                • Lo que <b>ya estaba</b> se actualiza y conserva su categoría y su foto.
              </li>
              <li>
                • Lo que <b>no aparece en el archivo</b> se da de baja — y antes te pregunta si
                querés.
              </li>
              <li>• Los IDs que la API no conoce se saltan y se listan al final.</li>
            </ul>
          </section>

          {!sucursal?.shopId ? (
            <p className="text-xs font-semibold text-amber-700">
              Esta sucursal no tiene Nº de tienda (shop ID) configurado: la API de precios no se
              puede consultar hasta que el Líder lo cargue en Unidades.
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
            {/* La plantilla con los tres encabezados, tal cual los lee el
                importador — está en public/ y se baja como cualquier asset. */}
            <a
              href="/plantilla-menu.xlsx"
              download
              title="Bajar la plantilla con los tres encabezados"
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2.5 text-xs font-black text-slate-600 transition-colors hover:bg-slate-50"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Descargar plantilla
            </a>
            <label
              className={`inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2.5 text-xs font-black text-slate-600 transition-colors hover:bg-slate-50 ${
                importando || !sucursal?.shopId
                  ? 'pointer-events-none cursor-not-allowed opacity-60'
                  : 'cursor-pointer'
              }`}
              title="Elegir el archivo Excel con la carta"
            >
              <Upload className="h-4 w-4" aria-hidden="true" />
              Elegir archivo
              <input
                type="file"
                accept=".xlsx"
                className="hidden"
                disabled={importando || !sucursal?.shopId}
                onChange={(e) => {
                  void elegirArchivoImport(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
            </label>
          </div>

          {importando && avanceImport ? (
            <div className="space-y-1.5">
              <ProgressBar value={(avanceImport.hecho / Math.max(1, avanceImport.total)) * 100} />
              <p className="text-xs font-bold text-slate-500">
                Importando {avanceImport.hecho} de {avanceImport.total}… no cierres esta ventana.
              </p>
            </div>
          ) : null}

          {resumenImport && !importando ? (
            <div className="space-y-1.5 rounded-xl border border-primary-100 bg-primary-50 p-3">
              <p className="text-xs font-black text-[#0a1e5e]">
                {contar(resumenImport.creados, 'creado', 'creados')} ·{' '}
                {contar(resumenImport.actualizados, 'actualizado', 'actualizados')}
                {resumenImport.dadosDeBaja
                  ? ` · ${contar(resumenImport.dadosDeBaja, 'dado de baja', 'dados de baja')}`
                  : ''}
              </p>
              {resumenImport.sinId > 0 ? (
                <p className="text-xs text-slate-600">
                  {contar(resumenImport.sinId, 'Fila sin ID', 'Filas sin ID')} (no se importaron).
                </p>
              ) : null}
              {resumenImport.noEncontrados.length > 0 ? (
                <div className="text-xs">
                  <p className="font-bold text-slate-600">
                    La API no conoce{' '}
                    {resumenImport.noEncontrados.length === 1 ? 'este ID' : 'estos IDs'} (no se
                    importaron):
                  </p>
                  <p className="mt-0.5 break-all text-slate-500">
                    {resumenImport.noEncontrados.join(', ')}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </Modal>

      {/* LA PREGUNTA DE LA IMPORTACIÓN. Los tres movimientos son el camino
          completo, pero ELIMINAR es el destructivo y va confirmado: el que
          sólo quiere sumar productos tiene su propio botón, y Cancelar no
          toca nada (las filas quedan leídas para volver a elegir). */}
      <Confirmar
        open={pendienteImport !== null}
        texto="¿Desea crear lo que no existe, actualizar lo que existe y eliminar lo que no esté en el archivo de importación?"
        textoConfirmar="Sí, importar todo"
        onConfirm={() => void importar(true)}
        textoSecundario="Sólo crear y actualizar"
        onSecundario={() => void importar(false)}
        onCancel={() => setPendienteImport(null)}
      />
    </div>
  )
}
