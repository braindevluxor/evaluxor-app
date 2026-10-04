import { useEffect, useRef, useState } from 'react'
import { Button } from './ui'

interface FirmaCanvasProps {
  valor: string | null
  onChange: (v: string | null) => void
  disabled?: boolean
  label?: string
}

export function FirmaCanvas({ valor, onChange, disabled, label = 'Firma del chofer' }: FirmaCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const [dibujando, setDibujando] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.strokeStyle = '#111827'
    ctxRef.current = ctx

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)
    canvas.style.width = rect.width + 'px'
    canvas.style.height = rect.height + 'px'

    if (valor) {
      const img = new Image()
      img.onload = () => {
        ctx.clearRect(0, 0, rect.width, rect.height)
        ctx.drawImage(img, 0, 0, rect.width, rect.height)
      }
      img.src = valor
    } else {
      ctx.clearRect(0, 0, rect.width, rect.height)
    }
  }, [valor])

  function obtenerPos(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    if ('touches' in e) {
      const t = e.touches[0]
      return { x: t.clientX - rect.left, y: t.clientY - rect.top }
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function empezar(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    if (disabled) return
    e.preventDefault()
    const p = obtenerPos(e)
    setDibujando(true)
    ctxRef.current?.beginPath()
    ctxRef.current?.moveTo(p.x, p.y)
  }

  function mover(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    if (!dibujando || disabled) return
    e.preventDefault()
    const p = obtenerPos(e)
    ctxRef.current?.lineTo(p.x, p.y)
    ctxRef.current?.stroke()
  }

  function terminar(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    if (!dibujando) return
    e.preventDefault()
    setDibujando(false)
    ctxRef.current?.closePath()
    const canvas = canvasRef.current
    if (canvas) onChange(canvas.toDataURL('image/png'))
  }

  function limpiar() {
    if (disabled) return
    const canvas = canvasRef.current
    const ctx = ctxRef.current
    if (!canvas || !ctx) return
    const rect = canvas.getBoundingClientRect()
    ctx.clearRect(0, 0, rect.width, rect.height)
    onChange(null)
  }

  return (
    <div className="space-y-2">
      {label && <span className="text-xs font-semibold text-slate-700">{label}</span>}
      <div className="overflow-hidden rounded-xl border border-slate-300 bg-white">
        <canvas
          ref={canvasRef}
          className="h-40 w-full touch-none"
          onMouseDown={empezar}
          onMouseMove={mover}
          onMouseUp={terminar}
          onMouseLeave={terminar}
          onTouchStart={empezar}
          onTouchMove={mover}
          onTouchEnd={terminar}
        />
      </div>
      <div className="flex justify-end">
        <Button type="button" variant="secondary" onClick={limpiar} disabled={disabled || !valor}>
          Limpiar firma
        </Button>
      </div>
    </div>
  )
}