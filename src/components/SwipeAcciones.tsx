import { useRef, useState } from 'react'
import type { ReactNode, PointerEvent } from 'react'
import { cn } from './ui'

const ABIERTO = 56
const UMBRAL = 36

interface Accion {
  lado: 'izq' | 'der'
  contenido: ReactNode
  onDisparar: () => void
}

export function SwipeAcciones({
  acciones,
  children,
  className
}: {
  acciones: Accion[]
  children: ReactNode
  className?: string
}) {
  const [pos, setPos] = useState(0)
  const [moviendo, setMoviendo] = useState(false)
  const puntero = useRef<{ x: number; base: number } | null>(null)
  const arrastrando = useRef(false)
  const maxDrag = useRef(0)
  const dirRef = useRef<'izq' | 'der'>('izq')

  const acIzq = acciones.find((a) => a.lado === 'izq')
  const acDer = acciones.find((a) => a.lado === 'der')

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    puntero.current = { x: e.clientX, base: pos }
    arrastrando.current = false
    maxDrag.current = 0
    setMoviendo(false)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const p = puntero.current
    if (!p) return
    const dx = e.clientX - p.x
    if (!arrastrando.current && Math.abs(dx) > 8) {
      arrastrando.current = true
      setMoviendo(true)
    }
    if (!arrastrando.current) return
    if (Math.abs(dx) > maxDrag.current) {
      maxDrag.current = Math.abs(dx)
      dirRef.current = dx >= 0 ? 'izq' : 'der'
    }
    const n = Math.max(-ABIERTO, Math.min(ABIERTO, p.base + dx))
    setPos(n)
  }

  const onUp = () => {
    puntero.current = null
    const fue = arrastrando.current
    arrastrando.current = false
    setMoviendo(false)
    if (!fue) {
      maxDrag.current = 0
      setPos(0)
      return
    }
    if (maxDrag.current >= ABIERTO - 4) {
      const lado = dirRef.current
      maxDrag.current = 0
      setPos(0)
      acciones.find((a) => a.lado === lado)?.onDisparar()
      return
    }
    maxDrag.current = 0
    setPos((p) => {
      if (p <= -UMBRAL) return -ABIERTO
      if (p >= UMBRAL) return ABIERTO
      return 0
    })
  }

  return (
    <div className={cn('relative overflow-hidden rounded-xl', className)}>
      {acIzq ? (
        <div className="absolute inset-y-0 left-0 flex w-14 items-stretch justify-center overflow-hidden rounded-l-xl">{acIzq.contenido}</div>
      ) : null}
      {acDer ? (
        <div className="absolute inset-y-0 right-0 flex w-14 items-stretch justify-center overflow-hidden rounded-r-xl">{acDer.contenido}</div>
      ) : null}
      <div
        className={cn('relative select-none bg-white touch-pan-y', !moviendo && 'transition-transform duration-200')}
        style={{ transform: `translateX(${pos}px)` }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        {children}
      </div>
    </div>
  )
}