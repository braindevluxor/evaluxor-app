import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { Modal } from './ui'

const ZOOM_MAXIMO = 4

interface Posicion {
  x: number
  y: number
}

interface Arrastre {
  pointerId: number
  inicioX: number
  inicioY: number
  posicionInicial: Posicion
}

export function ModalImagen({
  src,
  alt,
  onClose,
  footer
}: {
  src: string | null
  alt: string
  onClose: () => void
  footer?: ReactNode
}) {
  const [zoom, setZoom] = useState(1)
  const [posicion, setPosicion] = useState<Posicion>({ x: 0, y: 0 })
  const [arrastrando, setArrastrando] = useState(false)
  const areaImagenRef = useRef<HTMLDivElement>(null)
  const arrastreRef = useRef<Arrastre | null>(null)

  useEffect(() => {
    setZoom(1)
    setPosicion({ x: 0, y: 0 })
  }, [src])

  function limitarPosicion(pos: Posicion, escala: number): Posicion {
    const area = areaImagenRef.current
    if (!area) return pos
    const limiteX = area.clientWidth * (escala - 1) / 2
    const limiteY = area.clientHeight * (escala - 1) / 2
    return {
      x: Math.max(-limiteX, Math.min(limiteX, pos.x)),
      y: Math.max(-limiteY, Math.min(limiteY, pos.y))
    }
  }

  function iniciarArrastre(event: PointerEvent<HTMLDivElement>) {
    if (zoom <= 1) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    arrastreRef.current = {
      pointerId: event.pointerId,
      inicioX: event.clientX,
      inicioY: event.clientY,
      posicionInicial: posicion
    }
    setArrastrando(true)
  }

  function moverImagen(event: PointerEvent<HTMLDivElement>) {
    const arrastre = arrastreRef.current
    if (!arrastre || arrastre.pointerId !== event.pointerId) return
    setPosicion(limitarPosicion({
      x: arrastre.posicionInicial.x + event.clientX - arrastre.inicioX,
      y: arrastre.posicionInicial.y + event.clientY - arrastre.inicioY
    }, zoom))
  }

  function terminarArrastre(event: PointerEvent<HTMLDivElement>) {
    if (arrastreRef.current?.pointerId !== event.pointerId) return
    arrastreRef.current = null
    setArrastrando(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <Modal
      open={!!src}
      onClose={onClose}
      title="Vista previa de imagen"
      wide
      footer={footer}
      backdropClassName="bg-slate-950/80"
    >
      {src ? (
        <div
          ref={areaImagenRef}
          className={`overflow-hidden rounded-lg bg-slate-950 ${zoom > 1 ? (arrastrando ? 'cursor-grabbing' : 'cursor-grab') : ''}`}
          onPointerDown={iniciarArrastre}
          onPointerMove={moverImagen}
          onPointerUp={terminarArrastre}
          onPointerCancel={terminarArrastre}
          onWheel={(event) => {
            event.preventDefault()
            const siguienteZoom = Math.min(ZOOM_MAXIMO, Math.max(1, zoom * Math.exp(-event.deltaY * 0.001)))
            setZoom(siguienteZoom)
            setPosicion((actual) => limitarPosicion(actual, siguienteZoom))
          }}
          style={{ touchAction: zoom > 1 ? 'none' : 'auto' }}
        >
          <img
            src={src}
            alt={alt}
            draggable={false}
            className="mx-auto max-h-[65vh] w-full select-none object-contain transition-transform duration-100"
            style={{ transform: `translate(${posicion.x}px, ${posicion.y}px) scale(${zoom})` }}
          />
        </div>
      ) : null}
      {src ? <p className="mt-2 text-center text-xs text-slate-500">Rueda para zoom · arrastra para desplazarte · {Math.round(zoom * 100)}%</p> : null}
    </Modal>
  )
}
