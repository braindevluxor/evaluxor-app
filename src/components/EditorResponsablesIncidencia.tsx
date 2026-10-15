import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, CloudOff, HelpCircle, X } from 'lucide-react'
import { useCatalog } from '../context/CatalogContext'
import { useOffline } from '../context/OfflineContext'
import {
  agregarResponsable,
  catalogoDeIncidencia,
  confirmarConCatalogo,
  normalizarResponsables,
  pendientesDeValidar,
  quitarResponsable,
  type ResponsableIncidencia
} from '../lib/data/responsablesIncidencia'
import { agruparPorDepartamento, claveNormalizada } from '../lib/data/responsables'
import { Button, Input, cn } from './ui'

interface Props {
  valor: ResponsableIncidencia[]
  onChange: (rs: ResponsableIncidencia[]) => void
  /** La sucursal donde pasó la incidencia: define de qué tienda se buscan los cargos. */
  sucursalId: string
}

/**
 * Para BUSCAR hay que conservar los espacios: si se quitan, «enc de» no
 * matchea «Encargado de turno». Para COMPARAR pasa lo contrario y hay que
 * quitarlos, y eso lo hace `claveNormalizada`. Son dos trabajos distintos y por
 * eso son dos funciones distintas.
 */
function paraBuscar(valor: string): string {
  return valor.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

/**
 * Responsables de una incidencia: buscás el cargo en el catálogo y lo agregás.
 * Puede haber varios.
 *
 * CON SEÑAL
 *   El catálogo viene de una Edge Function y se busca en el de la sucursal de la
 *   incidencia más el de la central. Solo se pueden agregar cargos que estén en
 *   el catálogo: es lo que garantiza que un cargo de una incidencia sea el mismo
 *   que el de un ítem.
 *
 * SIN SEÑAL (o con el catálogo caído)
 *   No hay nada que buscar, así que el campo admite texto libre. Pero el cargo
 *   queda marcado como `porValidar`: se escribió a mano y puede estar mal. En la
 *   próxima oportunidad con señal se contrasta contra el catálogo, y el que
 *   coincide queda confirmado solo. El que no coincide sigue marcado, porque
 *   corrigió una persona, no el sistema.
 *
 * Esa diferencia es la razón de que el componente sea un poco más largo que un
 * `<select>`: si el catálogo no está, el campo tiene que seguir siendo usable,
 * y el que lo usa tiene que poder ver de un vistazo qué de lo que escribió está
 * verificado y qué no.
 */
export function EditorResponsablesIncidencia({ valor, onChange, sucursalId }: Props) {
  const { sucursales } = useCatalog()
  const { online } = useOffline()
  const [texto, setTexto] = useState('')
  const [abierto, setAbierto] = useState(false)
  const [catalogo, setCatalogo] = useState<{ cargo: string; departamento: string }[]>([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  /** Para no reconciliar en loop: solo una vez por carga de catálogo. */
  const reconciliado = useRef('')

  const branchId = useMemo(
    () => sucursales.find((s) => s.id === sucursalId)?.branch_id ?? null,
    [sucursales, sucursalId]
  )

  const cargarCatalogo = useCallback(async () => {
    if (!online) {
      setCatalogo([])
      setError('')
      return
    }
    setCargando(true)
    setError('')
    try {
      const crudo = await catalogoDeIncidencia(branchId)
      const vistos = new Set<string>()
      const lista: { cargo: string; departamento: string }[] = []
      for (const g of agruparPorDepartamento(crudo)) {
        for (const c of g.cargos) {
          const clave = claveNormalizada(c)
          if (!clave || vistos.has(clave)) continue
          vistos.add(clave)
          lista.push({ cargo: c, departamento: g.departamento })
        }
      }
      setCatalogo(lista)
      // Si la sucursal no tiene catálogo, `catalogoDeIncidencia` tira. Acá se
      // traduce a "no hay catálogo", que deja el campo en texto libre marcado.
      // Tratarlo como error duro dejaría al evaluador sin poder asignar nada.
    } catch (e) {
      setCatalogo([])
      setError(e instanceof Error ? e.message : 'No se pudo consultar el catálogo de cargos.')
    } finally {
      setCargando(false)
    }
  }, [online, branchId])

  useEffect(() => {
    void cargarCatalogo()
  }, [cargarCatalogo])

  const hayCatalogo = catalogo.length > 0
  /** Si no hay catálogo, el texto libre es la única forma de cargar un cargo. */
  const textoLibre = !hayCatalogo
  const pendientes = pendientesDeValidar(valor)

  // En cuanto llega el catálogo, lo que se había escrito a mano se contrasta
  // solo: lo que coincide queda confirmado y lo que no sigue marcado. Se hace
  // una sola vez por carga, con `reconciliado` como guarda.
  useEffect(() => {
    if (!hayCatalogo) return
    const marca = `${sucursalId}:${catalogo.length}`
    if (reconciliado.current === marca) return
    reconciliado.current = marca
    const siguiente = confirmarConCatalogo(
      normalizarResponsables(valor),
      catalogo.map((c) => c.cargo)
    )
    if (siguiente.some((r, i) => r.porValidar !== valor[i]?.porValidar)) onChange(siguiente)
  }, [hayCatalogo, catalogo, sucursalId, valor, onChange])

  const sugerencias = useMemo(() => {
    const busqueda = paraBuscar(texto)
    if (!busqueda) return catalogo.slice(0, 40)
    return catalogo
      .filter((c) => paraBuscar(c.cargo).includes(busqueda) || paraBuscar(c.departamento).includes(busqueda))
      .slice(0, 40)
  }, [catalogo, texto])

  const agregar = (cargo: string, porValidar: boolean) => {
    const limpio = cargo.trim()
    if (!limpio) return
    onChange(agregarResponsable(normalizarResponsables(valor), limpio, porValidar))
    setTexto('')
    // El desplegable sigue abierto: si hay que cargar tres cargos seguidos, no
    // hace falta tocar el campo tres veces.
    setAbierto(true)
  }

  const agregarLoEscrito = () => agregar(texto, true)

  const haySugerencias = abierto && hayCatalogo && sugerencias.length > 0

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-slate-600">Responsables</span>
        {valor.length ? (
          <span className="text-[11px] text-slate-400">
            {valor.length} cargo{valor.length === 1 ? '' : 's'}
            {pendientes ? ` · ${pendientes} por validar` : ''}
          </span>
        ) : null}
      </div>

      {valor.length ? (
        <div className="flex flex-wrap gap-1.5">
          {valor.map((r) => (
            <span
              key={r.cargo}
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold',
                r.porValidar ? 'bg-amber-100 text-amber-900' : 'bg-primary-50 text-primary-900'
              )}
              title={
                r.porValidar
                  ? 'Se escribió a mano, sin catálogo. Queda marcado hasta que se pueda verificar.'
                  : undefined
              }
            >
              {r.porValidar ? <HelpCircle className="h-3.5 w-3.5 shrink-0" /> : null}
              {r.cargo}
              <button
                type="button"
                onClick={() => onChange(quitarResponsable(valor, r.cargo))}
                className={cn(
                  'shrink-0 hover:text-red-600',
                  r.porValidar ? 'text-amber-500' : 'text-primary-400'
                )}
                aria-label={`Quitar ${r.cargo}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="relative">
        <Input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onFocus={() => setAbierto(true)}
          onBlur={() => setTimeout(() => setAbierto(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              // Con catálogo se agrega la primera sugerencia (Enter elige, no
              // inventa). Sin catálogo se agrega lo escrito, marcado.
              if (hayCatalogo) {
                if (sugerencias.length) agregar(sugerencias[0].cargo, false)
              } else {
                agregarLoEscrito()
              }
            } else if (e.key === 'Escape') {
              setTexto('')
              setAbierto(false)
            }
          }}
          placeholder={
            hayCatalogo ? 'Escribí para buscar un cargo…' : 'Escribí el cargo a mano…'
          }
          aria-expanded={haySugerencias}
          aria-label="Buscar cargo responsable"
        />
        {haySugerencias ? (
          <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
            {sugerencias.map((s) => {
              const yaEsta = valor.some((r) => claveNormalizada(r.cargo) === claveNormalizada(s.cargo))
              return (
                <button
                  key={s.cargo}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => agregar(s.cargo, false)}
                  aria-pressed={yaEsta}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors',
                    yaEsta ? 'bg-primary-50 text-primary-700' : 'text-slate-700 hover:bg-slate-50'
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{s.cargo}</span>
                    <span className="block truncate text-[11px] font-normal text-slate-400">{s.departamento}</span>
                  </span>
                  {yaEsta ? <Check className="h-4 w-4 shrink-0 text-primary-600" /> : null}
                </button>
              )
            })}
          </div>
        ) : null}
      </div>

      {/* Sin catálogo no hay otra forma de cargar un cargo, así que el botón
          aparece siempre que haya algo escrito. */}
      {textoLibre ? (
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={agregarLoEscrito}
            disabled={!texto.trim()}
            className="shrink-0"
          >
            Agregar
          </Button>
          <p className="min-w-0 flex-1 text-[11px] leading-snug text-amber-700">
            {cargando ? (
              'Consultando el catálogo de cargos…'
            ) : online ? (
              <>{error || 'El catálogo de esta sucursal no está disponible.'} Podés escribir el cargo a mano, pero queda marcado como pendiente de validar.</>
            ) : (
              <span className="inline-flex items-center gap-1">
                <CloudOff className="h-3.5 w-3.5 shrink-0" />
                Sin conexión: el cargo queda marcado como pendiente de validar.
              </span>
            )}
          </p>
        </div>
      ) : texto.trim() && sugerencias.length === 0 ? (
        <p className="text-[11px] text-slate-400">
          Ningún cargo del catálogo coincide con «{texto.trim()}».
        </p>
      ) : null}
    </div>
  )
}

/** Los cargos ya cargados, para las listas de solo lectura. */
export function ChipsResponsables({ valor, className }: { valor: unknown; className?: string }) {
  const lista = normalizarResponsables(valor)
  if (!lista.length) return null
  return (
    <div className={cn('flex flex-wrap gap-1', className)}>
      {lista.map((r) => (
        <span
          key={r.cargo}
          className={cn(
            'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold',
            r.porValidar ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-700'
          )}
          title={r.porValidar ? 'Se agregó a mano, sin catálogo. Pendiente de validar.' : undefined}
        >
          {r.porValidar ? <HelpCircle className="h-3 w-3 shrink-0" /> : null}
          {r.cargo}
        </span>
      ))}
    </div>
  )
}