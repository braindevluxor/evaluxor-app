import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { Button, Modal, Spinner } from './ui'

interface Props {
  open: boolean
  onClose: () => void
  onDetect: (codigo: string) => void
}

export function BarcodeScanner({ open, onClose, onDetect }: Props) {
  const scanRef = useRef<Html5Qrcode | null>(null)
  const [estado, setEstado] = useState<'iniciando' | 'activo' | 'error'>('iniciando')
  const [codigoManual, setCodigoManual] = useState('')

  useEffect(() => {
    if (!open) return
    setEstado('iniciando')
    setCodigoManual('')
    const scanner = new Html5Qrcode('barcode-scanner-region')
    scanRef.current = scanner

    scanner
      .start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 260, height: 130 }
        },
        (texto) => {
          if (!/^\s*$/.test(texto)) onDetect(texto.trim())
        },
        () => {}
      )
      .then(() => setEstado('activo'))
      .catch((err) => {
        console.error('BarcodeScanner start:', err)
        setEstado('error')
      })

    return () => {
      const current = scanRef.current
      scanRef.current = null
      if (current) {
        current.stop().then(() => current.clear()).catch(() => {})
      }
    }
  }, [open, onDetect])

  return (
    <Modal open={open} onClose={onClose} title="Escanear código de barras">
      <div className="space-y-4">
        <p className="text-sm text-slate-500">
          Apunta la cámara al código de barras del producto, o escribe el código interno manualmente.
        </p>
        {estado === 'error' ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            No se pudo acceder a la cámara. Escribe el código en el campo de abajo.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-black">
            <div id="barcode-scanner-region" className="min-h-[180px]" />
          </div>
        )}
        {estado === 'iniciando' ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Spinner /> Iniciando cámara…
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <input
            className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-800 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            placeholder="Código interno o SKU"
            value={codigoManual}
            onChange={(e) => setCodigoManual(e.target.value)}
            autoFocus={estado === 'error'}
          />
          <Button
            variant="success"
            onClick={() => {
              const c = codigoManual.trim()
              if (c) onDetect(c)
            }}
          >
            Usar
          </Button>
        </div>
        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        </div>
      </div>
    </Modal>
  )
}