import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, FileDown, FolderOpen, Plus, RefreshCw, Search } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useModuloHerramienta } from '../../context/CatalogContext'
import { useOffline } from '../../context/OfflineContext'
import { buscarVehiculo } from '../../lib/data/vehicles'
import { exportarRevisionPreEntrega } from '../../lib/pdf/exportarRevisionPreEntrega'
import { resolverPregunta } from '../../lib/pdf/preguntasRevision'
import { getPhotos, getPreEntregaAbierta, putPreEntrega, type PreEntregaRecord } from '../../lib/offline/db'
import { subirRevisionPreEntrega } from '../../lib/offline/syncPreEntrega'
import { tieneRespuesta } from '../../lib/scoring'
import { supabase } from '../../lib/supabase'
import {
  CLAVE_INSPECCION,
  COMBUSTIBLES,
  evidenciasDeRespuestas,
  seccionarItems
} from '../../lib/inspeccionVehiculo'
import { FirmaCanvas } from '../../components/FirmaCanvas'
import { ItemRenderer } from '../../components/ItemRenderer'
import { MobileLayout } from '../../components/layouts/MobileLayout'
import { Button, Card, EmptyState, Field, Input, Select, Spinner, Textarea, cn } from '../../components/ui'
import type { Item } from '../../lib/types'

/**
 * Inspección de vehículo particular: estética, mecánica y sistema de gas
 * vehicular, con fotos/incidencias por punto y salida a PDF.
 *
 * Vive en `/evaluar`, con `MobileLayout`: se llena desde el teléfono, con el
 * vehículo en el taller o en la calle. **No tiene sucursal** —a diferencia de
 * la pre-entrega, que entrega una flota en una unidad— porque no hay unidad a
 * la que pertenezca el vehículo: el registro se sube con `sucursal_id` null y
 * lo ven el evaluador que lo hizo y el Líder.
 *
 * Reutiliza la máquina de la Revisión Pre-Entrega —registro local, cola de
 * subida, fotos en el bucket y el mismo exportador— cambiando el módulo y la
 * ficha de la persona: aquí la inspección es de un vehículo de un dueño
 * particular, no de una flota con chofer asignado.
 */

interface Persona {
  cedula: string
  nombre: string
  apellido: string
  telefono: string
}

const PERSONA_VACIA: Persona = { cedula: '', nombre: '', apellido: '', telefono: '' }

function hoy(): string {
  return new Date().toISOString().slice(0, 10)
}

function registroVacio(evaluador_id: string, modulo_id: string): PreEntregaRecord {
  return {
    id: crypto.randomUUID(),
    evaluador_id,
    // Sin sucursal: la inspección no pertenece a ninguna unidad.
    sucursal_id: null,
    modulo_id,
    placa: '',
    vehiculo: {},
    chofer: {},
    chofer_firma: null,
    observaciones: '',
    respuestas: {},
    estado: 'BORRADOR',
    fecha: hoy(),
    photoIds: [],
    created_at: Date.now(),
    updated_at: Date.now(),
    sync: 'pendiente'
  }
}

/** Persona del registro → los campos controlados del formulario. */
function personaDe(chofer: Record<string, unknown>): Persona {
  return {
    cedula: String(chofer.cedula ?? ''),
    nombre: String(chofer.nombre ?? ''),
    apellido: String(chofer.apellido ?? ''),
    telefono: String(chofer.telefono ?? '')
  }
}

/** Fotos de las respuestas que siguen en el dispositivo (para subirlas después). */
function fotosDe(respuestas: Record<string, unknown>): string[] {
  const out = new Set<string>()
  for (const v of Object.values(respuestas)) {
    if (!v || typeof v !== 'object') continue
    const ev = (v as { evidencias?: unknown }).evidencias
    if (!ev) continue
    const filas = Array.isArray(ev) ? ev : typeof ev === 'object' ? Object.values(ev) : []
    for (const e of filas) {
      if (!e || typeof e !== 'object') continue
      for (const id of (e as { photoIds?: string[] }).photoIds ?? []) out.add(id)
    }
  }
  return [...out]
}

export function InspeccionVehiculo() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const { cargado } = useCatalog()
  const { online, sync: syncCola } = useOffline()
  const { modulo, items } = useModuloHerramienta(CLAVE_INSPECCION)

  const [reg, setReg] = useState<PreEntregaRecord | null>(null)
  const [cargando, setCargando] = useState(true)

  const [buscandoVehiculo, setBuscandoVehiculo] = useState(false)
  const [errorVehiculo, setErrorVehiculo] = useState<string | null>(null)

  const [persona, setPersona] = useState<Persona>(PERSONA_VACIA)

  const [exportando, setExportando] = useState(false)
  const [aviso, setAviso] = useState<{ texto: string; ok: boolean } | null>(null)

  const regRef = useRef<PreEntregaRecord | null>(null)

  const itemsEvaluables = useMemo(() => items.filter((i) => i.tipo !== 'CONTENEDOR'), [items])
  // El checklist, partido en Estética / Mecánica / Gas vehicular.
  const grupos = useMemo(() => seccionarItems(items), [items])

  /* --- Carga inicial: retomar la inspección a medias, si quedó una ---------- */

  useEffect(() => {
    // El módulo llega del caché del catálogo; sin él no hay registro que
    // retomar (el registro guarda el id del módulo con el que se abrió).
    if (!cargado || !profile || !modulo) return
    void (async () => {
      const abierta = await getPreEntregaAbierta(profile.id, modulo.id).catch(() => undefined)
      if (abierta) {
        regRef.current = abierta
        setReg(abierta)
        setPersona(personaDe(abierta.chofer))
      } else {
        // Siempre hay registro: no hace falta elegir unidad para empezar.
        const nuevo = registroVacio(profile.id, modulo.id)
        regRef.current = nuevo
        setReg(nuevo)
      }
      setCargando(false)
    })()
    // Se lee `profile`/`modulo` completos, pero sólo interesa que cambien sus
    // ids: si el catálogo vuelve a traer los mismos objetos, retomar el borrador
    // otra vez sólo reescribe en IndexedDB lo que ya estaba escrito.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cargado, profile?.id, modulo?.id])

  /* --- Guardado: siempre local; la cola global lo sube sola ---------------- */

  const guardarLocal = useCallback((r: PreEntregaRecord) => {
    regRef.current = r
    setReg(r)
    void putPreEntrega(r).catch(() => undefined)
  }, [])

  // Al cerrar la app, el borrador queda persistido y la cola lo sube al volver.
  useEffect(() => {
    const flush = () => {
      const r = regRef.current
      if (r) void putPreEntrega(r).catch(() => undefined)
    }
    window.addEventListener('beforeunload', flush)
    return () => {
      flush()
      window.removeEventListener('beforeunload', flush)
    }
  }, [])

  /** Actualiza un campo de la cabecera (OfflineContext agenda la subida). */
  const patch = useCallback(
    (cambios: Partial<PreEntregaRecord>) => {
      const actual = regRef.current
      if (!actual) return
      guardarLocal({ ...actual, ...cambios, updated_at: Date.now() })
    },
    [guardarLocal]
  )

  const patchVehiculo = useCallback(
    (cambios: Record<string, unknown>) => {
      const actual = regRef.current
      if (!actual) return
      patch({ vehiculo: { ...actual.vehiculo, ...cambios } })
    },
    [patch]
  )

  const cambiarPersona = useCallback(
    (cambios: Partial<Persona>) => {
      const actual = regRef.current
      if (!actual) return
      const nueva = { ...personaDe(actual.chofer), ...cambios }
      setPersona(nueva)
      patch({ chofer: { ...actual.chofer, ...nueva } })
    },
    [patch]
  )

  /* --- Respuestas del check list -------------------------------------------- */

  const cambiarRespuesta = useCallback(
    (itemId: string, valor: unknown) => {
      const actual = regRef.current
      if (!actual) return
      const previo = actual.respuestas[itemId]
      // `valor` puede venir como updater `(prev) => next`: los auto-marcados de
      // responsables escriben varios a la vez sobre el mismo ítem y resuelven
      // contra el valor vivo, no contra el del render.
      const nuevoValor = typeof valor === 'function' ? (valor as (p: unknown) => unknown)(previo) : valor
      const respuestas = { ...actual.respuestas, [itemId]: nuevoValor }
      guardarLocal({ ...actual, respuestas, photoIds: fotosDe(respuestas), updated_at: Date.now() })
    },
    [guardarLocal]
  )

  /* --- Consultas ------------------------------------------------------------- */

  async function buscarVehiculoPorPlaca() {
    const p = regRef.current?.placa.trim().toUpperCase() ?? ''
    if (!p) return
    setBuscandoVehiculo(true)
    setErrorVehiculo(null)
    try {
      const r = await buscarVehiculo(p)
      if (r.vehiculo) {
        const v = r.vehiculo
        patchVehiculo({
          placa: v.placa,
          marca: v.marca,
          modelo: v.modelo,
          color: v.color,
          anio: v.anio,
          kilometraje: v.kilometraje
        })
      } else {
        setErrorVehiculo(r.mensaje || 'No se encontró la placa. Escríbelos a mano.')
      }
    } catch (e) {
      setErrorVehiculo(e instanceof Error ? e.message : 'No se pudo consultar el vehículo.')
    } finally {
      setBuscandoVehiculo(false)
    }
  }

  /* --- PDF ------------------------------------------------------------------- */

  const vehiculo = reg?.vehiculo ?? {}
  const puedeExportar = Boolean(
    reg && reg.placa.trim() && persona.cedula.trim() && persona.nombre.trim()
    // La firma queda opcional a propósito: la inspección puede hacerse sin el
    // dueño presente (el vehículo está en el taller) y el PDF imprime «Sin firma»
    // en vez de bloquearle la salida al que hizo la revisión.
  )

  /** El checklist resuelto a filas del PDF, con la sección de cada uno. */
  const respuestas = reg?.respuestas
  const filasPdf = useMemo(() => {
    if (!respuestas) return []
    const filas: { etiqueta: string; valor: string; grupo: string | null }[] = []
    for (const g of grupos) {
      for (const item of g.items) {
        const p = resolverPregunta(item, respuestas[item.id])
        for (const f of p.filas) {
          filas.push({ etiqueta: `${item.texto} · ${f.etiqueta}`, valor: f.valor, grupo: g.seccion ?? 'Dictamen' })
        }
        if (p.veredicto) {
          filas.push({ etiqueta: `${item.texto} · Nota`, valor: p.veredicto, grupo: g.seccion ?? 'Dictamen' })
        }
      }
    }
    return filas
  }, [grupos, respuestas])

  /**
   * Las fotos de las respuestas como URLs listas para `html2canvas`.
   *
   * Dos orígenes: las que siguen en el dispositivo (IndexedDB) y las que ya
   * están en el bucket (paths firmados). Se revocan todas al terminar para no
   * dejar blob: colgados de la memoria de la pestaña.
   */
  async function fotosParaPdf(r: PreEntregaRecord): Promise<{ urls: string[]; fotos: { src: string; pie: string }[] }> {
    const evidencias = evidenciasDeRespuestas(itemsEvaluables, r.respuestas)
    const urls: string[] = []
    const fotos: { src: string; pie: string }[] = []

    for (const ev of evidencias) {
      for (const foto of await getPhotos(ev.photoIds)) {
        const src = URL.createObjectURL(foto.blob)
        urls.push(src)
        fotos.push({ src, pie: ev.pie })
      }
    }

    const firmadas = new Map<string, string>()
    const paths = [...new Set(evidencias.flatMap((ev) => ev.paths))]
    if (paths.length) {
      const { data } = await supabase.storage.from('evidencias').createSignedUrls(paths, 3600)
      const firmadasDeVuelta = data ?? []
      for (let i = 0; i < firmadasDeVuelta.length; i++) {
        const url = firmadasDeVuelta[i]?.signedUrl
        if (url) firmadas.set(paths[i], url)
      }
    }
    for (const ev of evidencias) {
      for (const p of ev.paths) {
        const src = firmadas.get(p)
        if (src) fotos.push({ src, pie: ev.pie })
      }
    }

    return { urls, fotos }
  }

  async function exportarPDF() {
    const r = regRef.current
    if (!r || !modulo) return
    setExportando(true)
    const creadas: string[] = []
    try {
      const { urls, fotos } = await fotosParaPdf(r)
      creadas.push(...urls)
      await exportarRevisionPreEntrega({
        titulo: modulo.nombre,
        fecha: r.fecha,
        evaluador: profile?.nombre ?? null,
        observaciones: r.observaciones.trim() || null,
        vehiculo: {
          placa: r.placa,
          marca: typeof r.vehiculo.marca === 'string' ? r.vehiculo.marca : null,
          modelo: typeof r.vehiculo.modelo === 'string' ? r.vehiculo.modelo : null,
          color: typeof r.vehiculo.color === 'string' ? r.vehiculo.color : null,
          anio: r.vehiculo.anio == null ? null : String(r.vehiculo.anio),
          kilometraje: r.vehiculo.kilometraje == null ? null : String(r.vehiculo.kilometraje),
          combustible: typeof r.vehiculo.combustible === 'string' ? r.vehiculo.combustible : null
        },
        chofer: {
          cedula: persona.cedula || null,
          nombre: persona.nombre || null,
          apellido: persona.apellido || null,
          cargo: null,
          firma: r.chofer_firma
        },
        etiquetaPersona: 'propietario',
        personaCampos: [
          { etiqueta: 'Cédula / RIF', valor: persona.cedula || null },
          { etiqueta: 'Nombre', valor: persona.nombre || null },
          { etiqueta: 'Apellido', valor: persona.apellido || null },
          { etiqueta: 'Teléfono', valor: persona.telefono || null }
        ],
        items: filasPdf,
        fotos
      })
      // La inspección quedó hecha: se marca finalizada y se sube en el acto si
      // hay señal. Si no, la cola la sube sola y la borra de local al confirmarla.
      const finalizada: PreEntregaRecord = { ...r, estado: 'FINALIZADA', updated_at: Date.now() }
      guardarLocal(finalizada)
      if (online) {
        try {
          await subirRevisionPreEntrega(finalizada)
          setAviso({ texto: 'PDF generado e inspección guardada en la nube.', ok: true })
        } catch {
          setAviso({ texto: 'PDF generado. La inspección queda en el equipo hasta que vuelva la señal.', ok: false })
        }
      } else {
        setAviso({ texto: 'PDF generado. La inspección queda en el equipo hasta que vuelva la señal.', ok: false })
      }
    } catch (e) {
      console.error('Error exportando PDF de inspección:', e)
      setAviso({ texto: 'No se pudo generar el PDF.', ok: false })
    } finally {
      for (const u of creadas) URL.revokeObjectURL(u)
      setExportando(false)
    }
  }

  /** Arranca otra inspección dejando la anterior intacta (ya subida o en cola). */
  function nuevaInspeccion() {
    if (!modulo || !profile?.id) return
    const nueva = registroVacio(profile.id, modulo.id)
    regRef.current = nueva
    setReg(nueva)
    setPersona(PERSONA_VACIA)
    setErrorVehiculo(null)
    setAviso(null)
    void putPreEntrega(nueva).catch(() => undefined)
  }

  /* --- Render ---------------------------------------------------------------- */

  const volver = (
    <Button variant="ghost" onClick={() => navigate(-1)} className="-ml-2">
      <ArrowLeft className="mr-1 h-4 w-4" />
      Volver
    </Button>
  )

  // El checklist vacío sólo se sabe después de tener el catálogo; el registro
  // se busca en paralelo, así que mientras el módulo exista se espera un poco.
  if (!cargado || (cargando && !!modulo)) {
    return (
      <MobileLayout titulo="Inspección de vehículo">
        <div className="py-20 text-center text-slate-400">
          <Spinner className="mx-auto" />
          <p className="mt-3 text-sm">Cargando inspección…</p>
        </div>
      </MobileLayout>
    )
  }

  if (!modulo || !itemsEvaluables.length) {
    return (
      <MobileLayout titulo="Inspección de vehículo">
        <EmptyState
          title="No hay checklist configurado"
          subtitle="Ejecuta supabase/inspeccion-vehiculo.sql en el SQL Editor (crea el módulo «Inspección de vehículo» con sus secciones) o créalo desde Ítems de evaluación."
        />
        <div className="text-center">{volver}</div>
      </MobileLayout>
    )
  }

  // No se elige sucursal (la inspección no es de ninguna unidad), así que el
  // registro se abre solo apenas hay perfil y módulo. Pasar de acá es sólo
  // esperar a que el perfil termine de cargar.
  if (!reg) {
    return (
      <MobileLayout titulo="Inspección de vehículo">
        <div className="py-20 text-center text-slate-400">
          <Spinner className="mx-auto" />
          <p className="mt-3 text-sm">Cargando inspección…</p>
        </div>
      </MobileLayout>
    )
  }

  const respondidas = itemsEvaluables.filter((i) => tieneRespuesta(i, reg.respuestas[i.id])).length
  const avance = Math.round((respondidas / itemsEvaluables.length) * 100)

  return (
    <MobileLayout titulo="Inspección de vehículo" subtitulo={modulo.nombre}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          {volver}
          <span className="text-xs font-semibold tabular-nums text-slate-400">
            {respondidas}/{itemsEvaluables.length} · {avance}%
          </span>
        </div>

        <p className="text-sm text-slate-600">
          <strong className="font-black text-primary-900">{itemsEvaluables.length}</strong>
          {' puntos a revisar'}
        </p>

        {aviso ? (
          <div
            className={cn(
              'rounded-xl border px-3 py-2 text-xs font-semibold',
              aviso.ok ? 'border-green-200 bg-green-50 text-green-800' : 'border-amber-200 bg-amber-50 text-amber-800'
            )}
          >
            {aviso.texto}
          </div>
        ) : null}

        {!online ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
            Sin conexión: la inspección se guarda en el equipo y sube sola cuando vuelva la señal.
          </p>
        ) : null}

        {/* Vehículo ---------------------------------------------------------- */}
        <Card className="space-y-3">
          <h2 className="text-sm font-bold text-primary-900">Vehículo particular</h2>

          <Field label="Placa" hint="Consulta los datos por placa; si no aparecen, escríbelos a mano.">
            <div className="flex gap-2">
              <Input
                value={reg.placa}
                onChange={(e) => patch({ placa: e.target.value.toUpperCase() })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void buscarVehiculoPorPlaca()
                }}
                placeholder="ABC-123"
                autoCapitalize="characters"
              />
              <Button
                type="button"
                onClick={() => void buscarVehiculoPorPlaca()}
                disabled={buscandoVehiculo || !reg.placa.trim()}
                className="shrink-0"
              >
                {buscandoVehiculo ? <Spinner size={16} light /> : <Search className="h-4 w-4" />}
              </Button>
            </div>
          </Field>

          {errorVehiculo ? (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">{errorVehiculo}</p>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Marca">
              <Input
                value={String(vehiculo.marca ?? '')}
                onChange={(e) => patchVehiculo({ marca: e.target.value })}
              />
            </Field>
            <Field label="Modelo">
              <Input
                value={String(vehiculo.modelo ?? '')}
                onChange={(e) => patchVehiculo({ modelo: e.target.value })}
              />
            </Field>
            <Field label="Año">
              <Input
                value={String(vehiculo.anio ?? '')}
                onChange={(e) => patchVehiculo({ anio: e.target.value })}
                inputMode="numeric"
                placeholder="2020"
              />
            </Field>
            <Field label="Color">
              <Input
                value={String(vehiculo.color ?? '')}
                onChange={(e) => patchVehiculo({ color: e.target.value })}
              />
            </Field>
            <Field label="Kilometraje">
              <Input
                value={String(vehiculo.kilometraje ?? '')}
                onChange={(e) => patchVehiculo({ kilometraje: e.target.value })}
                inputMode="numeric"
                placeholder="85000"
              />
            </Field>
            <Field label="Combustible">
              <Select
                value={String(vehiculo.combustible ?? '')}
                onChange={(e) => patchVehiculo({ combustible: e.target.value })}
              >
                <option value="">Selecciona…</option>
                {COMBUSTIBLES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Card>

        {/* Propietario ------------------------------------------------------- */}
        <Card className="space-y-3">
          <h2 className="text-sm font-bold text-primary-900">Propietario</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Cédula / RIF">
              <Input
                value={persona.cedula}
                onChange={(e) => cambiarPersona({ cedula: e.target.value })}
                inputMode="numeric"
                placeholder="V-12345678"
              />
            </Field>
            <Field label="Teléfono">
              <Input
                value={persona.telefono}
                onChange={(e) => cambiarPersona({ telefono: e.target.value })}
                inputMode="tel"
                placeholder="0412 000 0000"
              />
            </Field>
            <Field label="Nombre">
              <Input value={persona.nombre} onChange={(e) => cambiarPersona({ nombre: e.target.value })} />
            </Field>
            <Field label="Apellido">
              <Input value={persona.apellido} onChange={(e) => cambiarPersona({ apellido: e.target.value })} />
            </Field>
          </div>

          <FirmaCanvas
            valor={reg.chofer_firma}
            onChange={(v) => patch({ chofer_firma: v })}
            label="Firma del propietario (opcional)"
          />
        </Card>

        {/* Checklist por sección --------------------------------------------- */}
        {grupos.map((g) => (
          <section key={g.seccion ?? 'sin-seccion'} className="space-y-3">
            <div className="flex items-center gap-2 rounded-xl bg-primary-50 px-3 py-2">
              <FolderOpen className="h-4 w-4 shrink-0 text-primary" />
              <h2 className="min-w-0 text-sm font-bold text-primary-900">{g.seccion ?? 'Dictamen'}</h2>
              <span className="ml-auto text-xs font-semibold tabular-nums text-slate-500">
                {g.items.filter((i) => tieneRespuesta(i, reg.respuestas[i.id])).length}/{g.items.length}
              </span>
            </div>
            {g.items.map((item: Item) => (
              <ItemRenderer
                key={item.id}
                item={item}
                index={itemsEvaluables.indexOf(item)}
                total={itemsEvaluables.length}
                valor={reg.respuestas[item.id]}
                onChange={(v) => cambiarRespuesta(item.id, v)}
              />
            ))}
          </section>
        ))}

        {/* Observaciones ------------------------------------------------------ */}
        <Card className="space-y-2">
          <h2 className="text-sm font-bold text-primary-900">Observaciones e incidencias</h2>
          <Textarea
            value={reg.observaciones}
            onChange={(e) => patch({ observaciones: e.target.value })}
            rows={4}
            placeholder="Daños observados, recomendaciones, estado del sistema de gas…"
          />
        </Card>

        {/* Acción ------------------------------------------------------------ */}
        <div className="sticky bottom-0 -mx-4 border-t border-slate-200 bg-slate-100/95 px-4 py-3 backdrop-blur">
          {!puedeExportar && reg.estado !== 'FINALIZADA' ? (
            <p className="mb-2 text-center text-xs text-slate-500">
              Completa placa, cédula y nombre del propietario para exportar.
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => void syncCola()}
              className="shrink-0"
              title="Subir lo pendiente"
              aria-label="Sincronizar"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            {reg.estado === 'FINALIZADA' ? (
              <Button type="button" onClick={nuevaInspeccion} className="flex-1">
                <Plus className="h-4 w-4" />
                Nueva inspección
              </Button>
            ) : (
              <Button
                type="button"
                variant="success"
                onClick={() => void exportarPDF()}
                disabled={!puedeExportar || exportando}
                className="flex-1"
              >
                {exportando ? <Spinner size={16} light /> : <FileDown className="h-4 w-4" />}
                {exportando ? 'Generando PDF…' : 'Generar PDF de la inspección'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </MobileLayout>
  )
}
