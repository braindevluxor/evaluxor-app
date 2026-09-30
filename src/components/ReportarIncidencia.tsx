import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Check, CloudOff, Send } from 'lucide-react'
import { useOffline } from '../context/OfflineContext'
import { addIncidente } from '../lib/offline/db'
import { Button, Modal, Spinner, Textarea, cn } from './ui'
import { PhotoCapture } from './PhotoCapture'

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
 * El disparador es una fila de la barra inferior de controles, no un botón
 * flotante: la barra es fija y tapa el borde inferior, así que un botón suelto
 * abajo a la derecha quedaba escondido detrás de ella. En la barra ocupa su
 * propia línea (arriba de Anterior/Siguiente) y queda al alcance del pulgar en
 * cualquier ítem, módulo o sección repetible, porque lo interesante aparece en
 * cualquier momento de la visita: una bandeja de pechuga en la heladera de
 * helados, un FIGE vencido, una puerta sin rotular.
 *
 * El reporte NO es un ítem del cuestionario, así que va aparte: se guarda en el
 * teléfono y sube con el resto del avance (ver supabase/incidencias.sql).
 */
export function ReportarIncidencia({ sucursalId, fecha, moduloId, moduloNombre, evaluadorId }: Props) {
  const { online, incidentesPendientes, sync } = useOffline()
  const [abierto, setAbierto] = useState(false)
  const [descripcion, setDescripcion] = useState('')
  const [photoIds, setPhotoIds] = useState<string[]>([])
  const [guardando, setGuardando] = useState(false)
  const [recienGuardada, setRecienGuardada] = useState(false)

  const abrir = useCallback(() => {
    setDescripcion('')
    setPhotoIds([])
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
        photoIds
      })
      setAbierto(false)
      setDescripcion('')
      setPhotoIds([])
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
        className={cn(
          'flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors',
          recienGuardada
            ? 'border-green-200 bg-green-50 text-green-800'
            : 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'
        )}
      >
        {recienGuardada ? (
          <Check className="h-5 w-5 shrink-0 text-green-600" />
        ) : (
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
        )}
        <span className="min-w-0 flex-1 truncate text-left">
          {recienGuardada ? 'Incidencia guardada' : 'Reportar incidencia'}
        </span>
        {incidentesPendientes > 0 ? (
          <span
            className="shrink-0 rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-black text-white"
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
