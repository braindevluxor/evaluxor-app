import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Check, Send } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useModulosActivos } from '../../context/CatalogContext'
import { getDraft, type DraftEval } from '../../lib/offline/db'
import { encolarRespuestas } from '../../lib/offline/sync'
import { calcularPuntaje } from '../../lib/scoring'
import { Button, Puntaje } from '../../components/ui'
import { MobileLayout } from '../../components/layouts/MobileLayout'
import { cn } from '../../components/ui'

export function EvaluarResumen() {
  const { sucursalId = '' } = useParams()
  const { profile } = useAuth()
  const { modulosActivos, itemsDe } = useModulosActivos(sucursalId)
  const navigate = useNavigate()

  const [draft, setDraft] = useState<DraftEval | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void getDraft(sucursalId).then((d) => {
      if (d) setDraft(d)
      else navigate(`/evaluar/${sucursalId}`, { replace: true })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sucursalId])

  const modulos = useMemo(() => modulosActivos.filter((m) => itemsDe(m).length > 0), [modulosActivos, itemsDe])

  const detalles = useMemo(() => {
    if (!draft) return { puntaje: null as number | null, incompletos: 0, total: 0 }
    const todas = modulos.flatMap((m) => itemsDe(m).map((i) => ({ m, i })))
    const incompletos = todas.filter(({ i }) => i.requerido && !draft.respuestas[i.id]).length
    const binarios = todas.map(({ i }) => i)
    const puntaje = calcularPuntaje(
      binarios.map((i) => ({ item: i, valor: draft.respuestas[i.id]?.valor }))
    )
    return { puntaje, incompletos, total: todas.length }
  }, [draft, modulos, itemsDe])

  async function enviar() {
    if (!draft || !profile) return
    if (detalles.incompletos > 0) {
      setError(`Hay ${detalles.incompletos} ítems obligatorios sin responder. Completa la evaluación antes de enviar.`)
      return
    }
    setEnviando(true)
    await encolarRespuestas(draft)
    sessionStorage.removeItem(`evx:${sucursalId}:mod`)
    sessionStorage.setItem('evx:ok', '1')
    navigate('/evaluar', { replace: true })
  }

  if (!draft) {
    return <MobileLayout titulo="Resumen"><div className="py-20 text-center text-slate-400">Cargando…</div></MobileLayout>
  }

  return (
    <MobileLayout titulo="Resumen de evaluación" subtitulo={`Total de ${countItems()} ítems`}>
      <div className="space-y-4">
        <div className="rounded-2xl bg-primary text-white p-5 text-center shadow-md">
          <p className="text-sm opacity-80">Cumplimiento en tus módulos</p>
          <Puntaje value={detalles.puntaje} className="text-5xl text-white" />
          <p className="mt-1 text-xs opacity-80">
            {detalles.incompletos > 0 ? `${detalles.incompletos} ítems obligatorios pendientes` : 'Listo para enviar'}
          </p>
        </div>

        <div className="space-y-3">
          {modulos.map((m) => {
            const items = itemsDe(m)
            const respondidos = items.filter((i) => draft.respuestas[i.id]).length
            const completo = respondidos === items.length
            return (
              <div key={m.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-bold text-primary-900">{m.nombre}</p>
                    <p className="text-xs text-slate-500">{respondidos}/{items.length} ítems respondidos</p>
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
          Mientras respondes, tus avances se suben automáticamente y el Líder los ve en vivo dentro de la evaluación abierta para esta sucursal. Las fotos de evidencia se sincronizan al enviar.
        </p>

        {error ? <div className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-600">{error}</div> : null}

        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={() => navigate(`/evaluar/${sucursalId}`)}>
            <ArrowLeft className="h-4 w-4" /> Editar
          </Button>
          <Button variant="success" className="flex-1" disabled={enviando} onClick={() => void enviar()}>
            {enviando ? 'Enviando…' : <>Enviar evaluación <Send className="h-4 w-4" /></>}
          </Button>
        </div>
      </div>
    </MobileLayout>
  )

  function countItems(): number {
    return modulos.reduce((a, m) => a + itemsDe(m).length, 0)
  }
}