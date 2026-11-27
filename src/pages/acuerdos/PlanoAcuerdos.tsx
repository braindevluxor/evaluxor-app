import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { PortalCabecera } from '../../components/PortalCabecera'
import { Button, Confirmar, EmptyState, Field, Input, Modal, Select, Spinner } from '../../components/ui'
import { avisar } from '../../lib/aviso'
import { estadoEspacio, COLORES_ESTADO, neon, vigente } from '../../lib/acuerdos'
import {
  subirPlano,
  urlFirmada,
  type AcuerdoConRelacion,
  type CobroConAcuerdo,
  type Espacio,
  type PlanoSucursal,
  type SucursalAcuerdo,
  type TipoEspacio
} from '../../lib/data/acuerdos'
import { MapPin, Plus, Upload } from 'lucide-react'

const FORM = {
  tipo_id: '',
  codigo: '',
  detalle: '',
  x: 50,
  y: 50,
  forma: 'punto' as 'punto' | 'rectangulo' | 'circulo',
  ancho: 0,
  alto: 0
}

/** Tamaño mínimo (en % del plano) que tiene que tener un cuadro o círculo. */
const TAMANO_MINIMO = 2

/**
 * Techo del ALTO del plano, en unidades de viewport: la imagen es grande y
 * sin esto empuja la página entera (aparece scrollbar y el menú queda
 * arriba). El ancho máximo se calcula con la proporción de la foto.
 */
const ALTO_MAX = '78vh'

/** Zoom: el paso de cada toque de rueda o de botón, y sus límites. */
const PASO_ZOOM = 1.25
const ZOOM_MIN = 1
const ZOOM_MAX = 6

/**
 * El visor, acotado: al ampliar, la imagen no se puede sacar del marco
 * (siempre tiene que tapar el contenedor entero), y al volver al 100 %
 * queda exactamente en el origen.
 */
function acotarVisor(
  v: { zoom: number; x: number; y: number },
  ancho: number,
  alto: number
): { zoom: number; x: number; y: number } {
  return {
    zoom: v.zoom,
    x: Math.min(0, Math.max(ancho * (1 - v.zoom), v.x)),
    y: Math.min(0, Math.max(alto * (1 - v.zoom), v.y))
  }
}

/**
 * EL PLANO DE PISO DE VENTA
 * -------------------------
 * La imagen de la sucursal con sus espacios encima, posicionados en
 * porcentaje del ancho y del alto — así la imagen cambia de tamaño sin
 * reubicar nada—.
 *
 * EL COLOR ES EL ESTADO (un semáforo): ROJO si el espacio está DISPONIBLE,
 * VERDE si está OCUPADO y al día con sus cobros, AMARILLO si está OCUPADO
 * pero con cobros vencidos sin pagar. Lo decide `estadoEspacio()` contra el
 * día de hoy y lo cobrado, así que el plano se actualiza solo: no hay nada
 * que sincronizar.
 *
 * Quien gestiona (Coordinador) sube el plano, agrega espacios con un clic
 * sobre la imagen y los mueve; el Líder y el Auditor sólo lo miran.
 */
export function PlanoAcuerdos({
  sucursales,
  sucursalId,
  onSucursal,
  planos,
  espacios,
  tipos,
  acuerdos,
  cobros,
  puedeGestionar,
  onRecargar,
  onRecargarEspacios,
  tipoDe,
  onBorrarEspacio,
  onGuardarEspacio
}: {
  sucursales: SucursalAcuerdo[]
  sucursalId: string
  onSucursal: (id: string) => void
  planos: PlanoSucursal[]
  espacios: Espacio[]
  tipos: TipoEspacio[]
  acuerdos: AcuerdoConRelacion[]
  /** Lo ya cobrado: de acá sale si un ocupado está al día (verde) o con deuda (amarillo). */
  cobros: CobroConAcuerdo[]
  puedeGestionar: boolean
  /** Recarga TODO el módulo (la se sube una imagen nueva). */
  onRecargar: () => void
  onRecargarEspacios: () => Promise<void>
  tipoDe: (id: string) => string
  onBorrarEspacio: (e: Espacio) => void
  onGuardarEspacio: (entrada: {
    id?: string
    sucursal_id: string
    tipo_id: string
    codigo: string
    detalle?: string
    x: number
    y: number
    forma?: 'punto' | 'rectangulo' | 'circulo'
    ancho?: number
    alto?: number
  }) => Promise<void>
}) {
  const plano = planos.find((p) => p.sucursal_id === sucursalId) ?? null
  const [url, setUrl] = useState<string | null>(null)
  const [cargandoUrl, setCargandoUrl] = useState(false)

  /** La URL firmada del plano (bucket privado): se pide cuando cambia. */
  useEffect(() => {
    if (!plano) {
      setUrl(null)
      return
    }
    let vivo = true
    setCargandoUrl(true)
    urlFirmada(plano.imagen)
      .then((u) => {
        if (vivo) setUrl(u)
      })
      .catch((e) => avisar(e instanceof Error ? e.message : 'No se pudo abrir el plano.', 'error'))
      .finally(() => {
        if (vivo) setCargandoUrl(false)
      })
    return () => {
      vivo = false
    }
  }, [plano])

  const [form, setForm] = useState<typeof FORM | null>(null)
  const [editandoId, setEditandoId] = useState<string | null>(null)
  /** Tamaño REAL de la imagen: de acá sale el ancho máximo del contenedor. */
  const [dim, setDim] = useState<{ w: number; h: number } | null>(null)
  /** El VISOR: cuánto está ampliado el plano y dónde está corrido (paneo). */
  const [visor, setVisor] = useState({ zoom: 1, x: 0, y: 0 })
  /** El arrastre de paneo en curso (cuando hay zoom y no se está dibujando). */
  const [paneo, setPaneo] = useState<{ px: number; py: number; vx: number; vy: number } | null>(null)
  /**
   * El espacio RESALTADO (id): se pinta desde la leyenda y desde el plano,
   * así el código —que en la imagen a veces ni se lee— se encuentra igual.
   */
  const [resaltado, setResaltado] = useState<string | null>(null)
  const contRef = useRef<HTMLDivElement | null>(null)
  /** El modal está oculto esperando que el usuario elija sobre el plano. */
  const [eligiendo, setEligiendo] = useState(false)
  /** El trazo arrastrado (cuadro/círculo), en % del plano, mientras se dibuja. */
  const [trazo, setTrazo] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [borrar, setBorrar] = useState<Espacio | null>(null)

  /** El acuerdo VIGENTE de un espacio (el que le da el color). */
  const acuerdoDe = (espacioId: string) =>
    acuerdos.find((a) => a.espacio_id === espacioId && vigente(a)) ?? null

  /** Las fechas cobradas de CADA acuerdo: con eso se decide el color del semáforo. */
  const cobradasPorAcuerdo = useMemo(() => {
    const mapa = new Map<string, Set<string>>()
    for (const c of cobros) {
      const set = mapa.get(c.acuerdo_id) ?? new Set<string>()
      set.add(c.fecha)
      mapa.set(c.acuerdo_id, set)
    }
    return mapa
  }, [cobros])

  const abrirNuevo = (pos?: { x: number; y: number }) => {
    setEditandoId(null)
    setForm({ ...FORM, tipo_id: tipos[0]?.id ?? '', x: pos?.x ?? 50, y: pos?.y ?? 50 })
  }

  const abrirEdit = (e: Espacio) => {
    setEditandoId(e.id)
    setForm({
      tipo_id: e.tipo_id,
      codigo: e.codigo,
      detalle: e.detalle,
      x: Math.round(e.x * 10) / 10,
      y: Math.round(e.y * 10) / 10,
      forma: e.forma ?? 'punto',
      ancho: e.ancho ?? 0,
      alto: e.alto ?? 0
    })
  }

  /** Cambia la forma mientras se elige sobre el plano (barra flotante). */
  const cambiarForma = (forma: 'punto' | 'rectangulo' | 'circulo') => {
    setForm((f) =>
      f ? { ...f, forma, ancho: forma === 'punto' ? 0 : f.ancho || 10, alto: forma === 'punto' ? 0 : f.alto || 10 } : f
    )
  }

  /** El punto (en % del plano) de un evento, siempre dentro de la imagen. */
  const puntoEn = (ev: { clientX: number; clientY: number }, caja: DOMRect) => ({
    x: Math.min(100, Math.max(0, Math.round(((ev.clientX - caja.left) / caja.width) * 1000) / 10)),
    y: Math.min(100, Math.max(0, Math.round(((ev.clientY - caja.top) / caja.height) * 1000) / 10))
  })

  /**
   * Baja el puntero: empieza el TRAZO (si se está eligiendo) o el PANEO
   * (si hay zoom). Se usa POINTER (no mouse) y se captura el puntero, así
   * el arrastre sigue aunque el mouse salga de la imagen o se suelte
   * encima de un espacio.
   */
  const abajoEnPlano = (ev: ReactPointerEvent<HTMLDivElement>) => {
    if (!plano) return
    if (eligiendo) {
      if (!puedeGestionar || !form) return
      ev.preventDefault()
      const p = puntoEn(ev, ev.currentTarget.getBoundingClientRect())
      try {
        ev.currentTarget.setPointerCapture(ev.pointerId)
      } catch {
        /* sin captura: el trazo igual funciona mientras el puntero esté encima */
      }
      setTrazo({ x1: p.x, y1: p.y, x2: p.x, y2: p.y })
      return
    }
    // Con zoom, el arrastre mueve el plano (si no, sólo hay zoom y no se
    // puede ver el resto de la imagen).
    if (visor.zoom <= 1) return
    ev.preventDefault()
    try {
      ev.currentTarget.setPointerCapture(ev.pointerId)
    } catch {
      /* sin captura: el paneo igual funciona mientras esté encima */
    }
    setPaneo({ px: ev.clientX, py: ev.clientY, vx: visor.x, vy: visor.y })
  }

  const moverEnPlano = (ev: ReactPointerEvent<HTMLDivElement>) => {
    if (trazo) {
      const p = puntoEn(ev, ev.currentTarget.getBoundingClientRect())
      setTrazo((t) => (t ? { ...t, x2: p.x, y2: p.y } : t))
      return
    }
    if (!paneo) return
    const caja = contRef.current?.getBoundingClientRect()
    if (!caja) return
    setVisor((v) =>
      acotarVisor(
        { ...v, x: paneo.vx + (ev.clientX - paneo.px), y: paneo.vy + (ev.clientY - paneo.py) },
        caja.width,
        caja.height
      )
    )
  }

  /**
   * Suelta: un CLIC ubica el punto; un ARRASTRE dibuja la forma elegida.
   * Y si la forma era punto pero se arrastró, se convierte en cuadro sola —
   * así «arrastré y no pasó nada» no puede pasar.
   */
  const arribaEnPlano = (ev: ReactPointerEvent<HTMLDivElement>) => {
    setPaneo(null)
    if (!trazo || !form) return
    const p = puntoEn(ev, ev.currentTarget.getBoundingClientRect())
    const presion = trazo
    setTrazo(null)

    const ancho = Math.round(Math.abs(p.x - presion.x1) * 10) / 10
    const alto = Math.round(Math.abs(p.y - presion.y1) * 10) / 10
    const arrastre = ancho >= TAMANO_MINIMO || alto >= TAMANO_MINIMO

    if (!arrastre) {
      // Clic: el punto queda donde se tocó; una forma con tamaño arranca con el suyo.
      setForm((f) => {
        if (!f) return f
        return f.forma === 'punto'
          ? { ...f, x: presion.x1, y: presion.y1, ancho: 0, alto: 0 }
          : { ...f, x: presion.x1, y: presion.y1, ancho: f.ancho || 10, alto: f.alto || 10 }
      })
      setEligiendo(false)
      return
    }

    // Arrastre: centro + tamaño, con un piso mínimo para que se vea.
    setForm((f) => {
      if (!f) return f
      const forma = f.forma === 'punto' ? 'rectangulo' : f.forma
      const x = Math.round(((Math.min(presion.x1, p.x) + Math.max(presion.x1, p.x)) / 2) * 10) / 10
      const y = Math.round(((Math.min(presion.y1, p.y) + Math.max(presion.y1, p.y)) / 2) * 10) / 10
      return { ...f, forma, x, y, ancho: Math.max(ancho, TAMANO_MINIMO), alto: Math.max(alto, TAMANO_MINIMO) }
    })
    setEligiendo(false)
  }

  /** Esc cancela la elección sobre el plano y vuelve el modal. */
  useEffect(() => {
    if (!eligiendo) return
    const cancelar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setEligiendo(false)
        setTrazo(null)
      }
    }
    window.addEventListener('keydown', cancelar)
    return () => window.removeEventListener('keydown', cancelar)
  }, [eligiendo])

  /**
   * ZOOM CON LA RUEDA: se amplía alrededor del punto donde está el mouse
   * (si se ampliara desde la esquina, el plano se «escaparía» del marco).
   * Va como listener NATIVO y no pasivo: el `onWheel` de React no deja
   * hacer `preventDefault`, y sin eso la rueda además mueve la página.
   */
  useEffect(() => {
    const el = contRef.current
    if (!el) return
    const alRodar = (e: WheelEvent) => {
      e.preventDefault()
      const factor = e.deltaY < 0 ? PASO_ZOOM : 1 / PASO_ZOOM
      const caja = el.getBoundingClientRect()
      const mx = e.clientX - caja.left
      const my = e.clientY - caja.top
      setVisor((v) => {
        const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.zoom * factor))
        if (zoom === v.zoom) return v
        // El punto del plano bajo el mouse se queda clavado ahí.
        const px = (mx - v.x) / v.zoom
        const py = (my - v.y) / v.zoom
        return acotarVisor({ zoom, x: mx - px * zoom, y: my - py * zoom }, caja.width, caja.height)
      })
    }
    el.addEventListener('wheel', alRodar, { passive: false })
    return () => el.removeEventListener('wheel', alRodar)
  }, [])

  /** Zoom con los botones: alrededor del centro del marco. */
  const cambiarZoom = (factor: number) => {
    const el = contRef.current
    if (!el) return
    const caja = el.getBoundingClientRect()
    const mx = caja.width / 2
    const my = caja.height / 2
    setVisor((v) => {
      const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.zoom * factor))
      if (zoom === v.zoom) return v
      const px = (mx - v.x) / v.zoom
      const py = (my - v.y) / v.zoom
      return acotarVisor({ zoom, x: mx - px * zoom, y: my - py * zoom }, caja.width, caja.height)
    })
  }

  const guardar = async () => {
    if (!form || !sucursalId) return
    setGuardando(true)
    try {
      await onGuardarEspacio({
        id: editandoId ?? undefined,
        sucursal_id: sucursalId,
        tipo_id: form.tipo_id,
        codigo: form.codigo,
        detalle: form.detalle,
        x: form.x,
        y: form.y,
        forma: form.forma,
        ancho: form.ancho,
        alto: form.alto
      })
      setForm(null)
      setEditandoId(null)
      await onRecargarEspacios()
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo guardar el espacio.', 'error')
    } finally {
      setGuardando(false)
    }
  }

  const subir = async (file?: File | null) => {
    if (!file || !sucursalId) return
    try {
      await subirPlano(sucursalId, file)
      avisar('Plano actualizado.')
      onRecargar()
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo subir el plano.', 'error')
    }
  }

  return (
    <section className="space-y-4">
      {/* Los controles del plano viven en la BARRA SUPERIOR de la consola
          (PortalCabecera), junto a los de las otras vistas. */}
      <PortalCabecera>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={sucursalId}
            onChange={(e) => onSucursal(e.target.value)}
            aria-label="Sucursal del plano"
            className="h-10 w-auto min-w-[9.5rem] max-w-[11rem]"
          >
            {sucursales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </Select>

          <span className="hidden rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 sm:inline-block">
            {espacios.length} {espacios.length === 1 ? 'espacio' : 'espacios'}
          </span>

          {puedeGestionar ? (
            <>
              <label className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50">
                <Upload className="h-4 w-4" />
                {plano ? 'Cambiar plano' : 'Subir plano'}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    void subir(e.target.files?.[0])
                    e.target.value = ''
                  }}
                />
              </label>
              <Button onClick={() => abrirNuevo()} disabled={!plano && !tipos.length} className="h-10">
                <Plus className="h-4 w-4" /> Espacio
              </Button>
            </>
          ) : null}
        </div>
      </PortalCabecera>

      {!plano ? (
        <EmptyState
          title="Sin plano para esta sucursal"
          subtitle={
            puedeGestionar
              ? 'Subí la imagen del piso de venta para empezar a ubicar los espacios (cabezales, góndolas, checkout…).'
              : 'El Coordinador de Acuerdos todavía no cargó el plano de esta sucursal.'
          }
        />
      ) : (
        <div className="space-y-2">
          {eligiendo && form ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-primary-50 px-4 py-2">
              <p className="text-sm font-semibold text-primary-900">
                {form.forma === 'punto'
                  ? 'Hacé clic en el plano donde queda el punto.'
                  : `Arrastrá sobre el plano para dibujar ${form.forma === 'circulo' ? 'el círculo' : 'el cuadro'}.`}{' '}
                <span className="font-normal">(Esc para cancelar)</span>
              </p>
              {/* La forma se cambia acá mismo, sin volver al modal. */}
              <div className="ml-auto flex gap-1 rounded-lg bg-white p-1 shadow-sm">
                {(
                  [
                    ['punto', 'Punto'],
                    ['rectangulo', 'Cuadro'],
                    ['circulo', 'Círculo']
                  ] as const
                ).map(([valor, etiqueta]) => (
                  <button
                    key={valor}
                    type="button"
                    aria-pressed={form.forma === valor}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => cambiarForma(valor)}
                    className={`rounded-md px-2.5 py-1 text-xs font-bold transition-colors cursor-pointer ${
                      form.forma === valor ? 'bg-primary text-white' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {etiqueta}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {/* PLANO a la izquierda + LEYENDA a la derecha: el código del
              espacio en la imagen a veces ni se lee, así que la lista lo
              muestra entero y el resaltado va EN LOS DOS SENTIDOS. */}
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
          <div className="min-w-0 flex-1">
          <div
            ref={contRef}
            className={`relative mx-auto block w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ${
              eligiendo ? 'ring-2 ring-primary' : ''
            }`}
            // El plano NO puede empujar la página: su alto se techoa en
            // `ALTO_MAX` y el ancho máximo sale de la PROPORCIÓN de la
            // imagen (si no, el contenedor no calzaría con la foto y los
            // espacios dibujados se desalinearían). `min(100%, …)` evita
            // también el desborde horizontal en pantallas angostas.
            style={dim ? { maxWidth: `min(100%, calc(${ALTO_MAX} * ${dim.w / dim.h}))` } : undefined}
          >
            {/* El VISOR: la imagen y sus espacios, ampliables con la rueda
                y desplazables con el arrastre. El `transform` NO altera el
                layout, así que la página no crece ni genera scroll. */}
            <div
              className="relative"
              style={{
                transform: `translate(${visor.x}px, ${visor.y}px) scale(${visor.zoom})`,
                transformOrigin: 'top left',
                touchAction: eligiendo || visor.zoom > 1 ? 'none' : undefined,
                cursor: eligiendo ? 'crosshair' : visor.zoom > 1 ? (paneo ? 'grabbing' : 'grab') : undefined
              }}
              onPointerDown={abajoEnPlano}
              onPointerMove={moverEnPlano}
              onPointerUp={arribaEnPlano}
              role="presentation"
            >
            {cargandoUrl || !url ? (
              <div className="flex h-64 items-center justify-center">
                <Spinner />
              </div>
            ) : (
              <img
                src={url}
                alt="Plano de piso de venta"
                draggable={false}
                onLoad={(e) => setDim({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                className="block h-auto w-full select-none"
              />
            )}

            {/* El trazo en curso: un contorno punteado sobre la imagen. */}
            {trazo ? (
              <div
                className="pointer-events-none absolute border-2 border-dashed border-primary bg-primary-100/40"
                style={{
                  left: `${Math.min(trazo.x1, trazo.x2)}%`,
                  top: `${Math.min(trazo.y1, trazo.y2)}%`,
                  width: `${Math.abs(trazo.x2 - trazo.x1)}%`,
                  height: `${Math.abs(trazo.y2 - trazo.y1)}%`,
                  borderRadius: form?.forma === 'circulo' ? '50%' : 6
                }}
                aria-hidden
              />
            ) : null}

            {/* EL SEMÁFORO: ROJO disponible, VERDE ocupado y al día,
                AMARILLO ocupado con cobros vencidos sin pagar. */}
            {url
              ? espacios.map((esp) => {
                  const acuerdo = acuerdoDe(esp.id)
                  const estado = estadoEspacio(acuerdo, cobradasPorAcuerdo.get(acuerdo?.id ?? '') ?? new Set())
                  const color = COLORES_ESTADO[estado]
                  const titulo = `${esp.codigo} · ${tipoDe(esp.tipo_id)}${
                    esp.detalle ? ` — ${esp.detalle}` : ''
                  }${agreementLabel(acuerdo) ? ` · ${agreementLabel(acuerdo)}` : ' · Disponible'}${
                    estado === 'pendiente' ? ' · CON COBROS PENDIENTES' : ''
                  }`
                  const forma = esp.forma ?? 'punto'
                  const esPunto = forma === 'punto' || !esp.ancho || !esp.alto
                  const activo = resaltado === esp.id
                  return (
                    <button
                      key={esp.id}
                      type="button"
                      title={titulo}
                      aria-label={titulo}
                      onPointerDown={(ev) => ev.stopPropagation()}
                      onMouseEnter={() => setResaltado(esp.id)}
                      onMouseLeave={() => setResaltado((r) => (r === esp.id ? null : r))}
                      onFocus={() => setResaltado(esp.id)}
                      onBlur={() => setResaltado((r) => (r === esp.id ? null : r))}
                      onClick={(ev) => {
                        ev.stopPropagation()
                        if (puedeGestionar && !eligiendo) abrirEdit(esp)
                      }}
                      className={`absolute transition-all duration-150 ${
                        esPunto
                          ? '-translate-x-1/2 -translate-y-1/2 rounded-full'
                          : `-translate-x-1/2 -translate-y-1/2 ${
                              forma === 'circulo' ? 'rounded-full' : 'rounded-md'
                            }`
                      } ${
                        // Resaltado desde la leyenda: se agranda y se enciende
                        // el NEÓN. Sin resaltar NO hay borde ni brillo, sólo
                        // el color plano del estado (no uso `ring`: el ring y
                        // el box-shadow son la misma propiedad y se pisarían).
                        activo ? 'z-20 scale-125' : 'hover:scale-110'
                      }`}
                      style={
                        esPunto
                          ? {
                              left: `${esp.x}%`,
                              top: `${esp.y}%`,
                              backgroundColor: color,
                              width: 22,
                              height: 22,
                              // El neón sólo cuando hay énfasis.
                              boxShadow: activo ? neon(color) : undefined
                            }
                          : {
                              left: `${esp.x}%`,
                              top: `${esp.y}%`,
                              backgroundColor: color,
                              width: `${esp.ancho}%`,
                              height: `${esp.alto}%`,
                              boxShadow: activo ? neon(color) : undefined
                            }
                      }
                    >
                      {/* Sin código dentro de la forma: el plano se lee con
                          la leyenda de la derecha (ahí está el código, el
                          tipo y el estado de cada espacio). */}
                    </button>
                  )
                })
              : null}
            </div>

            {/* Controles de zoom: rueda del mouse sobre el plano, o estos
                botones. «Ajustar» vuelve al 100 %. */}
            {url ? (
              <div
                className="absolute right-2 top-2 z-10 flex flex-col gap-1"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  title="Acercar"
                  aria-label="Acercar"
                  onClick={() => cambiarZoom(PASO_ZOOM)}
                  className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white/95 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50 cursor-pointer"
                >
                  +
                </button>
                <button
                  type="button"
                  title="Alejar"
                  aria-label="Alejar"
                  onClick={() => cambiarZoom(1 / PASO_ZOOM)}
                  className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white/95 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50 cursor-pointer"
                >
                  −
                </button>
                <button
                  type="button"
                  title="Ajustar al 100 %"
                  aria-label="Ajustar al 100 %"
                  onClick={() => setVisor({ zoom: 1, x: 0, y: 0 })}
                  className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white/95 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50 cursor-pointer"
                >
                  ⤢
                </button>
                {visor.zoom !== 1 ? (
                  <span className="rounded-lg bg-white/95 px-1 py-0.5 text-center text-[10px] font-bold tabular-nums text-slate-600 shadow-sm">
                    {Math.round(visor.zoom * 100)}%
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
          </div>

          {/* LA LEYENDA: el listado de espacios con su código, que en la
              imagen a veces ni se lee. Hover acá → se resalta el espacio en
              el plano; hover en el plano → se resalta la fila de acá. */}
          <aside
            className="w-full shrink-0 rounded-2xl border border-slate-200 bg-white shadow-sm lg:w-72"
            aria-label="Leyenda de espacios"
          >
            <div className="border-b border-slate-100 px-4 py-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                Espacios ({espacios.length})
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                Pasá el mouse por uno para verlo en el plano.
              </p>
            </div>

            {espacios.length === 0 ? (
              <p className="px-4 py-4 text-xs text-slate-400">Sin espacios en esta sucursal.</p>
            ) : (
              <ul className="max-h-[78vh] divide-y divide-slate-100 overflow-y-auto">
                {espacios.map((esp) => {
                  const acuerdo = acuerdoDe(esp.id)
                  const estado = estadoEspacio(acuerdo, cobradasPorAcuerdo.get(acuerdo?.id ?? '') ?? new Set())
                  const activo = resaltado === esp.id
                  const textoEstado =
                    estado === 'disponible'
                      ? 'Disponible'
                      : estado === 'ocupado'
                        ? `Ocupado${acuerdo?.proveedor?.nombre ? ` · ${acuerdo.proveedor.nombre}` : ''}`
                        : 'Cobros pendientes'
                  return (
                    <li key={esp.id}>
                      <button
                        type="button"
                        onMouseEnter={() => setResaltado(esp.id)}
                        onMouseLeave={() => setResaltado((r) => (r === esp.id ? null : r))}
                        onFocus={() => setResaltado(esp.id)}
                        onBlur={() => setResaltado((r) => (r === esp.id ? null : r))}
                        onClick={() => {
                          if (puedeGestionar && !eligiendo) abrirEdit(esp)
                        }}
                        className={`flex w-full items-start gap-2.5 px-4 py-2.5 text-left transition-colors ${
                          activo ? 'bg-primary-50' : 'hover:bg-slate-50'
                        } ${puedeGestionar ? 'cursor-pointer' : 'cursor-default'}`}
                      >
                        <span
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-white shadow"
                          style={{ backgroundColor: COLORES_ESTADO[estado] }}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1">
                          <span
                            className={`block truncate font-mono text-xs font-extrabold ${
                              activo ? 'text-primary-900' : 'text-slate-800'
                            }`}
                          >
                            {esp.codigo}
                          </span>
                          <span className="block truncate text-[11px] text-slate-500">
                            {tipoDe(esp.tipo_id)}
                            {esp.detalle ? ` · ${esp.detalle}` : ''}
                          </span>
                          <span
                            className={`block truncate text-[11px] font-semibold ${
                              estado === 'pendiente'
                                ? 'text-amber-600'
                                : estado === 'ocupado'
                                  ? 'text-emerald-600'
                                  : 'text-red-600'
                            }`}
                          >
                            {textoEstado}
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </aside>
          </div>

          <p className="text-[11px] text-slate-500">
            <span className="mr-3 inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#dc2626]" /> Disponible
            </span>
            <span className="mr-3 inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#16a34a]" /> Ocupado, al día
            </span>
            <span className="mr-3 inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#eab308]" /> Ocupado con cobros pendientes
            </span>
            {puedeGestionar ? (
              <span className="text-slate-400">
                Tocá un espacio —o su fila en la leyenda— para editarlo, o creá uno nuevo desde el menú.
              </span>
            ) : null}
          </p>
        </div>
      )}

      {/* Modal del espacio: la ubicación exacta en el piso. */}
      <Modal
        open={!!form && !eligiendo}
        onClose={() => {
          setForm(null)
          setEditandoId(null)
        }}
        title={editandoId ? 'Editar espacio' : 'Nuevo espacio'}
        footer={
          <div className="flex items-center justify-between gap-2">
            {editandoId ? (
              <Button
                type="button"
                variant="danger"
                onClick={() => {
                  const actual = espacios.find((e) => e.id === editandoId)
                  if (actual) setBorrar(actual)
                }}
              >
                Quitar del plano
              </Button>
            ) : (
              <span />
            )}
            <span className="flex gap-2">
              <Button variant="ghost" onClick={() => setForm(null)} disabled={guardando}>
                Cancelar
              </Button>
              <Button type="submit" form="form-espacio" disabled={guardando}>
                {guardando ? <Spinner size={16} /> : null}
                {editandoId ? 'Guardar cambios' : 'Crear espacio'}
              </Button>
            </span>
          </div>
        }
      >
        {form ? (
          <form
            id="form-espacio"
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              void guardar()
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Tipo de espacio">
                <Select
                  value={form.tipo_id}
                  onChange={(e) => setForm((f) => (f ? { ...f, tipo_id: e.target.value } : f))}
                  required
                >
                  <option value="">— Elegí —</option>
                  {tipos.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nombre}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Código (ubicación exacta)" hint="Ej: G-03, CO-1, V-2…">
                <Input
                  value={form.codigo}
                  onChange={(e) => setForm((f) => (f ? { ...f, codigo: e.target.value } : f))}
                  required
                  placeholder="Ej: G-03"
                />
              </Field>
            </div>

            <Field label="Detalle de la ubicación" hint="Dónde queda exactamente (opcional).">
              <Input
                value={form.detalle}
                onChange={(e) => setForm((f) => (f ? { ...f, detalle: e.target.value } : f))}
                placeholder="Ej: entrada del supermercado, a la derecha"
              />
            </Field>

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Forma en el plano">
                <Select
                  value={form.forma}
                  onChange={(e) =>
                    setForm((f) =>
                      f
                        ? {
                            ...f,
                            forma: e.target.value as 'punto' | 'rectangulo' | 'circulo',
                            // Al pasar a una forma con tamaño, arranca con un tamaño inicial.
                            ancho:
                              e.target.value === 'punto' ? 0 : f.ancho || 10,
                            alto: e.target.value === 'punto' ? 0 : f.alto || 10
                          }
                        : f
                    )
                  }
                >
                  <option value="punto">Punto (un clic)</option>
                  <option value="rectangulo">Cuadro (arrastrando)</option>
                  <option value="circulo">Círculo (arrastrando)</option>
                </Select>
              </Field>
              <Field label="Posición X (%)">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={form.x}
                  onChange={(e) => setForm((f) => (f ? { ...f, x: Number(e.target.value) } : f))}
                />
              </Field>
              <Field label="Posición Y (%)">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={form.y}
                  onChange={(e) => setForm((f) => (f ? { ...f, y: Number(e.target.value) } : f))}
                />
              </Field>
            </div>

            {form.forma !== 'punto' ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Ancho (% del plano)">
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    step={0.1}
                    value={form.ancho}
                    onChange={(e) => setForm((f) => (f ? { ...f, ancho: Number(e.target.value) } : f))}
                  />
                </Field>
                <Field label="Alto (% del plano)">
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    step={0.1}
                    value={form.alto}
                    onChange={(e) => setForm((f) => (f ? { ...f, alto: Number(e.target.value) } : f))}
                  />
                </Field>
              </div>
            ) : null}

            <div className="flex items-end">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setEligiendo(true)}
                className="w-full"
              >
                <MapPin className="h-4 w-4" />
                {form.forma === 'punto' ? 'Elegir en el plano' : 'Dibujar en el plano'}
              </Button>
            </div>
          </form>
        ) : null}
      </Modal>

      <Confirmar
        open={!!borrar}
        texto={`¿Quitar el espacio ${borrar?.codigo} del plano?`}
        onConfirm={() => {
          if (borrar) onBorrarEspacio(borrar)
          setBorrar(null)
        }}
        onCancel={() => setBorrar(null)}
      />
    </section>
  )
}

/** El texto de estado que acompaña a un espacio en su tooltip. */
function agreementLabel(acuerdo: { proveedor?: { nombre: string } | null; fecha_fin: string } | null): string {
  if (!acuerdo) return ''
  return `Rentado a ${acuerdo.proveedor?.nombre ?? 'proveedor'} hasta ${acuerdo.fecha_fin}`
}
