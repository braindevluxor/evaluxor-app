import { useEffect, useState } from 'react'
import { Minus, Plus, Trash2 } from 'lucide-react'
import {
  columnasDeTabla,
  conCelda,
  conColumnas,
  conFilas,
  MAX_COLUMNAS_TABLA,
  MAX_FILAS_TABLA,
  type ModeloTabla
} from '../lib/markdown'
import { cn } from './ui'

/**
 * Grilla para editar una tabla de la descripción sin tocar un solo pipe:
 * cada celda es un input y los botones agregan o sacan filas y columnas.
 * Los cambios vuelven al texto como líneas markdown (`reemplazarTabla`), así
 * que la vista previa y la evaluación siempre ven lo mismo que esta grilla.
 */
export function EditorTabla({
  numero,
  modelo,
  onChange,
  onQuitar,
  autoFocus = false
}: {
  /** Nº de tabla en el texto, para los rótulos accesibles. */
  numero: number
  modelo: ModeloTabla
  onChange: (modelo: ModeloTabla) => void
  onQuitar: () => void
  /** Enfoca la primera celda al montar (la tabla recién insertada). */
  autoFocus?: boolean
}) {
  const columnas = columnasDeTabla(modelo)
  // Fila 0 = encabezado; de ahí en más las filas de datos.
  const renglones = [modelo.cabecera, ...modelo.filas]

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Tabla {numero}</p>
        <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-slate-600">
          <Contador
            etiqueta="Columnas"
            palabra="columna"
            valor={columnas}
            min={1}
            max={MAX_COLUMNAS_TABLA}
            onCambio={(n) => onChange(conColumnas(modelo, n))}
          />
          <Contador
            etiqueta="Filas"
            palabra="fila"
            valor={modelo.filas.length}
            min={1}
            max={MAX_FILAS_TABLA}
            onCambio={(n) => onChange(conFilas(modelo, n))}
          />
          <button
            type="button"
            onClick={onQuitar}
            title="Quitar esta tabla"
            aria-label={`Quitar la tabla ${numero}`}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full border-collapse text-xs">
          <tbody>
            {renglones.map((celdas, f) => (
              <tr key={f} className={f === 0 ? 'bg-slate-100' : ''}>
                {Array.from({ length: columnas }, (_, c) => (
                  <td key={c} className="border border-slate-200 p-0">
                    <input
                      type="text"
                      autoFocus={autoFocus && f === 0 && c === 0}
                      value={celdas[c] ?? ''}
                      placeholder={f === 0 ? `Columna ${c + 1}` : ''}
                      aria-label={`Tabla ${numero}, ${f === 0 ? 'encabezado' : `fila ${f}`}, columna ${c + 1}`}
                      onChange={(e) =>
                        onChange(conCelda(modelo, f, c, e.target.value.replace(/\|/g, '')))
                      }
                      className={cn(
                        'w-full min-w-28 border-0 bg-transparent px-2 py-1.5 text-xs text-slate-700 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-inset focus:ring-primary',
                        f === 0 && 'font-semibold text-slate-800'
                      )}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Contador({
  etiqueta,
  palabra,
  valor,
  min,
  max,
  onCambio
}: {
  etiqueta: string
  /** Singular, para los rótulos accesibles («Quitar una columna»). */
  palabra: string
  valor: number
  min: number
  max: number
  onCambio: (n: number) => void
}) {
  // Borrador propio para poder tipear el número de una (p. ej. 40 filas)
  // sin que cada dígito se dispare como cambio: se confirma al salir o con
  // Enter, y se recorta al rango permitido.
  const [borrador, setBorrador] = useState(String(valor))
  useEffect(() => {
    setBorrador(String(valor))
  }, [valor])

  const confirmar = () => {
    const crudo = borrador.trim()
    const n = Math.round(Number(crudo))
    const limpio = crudo && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : valor
    setBorrador(String(limpio))
    if (limpio !== valor) onCambio(limpio)
  }

  const clase = (deshabilitado: boolean) =>
    cn(
      'grid h-6 w-6 place-items-center rounded-full border border-slate-300 bg-white text-slate-500 transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-slate-300 disabled:hover:text-slate-500',
      deshabilitado && 'cursor-not-allowed opacity-40'
    )
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-slate-500">{etiqueta}</span>
      <button
        type="button"
        onClick={() => onCambio(valor - 1)}
        disabled={valor <= min}
        aria-label={`Quitar una ${palabra} de la tabla`}
        className={clase(valor <= min)}
      >
        <Minus className="h-3 w-3" aria-hidden="true" />
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={borrador}
        aria-label={`Cantidad de ${palabra}s de la tabla`}
        title={`Entre ${min} y ${max}`}
        onChange={(e) => setBorrador(e.target.value)}
        onBlur={confirmar}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            confirmar()
          }
        }}
        className="w-12 rounded-lg border border-slate-300 bg-white px-1 py-1 text-center text-xs tabular-nums text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
      />
      <button
        type="button"
        onClick={() => onCambio(valor + 1)}
        disabled={valor >= max}
        aria-label={`Agregar una ${palabra} a la tabla`}
        className={clase(valor >= max)}
      >
        <Plus className="h-3 w-3" aria-hidden="true" />
      </button>
    </span>
  )
}
