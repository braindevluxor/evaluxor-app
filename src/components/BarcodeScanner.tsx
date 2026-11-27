import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'
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

  // La identidad de `onDetect` cambia en cada render del padre (es una arrow
  // inline). Si el `useEffect` de abajo dependiera de ella, CADA render volvería
  // a arrancar la cámara. Guardamos el último callback en una ref para que el
  // efecto solo dependa de `open` y el escáner no se reinicie sin motivo.
  //
  // Ese reinicio era, además, el gatillo del pantalla en blanco: al bloquear el
  // teléfono el SO mata el stream de la cámara, al desbloquear React re-renderiza
  // (contextos que escuchan `visibilitychange`) y el cambio de identidad
  // re-ejecutaba el efecto. El cleanup llamaba a `stop()`, que lanza
  // síncronamente si `start()` no había llegado a completarse, y esa excepción
  // síncrona desmontaba el árbol entero de React (no había error boundary).
  const onDetectRef = useRef(onDetect)
  useEffect(() => {
    onDetectRef.current = onDetect
  })

  useEffect(() => {
    if (!open) return
    setEstado('iniciando')
    setCodigoManual('')

    // El constructor y `start()` de la librería lanzan excepciones SÍNCRONAS
    // (strings): el constructor si el nodo del visor no existe, y `start()` si la
    // transición de estado es inválida. Sin este try/catch escapan del efecto y
    // React desmonta toda la app.
    let scanner: Html5Qrcode
    try {
      scanner = new Html5Qrcode('barcode-scanner-region', {
        verbose: false,
        formatsToSupport: [
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
          Html5QrcodeSupportedFormats.ITF
        ],
        useBarCodeDetectorIfSupported: true
      })
    } catch (err) {
      console.error('BarcodeScanner constructor:', err)
      setEstado('error')
      return
    }
    scanRef.current = scanner

    try {
      scanner
        .start(
          { facingMode: 'environment' },
          {
            fps: 10,
            aspectRatio: 1.7778,
            qrbox: (w, h) => {
              // Banda horizontal amplia y proporcional al encuadre: los códigos de barra son anchos.
              // Al ser relativa al viewfinder, la zona dibujada coincide con la zona real de escaneo.
              const ancho = Math.min(Math.round(w * 0.86), 420)
              const alto = Math.min(Math.max(90, Math.round(ancho * 0.42)), Math.round(h * 0.6))
              return { width: ancho, height: alto }
            }
          },
          (texto) => {
            if (!/^\s*$/.test(texto)) onDetectRef.current(texto.trim())
          },
          () => {}
        )
        .then(() => setEstado('activo'))
        .catch((err) => {
          console.error('BarcodeScanner start:', err)
          setEstado('error')
        })
    } catch (err) {
      console.error('BarcodeScanner start (sync):', err)
      setEstado('error')
      return
    }

    return () => {
      const current = scanRef.current
      scanRef.current = null
      if (!current) return
      try {
        // `stop()` lanza SÍNCRONAMENTE si el escáner no está corriendo (p. ej.
        // cuando la cámara murió al bloquear el teléfono y `start()` quedó pendiente).
        // Al envolverlo, esa excepción no escapa y no desmonta la app.
        current.stop().then(() => current.clear()).catch(() => {})
      } catch {
        // Si `stop()` lanzó, el escáner no estaba corriendo: con `clear()` basta
        // para retirar el <video> y el overlay que hubiera dejado en el DOM.
        try {
          current.clear()
        } catch {
          // `clear()` también puede fallar si el nodo ya fue retirado; no hay
          // nada más que limpiar.
        }
      }
    }
  }, [open])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Escanear código de barras"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
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
      }
    >
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
        <input
          className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-800 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          placeholder="Código interno o SKU"
          value={codigoManual}
          onChange={(e) => setCodigoManual(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.keyCode === 13) {
              e.preventDefault()
              const c = (e.currentTarget.value || codigoManual).trim()
              if (c) onDetect(c)
            }
          }}
          autoFocus={estado === 'error'}
        />
      </div>
    </Modal>
  )
}
