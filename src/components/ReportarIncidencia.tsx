import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Check, CloudOff, Send } from 'lucide-react'
import { useOffline } from '../context/OfflineContext'
import { addIncidente } from '../lib/offline/db'
import { Button, Modal, Spinner, Textarea } from './ui'
import { PhotoCapture } from './PhotoCapture'

interface Props {
  /** Sucursal y fecha de la evaluación en curso: needed para associar el reporte. */
  sucursalId: string
  fecha: string
  moduloId: string | null
  moduloNombre: string | null
  evaluadorId: string
}

/**
 * Botón flotante para reportar incidencias fuera de lo programado.
 *
 * Está en toda la evaluación (todos los módulos, ítems y secciones) porque lo
 * interesante aparece en cualquier momento de la visita: una bandeja de pechuga
 * en la heladera de helados, un FIGE vencido, una puerta sin rotular. El reporte
 * NO es un ítem del cuestionario, así que va aparte: se guarda en el teléfono y
 * sube con el resto del avance (ver supabase/incidencias.sql).
 */
export function ReportarIncidencia({ sucursalId, fecha, moduloId, moduloNombre, evaluadorId }: Props) {
  const { online, incidentesPendientes, sync } = useOffline()
  const [abierto, setAbierto] = useState(false)
  const [descripcion, setDescripcion] = useState('')
  const [photoIds, setPhotoIds] = useState<string[]>([])
  const [guardando, setGuardando] = useState(false)
  const [guardado, setGuardado] = useState(false)

  const cerrar = useCallback(() => {
    setAbierto(false)
    setDescripcion('')
    setPhotoIds([])
    setGuardado(false)
  }, [])

  // El aviso de guardado se va solo: no tiene que quedar un cartel flotando.
  useEffect(() => {
    if (!guardado) return
    const t = window.setTimeout(() => setGuardado(false), 3000)
    return () => window.clearTimeout(t)
  }, [guardado])

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
      setGuardado(true)
      cerrar()
      // Si hay señal, se sube ya; si no, queda encolado y sube con el próximo sync.
      if (online) void sync()
    } finally {
      setGuardando(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        aria-label="Reportar incidencia"
        title="Reportar algo fuera de lo programado (foto o comentario)"
        className="fixed bottom-5 right-5 z-30 grid h-14 w-14 place-items-center rounded-full bg-amber-500 text-white shadow-lg shadow-amber-500/30 transition-colors hover:bg-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-2"
      >
        <AlertTriangle className="h-6 w-6" />
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
