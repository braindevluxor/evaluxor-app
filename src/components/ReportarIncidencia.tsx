import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Check, CloudOff, Send } from 'lucide-react'
import { useOffline } from '../context/OfflineContext'
import { addIncidente } from '../lib/offline/db'
import { Button, Modal, Spinner, Textarea, cn } from './ui'
import { PhotoCapture } from './PhotoCapture'
import { EditorResponsablesIncidencia } from './EditorResponsablesIncidencia'
import { normalizarResponsables, type ResponsableIncidencia } from '../lib/data/responsablesIncidencia'

interface Props {
  /** Sucursal y fecha de la evaluación en curso: sin esto el reporte no tiene a qué asociarse. */
  sucursalId: string
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
export function ReportarIncidencia({ sucursalId, fecha, moduloId, moduloNombre, evaluadorId }: Props) {
  const { online, incidentesPendientes, sync } = useOffline()
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

  // La confirmación se ve en el propio botón y se va sola: si no, queda un
  // cartel flotando durante toda la visita.
  useEffect(() => {
    if (!recienGuardada) return
    const t = window.setTimeout(() => setRecienGuardada(false), 4000)
    return () => window.clearTimeout(t)
  }, [recienGuardada])

  async function guardar() {
    const texto = descripcion.trim()
    if (!texto || guardando) return
    setGuardando(true)
    try {
      await addIncidente({
        evaluador_id: evaluadorId,
        sucursal_id: sucursalId,
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
          'relative grid h-11 w-11 shrink-0 place-items-center rounded-full text-white transition-colors',
          recienGuardada ? 'bg-green-600' : 'bg-amber-500 hover:bg-amber-600'
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

      <Modal
        open={abierto}
        onClose={cerrar}
        title="Reportar incidencia"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={cerrar}>Cancelar</Button>
            <Button className="flex-1" onClick={() => void guardar()} disabled={!descripcion.trim() || guardando}>
              {guardando ? <Spinner size={16} light /> : <Send className="h-4 w-4" />}
              Reportar
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            Anotá algo que viste en la tienda y no está en el cuestionario. Queda registrado para el Líder.
          </p>
          {moduloNombre ? (
            <p className="text-xs text-slate-500">
              Módulo en curso: <span className="font-semibold text-slate-700">{moduloNombre}</span>
            </p>
          ) : null}
          <Textarea
            rows={4}
            autoFocus
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="Ej: hay una bandeja de pechuga de pollo dentro de la nevera de helado."
          />
          {/* Va después del texto y antes de las fotos: primero qué pasó, después
              a quién le corresponde, y las fotos al final porque son las que más
              pesan en el modal. */}
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
      </Modal>
    </>
  )
}
