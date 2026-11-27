import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Link2, Lock, RefreshCw } from 'lucide-react'
import { BOTON_CABECERA, Button, Modal, Spinner, claseBotonIcono, cn } from './ui'
import { avisar } from '../lib/aviso'
import { copiarAlPortapapeles } from '../lib/copiar'
import {
  apagarEnlace,
  compartirEvaluacion,
  guardarEnlaceEnCache,
  obtenerEnlace,
  suscribirEnlace,
  urlCompartida,
  type EnlaceCompartido
} from '../lib/data/compartir'
import { formatearFechaHora } from '../lib/tiempo'

/**
 * Compartir la conciliación de una evaluación con alguien que no tiene cuenta.
 *
 * El coordinador de inventario quiere ver cómo va el conteo sin tener acceso a
 * la app. Esto genera un enlace público (`/compartir/:token`) de **sólo
 * lectura`: no hay edición, creación ni borrado del otro lado, y el enlace no
 * expone fotos, incidencias ni el resto de los ítems.
 *
 * Es reversible: apagar el enlace deja de servir sin tocar la evaluación, y
 * generar uno nuevo revoca el anterior porque la tabla tiene una sola fila por
 * evaluación. Ver `supabase/compartir-evaluacion.sql`.
 *
 * Sólo Líder: crear y apagar enlaces es configuración, igual que el catálogo
 * (`es_lider()` en la política). El componente se renderiza sólo cuando el
 * rol corresponde.
 *
 * El botón tiene dos caras porque vive en dos sitios: el encabezado azul del
 * detalle de evaluación (puro icono, sin fondo, igual que el resto de la barra)
 * y la fila de acciones del historial, donde tiene que verse igual que el Eye y
 * el FileDown de al lado. `variante` elige una; `className` es para ajustes
 * sueltos encima.
 *
 * Y cambia de color: **verde cuando el enlace está activo**, así el Líder sabe
 * de un vistazo, sin abrir nada, qué evaluaciones tiene compartidas. Cada cara
 * trae la suya porque el verde sobre azul y el verde sobre blanco no son el
 * mismo verde.
 */
export type VarianteCompartir = 'header' | 'ficha'

const CARAS: Record<VarianteCompartir, { boton: string; activo: string; icono: string }> = {
  // La cara de cabecera es literalmente `BOTON_CABECERA`, la misma que los
  // botones del resto de la barra: puro icono, sin disco y un escalón más
  // grande que el estándar, para que la barra no quede sembrada de contornos
  // sobre el azul.
  //
  // El verde se deriva con `replace` y no con `cn(BOTON_CABECERA,
  // 'text-green-400')`: la clase trae `text-white`, y Tailwind resuelve ese
  // empate por el orden del CSS, no por el de las clases. Así no hay empate.
  header: {
    boton: BOTON_CABECERA,
    activo: BOTON_CABECERA.replace('text-white', 'text-green-400'),
    icono: 'h-5 w-5'
  },
  ficha: {
    boton: claseBotonIcono('neutral'),
    activo: claseBotonIcono('success'),
    icono: 'h-5 w-5'
  }
}

export function CompartirEvaluacion({
  evaluacionId,
  creadoPor,
  variante = 'header',
  className
}: {
  evaluacionId: string
  creadoPor: string | null
  variante?: VarianteCompartir
  className?: string
}) {
  const [abierto, setAbierto] = useState(false)
  const [enlace, setEnlace] = useState<EnlaceCompartido | null>(null)
  // Arranca en true y se vuelve a poner en true al abrir: el primer cuadro
  // después de abrir tiene que ser "consultando", no el "no hay enlace" de un
  // estado viejo de la fila anterior.
  const [leyendo, setLeyendo] = useState(true)
  const [ocupado, setOcupado] = useState(false)
  // Verde en el icono cuando el enlace está activo. Se suscribe al lote que
  // arma la página en vez de pedir el suyo: en un historial esto es una fila
  // por evaluación, y N requests para N filas era el problema del commit
  // anterior. El aviso llega por `suscribirEnlace`, que desde un efecto puede
  // ser síncrono si ya está en caché.
  const [activo, setActivo] = useState(false)

  useEffect(() => {
    return suscribirEnlace(evaluacionId, (e) => setActivo(e?.activo === true))
  }, [evaluacionId])

  useEffect(() => {
    // Sólo al abrir. En el historial esto se renderiza una vez por evaluación,
    // y una petición por fila al montar la página es tráfico gratis que nadie
    // pidió: nadie mira el enlace que no está abriendo.
    if (!abierto) return
    let vivo = true
    setLeyendo(true)
    void obtenerEnlace(evaluacionId)
      .then((e) => {
        // La lectura fresca del modal actualiza también el indicador: si
        // alguien apagó el enlace desde el detalle, la fila se entera acá.
        if (!vivo) return
        setEnlace(e)
        guardarEnlaceEnCache(evaluacionId, e)
      })
      // Sin enlace no hay nada que mostrar y no es un error: el botón simplemente
      // ofrece generar uno. Una caída de red tampoco debe romper la lista.
      .catch(() => undefined)
      .finally(() => {
        if (vivo) setLeyendo(false)
      })
    return () => {
      vivo = false
    }
  }, [abierto, evaluacionId])

  const generar = useCallback(async () => {
    setOcupado(true)
    try {
      const nuevo = await compartirEvaluacion(evaluacionId, creadoPor)
      setEnlace(nuevo)
      guardarEnlaceEnCache(evaluacionId, nuevo)
      avisar('Enlace generado. El anterior dejó de funcionar.')
    } catch {
      avisar('No se pudo generar el enlace', 'error')
    } finally {
      setOcupado(false)
    }
  }, [evaluacionId, creadoPor])

  const apagar = useCallback(async () => {
    setOcupado(true)
    try {
      await apagarEnlace(evaluacionId)
      const apagado = enlace ? { ...enlace, activo: false } : null
      setEnlace(apagado)
      guardarEnlaceEnCache(evaluacionId, apagado)
      avisar('Enlace apagado. Ya no se puede abrir.')
    } catch {
      avisar('No se pudo apagar el enlace', 'error')
    } finally {
      setOcupado(false)
    }
  }, [evaluacionId, enlace])

  const copiar = useCallback(async () => {
    if (!enlace) return
    const ok = await copiarAlPortapapeles(urlCompartida(enlace.token))
    avisar(ok ? 'Enlace copiado' : 'No se pudo copiar el enlace', ok ? 'ok' : 'error')
  }, [enlace])

  const cara = CARAS[variante]
  const url = enlace?.activo ? urlCompartida(enlace.token) : null
  // Verde sólo con el enlace activo. Mientras se consulta se queda en el
  // color normal: un verde de mentira durante el primer cuadro sería peor.
  const rotulo = activo
    ? 'Conciliación compartida con un enlace público · gestionar'
    : 'Compartir la conciliación con un enlace público'

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setLeyendo(true)
          setAbierto(true)
        }}
        title={rotulo}
        aria-label={rotulo}
        className={cn(activo ? cara.activo : cara.boton, className)}
      >
        <Link2 className={cara.icono} />
      </button>

      <Modal open={abierto} onClose={() => setAbierto(false)} title="Compartir conciliación">
        <p className="text-sm font-medium leading-relaxed text-slate-600">
          Crea un enlace para que el coordinador de inventario siga el conteo en vivo sin tener
          cuenta en la app. Es de <strong className="font-bold text-slate-900">sólo lectura</strong>:
          no se pueden editar, crear ni borrar evaluaciones desde ahí, y no se muestran fotos,
          incidencias ni el resto de los ítems.
        </p>

        {leyendo ? (
          <p className="mt-4 flex items-center gap-2 text-sm font-medium text-slate-400">
            <Spinner size={16} /> Consultando el enlace…
          </p>
        ) : url ? (
          <div className="mt-4 space-y-3">
            <div className="rounded-xl bg-slate-50 px-4 py-3">
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-green-600">
                <span className="h-1.5 w-1.5 rounded-full bg-green-500" aria-hidden="true" />
                Activo desde {formatearFechaHora(enlace?.creado_at)}
              </p>
              <p className="mt-1 break-all font-mono text-xs text-slate-600">{url}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void copiar()} className="gap-1.5">
                <Copy className="h-4 w-4" /> Copiar enlace
              </Button>
              <Button
                variant="secondary"
                className="gap-1.5"
                disabled={ocupado}
                onClick={() => void generar()}
                title="Genera un enlace nuevo y deja de funcionar el anterior"
              >
                <RefreshCw className={cn('h-4 w-4', ocupado && 'animate-spin')} /> Generar otro
              </Button>
              <Button variant="ghost" className="gap-1.5 text-red-600" disabled={ocupado} onClick={() => void apagar()}>
                <Lock className="h-4 w-4" /> Apagar
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm font-medium text-slate-500">
              Esta evaluación todavía no tiene un enlace activo.
            </p>
            <Button onClick={() => void generar()} disabled={ocupado} className="gap-1.5">
              {ocupado ? <Spinner size={16} light /> : <Check className="h-4 w-4" />}
              Generar enlace público
            </Button>
          </div>
        )}
      </Modal>
    </>
  )
}
