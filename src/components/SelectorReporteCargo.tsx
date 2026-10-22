import { useState } from 'react'
import { FileDown, FileSpreadsheet } from 'lucide-react'
import { Button, Input, Modal, Spinner } from './ui'

/**
 * Qué cargos entran en el reporte por cargos, y en qué formato.
 *
 * Mismo patrón que `SelectorPdf`: la elección vive en un modal y no en una
 * preferencia guardada, porque depende de a quién se le manda el reporte —el
 * jefe de una sucursal quiere sus cargos, no los 40 de la empresa—. Acá no se
 * eligen bloques ni módulos: el único eje es la lista de cargos, así que el
 * modal es una lista con checkboxes, un buscador y dos botones de descarga.
 *
 * La lista llega desde el detalle, que ya tiene los cargos evaluados en memoria
 * (`valorPorResponsable`): sólo se ofrecen los que tienen datos, que son los
 * mismos que muestran las tarjetas de la pantalla.
 */
export interface CargoSeleccionable {
  /** Nombre del cargo tal como aparece en la evaluación. */
  cargo: string
  /** Porcentaje logrado, para mostrarlo al lado del nombre; null si no tiene. */
  porciento: number | null
}

export function SelectorReporteCargo({
  abierto,
  onClose,
  cargos,
  onDescargar,
  generando
}: {
  abierto: boolean
  onClose: () => void
  /** Cargos evaluados, en el orden en que se quieren ofrecer. */
  cargos: CargoSeleccionable[]
  onDescargar: (cargosElegidos: string[], formato: 'pdf' | 'excel') => void
  /** Formato que se está generando ahora, para el spinner del botón. */
  generando: 'pdf' | 'excel' | null
}) {
  const [elegidos, setElegidos] = useState<string[]>([])
  const [busqueda, setBusqueda] = useState('')
  /**
   * El ajuste de la selección inicial va en el render y no en un `useEffect`,
   * por el mismo motivo que en `SelectorPdf`: con el efecto, la primera apertura
   * sale con todo desmarcado y recién al segundo toque se marca. La firma
   * combina la apertura con la lista de cargos, así cada vez que se abre el
   * modal —o cambian los cargos— se vuelve a marcar todo, que es lo más común:
   * se quiere el reporte completo y se desmarcan los que no interesan.
   */
  const firma = `${abierto ? 'abierto' : 'cerrado'}\u0000${cargos.map((c) => c.cargo).join('\u0000')}`
  const [ultimaFirma, setUltimaFirma] = useState<string | null>(null)

  const cambiaLista = ultimaFirma !== firma
  if (cambiaLista) {
    setUltimaFirma(firma)
    if (abierto) setElegidos(cargos.map((c) => c.cargo))
    setBusqueda('')
  }

  const visibles = busqueda.trim()
    ? cargos.filter((c) => c.cargo.toLowerCase().includes(busqueda.trim().toLowerCase()))
    : cargos

  const todosVisiblesMarcados = visibles.length > 0 && visibles.every((c) => elegidos.includes(c.cargo))

  const alternar = (cargo: string) =>
    setElegidos((prev) => (prev.includes(cargo) ? prev.filter((otro) => otro !== cargo) : [...prev, cargo]))

  const alternarVisibles = () => {
    if (todosVisiblesMarcados) {
      const quitar = new Set(visibles.map((c) => c.cargo))
      setElegidos((prev) => prev.filter((c) => !quitar.has(c)))
    } else {
      setElegidos((prev) => Array.from(new Set([...prev, ...visibles.map((c) => c.cargo)])))
    }
  }

  const cantidad = elegidos.length

  return (
    <Modal
      open={abierto}
      onClose={onClose}
      title="Reporte de pendientes por cargo"
      wide
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-slate-500">
            {cantidad === 0
              ? 'Elegí al menos un cargo para descargar.'
              : `${cantidad} ${cantidad === 1 ? 'cargo seleccionado' : 'cargos seleccionados'}.`}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              variant="secondary"
              onClick={() => onDescargar(elegidos, 'excel')}
              disabled={cantidad === 0 || generando != null}
              aria-busy={generando === 'excel'}
            >
              {generando === 'excel' ? <Spinner size={16} /> : <FileSpreadsheet className="h-4 w-4" />}
              {generando === 'excel' ? 'Generando…' : 'Excel'}
            </Button>
            <Button
              onClick={() => onDescargar(elegidos, 'pdf')}
              disabled={cantidad === 0 || generando != null}
              aria-busy={generando === 'pdf'}
            >
              {generando === 'pdf' ? <Spinner size={16} light /> : <FileDown className="h-4 w-4" />}
              {generando === 'pdf' ? 'Generando…' : 'PDF'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Sale un bloque por cargo con los ítems en los que quedó mal, los checks concretos que fallaron y
          los puntos que le costaron. Es el mismo detalle del modal «Fallas de…», para los cargos que elijas.
        </p>

        {cargos.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 px-3 py-3 text-sm text-slate-500">
            Esta evaluación no tiene cargos con puntaje. No hay pendientes que reportar por cargo.
          </p>
        ) : (
          <section>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-primary-900">
                Cargos ({visibles.length}
                {busqueda.trim() ? ` de ${cargos.length}` : ''})
              </h4>
              <button
                type="button"
                onClick={alternarVisibles}
                className="text-xs font-medium text-primary-600 hover:underline"
              >
                {todosVisiblesMarcados ? 'Desmarcar' : 'Marcar'} {busqueda.trim() ? 'los filtrados' : 'todos'}
              </button>
            </div>

            <Input
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar cargo…"
              className="mb-2"
            />

            {visibles.length ? (
              <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                {visibles.map((c) => (
                  <li key={c.cargo}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-slate-50">
                      <input
                        type="checkbox"
                        className="h-4 w-4 shrink-0 accent-primary"
                        checked={elegidos.includes(c.cargo)}
                        onChange={() => alternar(c.cargo)}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm text-slate-700" title={c.cargo}>
                        {c.cargo}
                      </span>
                      <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-500">
                        {c.porciento == null ? '—' : `${c.porciento}%`}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-lg border border-dashed border-slate-200 px-3 py-3 text-sm text-slate-500">
                Ningún cargo coincide con «{busqueda.trim()}».
              </p>
            )}
          </section>
        )}
      </div>
    </Modal>
  )
}
