import { useState } from 'react'
import { FileDown } from 'lucide-react'
import { Button, Modal, Spinner } from './ui'
import { BLOQUES_PDF, TODOS_LOS_BLOQUES, resumenDeOpciones, type BloquePdf, type OpcionesPdf } from '../lib/pdf/opciones'

/**
 * Qué se va a imprimir en el PDF.
 *
 * Vive en un modal y no en una preferencia guardada porque la elección depende de
 * a quién se le manda el informe: la misma evaluación va entera para el archivo
 * y a medias para el que solo quiere la hoja de compromiso. Guardarla sería
 * adivinar.
 *
 * La lista de módulos la pasa cada pantalla porque cada una la tiene en un
 * lugar distinto: el detalle ya la tiene en memoria, y los listados la piden al
 * abrir. Acá solo se decide qué queda marcado.
 */
export function SelectorPdf({
  abierto,
  onClose,
  modulos,
  cargandoModulos,
  onConfirmar,
  descargando
}: {
  abierto: boolean
  onClose: () => void
  /** Módulos con algo respondido en esta evaluación, en el orden del PDF. */
  modulos: { id: string; nombre: string }[]
  cargandoModulos?: boolean
  onConfirmar: (opciones: OpcionesPdf) => void
  descargando?: boolean
}) {
  const idsModulos = modulos.map((modulo) => modulo.id)
  const firma = idsModulos.join('|')

  const [eleccion, setEleccion] = useState(() => ({
    abierta: abierto,
    firma,
    modulos: idsModulos,
    bloques: { ...TODOS_LOS_BLOQUES } as Record<BloquePdf, boolean>
  }))

  // El ajuste va en el render y no en un `useEffect` a propósito. Con el efecto,
  // la primera pantalla sale con todos los módulos desmarcados y recién al
  // siguiente toque se marcan; en el detalle se nota, y en un PDF mal elegido no
  // se nota nada. Además el render del servidor no pasa por efectos, así que con
  // ellos el marcado inicial nunca se vería al imprimir.
  const cambiaLista = eleccion.abierta !== abierto || eleccion.firma !== firma
  if (cambiaLista) {
    setEleccion({ abierta: abierto, firma, modulos: idsModulos, bloques: { ...TODOS_LOS_BLOQUES } })
  }
  // Lo que se dibuja sale de la lista que hay ahora, no del estado viejo.
  const elegidos = cambiaLista ? idsModulos : eleccion.modulos
  const bloques = cambiaLista ? TODOS_LOS_BLOQUES : eleccion.bloques

  const marcarModulo = (id: string) =>
    setEleccion((prev) => ({
      ...prev,
      modulos: prev.modulos.includes(id) ? prev.modulos.filter((otro) => otro !== id) : [...prev.modulos, id]
    }))
  const marcarBloque = (bloque: BloquePdf) =>
    setEleccion((prev) => ({ ...prev, bloques: { ...prev.bloques, [bloque]: !prev.bloques[bloque] } }))

  const todos = modulos.length > 0 && elegidos.length === modulos.length
  const opciones: OpcionesPdf = { modulos: elegidos, bloques }

  return (
    <Modal
      open={abierto}
      onClose={onClose}
      title="Qué incluir en el PDF"
      wide
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-slate-500">{resumenDeOpciones(opciones, modulos.length)}</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              onClick={() => onConfirmar(opciones)}
              disabled={descargando}
              aria-busy={descargando}
            >
              {descargando ? <Spinner size={16} light /> : <FileDown className="h-4 w-4" />}
              {descargando ? 'Generando…' : 'Descargar'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Los puntajes no cambian: el informe sigue diciendo el resultado de la evaluación completa. Lo que
          desmarques acá solamente deja de imprimirse.
        </p>

        {/* Aviso y no otra opción para marcarlo: la portada depende de la lista, no
            al revés. Si alguien quiere el total y el gráfico, tiene que llevarlos
            todos; y no es un detalle que se entere al final, cuando el documento ya
            está impreso y firmado. */}
        {modulos.length > 0 && !todos ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <strong>Sin portada.</strong> Al no ir todos los módulos, el informe no lleva la primera hoja: se van
            los datos de la tienda, la puntuación general, el gráfico por módulo y las firmas de gerencia.
          </p>
        ) : null}

        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-primary-900">Módulos</h4>
            {modulos.length ? (
              <button
                type="button"
                onClick={() => setEleccion((prev) => ({ ...prev, modulos: todos ? [] : idsModulos }))}
                className="text-xs font-medium text-primary-600 hover:underline"
              >
                {todos ? 'Desmarcar todos' : 'Marcar todos'}
              </button>
            ) : null}
          </div>

          {cargandoModulos ? (
            <div className="flex items-center gap-2 py-3 text-sm text-slate-500">
              <Spinner size={16} />
              Buscando los módulos…
            </div>
          ) : modulos.length ? (
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
              {modulos.map((modulo) => (
                <li key={modulo.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-slate-50">
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0 accent-primary"
                      checked={elegidos.includes(modulo.id)}
                      onChange={() => marcarModulo(modulo.id)}
                    />
                    <span className="min-w-0 flex-1 text-sm text-slate-700">{modulo.nombre}</span>
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-lg border border-dashed border-slate-200 px-3 py-3 text-sm text-slate-500">
              Esta evaluación no tiene módulos con respuestas.
            </p>
          )}
        </section>

        <section>
          <h4 className="mb-2 text-sm font-semibold text-primary-900">Bloques del final</h4>
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
            {BLOQUES_PDF.map(({ id, etiqueta, ayuda }) => (
              <li key={id}>
                <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                    checked={bloques[id]}
                    onChange={() => marcarBloque(id)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-slate-700">{etiqueta}</span>
                    <span className="block text-xs text-slate-500">{ayuda}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Modal>
  )
}