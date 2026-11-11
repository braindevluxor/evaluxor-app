import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Check } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useModulosActivos } from '../../context/CatalogContext'
import { getDraft, instanciasPlanasDe, type DraftEval } from '../../lib/offline/db'
import { encolarRespuestas } from '../../lib/offline/sync'
import { pasosDeModulo } from '../../lib/pasos'
import { calcularPuntaje, pesoItem, tieneRespuesta, promedioPuntajesModulos } from '../../lib/scoring'
import { Button, Puntaje, cn } from '../../components/ui'
import { MobileLayout } from '../../components/layouts/MobileLayout'

export function EvaluarResumen() {
  // Dos rutas posibles: /evaluar/:sucursalId/resumen y
  // /evaluar/departamento/:departamentoId/resumen.
  const { sucursalId = '', departamentoId = '' } = useParams()
  /** Unidad evaluada: sucursal o departamento (la clave del borrador). */
  const unidadId = sucursalId || departamentoId
  const rutaBase = departamentoId ? `/evaluar/departamento/${departamentoId}` : `/evaluar/${sucursalId}`
  const { profile } = useAuth()
  const { modulosActivos, itemsDe } = useModulosActivos(sucursalId, departamentoId)
  const navigate = useNavigate()

  const [draft, setDraft] = useState<DraftEval | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  /** La entrega ya se disparó: evita que un render posterior la dispare otra vez. */
  const entregadoRef = useRef(false)

  useEffect(() => {
    void getDraft(unidadId).then((d) => {
      if (d) setDraft(d)
      else navigate(rutaBase, { replace: true })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unidadId])

  const modulos = useMemo(
    () => modulosActivos.filter((m) => itemsDe(m).some((i) => i.tipo !== 'CONTENEDOR')),
    [modulosActivos, itemsDe]
  )

  const detalles = useMemo(() => {
    if (!draft) return { puntaje: null as number | null, incompletos: 0, total: 0 }
    const pasos = modulos.flatMap((m) => pasosDeModulo(itemsDe(m), instanciasPlanasDe(draft)))
    const incompletos = pasos.filter((p) => p.item.requerido && !tieneRespuesta(p.item, draft.respuestas[p.key]?.valor)).length
    const puntaje = promedioPuntajesModulos(modulos.map((modulo) => {
      const pasosModulo = pasosDeModulo(itemsDe(modulo), instanciasPlanasDe(draft))
      return calcularPuntaje(
        pasosModulo.flatMap((p) => [
          { item: p.item, valor: draft.respuestas[p.key]?.valor },
          // La sección ponderada participa como grupo: su peso es el puntaje de la
          // sección y agrupa el de sus hijos (PasoEval.seccion ya trae la dueña).
          ...(p.seccion && pesoItem(p.seccion) > 0 ? [{ item: p.seccion, valor: undefined }] : [])
        ])
      )
    }))
    return { puntaje, incompletos, total: pasos.length }
  }, [draft, modulos, itemsDe])

  async function enviar() {
    if (!draft || !profile) return
    setEnviando(true)
    setError('')
    try {
      // El cierre es LOCAL: se deja el trabajo en la cola del teléfono (que
      // sube respuestas, fotos y registra las evidencias, con reintentos si se
      // corta la señal) y se borra el borrador, que es lo que saca la
      // evaluación de la lista «en curso».
      await encolarRespuestas(draft)
      sessionStorage.removeItem(`evx:${unidadId}:mod`)
      sessionStorage.setItem('evx:ok', '1')
      navigate('/evaluar', { replace: true })
    } catch {
      // Si la base local no pudo guardar la cola, no se cierra nada: se avisa y
      // se deja reintentar. Borrar el borrador sin encolar sería perder el turno.
      entregadoRef.current = false
      setEnviando(false)
      setError('No se pudo registrar la entrega en este dispositivo. Pulsa Reintentar.')
    }
  }

  /**
   * La entrega es AUTOMÁTICA: no hay botón que pulsar.
   *
   * Mientras se responde, el autoguardado ya va subiendo respuestas y fotos;
   * acá sólo se cierra el turno. Cuando el resumen confirma que no falta nada
   * obligatorio, se encola el trabajo y se borra el borrador. La pausa es para
   * que alcance a verse el resumen antes de volver al inicio. Si falta algo
   * obligatorio no se entrega nada: se vuelve a editar.
   */
  useEffect(() => {
    if (!draft || !profile || entregadoRef.current) return
    if (detalles.incompletos > 0) return
    const t = window.setTimeout(() => {
      entregadoRef.current = true
      void enviar()
    }, 1200)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, profile, detalles.incompletos])

  if (!draft) {
    return <MobileLayout titulo="Resumen"><div className="py-20 text-center text-slate-400">Cargando…</div></MobileLayout>
  }

  return (
    <MobileLayout titulo="Resumen de evaluación" subtitulo={`Total de ${countItems()} ítems`}>
      <div className="space-y-4">
        <div className="rounded-2xl bg-gradient-to-br from-primary to-primary-800 p-5 text-center text-white shadow-md">
          <p className="text-[10px] font-bold uppercase tracking-wider text-primary-100/90">Cumplimiento en tus módulos</p>
          <Puntaje value={detalles.puntaje} className="text-5xl text-white" />
          <p className="mt-1 text-xs text-primary-100/90">
            {detalles.incompletos > 0
              ? `${detalles.incompletos} ítems obligatorios pendientes`
              : enviando
                ? 'Entregando la evaluación…'
                : 'Todo respondido: se entrega automáticamente'}
          </p>
        </div>

        <div className="space-y-3">
          {modulos.map((m) => {
            const pasos = pasosDeModulo(itemsDe(m), instanciasPlanasDe(draft))
            const respondidos = pasos.filter((p) => tieneRespuesta(p.item, draft.respuestas[p.key]?.valor)).length
            const completo = pasos.length > 0 && respondidos === pasos.length
            return (
              <div key={m.id} className="sup p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-bold text-primary-900">{m.nombre}</p>
                    <p className="text-xs text-slate-500">{respondidos}/{pasos.length} ítems respondidos</p>
                  </div>
                  <span className={cn('grid h-8 w-8 place-items-center rounded-full text-sm font-bold', completo ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700')}>
                    {completo ? <Check className="h-4 w-4" /> : respondidos ? '…' : '—'}
                  </span>
                </div>
              </div>
            )
          })}
        </div>

        <p className="text-center text-xs text-slate-400">
          {departamentoId
            ? 'Tus respuestas y fotos se suben solas mientras respondes, y el Líder las ve en vivo en la evaluación abierta de este departamento. Al terminar, la evaluación se entrega sola: no hay que pulsar nada.'
            : 'Tus respuestas y fotos se suben solas mientras respondes, y el Líder las ve en vivo en la evaluación abierta para esta sucursal. Al terminar, la evaluación se entrega sola: no hay que pulsar nada.'}
        </p>

        {error ? <div className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-600">{error}</div> : null}

        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={() => navigate(rutaBase)} disabled={enviando}>
            <ArrowLeft className="h-4 w-4" /> {detalles.incompletos > 0 ? 'Volver a editar' : 'Editar'}
          </Button>
          {/* Sólo aparece si el cierre local falló: la entrega es automática,
              pero nadie debe perder un turno por una base local caída. */}
          {error ? (
            <Button variant="success" className="flex-1" disabled={enviando} onClick={() => void enviar()}>
              Reintentar
            </Button>
          ) : null}
        </div>
      </div>
    </MobileLayout>
  )

  function countItems(): number {
    return modulos.reduce((a, m) => a + pasosDeModulo(itemsDe(m), instanciasPlanasDe(draft)).length, 0)
  }
}