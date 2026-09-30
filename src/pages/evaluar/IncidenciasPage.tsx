import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Camera, CloudOff, Pencil, RefreshCw, X } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useCatalog } from '../../context/CatalogContext'
import { useOffline } from '../../context/OfflineContext'
import { deletePhoto, getPhotos, listIncidentes, updateIncidente, type IncidenteRecord } from '../../lib/offline/db'
import { PhotoCapture } from '../../components/PhotoCapture'
import { pathFotoIncidencia } from '../../lib/offline/sync'
import { supabase } from '../../lib/supabase'
import { Button, Modal, Spinner, Textarea } from '../../components/ui'
import { MobileLayout } from '../../components/layouts/MobileLayout'

type IncidenciaVista = {
  id: string
  sucursal_id: string
  fecha: string
  modulo_id: string | null
  descripcion: string
  fotos: string[]
  photoIds: string[]
  created_at: number
  pendiente: boolean
  local: boolean
}

export function IncidenciasPage() {
  const { profile } = useAuth()
  const { sucursales, modulos } = useCatalog()
  const { online, sync } = useOffline()
  const [incidencias, setIncidencias] = useState<IncidenciaVista[]>([])
  const [cargando, setCargando] = useState(true)
  const [actualizando, setActualizando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editando, setEditando] = useState<IncidenciaVista | null>(null)
  const [descripcion, setDescripcion] = useState('')
  const [photoIdsEditando, setPhotoIdsEditando] = useState<string[]>([])
  const [fotosNubeEditando, setFotosNubeEditando] = useState<string[]>([])
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
          .select('id, sucursal_id, fecha, modulo_id, descripcion, fotos, created_at')
          .eq('evaluador_id', profile.id)
          .order('created_at', { ascending: false })

        if (queryError) {
          errorRemoto = queryError.message
        } else {
          remotas = (data ?? []).map((fila) => ({
            id: fila.id as string,
            sucursal_id: fila.sucursal_id as string,
            fecha: fila.fecha as string,
            modulo_id: fila.modulo_id as string | null,
            descripcion: fila.descripcion as string,
            fotos: Array.isArray(fila.fotos) ? fila.fotos as string[] : [],
            photoIds: [],
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

  function abrirEdicion(incidente: IncidenciaVista) {
    setEditando(incidente)
    setDescripcion(incidente.descripcion)
    setPhotoIdsEditando(incidente.photoIds)
    setFotosNubeEditando(incidente.fotos)
    setErrorGuardado(null)
  }

  async function guardarEdicion() {
    if (!editando || !profile) return
    const texto = descripcion.trim()
    if (!texto || guardando) return
    setGuardando(true)
    setErrorGuardado(null)
    try {
      if (editando.local) {
        await updateIncidente(editando.id, { descripcion: texto, photoIds: photoIdsEditando })
        if (online) {
          const { error: updateError } = await supabase
            .from('incidencias')
            .update({ descripcion: texto })
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
          .update({ descripcion: texto, fotos: fotosFinales })
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
        <section className="flex items-center gap-3 border-b border-slate-200 pb-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-amber-100 text-amber-800">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-slate-900">Incidencias reportadas</h2>
            <p className="text-xs text-slate-500">{incidencias.length} en total · puedes editar la descripción</p>
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

        {cargando ? (
          <div className="flex justify-center py-12"><Spinner size={24} /></div>
        ) : incidencias.length === 0 ? (
          <div className="border-y border-dashed border-slate-300 py-10 text-center">
            <AlertTriangle className="mx-auto h-7 w-7 text-slate-300" />
            <p className="mt-2 text-sm font-semibold text-slate-700">Todavía no hay incidencias</p>
            <p className="mt-1 text-xs text-slate-500">Puedes reportarlas desde la barra de evaluación.</p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-200">
            {incidencias.map((incidente) => {
              const sucursal = sucursales.find((fila) => fila.id === incidente.sucursal_id)
              const modulo = modulos.find((fila) => fila.id === incidente.modulo_id)
              return (
                <li key={incidente.id} className="py-3">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="whitespace-pre-wrap text-sm font-medium text-slate-900">{incidente.descripcion}</p>
                      <p className="mt-1 text-xs text-slate-600">
                        {sucursal?.nombre ?? 'Sucursal'} · {new Date(`${incidente.fecha}T12:00:00`).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' })}
                        {modulo ? ` · ${modulo.nombre}` : ''}
                      </p>
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
                      aria-label={`Editar incidencia de ${sucursal?.nombre ?? 'la sucursal'}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
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
    sucursal_id: incidente.sucursal_id,
    fecha: incidente.fecha,
    modulo_id: incidente.modulo_id,
    descripcion: incidente.descripcion,
    fotos: [],
    photoIds: incidente.photoIds,
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
            <img src={urls[path]} alt="Foto de la incidencia" className="h-full w-full object-cover" />
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
    </div>
  )
}
