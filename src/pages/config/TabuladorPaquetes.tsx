import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  HOJAS_TABULADOR,
  listarTabulador,
  type FilaTabulador,
  type HojaTabulador,
  type Tabulador
} from '../../lib/data/tabuladorPaquetes'
import { EmptyState, Input, Modal, Select, SkeletonFilas, Spinner } from '../../components/ui'
import {
  guardarTasaManual,
  leerTasaManual,
  obtenerTasaBcv,
  type TasaBcv
} from '../../lib/tasaBcv'
import { avisar } from '../../lib/aviso'
import { ChevronDown, ChevronUp, Pencil, Search } from 'lucide-react'

/**
 * TABULADOR DE PAQUETES: LA CONSULTA DEL EXCEL DE TALENTO HUMANO
 * -------------------------------------------------------------
 * `TABULADOR ESTRCII LUXOR` (OFICINA / SUCURSALES): por cargo, la
 * plantilla, el salario y el PAQUETE APROBADO —en USD— con su desglose.
 * La pantalla es de SÓLO LECTURA —los números se ajustan en el Excel y se
 * reemplazan con el SQL de `scripts/generar_tabulador_paquetes.py`—, así
 * que no hay formularios: se busca, se filtra, se ordena y se abre el
 * detalle.
 *
 * Quién entra: LÍDER y GERENTE TH (la ruta, el menú y el RLS
 * `puede_bonos` dicen lo mismo). Sin `RequireRol` acá: lo pone la ruta.
 *
 * Son ~195 filas: se cargan ENTERAS de una y todo el filtro, el orden y la
 * búsqueda corren en memoria — sin una consulta por tecla.
 */

/**
 * Lo que la tabla principal ordena: cargo, departamento y el PAQUETE en
 * USD. Plazas y salario NO son columnas de la tabla —se piden en el
 * detalle—, pero siguen siendo columnas propias de la base.
 */
type CampoOrden = 'cargo' | 'departamento' | 'paquete'

/**
 * Formato de cifras: dos decimales con separador de miles. Sin símbolo de
 * moneda —la etiqueta de cada columna ya dice si es Bs o $—.
 */
function formato(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  return new Intl.NumberFormat('es-VE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(n)
}

/** Fecha corta de un ISO de la API —`· 20/11/2026`—, o '' si es ilegible. */
function fechaCorta(iso: string): string {
  const fecha = new Date(iso)
  return Number.isNaN(fecha.getTime()) ? '' : ` · ${fecha.toLocaleDateString('es-VE')}`
}

export function TabuladorPaquetesPage() {
  const [tabulador, setTabulador] = useState<Tabulador | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hoja, setHoja] = useState<HojaTabulador>('OFICINA')
  const [busqueda, setBusqueda] = useState('')
  const [departamento, setDepartamento] = useState('')
  const [orden, setOrden] = useState<{ campo: CampoOrden; dir: 1 | -1 }>({
    campo: 'cargo',
    dir: 1
  })
  /** El renglón abierto en el detalle, o `null`. */
  const [detalle, setDetalle] = useState<FilaTabulador | null>(null)
  /** La tasa BCV del día (se pide al entrar; sin red, `null`). */
  const [tasaBcv, setTasaBcv] = useState<TasaBcv | null>(null)
  /** La alternativa manual: cargada a mano y guardada en este navegador. */
  const [tasaManual, setTasaManual] = useState<number | null>(() => leerTasaManual())
  const [editandoTasa, setEditandoTasa] = useState(false)
  const [borradorTasa, setBorradorTasa] = useState('')

  // La tasa del BCV: una petición al entrar; si falla, la pantalla se
  // queda con la manual o con la del archivo (en ese orden).
  useEffect(() => {
    const control = new AbortController()
    void obtenerTasaBcv(control.signal).then((tasa) => {
      if (!control.signal.aborted) setTasaBcv(tasa)
    })
    return () => control.abort()
  }, [])

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      setTabulador(await listarTabulador())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el tabulador.')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  /** Las etiquetas de la hoja activa: el import manda los rótulos. */
  const etiquetas = useMemo(() => {
    const mapa = new Map<string, string>()
    for (const columna of tabulador?.config?.columnas ?? []) {
      if (columna.hoja === hoja) mapa.set(columna.key, columna.etiqueta)
    }
    return mapa
  }, [tabulador, hoja])

  /** Los departamentos de la hoja activa, para el filtro. */
  const departamentos = useMemo(() => {
    const set = new Set<string>()
    for (const fila of tabulador?.filas ?? []) {
      if (fila.hoja === hoja && fila.departamento) set.add(fila.departamento)
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'es'))
  }, [tabulador, hoja])

  /** Lo que se muestra: hoja + búsqueda (cargo o código) + departamento + orden. */
  const visibles = useMemo(() => {
    const texto = busqueda.trim().toLowerCase()
    const filas = (tabulador?.filas ?? []).filter((f) => {
      if (f.hoja !== hoja) return false
      if (departamento && f.departamento !== departamento) return false
      if (!texto) return true
      return (
        f.cargo.toLowerCase().includes(texto) || f.codigo.toLowerCase().includes(texto)
      )
    })
    const { campo, dir } = orden
    return [...filas].sort((a, b) => {
      const va = a[campo]
      const vb = b[campo]
      if (typeof va === 'number' || typeof vb === 'number') {
        const na = typeof va === 'number' ? va : Number.NEGATIVE_INFINITY
        const nb = typeof vb === 'number' ? vb : Number.NEGATIVE_INFINITY
        return (na - nb) * dir
      }
      return String(va ?? '').localeCompare(String(vb ?? ''), 'es') * dir
    })
  }, [tabulador, hoja, busqueda, departamento, orden])

  const cambiarOrden = (campo: CampoOrden) =>
    setOrden((o) =>
      o.campo === campo ? { campo, dir: o.dir === 1 ? -1 : 1 } : { campo, dir: 1 }
    )

  /** Plazas de la hoja: lo que la cabecera resume junto a los cargos. */
  const plazas = useMemo(
    () => visibles.reduce((suma, f) => suma + (f.plantilla ?? 0), 0),
    [visibles]
  )

  /**
   * La tasa que se muestra: la MANUAL (si se cargó una) → la del BCV →
   * la del archivo (la que trae el Excel, respaldo cuando no hay red).
   */
  const tasaValor = tasaManual ?? tasaBcv?.valor ?? tabulador?.config?.tasa_cambio ?? null
  const tasaFuente =
    tasaManual != null
      ? 'manual'
      : tasaBcv
        ? `BCV${fechaCorta(tasaBcv.fecha)}`
        : tabulador?.config?.tasa_cambio != null
          ? 'archivo'
          : ''

  /** Aplica la tasa tecleada: sólo números mayores que cero. */
  const aplicarTasaManual = () => {
    const valor = Number(borradorTasa.replace(',', '.'))
    if (!Number.isFinite(valor) || valor <= 0) {
      avisar('La tasa tiene que ser un número mayor que cero.', 'aviso')
      return
    }
    guardarTasaManual(valor)
    setTasaManual(valor)
    setEditandoTasa(false)
    avisar('Tasa manual guardada en este navegador. «Volver a BCV» la restablece.')
  }

  /** Borra la manual: la pantalla vuelve a la tasa del BCV. */
  const volverABcv = () => {
    guardarTasaManual(null)
    setTasaManual(null)
    setEditandoTasa(false)
  }

  const cabeceraTabla: { campo: CampoOrden | null; texto: string; clase: string }[] = [
    { campo: null, texto: 'Código', clase: 'text-left' },
    { campo: 'cargo', texto: 'Cargo', clase: 'text-left' },
    { campo: 'departamento', texto: 'Departamento', clase: 'text-left' },
    { campo: null, texto: 'Dependencia', clase: 'text-left' },
    // El PAQUETE es la cifra que la tabla resuelve: va en DÓLARES (así lo
    // aprueba el Excel) — plazas y salario se piden en el detalle.
    { campo: 'paquete', texto: 'Paquete aprobado (USD)', clase: 'text-right' }
  ]

  if (cargando) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <SkeletonFilas n={8} />
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <EmptyState title="No se pudo cargar el tabulador" subtitle={error} />
        <button
          onClick={() => void cargar()}
          className="mt-3 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Reintentar
        </button>
      </div>
    )
  }

  if (!tabulador) return null

  const config = tabulador.config

  return (
    <div className="space-y-4">
      {/* Lo que dice el encabezado del archivo: fecha y tasas del corte. */}
      <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
        {config?.fecha_archivo ? (
          <span className="rounded-full bg-slate-100 px-3 py-1">
            Archivo al {new Date(config.fecha_archivo + 'T00:00:00').toLocaleDateString('es-VE')}
          </span>
        ) : null}
        {tasaValor != null && !editandoTasa ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1">
            Tasa de cambio: {formato(tasaValor)} ({tasaFuente})
            <button
              type="button"
              onClick={() => {
                setBorradorTasa(String(tasaValor).replace('.', ','))
                setEditandoTasa(true)
              }}
              aria-label="Editar la tasa de cambio"
              title="Cargar la tasa a mano"
              className="rounded-full p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
            >
              <Pencil className="h-3 w-3" />
            </button>
          </span>
        ) : null}

        {/* La alternativa manual: se teclea, se aplica y queda en este
            navegador hasta que la página vuelva a la del BCV. */}
        {editandoTasa ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-white px-2 py-1">
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              autoFocus
              value={borradorTasa}
              onChange={(e) => setBorradorTasa(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') aplicarTasaManual()
                if (e.key === 'Escape') setEditandoTasa(false)
              }}
              aria-label="Tasa de cambio manual"
              className="w-24 rounded-lg border border-slate-200 px-2 py-0.5 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <button
              type="button"
              onClick={aplicarTasaManual}
              className="rounded-lg bg-primary px-2 py-1 text-[11px] font-bold text-white hover:opacity-90"
            >
              Aplicar
            </button>
            {tasaManual != null ? (
              <button
                type="button"
                onClick={volverABcv}
                className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50"
              >
                Volver a BCV
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setEditandoTasa(false)}
              className="rounded-lg px-2 py-1 text-[11px] font-bold text-slate-400 hover:text-slate-600"
            >
              Cancelar
            </button>
          </span>
        ) : null}
        {config?.tasa_cupon != null ? (
          <span className="rounded-full bg-slate-100 px-3 py-1">
            Tasa de cupón: {formato(config.tasa_cupon)}
          </span>
        ) : null}
        <span className="rounded-full bg-primary-50 px-3 py-1 text-primary-700">
          {visibles.length} {visibles.length === 1 ? 'cargo' : 'cargos'} · {plazas}{' '}
          {plazas === 1 ? 'plaza' : 'plazas'}
        </span>
      </div>

      {/* Las DOS hojas del Excel, como pestañas. */}
      <div className="flex flex-wrap gap-2">
        {HOJAS_TABULADOR.map((h) => (
          <button
            key={h}
            onClick={() => {
              setHoja(h)
              setDepartamento('')
            }}
            className={`rounded-xl px-4 py-2 text-sm font-bold transition-colors ${
              hoja === h
                ? 'bg-primary text-white'
                : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {h === 'OFICINA' ? 'Oficina' : 'Sucursales'}
          </button>
        ))}
      </div>

      {/* Buscar por cargo o código, y acotar por departamento. */}
      <div className="grid gap-3 sm:grid-cols-[1fr_18rem]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por cargo o código…"
            aria-label="Buscar por cargo o código"
            className="pl-9"
          />
        </div>
        <Select
          value={departamento}
          onChange={(e) => setDepartamento(e.target.value)}
          aria-label="Filtrar por departamento"
        >
          <option value="">Todos los departamentos</option>
          {departamentos.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </Select>
      </div>

      {!visibles.length ? (
        <EmptyState
          title="Sin resultados"
          subtitle="Ningún cargo coincide con la búsqueda o el filtro."
        />
      ) : (
        <div className="max-h-[70vh] overflow-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_theme(colors.slate.200)]">
              <tr className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
                {cabeceraTabla.map((col) => (
                  <th key={col.texto} className={`px-3 py-3 ${col.clase}`}>
                    {col.campo ? (
                      <button
                        onClick={() => cambiarOrden(col.campo as CampoOrden)}
                        className="inline-flex items-center gap-1 hover:text-primary"
                      >
                        {col.texto}
                        {orden.campo === col.campo ? (
                          orden.dir === 1 ? (
                            <ChevronUp className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5" />
                          )
                        ) : null}
                      </button>
                    ) : (
                      col.texto
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibles.map((f) => (
                <tr
                  key={f.id}
                  onClick={() => setDetalle(f)}
                  className="cursor-pointer border-t border-slate-100 hover:bg-primary-50/60"
                >
                  <td className="px-3 py-2.5 font-mono text-xs text-slate-500">{f.codigo}</td>
                  <td className="px-3 py-2.5 font-semibold text-slate-800">{f.cargo}</td>
                  <td className="px-3 py-2.5 text-slate-600">{f.departamento || '—'}</td>
                  <td className="px-3 py-2.5 text-slate-600">{f.dependencia || '—'}</td>
                  <td className="px-3 py-2.5 text-right font-bold tabular-nums text-primary">
                    {formato(f.paquete)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-400">
        Tocá una fila para ver el desglose completo. Los valores se ajustan en el Excel de
        Talento Humano y se actualizan con el import — la app no los edita.
      </p>

      {/* El desglose: TODO lo que trae el renglón, con las etiquetas del
          propio import (las dos hojas no traen las mismas columnas). */}
      <Modal
        open={!!detalle}
        onClose={() => setDetalle(null)}
        title={detalle ? `${detalle.cargo}` : ''}
        wide
      >
        {detalle ? (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {[
                { rotulo: 'Código', valor: detalle.codigo },
                { rotulo: 'Departamento', valor: detalle.departamento || '—' },
                { rotulo: 'Dependencia', valor: detalle.dependencia || '—' },
                { rotulo: 'Plazas', valor: formato(detalle.plantilla) },
                { rotulo: 'Salario (Bs)', valor: formato(detalle.salario) }
              ].map((dato) => (
                <div key={dato.rotulo} className="rounded-xl bg-slate-50 p-3">
                  <span className="block text-[10px] font-extrabold uppercase tracking-wide text-slate-400">
                    {dato.rotulo}
                  </span>
                  <span className="mt-0.5 block truncate text-sm font-bold text-slate-700">
                    {dato.valor}
                  </span>
                </div>
              ))}
            </div>

            <div className="rounded-xl border-2 border-primary/30 bg-primary-50 p-4">
              <span className="block text-[11px] font-extrabold uppercase tracking-wide text-primary-700">
                Paquete aprobado (USD)
              </span>
              <span className="mt-1 block text-2xl font-black tabular-nums text-primary">
                {formato(detalle.paquete)}
              </span>
            </div>

            <div>
              <span className="block text-xs font-extrabold uppercase tracking-wide text-slate-400">
                Desglose del tabulador
              </span>
              <dl className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200">
                {Object.entries(detalle.componentes).map(([key, valor]) => (
                  <div key={key} className="flex items-baseline justify-between gap-4 px-4 py-2.5">
                    <dt className="text-xs font-semibold text-slate-500">
                      {etiquetas.get(key) ?? key}
                    </dt>
                    <dd className="text-sm font-bold tabular-nums text-slate-700">
                      {typeof valor === 'number' ? formato(valor) : valor}
                    </dd>
                  </div>
                ))}
                {!Object.keys(detalle.componentes).length ? (
                  <p className="px-4 py-3 text-xs text-slate-400">
                    Este cargo no trae componentes en el archivo.
                  </p>
                ) : null}
              </dl>
            </div>

            {!Object.keys(detalle.componentes).length ? null : (
              <p className="text-[11px] text-slate-400">
                Cifras en bolívares salvo que la etiqueta indique lo contrario · hoja{' '}
                {detalle.hoja === 'OFICINA' ? 'Oficina' : 'Sucursales'}.
              </p>
            )}
          </div>
        ) : (
          <Spinner />
        )}
      </Modal>
    </div>
  )
}
