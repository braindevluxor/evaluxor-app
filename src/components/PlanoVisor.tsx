import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Maximize2, Minus, Plus } from 'lucide-react'
import type { PuntoPlano } from '../lib/scoring'
import {
  limitarPan,
  limitarZoom,
  normalizadoAPantalla,
  pantallaANormalizado,
  tamanoImagen,
  vistaCentradaEnPunto,
  vistaConZoomEn,
  vistaInicial,
  type Vista
} from '../lib/planos'
import { Spinner, cn } from './ui'

/** Desplazamiento (px) por debajo del cual el gesto se lee como "toque" y no como arrastre. */
const UMBRAL_TAP = 10
/** Duración máxima (ms) de un toque. Un dedo quieto mucho tiempo no marca nada. */
const MAX_TAP_MS = 700
/** Zoom al que acerca el visor cuando se pide centrar en un pin. */
const ZOOM_CENTRAR = 2.5
/** Lado del marcador de pin (px): fijo en pantalla para que se lea en cualquier zoom. */
const LADO_PIN = 28

interface Props {
  src: string
  alt: string
  /** Pines del plano que se está viendo (los de los demás planos se filtran antes). */
  puntos: PuntoPlano[]
  /** Número visible de cada pin (1-based). Por defecto, el orden del array. */
  numeros?: Record<string, number>
  seleccionado?: string | null
  onSelect?: (id: string) => void
  /** Coloca un pin en coordenadas normalizadas (0..1) de la imagen. Ausente = solo lectura. */
  onPlace?: (x: number, y: number) => void
  /** Punto al que hay que acercar el plano (al tocar un pin de la lista). */
  centrarEn?: { x: number; y: number } | null
  /** Cambia para volver a centrar aunque sea el mismo pin. */
  centrarClave?: number
  className?: string
  /** Clase de altura del visor. */
  alto?: string
}

interface Punto2D {
  x: number
  y: number
}

interface Gestura {
  id: number
  x0: number
  y0: number
  t0: number
  vista0: Vista
  movido: boolean
  pinza: { dist: number; u: number; v: number } | null
}

/**
 * Visor de un plano (imagen) con zoom y arrastre, sobre el que se marcan pines.
 * Un toque (sin arrastre) coloca un pin; con dos dedos se hace zoom. Los pines se
 * guardan normalizados, así que el zoom no altera dónde caen.
 */
export function PlanoVisor({ src, alt, puntos, numeros, seleccionado, onSelect, onPlace, centrarEn, centrarClave, className, alto = 'h-80 sm:h-96' }: Props) {
  const contRef = useRef<HTMLDivElement | null>(null)
  // Las medidas se guardan junto al src al que pertenecen: así una imagen en caché
  // (que dispara onLoad antes de que corran los efectos) nunca queda sin medir, y al
  // cambiar de plano la geometría anterior se descarta sola.
  const [medida, setMedida] = useState<{ src: string; w: number; h: number } | null>(null)
  const natural = medida && medida.src === src ? { w: medida.w, h: medida.h } : null
  const [caja, setCaja] = useState({ w: 0, h: 0 })
  const [vista, setVistaState] = useState<Vista>(vistaInicial)

  // Espejo del estado para las escuchas nativas (rueda) y los punteros: evita
  // re-registrar escuchas en cada movimiento.
  const st = useRef({ natural, caja, vista })
  useEffect(() => {
    st.current = { natural, caja, vista }
  }, [natural, caja, vista])
  const setVista = useCallback((v: Vista) => setVistaState(v), [])

  useEffect(() => {
    setVistaState(vistaInicial)
  }, [src])

  useEffect(() => {
    const el = contRef.current
    if (!el) return
    const medir = () => setCaja({ w: el.clientWidth, h: el.clientHeight })
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [src])

  const alGirar = useCallback((e: WheelEvent) => {
    e.preventDefault()
    const el = contRef.current
    const { natural: n, caja: c, vista: v } = st.current
    if (!el || !n || !c.w) return
    const r = el.getBoundingClientRect()
    setVista(vistaConZoomEn(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX - r.left, e.clientY - r.top, n, c, v))
  }, [setVista])

  useEffect(() => {
    const el = contRef.current
    if (!el) return
    el.addEventListener('wheel', alGirar, { passive: false })
    return () => el.removeEventListener('wheel', alGirar)
  }, [alGirar])

  // Centrado en un pin pedido desde afuera. Queda pendiente hasta que la imagen y el
  // visor tienen medidas (el toque al pin suele llegar antes de que cargue el plano).
  const centrado = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => {
    if (centrarEn) centrado.current = centrarEn
  }, [centrarEn, centrarClave])
  useEffect(() => {
    const p = centrado.current
    if (!p || !natural || !caja.w) return
    centrado.current = null
    const z = Math.max(limitarZoom(vista.zoom), ZOOM_CENTRAR)
    setVista(limitarPan(vistaCentradaEnPunto(p, natural, caja, z), natural, caja))
  }, [natural, caja, vista.zoom, setVista])

  const punteros = useRef(new Map<number, Punto2D>())
  const gesto = useRef<Gestura | null>(null)

  const alBajar = (e: React.PointerEvent<HTMLDivElement>) => {
    const { natural: n, caja: c } = st.current
    const el = contRef.current
    if (!n || !c.w || !el) return
    const r = el.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    punteros.current.set(e.pointerId, { x, y })
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Sin captura: el gesto sigue funcionando, solo puede perder eventos fuera del visor.
    }
    if (punteros.current.size === 1) {
      gesto.current = { id: e.pointerId, x0: x, y0: y, t0: Date.now(), vista0: st.current.vista, movido: false, pinza: null }
    } else if (punteros.current.size === 2) {
      const [a, b] = [...punteros.current.values()]
      const { vista } = st.current
      const g = tamanoImagen(n, c, vista)
      const cx = (a.x + b.x) / 2
      const cy = (a.y + b.y) / 2
      gesto.current = {
        id: -1,
        x0: cx,
        y0: cy,
        t0: Date.now(),
        vista0: vista,
        movido: true,
        pinza: { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, u: (cx - g.ox) / g.w, v: (cy - g.oy) / g.h }
      }
    }
  }

  const alMover = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesto.current
    const el = contRef.current
    const { natural: n, caja: c } = st.current
    if (!g || !el || !n || !c.w) return
    const r = el.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    if (punteros.current.has(e.pointerId)) punteros.current.set(e.pointerId, { x, y })

    if (g.pinza && punteros.current.size >= 2) {
      const [a, b] = [...punteros.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1
      const cx = (a.x + b.x) / 2
      const cy = (a.y + b.y) / 2
      const zoom = limitarZoom(g.vista0.zoom * (dist / g.pinza.dist))
      const gi = tamanoImagen(n, c, { zoom, x: 0, y: 0 })
      setVista(
        limitarPan(
          { zoom, x: cx - g.pinza.u * gi.w - (c.w - gi.w) / 2, y: cy - g.pinza.v * gi.h - (c.h - gi.h) / 2 },
          n,
          c
        )
      )
      return
    }
    if (e.pointerId !== g.id) return
    const dx = x - g.x0
    const dy = y - g.y0
    if (!g.movido && Math.hypot(dx, dy) > UMBRAL_TAP) g.movido = true
    if (!g.movido) return
    setVista(limitarPan({ ...g.vista0, x: g.vista0.x + dx, y: g.vista0.y + dy }, n, c))
  }

  const alSoltar = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesto.current
    punteros.current.delete(e.pointerId)
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // Nada que liberar.
    }
    const el = contRef.current
    const { natural: n, caja: c, vista } = st.current
    if (g && g.id === e.pointerId && !g.movido && !g.pinza && onPlace && el && n && c.w && Date.now() - g.t0 < MAX_TAP_MS) {
      const r = el.getBoundingClientRect()
      const p = pantallaANormalizado(e.clientX - r.left, e.clientY - r.top, n, c, vista)
      if (p) onPlace(p.x, p.y)
    }
    if (punteros.current.size === 1) {
      // Queda un dedo del pellizco: sigue arrastrando, pero ya no puede marcar un pin.
      const [id, p] = [...punteros.current.entries()][0]
      gesto.current = { id, x0: p.x, y0: p.y, t0: Date.now(), vista0: st.current.vista, movido: true, pinza: null }
    } else if (punteros.current.size === 0) {
      gesto.current = null
    }
  }

  const zoomEn = (factor: number) => {
    const { natural: n, caja: c, vista: v } = st.current
    if (!n || !c.w) return
    setVista(vistaConZoomEn(factor, c.w / 2, c.h / 2, n, c, v))
  }

  const geo = useMemo(
    () => (natural && caja.w ? tamanoImagen(natural, caja, vista) : null),
    [natural, caja, vista]
  )

  return (
    <div
      ref={contRef}
      onPointerDown={alBajar}
      onPointerMove={alMover}
      onPointerUp={alSoltar}
      onPointerCancel={alSoltar}
      className={cn(
        'relative select-none overflow-hidden rounded-xl border border-slate-200 bg-slate-100 touch-none',
        alto,
        onPlace ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing',
        className
      )}
    >
      {src ? (
        <img
          src={src}
          alt={alt}
          draggable={false}
          onDragStart={(e) => e.preventDefault()}
          onLoad={(e) => {
            const img = e.currentTarget
            setMedida({ src, w: img.naturalWidth, h: img.naturalHeight })
          }}
          // `max-w-none` es necesario: el preflight de Tailwind pone `max-width:100%`
          // a las imágenes, que al ampliar el plano lo deformaría y desalinearía los pines.
          className={cn('absolute select-none', geo ? 'max-w-none' : 'left-0 top-0 h-auto w-full')}
          style={geo ? { left: geo.ox, top: geo.oy, width: geo.w, height: geo.h } : undefined}
        />
      ) : (
        <div className="grid h-full w-full place-items-center">
          <Spinner size={20} />
        </div>
      )}
      {geo
        ? puntos.map((p, i) => {
            const pos = normalizadoAPantalla(p, natural!, caja, vista)
            const n = numeros?.[p.id] ?? i + 1
            return (
              <button
                key={p.id}
                type="button"
                title={`Punto ${n}${p.comentario ? `: ${p.comentario}` : ''}`}
                aria-label={`Punto ${n}: ${p.cumple === true ? 'cumple' : p.cumple === false ? 'no cumple' : 'sin marcar'}`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  onSelect?.(p.id)
                }}
                style={{ left: pos.x - LADO_PIN / 2, top: pos.y - LADO_PIN / 2 }}
                className={cn(
                  'absolute grid h-7 w-7 place-items-center rounded-full border-2 text-[11px] font-black shadow-md',
                  p.cumple === true
                    ? 'border-green-700 bg-green-600 text-white'
                    : p.cumple === false
                      ? 'border-red-700 bg-red-600 text-white'
                      : 'border-amber-400 bg-white text-amber-700',
                  seleccionado === p.id && 'ring-2 ring-primary ring-offset-1'
                )}
              >
                {n}
              </button>
            )
          })
        : null}
      <div
        className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-slate-900/70 px-3 py-1 text-[11px] font-semibold text-white"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {onPlace
          ? puntos.length
            ? `${puntos.length} ${puntos.length === 1 ? 'punto marcado' : 'puntos marcados'} · tocá para marcar otro`
            : 'Tocá el plano para marcar un punto'
          : `${puntos.length} ${puntos.length === 1 ? 'punto' : 'puntos'}`}
      </div>
      {geo && (vista.zoom > 1.01 || vista.x !== 0 || vista.y !== 0) ? (
        <div className="absolute right-2 top-2 flex flex-col gap-1">
          <BotonVisor title="Acercar" onClick={() => zoomEn(1.4)}>
            <Plus className="h-4 w-4" />
          </BotonVisor>
          <BotonVisor title="Alejar" onClick={() => zoomEn(1 / 1.4)}>
            <Minus className="h-4 w-4" />
          </BotonVisor>
          <BotonVisor title="Ver el plano completo" onClick={() => setVista(vistaInicial)}>
            <Maximize2 className="h-4 w-4" />
          </BotonVisor>
        </div>
      ) : null}
    </div>
  )
}

function BotonVisor({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClick}
      className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white/90 text-slate-600 shadow-sm hover:bg-white"
    >
      {children}
    </button>
  )
}
