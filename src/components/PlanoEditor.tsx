import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Camera, Check, MapPin, Plus, Trash2, X } from 'lucide-react'
import type { Item } from '../lib/types'
import { puntosMarcadosPlano, proporcionPlano, type PlanoImagen, type PuntoPlano, type ValorPlano } from '../lib/scoring'
import { comprimirPlano, medirImagen } from '../lib/fotos'
import { addPhoto, deletePhoto, getPhotos } from '../lib/offline/db'
import { supabase } from '../lib/supabase'
import { PlanoVisor } from './PlanoVisor'
import { BotonInformativo, SelectorResponsables } from './WidgetsEvaluacion'
import { Button, Input, Spinner, cn } from './ui'

/** Referencias de imagen de un plano: ids del borrador local o rutas ya sincronizadas. */
function refsDe(p: PlanoImagen): string[] {
  return p.paths ?? p.photoIds ?? []
}

/** URLs mostrables de las imágenes de un plano: blobs locales (borrador) o firmadas (nube). */
function useUrlPlanos(planos: PlanoImagen[]): (p: PlanoImagen) => string | undefined {
  const [locales, setLocales] = useState<Record<string, string>>({})
  const [nube, setNube] = useState<Record<string, string>>({})
  const urlsRef = useRef<string[]>([])

  const idsLocales = useMemo(() => planos.flatMap((p) => (p.paths ? [] : (p.photoIds ?? []))), [planos])
  const paths = useMemo(() => planos.flatMap((p) => p.paths ?? []), [planos])
  const claveLocales = idsLocales.join('|')
  const clavePaths = paths.join('|')

  useEffect(() => {
    if (!claveLocales) {
      setLocales({})
      return
    }
    let vivo = true
    void (async () => {
      const recs = await getPhotos(idsLocales)
      const mapa: Record<string, string> = {}
      const creadas: string[] = []
      for (const r of recs) {
        mapa[r.id] = URL.createObjectURL(r.blob)
        creadas.push(mapa[r.id])
      }
      if (vivo) {
        setLocales(mapa)
        // Las URLs del set anterior se liberan al cambiar de plano (o al desmontar).
        urlsRef.current.forEach((u) => URL.revokeObjectURL(u))
        urlsRef.current = creadas
      } else {
        creadas.forEach((u) => URL.revokeObjectURL(u))
      }
    })()
    return () => {
      vivo = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveLocales])

  useEffect(() => {
    if (!clavePaths) {
      setNube({})
      return
    }
    let vivo = true
    void (async () => {
      const mapa: Record<string, string> = {}
      try {
        const { data } = await supabase.storage.from('evidencias').createSignedUrls(paths, 3600)
        for (const d of data ?? []) if (d.signedUrl && d.path) mapa[d.path] = d.signedUrl
      } catch {
        // Sin acceso a la imagen: se muestra el marco vacío, no rompe la vista.
      }
      if (vivo) setNube(mapa)
    })()
    return () => {
      vivo = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clavePaths])

  useEffect(
    () => () => {
      urlsRef.current.forEach((u) => URL.revokeObjectURL(u))
      urlsRef.current = []
    },
    []
  )

  return useCallback(
    (p: PlanoImagen) => {
      for (const ref of refsDe(p)) {
        const url = p.paths ? nube[ref] : locales[ref]
        if (url) return url
      }
      return undefined
    },
    [locales, nube]
  )
}

function valorDe(valor: unknown): ValorPlano {
  const v = (valor ?? {}) as Partial<ValorPlano>
  return { planos: v.planos ?? [], puntos: v.puntos ?? [], informativo: v.informativo, responsables: v.responsables, responsablesGerente: v.responsablesGerente }
}

/** Porcentaje sin ceros sobrantes: 0.7333 → "73.33", 1 → "100". */
function pct(prop: number | null): string {
  return prop === null ? '—' : `${(prop * 100).toFixed(2).replace(/\.?0+$/, '')}%`
}

/** Número visible de cada pin: su posición en la lista, contando todos los planos. */
function numerosDe(puntos: PuntoPlano[]): Record<string, number> {
  const m: Record<string, number> = {}
  for (let i = 0; i < puntos.length; i++) m[puntos[i].id] = i + 1
  return m
}

interface Props {
  item: Item
  valor: unknown
  onChange: (valor: unknown) => void
  gerente?: string | null
}

/**
 * Editor del ítem Cumplimiento XY: el evaluador sube la imagen del layout, marca
 * puntos (pines) sobre ella y marca cada punto como cumple / no cumple.
 * El puntaje del ítem es proporcional a los pines marcados (11 de 15 → 73.33%).
 */
export function PlanoEditor({ item, valor, onChange, gerente }: Props) {
  const v = valorDe(valor)
  const planos = v.planos
  const puntos = v.puntos
  const urlDe = useUrlPlanos(planos)
  const [planoActivoId, setPlanoActivoId] = useState<string | null>(null)
  const [selId, setSelId] = useState<string | null>(null)
  const [centrarClave, setCentrarClave] = useState(0)
  const [subiendo, setSubiendo] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const activo = planos.find((p) => p.id === planoActivoId) ?? planos[0] ?? null
  const puntosActivo = puntos.filter((p) => p.planoId === activo?.id)
  const prop = proporcionPlano(v)
  const fallados = puntosMarcadosPlano(v).filter((p) => p.cumple === false).length
  const cumplidos = puntosMarcadosPlano(v).length - fallados

  const guardar = (patch: Partial<ValorPlano>) => onChange({ ...v, ...patch })

  const agregarPlanos = async (files: FileList | null) => {
    if (!files?.length) return
    setSubiendo(true)
    try {
      const nuevos: PlanoImagen[] = []
      for (const f of Array.from(files)) {
        const { blob, mime } = await comprimirPlano(f)
        const id = await addPhoto(blob, mime)
        const tam = await medirImagen(blob)
        nuevos.push({ id, nombre: f.name.replace(/\.[^.]+$/, '') || `Plano ${planos.length + nuevos.length + 1}`, photoIds: [id], ...(tam ? {} : {}) })
      }
      guardar({ planos: [...planos, ...nuevos] })
      if (nuevos.length && !planos.length) setPlanoActivoId(nuevos[0].id)
    } finally {
      setSubiendo(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const quitarPlano = async (id: string) => {
    const p = planos.find((x) => x.id === id)
    guardar({ planos: planos.filter((x) => x.id !== id), puntos: puntos.filter((x) => x.planoId !== id) })
    if (p && !p.paths) for (const ref of refsDe(p)) void deletePhoto(ref).catch(() => {})
    if (activo?.id === id) setPlanoActivoId(null)
    setSelId(null)
  }

  const agregarPin = (x: number, y: number) => {
    if (!activo) return
    const pin: PuntoPlano = { id: crypto.randomUUID(), planoId: activo.id, x, y, cumple: null, comentario: '' }
    guardar({ puntos: [...puntos, pin] })
    setSelId(pin.id)
    setCentrarClave((k) => k + 1)
  }

  const patchPin = (id: string, patch: Partial<PuntoPlano>) =>
    guardar({ puntos: puntos.map((p) => (p.id === id ? { ...p, ...patch } : p)) })

  const quitarPin = (id: string) => {
    guardar({ puntos: puntos.filter((p) => p.id !== id) })
    if (selId === id) setSelId(null)
  }

  const seleccionar = (id: string) => {
    setSelId(id)
    setCentrarClave((k) => k + 1)
  }

  const numeros = numerosDe(puntos)
  const pinSel = puntos.find((p) => p.id === selId) ?? null

  return (
    <div className="space-y-3">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => void agregarPlanos(e.target.files)}
      />

      {!planos.length ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 p-5 text-center">
          <MapPin className="mx-auto h-6 w-6 text-slate-300" />
          <p className="mt-1.5 text-sm font-semibold text-slate-600">Subí la imagen del layout</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-slate-400">
            Foto o plano del piso de venta de la sucursal. Sobre ella vas a marcar los puntos y decidir si cada uno cumple.
          </p>
          <Button type="button" variant="secondary" className="mt-3" onClick={() => fileRef.current?.click()}>
            <Camera className="h-4 w-4" /> {subiendo ? 'Procesando…' : 'Elegir imagen'}
          </Button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {planos.map((p) => (
              <div key={p.id} className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setPlanoActivoId(p.id)
                    setSelId(null)
                  }}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs font-semibold transition-colors',
                    activo?.id === p.id ? 'border-primary bg-primary-50 text-primary-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  )}
                >
                  <Miniatura url={urlDe(p)} />
                  <span className="max-w-[9rem] truncate">{p.nombre}</span>
                </button>
                <button
                  type="button"
                  title="Quitar plano"
                  aria-label={`Quitar ${p.nombre}`}
                  onClick={() => void quitarPlano(p.id)}
                  className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm hover:text-red-600"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            <Button type="button" variant="secondary" className="shrink-0 !min-h-[40px] !px-3 !py-1.5 text-xs" onClick={() => fileRef.current?.click()}>
              <Plus className="h-4 w-4" /> Plano
            </Button>
          </div>

          {activo ? (
            <PlanoVisor
              src={urlDe(activo) ?? ''}
              alt={`Plano ${activo.nombre}`}
              puntos={puntosActivo}
              numeros={numeros}
              seleccionado={selId}
              onSelect={seleccionar}
              onPlace={agregarPin}
              centrarEn={pinSel && pinSel.planoId === activo.id ? pinSel : null}
              centrarClave={centrarClave}
            />
          ) : null}
          {subiendo ? (
            <p className="flex items-center gap-1.5 text-xs text-slate-400">
              <Spinner size={14} /> Procesando la imagen del plano…
            </p>
          ) : null}
          {!urlDe(activo ?? planos[0]) && planos.length ? (
            <p className="text-xs text-amber-600">No se pudo cargar la imagen del plano.</p>
          ) : null}
        </>
      )}

      {planos.length ? (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
          <span>
            {puntos.length} {puntos.length === 1 ? 'punto' : 'puntos'} · {cumplidos} cumplen · {fallados} no cumplen
          </span>
          <span className="tabular-nums text-slate-800">{pct(prop)}</span>
        </div>
      ) : null}

      {puntos.length ? (
        <ul className="space-y-2">
          {puntos.map((p) => (
            <li key={p.id}>
              <FilaPunto
                punto={p}
                numero={numeros[p.id]}
                nombrePlano={planos.find((x) => x.id === p.planoId)?.nombre ?? ''}
                otroPlano={p.planoId !== activo?.id}
                seleccionado={selId === p.id}
                onSelect={() => seleccionar(p.id)}
                onChange={(patch) => patchPin(p.id, patch)}
                onQuitar={() => quitarPin(p.id)}
              />
            </li>
          ))}
        </ul>
      ) : null}

      {planos.length ? (
        <>
          <BotonInformativo activo={!!v.informativo} onClick={() => guardar({ informativo: !v.informativo })}>
            Informativo · no descuenta puntos
          </BotonInformativo>
          {fallados > 0 ? (
            <div className="min-w-0 rounded-xl border border-red-100 bg-red-50/60 p-2.5">
              <SelectorResponsables
                etiqueta="Responsables de los puntos que no cumplen"
                responsables={item.responsables ?? []}
                seleccion={v.responsables ?? []}
                gerente={gerente ?? null}
                ayuda={
                  v.responsables?.length
                    ? 'La parte del ítem que no se cumple se carga a cada responsable elegido.'
                    : gerente
                      ? `Sin elegir, la parte que no se cumple queda para ${gerente}.`
                      : 'Sin responsables configurados en este ítem, no se puede atribuir la falla.'
                }
                onChange={(sel) => guardar({ responsables: sel })}
              />
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

function Miniatura({ url }: { url?: string }) {
  if (!url) return <span className="block h-7 w-7 rounded bg-slate-200" />
  return <img src={url} alt="" className="h-7 w-7 rounded object-cover" />
}

function FilaPunto({ punto, numero, nombrePlano, otroPlano, seleccionado, onSelect, onChange, onQuitar }: {
  punto: PuntoPlano
  numero: number
  nombrePlano: string
  otroPlano: boolean
  seleccionado: boolean
  onSelect: () => void
  onChange: (patch: Partial<PuntoPlano>) => void
  onQuitar: () => void
}) {
  return (
    <div
      className={cn(
        'min-w-0 rounded-xl border p-2.5 transition-colors',
        seleccionado ? 'border-primary bg-primary-50/40' : punto.cumple === false ? 'border-red-100 bg-red-50/50' : 'border-slate-200 bg-white'
      )}
    >
      <div className="flex items-start gap-2">
        <button type="button" onClick={onSelect} className="shrink-0">
          <span
            className={cn(
              'grid h-7 w-7 place-items-center rounded-full border-2 text-[11px] font-black',
              punto.cumple === true
                ? 'border-green-700 bg-green-600 text-white'
                : punto.cumple === false
                  ? 'border-red-700 bg-red-600 text-white'
                  : 'border-amber-400 bg-white text-amber-700'
            )}
          >
            {numero}
          </span>
        </button>
        <div className="min-w-0 flex-1 space-y-2">
          <Input
            value={punto.comentario}
            onFocus={onSelect}
            placeholder="Ej. la góndola de panadería no está en el pasillo 5"
            onChange={(e) => onChange({ comentario: e.target.value })}
          />
          <div className="flex flex-wrap items-center gap-2">
            <BotonVeredicto activo={punto.cumple === true} onClick={() => onChange({ cumple: punto.cumple === true ? null : true })}>
              <Check className="h-3.5 w-3.5" /> Cumple
            </BotonVeredicto>
            <BotonVeredicto
              activo={punto.cumple === false}
              tono="rojo"
              onClick={() => onChange({ cumple: punto.cumple === false ? null : false })}
            >
              <X className="h-3.5 w-3.5" /> No cumple
            </BotonVeredicto>
            {otroPlano && nombrePlano ? (
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{nombrePlano}</span>
            ) : null}
            <button
              type="button"
              title="Quitar punto"
              aria-label={`Quitar punto ${numero}`}
              onClick={onQuitar}
              className="ml-auto grid h-8 w-8 place-items-center rounded-full text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function BotonVeredicto({ activo, tono = 'verde', onClick, children }: {
  activo: boolean
  tono?: 'verde' | 'rojo'
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold transition-colors',
        activo
          ? tono === 'verde'
            ? 'border-green-600 bg-green-50 text-green-800'
            : 'border-red-600 bg-red-50 text-red-700'
          : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
      )}
    >
      {children}
    </button>
  )
}

/** Vista de solo lectura del ítem Cumplimiento XY (detalle de evaluación ya enviado). */
export function PlanoLectura({ valor }: { valor: unknown }) {
  const v = valorDe(valor)
  const urlDe = useUrlPlanos(v.planos)
  const [planoActivoId, setPlanoActivoId] = useState<string | null>(null)
  const [selId, setSelId] = useState<string | null>(null)
  const [centrarClave, setCentrarClave] = useState(0)
  const activo = v.planos.find((p) => p.id === planoActivoId) ?? v.planos[0] ?? null
  const puntos = v.puntos.filter((p) => p.planoId === activo?.id)
  const numeros = numerosDe(v.puntos)
  const pinSel = v.puntos.find((p) => p.id === selId) ?? null
  const fallados = puntosMarcadosPlano(v).filter((p) => p.cumple === false).length
  const cumplidos = puntosMarcadosPlano(v).length - fallados

  if (!v.planos.length) return <p className="text-sm text-slate-400">Sin plano cargado</p>

  return (
    <div className="space-y-3">
      {v.planos.length > 1 ? (
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {v.planos.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setPlanoActivoId(p.id)
                setSelId(null)
              }}
              className={cn(
                'flex shrink-0 items-center gap-2 rounded-lg border px-2 py-1.5 text-xs font-semibold transition-colors',
                activo?.id === p.id ? 'border-primary bg-primary-50 text-primary-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              )}
            >
              <Miniatura url={urlDe(p)} />
              <span className="max-w-[9rem] truncate">{p.nombre}</span>
            </button>
          ))}
        </div>
      ) : null}
      {activo ? (
        <PlanoVisor
          src={urlDe(activo) ?? ''}
          alt={`Plano ${activo.nombre}`}
          puntos={puntos}
          numeros={numeros}
          seleccionado={selId}
          onSelect={(id) => {
            setSelId(id)
            setCentrarClave((k) => k + 1)
          }}
          centrarEn={pinSel && pinSel.planoId === activo.id ? pinSel : null}
          centrarClave={centrarClave}
        />
      ) : null}
      <p className="text-xs font-semibold text-slate-600">
        {v.puntos.length} {v.puntos.length === 1 ? 'punto' : 'puntos'} · {cumplidos} cumplen · {fallados} no cumplen ·{' '}
        <span className="tabular-nums">{pct(proporcionPlano(v))}</span>
        {v.informativo ? ' · informativo' : ''}
      </p>
      {v.puntos.length ? (
        <ul className="space-y-1.5">
          {v.puntos.map((p) => (
            <li key={p.id} className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <span
                className={cn(
                  'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-black',
                  p.cumple === true ? 'bg-green-600 text-white' : p.cumple === false ? 'bg-red-600 text-white' : 'bg-slate-200 text-slate-600'
                )}
              >
                {numeros[p.id]}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block break-words text-slate-700">{p.comentario || 'Sin comentario'}</span>
                <span className={cn('text-[11px] font-bold', p.cumple === true ? 'text-green-700' : p.cumple === false ? 'text-red-600' : 'text-slate-400')}>
                  {p.cumple === true ? 'Cumple' : p.cumple === false ? 'No cumple' : 'Sin marcar'}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
