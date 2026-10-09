import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, FileDown, RefreshCw, Search, UserSearch } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useCatalog, useModuloHerramienta } from '../../context/CatalogContext'
import { useOffline } from '../../context/OfflineContext'
import { buscarVehiculo, type Vehiculo } from '../../lib/data/vehicles'
import { listarColaboradores, type ColaboradorAPI } from '../../lib/data/colaboradores'
import { nombreColaborador } from '../../lib/data/apis'
import { exportarRevisionPreEntrega } from '../../lib/pdf/exportarRevisionPreEntrega'
import { resolverPregunta } from '../../lib/pdf/preguntasRevision'
import { getPreEntregaAbierta, putPreEntrega, type PreEntregaRecord } from '../../lib/offline/db'
import { subirRevisionPreEntrega } from '../../lib/offline/syncPreEntrega'
import { tieneRespuesta } from '../../lib/scoring'
import { FirmaCanvas } from '../../components/FirmaCanvas'
import { ItemRenderer } from '../../components/ItemRenderer'
import { Button, Card, EmptyState, Field, Input, Select, Spinner, Textarea, cn } from '../../components/ui'
import { MobileLayout } from '../../components/layouts/MobileLayout'
import type { Item } from '../../lib/types'

const CLAVE_HERRAMIENTA = 'REVISION_PRE_ENTREGA'

interface Chofer {
  cedula: string
  nombre: string
  apellido: string
  cargo: string
}

function hoy(): string {
  return new Date().toISOString().slice(0, 10)
}

function registroVacio(evaluador_id: string, sucursal_id: string, modulo_id: string | null): PreEntregaRecord {
  return {
    id: crypto.randomUUID(),
    evaluador_id,
    sucursal_id,
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

/** Fotografías de un itemRenderer guardadas localmente (para subirlas después). */
function fotosDe(respuestas: Record<string, unknown>): string[] {
  const out = new Set<string>()
  for (const v of Object.values(respuestas)) {
    if (!v || typeof v !== 'object') continue
    const ev = (v as { evidencias?: Record<string, { photoIds?: string[] }> }).evidencias
    if (!ev) continue
    for (const e of Object.values(ev)) for (const id of e.photoIds ?? []) out.add(id)
  }
  return [...out]
}

export default function RevisionPreEntrega() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { sucursales } = useCatalog()
  const { online, sync: syncCola } = useOffline()
  const { modulo, items } = useModuloHerramienta(CLAVE_HERRAMIENTA)

  const [sucursalId, setSucursalId] = useState(profile?.sucursal_id ?? '')
  const [reg, setReg] = useState<PreEntregaRecord | null>(null)
  const [cargando, setCargando] = useState(true)

  // Búsqueda de vehículo
  const [buscandoVehiculo, setBuscandoVehiculo] = useState(false)
  const [errorVehiculo, setErrorVehiculo] = useState<string | null>(null)

  // Búsqueda de chofer
  const [cedulaBuscar, setCedulaBuscar] = useState('')
  const [buscandoChofer, setBuscandoChofer] = useState(false)
  const [choferApi, setChoferApi] = useState<ColaboradorAPI | null>(null)
  const [errorChofer, setErrorChofer] = useState<string | null>(null)
  const [modoManualChofer, setModoManualChofer] = useState(false)
  const [choferManual, setChoferManual] = useState<Chofer>({ cedula: '', nombre: '', apellido: '', cargo: '' })

  const [exportando, setExportando] = useState(false)
  const [aviso, setAviso] = useState<{ texto: string; ok: boolean } | null>(null)

  const regRef = useRef<PreEntregaRecord | null>(null)

  const sucursalActual = useMemo(
    () => sucursales.find((s) => s.id === sucursalId) ?? null,
    [sucursales, sucursalId]
  )

  const itemsEvaluables = useMemo(() => items.filter((i) => i.tipo !== 'CONTENEDOR'), [items])

  /* --- Carga inicial: retomar la revisión a medias, si quedó una ------------ */

  useEffect(() => {
    if (!profile) return
    void (async () => {
      const abierta = await getPreEntregaAbierta(profile.id).catch(() => undefined)
      if (abierta) {
        regRef.current = abierta
        setReg(abierta)
        setSucursalId(abierta.sucursal_id)
        setCedulaBuscar(String((abierta.chofer.cedula as string) ?? ''))
        if (abierta.chofer.nombre) {
          setModoManualChofer(true)
          setChoferManual({
            cedula: String(abierta.chofer.cedula ?? ''),
            nombre: String(abierta.chofer.nombre ?? ''),
            apellido: String(abierta.chofer.apellido ?? ''),
            cargo: String(abierta.chofer.cargo ?? '')
          })
        }
      } else if (profile.sucursal_id) {
        regRef.current = registroVacio(profile.id, profile.sucursal_id, modulo?.id ?? null)
        setReg(regRef.current)
      }
      setCargando(false)
    })()
    // El módulo puede llegar del caché después que el perfil; se reintenta una vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, modulo?.id])

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

  /** Actualiza un dato del chofer leyendo el estado actual (no el del render). */
  const patchChofer = useCallback(
    (cambios: Record<string, string>) => {
      const actual = regRef.current
      if (!actual) return
      patch({ chofer: { ...actual.chofer, ...cambios } })
    },
    [patch]
  )

  /* --- Respuestas del check list -------------------------------------------- */

  const cambiarRespuesta = useCallback(
    (itemId: string, valor: unknown) => {
      const actual = regRef.current
      if (!actual) return
      const respuestas = { ...actual.respuestas, [itemId]: valor }
      const nuevo: PreEntregaRecord = {
        ...actual,
        respuestas,
        photoIds: fotosDe(respuestas),
        updated_at: Date.now()
      }
      guardarLocal(nuevo)
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
        const v: Vehiculo = r.vehiculo
        patch({
          vehiculo: {
            placa: v.placa,
            marca: v.marca,
            modelo: v.modelo,
            color: v.color,
            anio: v.anio,
            kilometraje: v.kilometraje,
            flota: v.fleetTypeDisplay ?? v.fleetType ?? null
          }
        })
      } else {
        patch({ vehiculo: {} })
        setErrorVehiculo(r.mensaje || 'Vehículo no encontrado.')
      }
    } catch (e) {
      setErrorVehiculo(e instanceof Error ? e.message : 'No se pudo consultar el vehículo.')
    } finally {
      setBuscandoVehiculo(false)
    }
  }

  function cambiarSucursal(id: string) {
    setSucursalId(id)
    // El chofer y el vehículo buscados son de la sucursal anterior.
    setChoferApi(null)
    setErrorChofer(null)
    setModoManualChofer(false)
    setChoferManual({ cedula: '', nombre: '', apellido: '', cargo: '' })
    setCedulaBuscar('')
    patch({ sucursal_id: id, chofer: {}, chofer_firma: null, vehiculo: {} })
  }

  async function buscarChoferPorCedula() {
    const c = cedulaBuscar.trim()
    if (!c) return
    setBuscandoChofer(true)
    setErrorChofer(null)
    try {
      if (!sucursalActual) {
        setErrorChofer('Selecciona primero la sucursal donde se busca al chofer.')
        return
      }
      const branch = sucursalActual.branch_id ?? sucursalActual.shop_id
      if (!branch) {
        setErrorChofer(
          `«${sucursalActual.nombre}» no tiene ID de trabajadores (branch_id/shop_id) configurado. ` +
            'Elige otra sucursal o captura los datos del chofer a mano.'
        )
        setModoManualChofer(true)
        setChoferManual((m) => ({ ...m, cedula: c }))
        patch({ chofer: { cedula: c } })
        return
      }
      const r = await listarColaboradores(branch)
      if (r.mensaje) {
        setErrorChofer(r.mensaje)
        setModoManualChofer(true)
        setChoferManual((m) => ({ ...m, cedula: c }))
        patch({ chofer: { cedula: c } })
        return
      }
      const encontrado = r.colaboradores.find((col) => String(col.dni ?? '').trim() === c)
      if (encontrado) {
        setChoferApi(encontrado)
        setModoManualChofer(false)
        const nom = nombreColaborador(encontrado)
        const partes = nom.split(' ')
        const nombre = partes.shift() || encontrado.name || ''
        const apellido = partes.join(' ') || encontrado.lastname || ''
        patch({
          chofer: {
            cedula: c,
            nombre,
            apellido,
            cargo: encontrado.role_name || encontrado.role_id || ''
          }
        })
      } else {
        setErrorChofer('No se encontró un trabajador con esa cédula en la sucursal seleccionada.')
        setModoManualChofer(true)
        setChoferManual((m) => ({ ...m, cedula: c }))
        patch({ chofer: { cedula: c } })
      }
    } catch (e) {
      setErrorChofer(e instanceof Error ? e.message : 'No se pudo consultar los trabajadores.')
      setModoManualChofer(true)
      setChoferManual((m) => ({ ...m, cedula: c }))
    } finally {
      setBuscandoChofer(false)
    }
  }

  /* --- PDF ------------------------------------------------------------------- */

  const chofer = reg?.chofer ?? {}
  const puedeExportar = Boolean(
    reg &&
      reg.placa.trim() &&
      String(chofer.cedula ?? '').trim() &&
      String(chofer.nombre ?? '').trim() &&
      reg.chofer_firma
  )

  const preguntas = useMemo(
    () => itemsEvaluables.map((i) => resolverPregunta(i, reg?.respuestas?.[i.id])),
    [itemsEvaluables, reg?.respuestas]
  )

  /**
   * Cada pregunta resuelta a las filas de la tabla del PDF. El PDF solo entiende
   * etiqueta/valor, así que el texto del ítem va en la etiqueta de cada fila y el
   * dictamen (si hay) se agrega como fila aparte.
   */
  const filasPdf = useMemo(
    () =>
      preguntas.flatMap((p) => [
        ...p.filas.map((f) => ({ etiqueta: `${p.texto} · ${f.etiqueta}`, valor: f.valor })),
        ...(p.veredicto ? [{ etiqueta: `${p.texto} · Nota`, valor: p.veredicto }] : [])
      ]),
    [preguntas]
  )

  async function exportarPDF() {
    const r = regRef.current
    if (!r || !modulo) return
    setExportando(true)
    try {
      await exportarRevisionPreEntrega({
        titulo: modulo.nombre,
        fecha: r.fecha,
        sucursal: sucursalActual?.nombre ?? null,
        evaluador: profile?.nombre ?? null,
        observaciones: r.observaciones.trim() || null,
        vehiculo: { placa: r.placa, ...r.vehiculo },
        chofer: {
          cedula: (r.chofer.cedula as string) || null,
          nombre: (r.chofer.nombre as string) || null,
          apellido: (r.chofer.apellido as string) || null,
          cargo: (r.chofer.cargo as string) || null,
          firma: r.chofer_firma
        },
        items: filasPdf
      })
      // La entrega quedó hecha: se marca finalizada y se sube en el acto si hay
      // señal. Si no, la cola la sube sola y la borra de local al confirmarla.
      const finalizada: PreEntregaRecord = { ...r, estado: 'FINALIZADA', updated_at: Date.now() }
      guardarLocal(finalizada)
      if (online) {
        try {
          await subirRevisionPreEntrega(finalizada)
          setAviso({ texto: 'PDF generado y revisión guardada en la nube.', ok: true })
        } catch {
          setAviso({ texto: 'PDF generado. La revisión queda en el teléfono hasta que vuelva la señal.', ok: false })
        }
      } else {
        setAviso({ texto: 'PDF generado. La revisión queda en el teléfono hasta que vuelva la señal.', ok: false })
      }
    } catch (e) {
      console.error('Error exportando PDF:', e)
      setAviso({ texto: 'No se pudo generar el PDF.', ok: false })
    } finally {
      setExportando(false)
    }
  }

  /* --- Render ---------------------------------------------------------------- */

  if (cargando) {
    return (
      <MobileLayout titulo="Revisión Pre-Entrega">
        <div className="py-20 text-center text-slate-400">Cargando…</div>
      </MobileLayout>
    )
  }

  if (!modulo || !itemsEvaluables.length) {
    return (
      <MobileLayout titulo="Revisión Pre-Entrega">
        <EmptyState
          title="No hay check list configurado"
          subtitle="El Líder debe crear el módulo «Revisión Pre-Entrega» y sus ítems desde Ítems de evaluación."
        />
        <div className="text-center">
          <Button variant="ghost" onClick={() => navigate(-1)}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Volver
          </Button>
        </div>
      </MobileLayout>
    )
  }

  if (!reg) {
    return (
      <MobileLayout titulo="Revisión Pre-Entrega">
        <EmptyState title="Elige una sucursal" subtitle="Selecciona la sucursal para empezar la revisión." />
      </MobileLayout>
    )
  }

  const respondidas = itemsEvaluables.filter((i) => tieneRespuesta(i, reg.respuestas[i.id])).length
  const pct = Math.round((respondidas / itemsEvaluables.length) * 100)
  const vehiculo = reg.vehiculo

  return (
    <MobileLayout titulo="Revisión Pre-Entrega" subtitulo={sucursalActual?.nombre ?? undefined}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" onClick={() => navigate(-1)} className="-ml-2">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Volver
          </Button>
          <span className="text-xs text-slate-400">
            {respondidas}/{itemsEvaluables.length} · {pct}%
          </span>
        </div>

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
            Sin conexión: la revisión se guarda en el teléfono y sube sola cuando vuelva la señal.
          </p>
        ) : null}

        {/* Sucursal ---------------------------------------------------------- */}
        <Card className="space-y-3">
          <Field
            label="Sucursal"
            hint={
              sucursalActual
                ? sucursalActual.branch_id || sucursalActual.shop_id
                  ? `Trabajadores: ${sucursalActual.branch_id || sucursalActual.shop_id}`
                  : 'Esta sucursal no tiene ID de trabajadores; el chofer se captura a mano.'
                : 'Los cambios de sucursal descartan el vehículo y el chofer ya cargados.'
            }
          >
            <Select value={sucursalId} onChange={(e) => cambiarSucursal(e.target.value)}>
              <option value="">Selecciona una sucursal…</option>
              {sucursales
                .filter((s) => s.activa)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre}
                  </option>
                ))}
            </Select>
          </Field>
        </Card>

        {/* Vehículo ---------------------------------------------------------- */}
        <Card className="space-y-3">
          <h2 className="text-sm font-bold text-primary-900">Vehículo</h2>
          <Field label="Placa" hint="Consulta la flota por placa.">
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
            <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{errorVehiculo}</p>
          ) : null}

          {vehiculo.placa || vehiculo.marca ? (
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-xl bg-slate-50 p-3 text-xs">
              <Dato label="Marca" valor={vehiculo.marca as string} />
              <Dato label="Modelo" valor={vehiculo.modelo as string} />
              <Dato label="Color" valor={vehiculo.color as string} />
              <Dato label="Año" valor={vehiculo.anio as number} />
              <Dato label="Kilometraje" valor={vehiculo.kilometraje as number} />
              <Dato label="Flota" valor={vehiculo.flota as string} />
            </dl>
          ) : null}
        </Card>

        {/* Chofer ------------------------------------------------------------ */}
        <Card className="space-y-3">
          <h2 className="text-sm font-bold text-primary-900">Chofer</h2>

          <Field label="Cédula" hint="Busca al trabajador de la sucursal. Si no aparece, ingrésalo manual.">
            <div className="flex gap-2">
              <Input
                value={cedulaBuscar}
                onChange={(e) => setCedulaBuscar(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void buscarChoferPorCedula()
                }}
                placeholder="Número de cédula"
                inputMode="numeric"
              />
              <Button
                type="button"
                onClick={() => void buscarChoferPorCedula()}
                disabled={buscandoChofer || !cedulaBuscar.trim()}
                className="shrink-0"
              >
                {buscandoChofer ? <Spinner size={16} light /> : <UserSearch className="h-4 w-4" />}
              </Button>
            </div>
          </Field>

          {errorChofer ? (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">{errorChofer}</p>
          ) : null}

          {modoManualChofer ? (
            <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3">
              <Field label="Cédula" className="col-span-2 sm:col-span-1">
                <Input
                  value={choferManual.cedula}
                  onChange={(e) => {
                    const v = e.target.value
                    setChoferManual((m) => ({ ...m, cedula: v }))
                    patchChofer({ cedula: v })
                  }}
                />
              </Field>
              <Field label="Nombre">
                <Input
                  value={choferManual.nombre}
                  onChange={(e) => {
                    const v = e.target.value
                    setChoferManual((m) => ({ ...m, nombre: v }))
                    patchChofer({ nombre: v })
                  }}
                />
              </Field>
              <Field label="Apellido">
                <Input
                  value={choferManual.apellido}
                  onChange={(e) => {
                    const v = e.target.value
                    setChoferManual((m) => ({ ...m, apellido: v }))
                    patchChofer({ apellido: v })
                  }}
                />
              </Field>
              <Field label="Cargo">
                <Input
                  value={choferManual.cargo}
                  onChange={(e) => {
                    const v = e.target.value
                    setChoferManual((m) => ({ ...m, cargo: v }))
                    patchChofer({ cargo: v })
                  }}
                />
              </Field>
            </div>
          ) : choferApi ? (
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-xl bg-slate-50 p-3 text-xs">
              <Dato label="Cédula" valor={choferApi.dni} />
              <Dato label="Nombre" valor={nombreColaborador(choferApi)} />
              <Dato label="Cargo" valor={choferApi.role_name ?? choferApi.role_id} />
              <Dato label="Sucursal" valor={choferApi.branch_name} />
            </dl>
          ) : null}

          <FirmaCanvas
            valor={reg.chofer_firma}
            onChange={(v) => patch({ chofer_firma: v })}
            label="Firma del chofer (necesaria para exportar)"
          />
        </Card>

        {/* Check list del catálogo ------------------------------------------- */}
        {itemsEvaluables.map((item: Item, idx) => (
          <ItemRenderer
            key={item.id}
            item={item}
            index={idx}
            total={itemsEvaluables.length}
            valor={reg.respuestas[item.id]}
            shopId={sucursalActual?.shop_id}
            branchId={sucursalActual?.branch_id}
            gerente={sucursalActual?.gerente?.nombre ?? null}
            onChange={(v) => cambiarRespuesta(item.id, v)}
          />
        ))}

        {/* Observaciones ----------------------------------------------------- */}
        <Card className="space-y-2">
          <h2 className="text-sm font-bold text-primary-900">Observaciones</h2>
          <Textarea
            value={reg.observaciones}
            onChange={(e) => patch({ observaciones: e.target.value })}
            rows={4}
            placeholder="Detalles de la entrega, recomendaciones, daños observados…"
          />
        </Card>

        {/* Acción ------------------------------------------------------------ */}
        <div className="sticky bottom-0 -mx-4 border-t border-slate-200 bg-slate-100/95 px-4 py-3 backdrop-blur">
          {!puedeExportar ? (
            <p className="mb-2 text-center text-xs text-slate-500">
              Completa placa, cédula, nombre y firma del chofer para exportar.
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
            <Button
              type="button"
              variant="success"
              onClick={() => void exportarPDF()}
              disabled={!puedeExportar || exportando}
              className="flex-1"
            >
              {exportando ? <Spinner size={16} light /> : <FileDown className="h-4 w-4" />}
              {exportando ? 'Generando PDF…' : 'Exportar PDF y finalizar'}
            </Button>
          </div>
        </div>
      </div>
    </MobileLayout>
  )
}

/** Par etiqueta/valor para las fichas de datos (vehículo y chofer). */
function Dato({ label, valor }: { label: string; valor?: string | number | null }) {
  const vacio = valor === null || valor === undefined || valor === ''
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className={`mt-0.5 font-semibold ${vacio ? 'text-slate-400' : 'text-slate-800'}`}>
        {vacio ? '—' : String(valor)}
      </dd>
    </div>
  )
}