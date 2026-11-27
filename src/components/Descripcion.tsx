import { Fragment, type ReactNode } from 'react'
import { parsearMarkdown, type BloqueMD, type InlineMD } from '../lib/markdown'
import { cn } from './ui'

/**
 * Pinta la descripción de un ítem (`items.descripcion`) con su formato:
 * negrita, cursiva, viñetas y tablas.
 *
 * Sale del parser como nodos de React, nunca como HTML armado a mano, así que
 * cualquier texto pegado ahí se pinta literal (sin riesgo de inyección). Sin
 * descripción no devuelve nada: ni un elemento ni un espacio de más.
 */
export function Descripcion({ texto, className }: { texto?: string | null; className?: string }) {
  if (!texto?.trim()) return null
  const bloques = parsearMarkdown(texto)
  if (!bloques.length) return null
  return (
    <div className={cn('space-y-1.5 text-[13px] leading-relaxed text-slate-500', className)}>
      {bloques.map((b, i) => (
        <Fragment key={i}>{pintarBloque(b)}</Fragment>
      ))}
    </div>
  )
}

function pintarBloque(b: BloqueMD): ReactNode {
  if (b.t === 'parrafo') {
    // Los saltos de línea escritos a mano se conservan (el campo es multilinea).
    return <p className="whitespace-pre-wrap">{b.hijos.map((h, j) => pintarInline(h, String(j)))}</p>
  }
  if (b.t === 'lista') {
    const Lista = b.ordenada ? 'ol' : 'ul'
    return (
      <Lista className={cn('space-y-0.5 pl-5 marker:text-slate-400', b.ordenada ? 'list-decimal' : 'list-disc')}>
        {b.items.map((item, j) => (
          <li key={j} className="pl-0.5">{item.map((h, k) => pintarInline(h, String(k)))}</li>
        ))}
      </Lista>
    )
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse text-xs">
        <thead>
          <tr>
            {b.cabecera.map((celda, j) => (
              <th key={j} className="border border-slate-200 bg-slate-50 px-2 py-1 text-left font-semibold text-slate-600">
                {celda.map((h, k) => pintarInline(h, String(k)))}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {b.filas.map((fila, j) => (
            <tr key={j}>
              {fila.map((celda, k) => (
                <td key={k} className="border border-slate-200 px-2 py-1 align-top text-slate-600">
                  {celda.map((h, l) => pintarInline(h, String(l)))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function pintarInline(n: InlineMD, k: string): ReactNode {
  if (n.t === 'texto') return <Fragment key={k}>{n.v}</Fragment>
  const hijos = n.hijos.map((h, i) => pintarInline(h, `${k}-${i}`))
  // La descripción va en gris apagado: la negrita se aclara un punto para que
  // se lea como énfasis y no como otro texto.
  if (n.t === 'negrita') return <strong key={k} className="font-semibold text-slate-700">{hijos}</strong>
  return <em key={k}>{hijos}</em>
}
