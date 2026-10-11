import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, Camera, ChevronDown, CloudOff, Filter, Pencil, RefreshCw, X } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useCatalog } from '../../context/CatalogContext'
import { useOffline } from '../../context/OfflineContext'
import { deletePhoto, getPhotos, listIncidentes, updateIncidente, type IncidenteRecord } from '../../lib/offline/db'
import { ChipsResponsables, EditorResponsablesIncidencia } from '../../components/EditorResponsablesIncidencia'
import { PhotoCapture } from '../../components/PhotoCapture'
import { pathFotoIncidencia } from '../../lib/offline/sync'
import { supabase } from '../../lib/supabase'
import { Button, cn, Input, Modal, Select, Spinner, Textarea } from '../../components/ui'
import { ModalImagen } from '../../components/ModalImagen'
import { MobileLayout } from '../../components/layouts/MobileLayout'
import {
  normalizarResponsables,
  responsablesAColumna,
  type ResponsableIncidencia
} from '../../lib/data/responsablesIncidencia'

type IncidenciaVista = {
  id: string
  /** Unidad de la incidencia: sucursal **o** departamento (una de las dos). */
  sucursal_id: string | null
  departamento_id: string | null
  fecha: string
  modulo_id: string | null
  descripcion: string
  fotos: string[]
  photoIds: string[]
  /** Cargos responsables. Vacío si la incidencia se creó sin ellos. */
  responsables: ResponsableIncidencia[]
  created_at: number
  pendiente: boolean
  local: boolean
}

/** La fecha en el mismo formato que ya se mostraba en cada incidencia. */
function fechaBonita(fecha: string): string {
  return new Date(`${fecha}T12:00:00`).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function IncidenciasPage() {
  const { profile } = useAuth()
  const { sucursales, departamentos, modulos } = useCatalog()
  const { online, sync } = useOffline()
  const [incidencias, setIncidencias] = useState<IncidenciaVista[]>([])
  const [cargando, setCargando] = useState(true)
  const [actualizando, setActualizando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editando, setEditando] = useState<IncidenciaVista | null>(null)
  const [descripcion, setDescripcion] = useState('')
  const [photoIdsEditando, setPhotoIdsEditando] = useState<string[]>([])
  const [fotosNubeEditando, setFotosNubeEditando] = useState<string[]>([])
  const [responsablesEditando, setResponsablesEditando] = useState<ResponsableIncidencia[]>([])
  const [guardando, setGuardando] = useState(false)
  const [errorGuardado, setErrorGuardado] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    if (!profile) return
    setActualizando(true)
    try {
      const locales = (await listIncidentes()).filter((incidente) => incidente.evaluador_id === profile.id)
      let remotas: IncidenciaVista[] = []
      let errorRemoto: string | null = null

      if (online) {
        const { data, error: queryError } = await supabase
          .from('incidencias')
          .select('id, sucursal_id, departamento_id, fecha, modulo_id, descripcion, fotos, created_at, responsables')
          .eq('evaluador_id', profile.id)
          .order('created_at', { ascending: false })

        if (queryError) {
          errorRemoto = queryError.message
        } else {
          remotas = (data ?? []).map((fila) => ({
            id: fila.id as string,
            sucursal_id: (fila.sucursal_id as string | null) ?? null,
            departamento_id: (fila.departamento_id as string | null) ?? null,
            fecha: fila.fecha as string,
            modulo_id: fila.modulo_id as string | null,
            descripcion: fila.descripcion as string,
            fotos: Array.isArray(fila.fotos) ? fila.fotos as string[] : [],
            photoIds: [],
            // Las incidencias guardadas antes de esta columna no la tienen: por
            // eso `normalizarResponsables` y no un `?? []`, que dejaría pasar
            // cualquier otra forma.
            responsables: normalizarResponsables(fila.responsables),
            created_at: new Date(fila.created_at as string).getTime(),
            pendiente: false,
            local: false
          }))
        }
      }

      const unicas = new Map(remotas.map((incidente) => [incidente.id, incidente]))
      for (const incidente of locales) {
        unicas.set(incidente.id, convertirLocal(incidente))
      }
      setIncidencias([...unicas.values()].sort((a, b) => b.created_at - a.created_at))
      setError(errorRemoto)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar las incidencias.')
    } finally {
      setCargando(false)
      setActualizando(false)
    }
  }, [online, profile])

  useEffect(() => {
    void cargar()
  }, [cargar])

  /* El filtro vive en la URL y no en estado local: así el enlace que sale de la
     evaluación llega con la unidad y el día ya puestos (ver ReportarIncidencia),
     se puede compartir, y refrescar la página o volver con Atrás no lo borra. */
  const [params, setParams] = useSearchParams()
  const unidadSel = params.get('unidad') ?? ''
  const fechaSel = params.get('fecha') ?? ''
  const moduloSel = params.get('modulo') ?? ''
  const hayFiltro = !!(unidadSel || fechaSel || moduloSel)

  const cambiarFiltro = useCallback(
    (clave: string, valor: string) => {
      const siguiente = new URLSearchParams(params)
      if (valor) siguiente.set(clave, valor)
      else siguiente.delete(clave)
      setParams(siguiente, { replace: true })
    },
    [params, setParams]
  )

  const nombreUnidad = useCallback(
    (unidadId: string, esDepartamento: boolean) =>
      (esDepartamento ? departamentos.find((d) => d.id === unidadId) : sucursales.find((s) => s.id === unidadId))?.nombre ?? 'Sucursal',
    [departamentos, sucursales]
  )

  /**
   * Una incidencia pertenece a una evaluación, y una evaluación es unidad + fecha
   * (la misma clave que usa `evaluacionActivaDe` al subir). Agrupar así es lo que
   * hace legible la lista: cada bloque es una visita, no un pedazo de la historia
   * del evaluador mezclado con las demás tiendas.
   */
  const agrupadas = useMemo(() => {
    const visibles = incidencias.filter((i) => {
      if (unidadSel && (i.departamento_id ?? i.sucursal_id) !== unidadSel) return false
      if (fechaSel && i.fecha !== fechaSel) return false
      if (moduloSel && (i.modulo_id ?? '') !== moduloSel) return false
      return true
    })
    const mapa = new Map<string, { clave: string; unidad: string; fecha: string; items: IncidenciaVista[] }>()
    for (const incidencia of visibles) {
      const unidadId = incidencia.departamento_id ?? incidencia.sucursal_id ?? ''
      const clave = `${unidadId}|${incidencia.fecha}`
      const grupo = mapa.get(clave) ?? {
        clave,
        unidad: nombreUnidad(unidadId, !!incidencia.departamento_id),
        fecha: incidencia.fecha,
        items: []
      }
      grupo.items.push(incidencia)
      mapa.set(clave, grupo)
    }
    return [...mapa.values()].sort((a, b) =>
      b.fecha === a.fecha ? (b.items[0]?.created_at ?? 0) - (a.items[0]?.created_at ?? 0) : b.fecha.localeCompare(a.fecha)
    )
  }, [incidencias, unidadSel, fechaSel, moduloSel, nombreUnidad])

  // Estado explícito de lo que el usuario abrió o cerró a mano. Lo que no
  // tocó, se resuelve con `abiertaDeEntrada`.
  const [plegadas, setPlegadas] = useState<Record<string, boolean>>({})
  // Por defecto las secciones van colgadas: la lista se ve como un índice de
  // visitas y sólo se abre lo que interesa. La única excepción es entrar desde
  // una evaluación, donde la URL ya trae la unidad y el día y lo que se quiere
  // ver es justamente esa visita.
  const desdeEvaluacion = !!(unidadSel && fechaSel)
  const abiertaDeEntrada = !desdeEvaluacion
  const conFiltro = agrupadas.reduce((total, grupo) => total + grupo.items.length, 0)

  function abrirEdicion(incidente: IncidenciaVista) {
    setEditando(incidente)
    setDescripcion(incidente.descripcion)
    setPhotoIdsEditando(incidente.photoIds)
    setFotosNubeEditando(incidente.fotos)
    setResponsablesEditando(normalizarResponsables(incidente.responsables))
    setErrorGuardado(null)
  }

  async function guardarEdicion() {
    if (!editando || !profile) return
    const texto = descripcion.trim()
    if (!texto || guardando) return
    setGuardando(true)
    setErrorGuardado(null)
    try {
      // Se normaliza una sola vez y se usa en los dos caminos, para que lo que
      // queda guardado sea idéntico si la incidencia es local o ya está subida.
      const responsables = responsablesAColumna(normalizarResponsables(responsablesEditando))
      if (editando.local) {
        await updateIncidente(editando.id, {
          descripcion: texto,
          photoIds: photoIdsEditando,
          responsables: normalizarResponsables(responsablesEditando)
        })
        if (online) {
          const { error: updateError } = await supabase
            .from('incidencias')
            .update({ descripcion: texto, responsables })
            .eq('id', editando.id)
            .eq('evaluador_id', profile.id)
          if (updateError) throw updateError
          await sync()
        }
      } else {
        const nuevasFotos = await subirFotos(editando.id, photoIdsEditando)
        const fotosFinales = [...fotosNubeEditando, ...nuevasFotos]
        const { error: updateError } = await supabase
          .from('incidencias')
          .update({ descripcion: texto, fotos: fotosFinales, responsables })
          .eq('id', editando.id)
          .eq('evaluador_id', profile.id)
        if (updateError) throw updateError
        const quitarFotos = editando.fotos.filter((path) => !fotosNubeEditando.includes(path))
        if (quitarFotos.length) {
          const { error: deleteError } = await supabase.storage.from('evidencias').remove(quitarFotos)
          if (deleteError) throw deleteError
        }
        for (const id of photoIdsEditando) await deletePhoto(id)
      }
      setEditando(null)
      setPhotoIdsEditando([])
      setFotosNubeEditando([])
      await cargar()
    } catch (e) {
      setErrorGuardado(e instanceof Error ? e.message : 'No se pudo guardar la incidencia.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <MobileLayout titulo="Incidencias" subtitulo="Reportes de tus evaluaciones">
      <div className="space-y-4">
        <section className="flex items-center gap-3 pb-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-amber-100 text-amber-800">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-slate-900">Incidencias reportadas</h2>
            <p className="text-xs text-slate-500">
              {hayFiltro
                ? `${conFiltro} de ${incidencias.length} · puedes editar la descripción`
                : `${incidencias.length} en total · puedes editar la descripción`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void cargar()}
            disabled={actualizando}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-600 hover:bg-slate-200 disabled:opacity-50"
            title="Actualizar incidencias"
            aria-label="Actualizar incidencias"
          >
            <RefreshCw className={`h-4 w-4 ${actualizando ? 'animate-spin' : ''}`} />
          </button>
        </section>

        {!online ? (
          <p className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
            <CloudOff className="h-4 w-4 shrink-0" /> Sin conexión: se muestran las incidencias guardadas en este dispositivo.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            No se pudieron actualizar todas las incidencias: {error}. Las que están guardadas en este dispositivo siguen disponibles.
          </p>
        ) : null}

        {/* El filtro vive en la URL: el enlace desde la evaluación llega con la
            unidad y el día puestos, y se puede compartir o refrescar sin perderlo. */}
        <section className="rounded-xl bg-slate-50 p-3">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 shrink-0 text-slate-500" />
            <p className="flex-1 text-xs font-bold uppercase tracking-wide text-slate-500">Filtrar por evaluación</p>
            {hayFiltro ? (
              <button
                type="button"
                onClick={() => setParams(new URLSearchParams(), { replace: true })}
                className="inline-flex items-center gap-1 text-xs font-bold text-slate-600 hover:text-slate-900"
              >
                <X className="h-3.5 w-3.5" /> Quitar
              </button>
            ) : null}
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <label className="block">
              <span className="block text-[11px] font-semibold text-slate-500">Sucursal o departamento</span>
              <Select className="mt-1" value={unidadSel} onChange={(e) => cambiarFiltro('unidad', e.target.value)}>
                <option value="">Todas</option>
                <optgroup label="Sucursales">
                  {sucursales.map((s) => (
                    <option key={s.id} value={s.id}>{s.nombre}</option>
                  ))}
                </optgroup>
                {departamentos.length ? (
                  <optgroup label="Departamentos">
                    {departamentos.map((d) => (
                      <option key={d.id} value={d.id}>{d.nombre}</option>
                    ))}
                  </optgroup>
                ) : null}
              </Select>
            </label>
            <label className="block">
              <span className="block text-[11px] font-semibold text-slate-500">Fecha</span>
              <Input type="date" className="mt-1" value={fechaSel} onChange={(e) => cambiarFiltro('fecha', e.target.value)} />
            </label>
            <label className="block">
              <span className="block text-[11px] font-semibold text-slate-500">Módulo</span>
              <Select className="mt-1" value={moduloSel} onChange={(e) => cambiarFiltro('modulo', e.target.value)}>
                <option value="">Todos</option>
                {modulos.filter((m) => !m.herramienta).map((m) => (
                  <option key={m.id} value={m.id}>{m.nombre}</option>
                ))}
              </Select>
            </label>
          </div>
        </section>

        {cargando ? (
          <div className="flex justify-center py-12"><Spinner size={24} /></div>
        ) : agrupadas.length === 0 ? (
          <div className="rounded-xl bg-slate-50 py-10 text-center">
            <AlertTriangle className="mx-auto h-7 w-7 text-slate-300" />
            <p className="mt-2 text-sm font-semibold text-slate-700">{hayFiltro ? 'Nada con ese filtro' : 'Todavía no hay incidencias'}</p>
            <p className="mt-1 text-xs text-slate-500">
              {hayFiltro ? 'Probá quitar el filtro o mirar otra fecha.' : 'Puedes reportarlas desde la barra de evaluación.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {agrupadas.map((grupo) => {
              const abierta = plegadas[grupo.clave] ?? abiertaDeEntrada
              // El bloque se distingue por el relleno, no por un borde: la
              // página es blanca y estas tarjetas son gris claro.
              return (
                <section key={grupo.clave} className="overflow-hidden rounded-xl bg-slate-50">
                  <button
                    type="button"
                    onClick={() => setPlegadas((p) => ({ ...p, [grupo.clave]: !abierta }))}
                    aria-expanded={abierta}
                    className="flex w-full items-center gap-2 bg-slate-100 px-3 py-2.5 text-left transition-colors hover:bg-slate-200"
                  >
                    <ChevronDown className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', abierta ? '' : '-rotate-90')} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-slate-800">{grupo.unidad}</span>
                      <span className="block text-xs text-slate-500">
                        {fechaBonita(grupo.fecha)} · {grupo.items.length} incidencia{grupo.items.length === 1 ? '' : 's'}
                      </span>
                    </span>
                  </button>
                  {abierta ? (
                    <ul className="divide-y divide-slate-200">
                      {grupo.items.map((incidente) => {
                        const modulo = modulos.find((fila) => fila.id === incidente.modulo_id)
                        return (
                          <li key={incidente.id} className="px-3 py-3">
                            <div className="flex items-start gap-3">
                              <div className="min-w-0 flex-1">
                                <p className="whitespace-pre-wrap text-sm font-medium text-slate-900">{incidente.descripcion}</p>
                                {modulo ? <p className="mt-1 text-xs text-slate-600">{modulo.nombre}</p> : null}
                                <ChipsResponsables valor={incidente.responsables} className="mt-1.5" />
                                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                                  <span>{new Date(incidente.created_at).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                                  {incidente.fotos.length + incidente.photoIds.length > 0 ? <span className="inline-flex items-center gap-1"><Camera className="h-3.5 w-3.5" /> {incidente.fotos.length + incidente.photoIds.length} foto(s)</span> : null}
                                  {incidente.pendiente ? <span className="font-semibold text-amber-700">Pendiente de sincronizar</span> : null}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => abrirEdicion(incidente)}
                                disabled={!online && !incidente.local}
                                className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-600 hover:bg-amber-100 hover:text-amber-900"
                                title="Editar incidencia"
                                aria-label={`Editar incidencia de ${grupo.unidad}`}
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  ) : null}
                </section>
              )
            })}
          </div>
        )}
      </div>

      <Modal
        open={!!editando}
        onClose={() => setEditando(null)}
        title="Editar incidencia"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setEditando(null)}>Cancelar</Button>
            <Button className="flex-1" onClick={() => void guardarEdicion()} disabled={!descripcion.trim() || guardando}>
              {guardando ? <Spinner size={16} light /> : null}
              Guardar
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Textarea rows={5} value={descripcion} onChange={(event) => setDescripcion(event.target.value)} autoFocus />
          {editando ? (
            <EditorResponsablesIncidencia
              valor={responsablesEditando}
              onChange={setResponsablesEditando}
              // Sin sucursal (incidencia de un departamento) el catálogo de cargos
              // no aplica: el editor queda en modo texto libre.
              sucursalId={editando.sucursal_id ?? ''}
            />
          ) : null}
          {errorGuardado ? <p role="alert" className="text-xs font-medium text-red-700">{errorGuardado}</p> : null}
          <FotosNubeEditables paths={fotosNubeEditando} onQuitar={(path) => setFotosNubeEditando((actuales) => actuales.filter((x) => x !== path))} />
          <PhotoCapture photoIds={photoIdsEditando} onChange={setPhotoIdsEditando} />
          {editando?.pendiente ? <p className="text-xs text-slate-500">Los cambios se guardarán en el dispositivo y se sincronizarán al recuperar conexión.</p> : null}
        </div>
      </Modal>
    </MobileLayout>
  )
}

function convertirLocal(incidente: IncidenteRecord): IncidenciaVista {
  return {
    id: incidente.id,
    sucursal_id: incidente.departamento_id ? null : incidente.unidad_id,
    departamento_id: incidente.departamento_id ?? null,
    fecha: incidente.fecha,
    modulo_id: incidente.modulo_id,
    descripcion: incidente.descripcion,
    fotos: [],
    photoIds: incidente.photoIds,
    responsables: normalizarResponsables(incidente.responsables),
    created_at: incidente.created_at,
    pendiente: incidente.sync === 'pendiente',
    local: true
  }
}

async function subirFotos(incidenteId: string, photoIds: string[]): Promise<string[]> {
  const fotos = await getPhotos(photoIds)
  if (fotos.length !== photoIds.length) throw new Error('No se encontraron todas las fotos nuevas en este dispositivo.')
  const paths: string[] = []
  for (const foto of fotos) {
    const path = pathFotoIncidencia(incidenteId, foto.id)
    const { error } = await supabase.storage.from('evidencias').upload(path, foto.blob, {
      contentType: foto.mime,
      upsert: true
    })
    if (error) throw error
    paths.push(path)
  }
  return paths
}

function FotosNubeEditables({ paths, onQuitar }: { paths: string[]; onQuitar: (path: string) => void }) {
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [sinAcceso, setSinAcceso] = useState<Set<string>>(new Set())
  const [imagenAbierta, setImagenAbierta] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    setSinAcceso(new Set())
    if (!paths.length) {
      setUrls({})
      return
    }
    void supabase.storage.from('evidencias').createSignedUrls(paths, 3600).then(({ data, error }) => {
      if (!vivo) return
      if (error) throw error
      const nuevas: Record<string, string> = {}
      for (const foto of data ?? []) if (foto.path && foto.signedUrl) nuevas[foto.path] = foto.signedUrl
      setUrls(nuevas)
      setSinAcceso(new Set(paths.filter((path) => !nuevas[path])))
    }).catch(() => {
      if (vivo) setSinAcceso(new Set(paths))
    })
    return () => { vivo = false }
  }, [paths])

  if (!paths.length) return null
  return (
    <div className="grid grid-cols-3 gap-2">
      {paths.map((path) => (
        <div key={path} className="relative aspect-square overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
          {urls[path] ? (
            <button type="button" onClick={() => setImagenAbierta(urls[path])} aria-label="Ampliar foto de la incidencia" className="h-full w-full">
              <img src={urls[path]} alt="Foto de la incidencia" className="h-full w-full object-cover" />
            </button>
          ) : sinAcceso.has(path) ? (
            <div className="grid h-full place-items-center px-2 text-center text-[10px] font-medium text-slate-500">Foto no disponible. Revisa las políticas de Storage.</div>
          ) : (
            <div className="grid h-full place-items-center"><Spinner size={16} /></div>
          )}
          <button
            type="button"
            onClick={() => onQuitar(path)}
            aria-label="Quitar foto existente"
            title="Quitar foto"
            className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-slate-900/70 text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
      <ModalImagen
        src={imagenAbierta}
        alt="Foto de la incidencia"
        onClose={() => setImagenAbierta(null)}
      />
    </div>
  )
}
