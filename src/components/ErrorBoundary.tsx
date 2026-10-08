import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Se reinicia el boundary cuando cambia: permite que quien lo monte fuerze un
   *  reintento (p. ej. al navegar a otra ruta) limpiando el error guardado. */
  resetKey?: unknown
}

interface State {
  error: Error | null
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
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // El detalle va al console para depurar; el usuario ve el fallback de arriba.
    console.error('ErrorBoundary capturó:', error, info.componentStack)
  }

  componentDidUpdate(prevProps: Props) {
    // Al cambiar `resetKey` (p. ej. nueva ruta) se limpia el error y se reintenta.
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  private reintentar = () => {
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state
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
