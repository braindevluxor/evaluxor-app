import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, ArrowLeft, Check, CloudOff, Eye, Send } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useOffline } from '../context/OfflineContext'
import { addIncidente } from '../lib/offline/db'
import { Button, Spinner, Textarea, cn } from './ui'
import { PhotoCapture } from './PhotoCapture'
import { EditorResponsablesIncidencia } from './EditorResponsablesIncidencia'
import { normalizarResponsables, type ResponsableIncidencia } from '../lib/data/responsablesIncidencia'

interface Props {
  /**
   * Unidad de la evaluación en curso: la sucursal **o** el departamento al que
   * pertenece. Sin uno de los dos el reporte no tiene a qué asociarse.
   */
  sucursalId: string
  departamentoId?: string | null
  fecha: string
  moduloId: string | null
  moduloNombre: string | null
  evaluadorId: string
}

/**
 * Reportar una incidencia fuera de lo programado.
 *
 * El disparador es un botón compacto dentro de la barra inferior de controles,
 * no un botón flotante: la barra es fija y tapa el borde inferior, así que un
 * botón suelto abajo a la derecha quedaba escondido detrás de ella. Va en la
 * misma línea que Anterior / Navegación / Siguiente, que es donde el pulgar ya
 * está: el aviso aparece en cualquier momento de la visita (una bandeja de
 * pechuga en la heladera de helados, un FIGE vencido, una puerta sin rotular).
 *
 * Sin texto para que entre la fila: se reconoce por el triángulo ámbar, el
 * título, y el contador rojo de las que faltan subir.
 *
 * El reporte NO es un ítem del cuestionario, así que va aparte: se guarda en el
 * teléfono y sube con el resto del avance (ver supabase/schema.sql).
 */
export function ReportarIncidencia({ sucursalId, departamentoId, fecha, moduloId, moduloNombre, evaluadorId }: Props) {
  const { online, incidentesPendientes, sync } = useOffline()
  // La unidad de la evaluación: la incidencia se le cuelga a ella (una sucursal
  // o un departamento centralizado) y así la cola sabe a qué tabla subirla. Va
  // con `||` y no con `??`: en la ruta de sucursal el departamento llega en ''.
  const unidadId = departamentoId || sucursalId
  const [abierto, setAbierto] = useState(false)
  const [descripcion, setDescripcion] = useState('')
  const [photoIds, setPhotoIds] = useState<string[]>([])
  const [responsables, setResponsables] = useState<ResponsableIncidencia[]>([])
  const [guardando, setGuardando] = useState(false)
  const [recienGuardada, setRecienGuardada] = useState(false)

  const abrir = useCallback(() => {
    setDescripcion('')
    setPhotoIds([])
    setResponsables([])
    setAbierto(true)
  }, [])

  const cerrar = useCallback(() => setAbierto(false), [])

  // La pantalla se cierra con Escape, igual que hacía el modal.
  useEffect(() => {
    if (!abierto) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAbierto(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [abierto])

  // La confirmación se ve en el propio botón y se va sola: si no, queda un
  // cartel flotando durante toda la visita.
  useEffect(() => {
    if (!recienGuardada) return
    const t = window.setTimeout(() => setRecienGuardada(false), 4000)
    return () => window.clearTimeout(t)
  }, [recienGuardada])

  async function guardar() {
    const texto = descripcion.trim()
    if (!texto || guardando || !unidadId) return
    setGuardando(true)
    try {
      await addIncidente({
        evaluador_id: evaluadorId,
        unidad_id: unidadId,
        departamento_id: departamentoId || null,
        fecha,
        modulo_id: moduloId,
        descripcion: texto,
        photoIds,
        responsables: normalizarResponsables(responsables)
      })
      setAbierto(false)
      setDescripcion('')
      setPhotoIds([])
      setResponsables([])
      setRecienGuardada(true)
      // Si hay señal, se sube ya; si no, queda en el teléfono y sube con el próximo sync.
      if (online) void sync()
    } finally {
      setGuardando(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        aria-label="Reportar incidencia"
        title={recienGuardada ? 'Incidencia guardada' : 'Reportar algo fuera de lo programado'}
        className={cn(
          // Mismo lenguaje que las acciones del Historial: outline, el color
          // vive en el trazo del ícono y el fondo sólo aparece como tinte al
          // hover. El ámbar lo deja claro que es "avisar algo", no navegar.
          'relative inline-grid h-11 w-11 shrink-0 place-items-center rounded-full transition-colors',
          recienGuardada
            ? 'text-green-600 hover:bg-green-50'
            : 'text-amber-500 hover:bg-amber-50'
        )}
      >
        {recienGuardada ? <Check className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
        {incidentesPendientes > 0 ? (
          <span
            className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-red-600 px-1 text-[11px] font-black text-white"
            title={`${incidentesPendientes} incidencia(s) esperando subir`}
          >
            {incidentesPendientes}
          </span>
        ) : null}
      </button>
      {/* Pantalla propia a pantalla completa (no un modal): el formulario vive
          en su vista con header y volver, y la evaluación queda abajo sin
          perder el módulo ni el ítem donde iba el evaluador. */}
      {abierto
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Reportar incidencia"
              className="fixed inset-0 z-[100] flex flex-col bg-white"
            >
              <header className="flex shrink-0 items-center gap-2 bg-white px-3 py-3">
                <button
                  type="button"
                  onClick={cerrar}
                  aria-label="Volver"
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <div className="min-w-0">
                  <h2 className="truncate text-base font-bold text-primary-900">Reportar incidencia</h2>
                  {moduloNombre ? (
                    <p className="truncate text-xs text-slate-500">Módulo en curso: {moduloNombre}</p>
                  ) : null}
                </div>
                {/* La lista de esta misma evaluación, no la de todas: el enlace
                    arrastra la unidad y el día para que la pantalla de
                    incidencias abra filtrada a la visita en curso. */}
                <Link
                  to={`/evaluar/incidencias?unidad=${encodeURIComponent(unidadId)}&fecha=${encodeURIComponent(fecha)}`}
                  aria-label="Ver incidencias de esta evaluación"
                  title="Ver incidencias de esta evaluación"
                  className="ml-auto grid h-10 w-10 shrink-0 place-items-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
                >
                  <Eye className="h-5 w-5" />
                </Link>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
                <div className="mx-auto w-full max-w-lg space-y-3">
                  <p className="text-sm text-slate-600">
                    Anotá algo que viste en la tienda y no está en el cuestionario. Queda registrado para el Líder.
                  </p>
                  <Textarea
                    rows={5}
                    autoFocus
                    value={descripcion}
                    onChange={(e) => setDescripcion(e.target.value)}
                    placeholder="Ej: hay una bandeja de pechuga de pollo dentro de la nevera de helado."
                  />
                  {/* Va después del texto y antes de las fotos: primero qué pasó,
                      después a quién le corresponde, y las fotos al final porque
                      son las que más pesan. */}
                  {/* Sin sucursal (incidencia de un departamento) el catálogo de
                      cargos no aplica: el editor queda en modo texto libre. */}
                  <EditorResponsablesIncidencia
                    valor={responsables}
                    onChange={setResponsables}
                    sucursalId={sucursalId}
                  />
                  <PhotoCapture photoIds={photoIds} onChange={setPhotoIds} />
                  <p className="flex items-center gap-1.5 text-xs text-slate-500">
                    {online ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-green-600" /> Se sube al reportar. Si no hay señal, queda en el teléfono.
                      </>
                    ) : (
                      <>
                        <CloudOff className="h-3.5 w-3.5 text-amber-600" /> Sin conexión: queda en el teléfono y sube sola después.
                      </>
                    )}
                  </p>
                </div>
              </div>

              <div className="shrink-0 bg-white px-4 py-3">
                <div className="mx-auto flex w-full max-w-lg gap-2">
                  <Button variant="secondary" className="flex-1" onClick={cerrar}>Cancelar</Button>
                  <Button className="flex-1" onClick={() => void guardar()} disabled={!descripcion.trim() || guardando}>
                    {guardando ? <Spinner size={16} light /> : <Send className="h-4 w-4" />}
                    Reportar
                  </Button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  )
}
