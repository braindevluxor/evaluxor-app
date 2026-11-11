import { Component, type ErrorInfo, type ReactNode } from 'react'
import { versionCorta } from '../lib/version'

interface Props {
  children: ReactNode
  /** Se reinicia el boundary cuando cambia: permite que quien lo monte fuerze un
   *  reintento (p. ej. al navegar a otra ruta) limpiando el error guardado. */
  resetKey?: unknown
}

interface State {
  error: Error | null
  /** Árbol de componentes que estaba montado cuando cayó el error. Se muestra
   *  colapsado en el fallback: en un teléfono no hay consola que leer, y sin esto
   *  un error remoto es imposible de ubicar (no se sabe ni qué pantalla era). */
  pila: string | null
}

/**
 * Red de seguridad contra la pantalla en blanco.
 *
 * Sin un boundary, cualquier excepción no capturada durante el render o en un
 * `useEffect` desmonta TODO el árbol de React y la app queda en blanco hasta que
 * el usuario refresca. Con este boundary, el error queda confinado a su rama: se
 * muestra este fallback con un botón de reintento en vez de perder la sesión.
 *
 * Es defensa en profundidad: los bugs concretos (p. ej. el lector de barras que
 * lanzaba excepciones síncronas al bloquear el teléfono) se arreglan en su origen,
 * pero cualquier falla futura e imprevista deja de ser fatal para el usuario.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, pila: null }

  static getDerivedStateFromError(error: Error): State {
    // `pila` se limpia acá y la vuelve a llenar `componentDidCatch` apenas React
    // le pase el árbol: si no, se mostraría la pila del error anterior.
    return { error, pila: null }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // El detalle va al console para depurar; el usuario ve el fallback de arriba,
    // que además muestra la pila de componentes colapsada para poder reportarla.
    console.error('ErrorBoundary capturó:', error, info.componentStack)
    this.setState({ pila: (info.componentStack ?? '').trim() || null })
  }

  componentDidUpdate(prevProps: Props) {
    // Al cambiar `resetKey` (p. ej. nueva ruta) se limpia el error y se reintenta.
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null, pila: null })
    }
  }

  private reintentar = () => {
    this.setState({ error: null, pila: null })
  }

  render() {
    const { error, pila } = this.state
    if (!error) return this.props.children

    return (
      <div className="grid min-h-screen place-items-center bg-slate-50 px-6 py-12">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center">
          <h1 className="text-lg font-bold text-slate-800">Algo salió mal</h1>
          <p className="mt-2 text-sm text-slate-600">
            Se produjo un error inesperado y no se pudo mostrar esta pantalla.
            Tu trabajo no se perdió: puedes reintentar o volver atrás.
          </p>
          <pre className="mt-4 max-h-40 overflow-auto rounded-xl bg-slate-100 p-3 text-left text-xs text-slate-500">
            {error.message || String(error)}
          </pre>
          {/* Ruta y build en el momento del fallo: un pantallazo alcanza para saber
              en qué pantalla y con qué versión se cayó — sin abrir la consola. */}
          <p className="mt-2 break-all text-[11px] text-slate-400">
            {window.location.pathname} · {versionCorta()}
          </p>
          {/*
            Colapsado a propósito: para el usuario es ruido, y para quien depura es
            lo único que dice EN QUÉ componente se cayó — en un teléfono la consola
            no está a mano.
          */}
          {pila ? (
            <details className="mt-3 text-left">
              <summary className="cursor-pointer text-xs font-semibold text-slate-500">
                Detalle técnico (para reportar el fallo)
              </summary>
              <pre className="mt-2 max-h-40 overflow-auto rounded-xl bg-slate-100 p-3 text-left text-[11px] leading-snug text-slate-500">
                {pila.split('\n').slice(0, 8).join('\n')}
              </pre>
            </details>
          ) : null}
          <div className="mt-5 flex justify-center gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Recargar app
            </button>
            <button
              type="button"
              onClick={this.reintentar}
              className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-700"
            >
              Reintentar
            </button>
          </div>
        </div>
      </div>
    )
  }
}
