import { useEffect, useMemo, useRef, useState } from 'react'
import { Bold, List, Table } from 'lucide-react'
import {
  conMarcadoresDeTabla,
  envolverNegrita,
  finDeLinea,
  inicioDeLinea,
  lineaEnValor,
  numeroDeTabla,
  plantillaTabla,
  prefijarViñetas,
  quitarTabla,
  reemplazarTabla,
  sinMarcadoresDeTabla,
  tablasDe,
  type Edicion
} from '../lib/markdown'
import { Textarea } from './ui'
import { EditorTabla } from './EditorTabla'

type Accion = (texto: string, inicio: number, fin: number) => Edicion & { linea?: number }

const BOTONES: { etiqueta: string; ayuda: string; accion: Accion; Icono: typeof Bold; grilla?: boolean }[] = [
  { etiqueta: 'Negrita', ayuda: 'Poner en negrita lo seleccionado', accion: envolverNegrita, Icono: Bold },
  { etiqueta: 'Viñeta', ayuda: 'Convertir lo seleccionado en lista con viñetas', accion: prefijarViñetas, Icono: List },
  {
    etiqueta: 'Tabla',
    ayuda: 'Insertar una tabla: se completa en la grilla de abajo, sin escribir caracteres',
    accion: plantillaTabla,
    Icono: Table,
    grilla: true
  }
]

/**
 * Editor de la descripción de un ítem: caja de texto con botones de negrita y
 * viñeta, y grilla para armar las tablas.
 *
 * La tabla **no se pinta en la caja**: ahí ocupa una línea `[[Tabla N]]` y se
 * edita sólo en la grilla, para no tener la misma tabla tres veces en pantalla
 * ni tipear pipes. El texto real (con las tablas escritas) es el que viaja en
 * `items.descripcion` y el que leen la evaluación y el detalle; la caja sólo
 * lo muestra y lo devuelve con `sinMarcadoresDeTabla`.
 *
 * Se guarda texto plano, no HTML: los botones sólo envuelven o prefijan lo
 * seleccionado y la grilla reescribe su propio bloque de líneas, así que no
 * hay nada que sanitizar.
 */
export function EditorDescripcion({
  value,
  onChange,
  rows = 3,
  placeholder
}: {
  value: string
  onChange: (texto: string) => void
  rows?: number
  placeholder?: string
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  /** Si la caja nunca se enfocó, los botones trabajan al final del texto. */
  const tocada = useRef(false)
  const tablas = useMemo(() => tablasDe(value), [value])
  /** Lo que se muestra en la caja: tablas convertidas en marcadores. */
  const textoCaja = useMemo(() => conMarcadoresDeTabla(value), [value])
  /** Línea donde quedó insertada la tabla nueva, para pasarle el foco a su grilla. */
  const [tablaNueva, setTablaNueva] = useState<number | null>(null)

  // El foco se da en el mismo render en que la grilla aparece (`autoFocus`);
  // después se limpia el marcador para no robarle el foco a nada más.
  useEffect(() => {
    if (tablaNueva != null) setTablaNueva(null)
  }, [tablaNueva])

  const aplicar = (boton: (typeof BOTONES)[number]) => {
    const caja = ref.current
    if (!caja) return
    // Nunca enfocada = sin cursor conocido: se trabaja al final del texto,
    // que es donde casi siempre se inserta algo nuevo.
    const pos = tocada.current ? caja.selectionStart : textoCaja.length
    const hasta = tocada.current ? caja.selectionEnd : textoCaja.length
    const modelos = tablas.map((t) => t.modelo)

    if (boton.grilla) {
      // La caja muestra marcadores y el texto real tiene las tablas escritas:
      // la línea del cursor hay que traducirla antes de insertar. Sobre un
      // marcador la nueva tabla entra al lado de la que ya está (metida en el
      // medio quedarían pegadas y se leerían como una sola); en el resto, al
      // inicio o al final de la línea según dónde esté el cursor.
      const lineasCaja = textoCaja.split('\n')
      const lineaCaja = textoCaja.slice(0, pos).split('\n').length - 1
      const columna = pos - inicioDeLinea(textoCaja, lineaCaja)
      const tabla = tablas[(numeroDeTabla(lineasCaja[lineaCaja] ?? '') ?? 0) - 1]
      const lineaValor = tabla ? tabla.desde : lineaEnValor(value, lineaCaja)
      const destino = Math.min(
        columna === 0
          ? inicioDeLinea(value, lineaValor)
          : tabla
            ? finDeLinea(value, tabla.hasta)
            : finDeLinea(value, lineaValor),
        value.length
      )
      const r = boton.accion(value, destino, destino)
      onChange(r.texto)
      setTablaNueva(r.linea ?? null)
      return
    }

    // Negrita y viñeta se aplican sobre lo que se ve en la caja (con sus
    // marcadores) y el resultado vuelve con las tablas de vuelta adentro.
    const r = boton.accion(textoCaja, pos, hasta)
    onChange(sinMarcadoresDeTabla(r.texto, modelos))
    // El textarea todavía no repintó con el texto nuevo: recién en el cuadro
    // siguiente su valor coincide y se puede volver a ubicar el cursor.
    requestAnimationFrame(() => {
      const actual = ref.current
      if (!actual) return
      actual.focus()
      actual.setSelectionRange(r.inicio, r.fin)
    })
  }

  return (
    <div className="space-y-2">
      {/* El textarea va primero en el DOM: `Field` envuelve todo en un
          <label> y el primer elemento labelable es el que recibe el clic del
          título. Si los botones vinieran antes, apretar «Descripción»
          dispararía «Negrita». */}
      <Textarea
        ref={ref}
        rows={rows}
        value={textoCaja}
        onFocus={() => {
          tocada.current = true
        }}
        onChange={(e) => onChange(sinMarcadoresDeTabla(e.target.value, tablas.map((t) => t.modelo)))}
        placeholder={placeholder}
      />
      <div className="flex flex-wrap items-center gap-1.5">
        {BOTONES.map((b) => (
          <button
            key={b.etiqueta}
            type="button"
            onClick={() => aplicar(b)}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-600 transition-colors hover:border-primary-300 hover:text-primary"
            title={b.ayuda}
          >
            <b.Icono className="h-3.5 w-3.5" aria-hidden="true" />
            {b.etiqueta}
          </button>
        ))}
      </div>
      {tablas.length ? (
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
            {tablas.length === 1 ? 'Tabla de la descripción' : `${tablas.length} tablas de la descripción`}
          </p>
          {tablas.map((t, i) => (
            <EditorTabla
              key={`${t.desde}-${i}`}
              numero={i + 1}
              modelo={t.modelo}
              autoFocus={t.desde === tablaNueva}
              onChange={(m) => onChange(reemplazarTabla(value, t.desde, t.hasta, m))}
              onQuitar={() => onChange(quitarTabla(value, t.desde, t.hasta))}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
