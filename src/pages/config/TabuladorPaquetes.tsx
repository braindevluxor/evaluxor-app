import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react'
import {
  COLUMNAS_MONEDA,
  VISTAS,
  bonoCompensatorio,
  eliminarFila,
  esConvertido,
  guardarFila,
  listarTabulador,
  validarFila,
  valorParaVista,
  type CampoMonetario,
  type FilaTabulador,
  type Moneda,
  type VistaMoneda
} from '../../lib/data/tabuladorPaquetes'
import { Button, Confirmar, EmptyState, Field, Input, Modal, Select, SkeletonFilas, Spinner } from '../../components/ui'
import { guardarTasaManual, leerTasaManual, obtenerTasaBcv, type TasaBcv } from '../../lib/tasaBcv'
import { avisar } from '../../lib/aviso'
import { ChevronDown, ChevronUp, Pencil, Plus, Search, Trash2 } from 'lucide-react'

/**
 * TABULADOR DE PAQUETES: LAS CIFRAS DE TALENTO HUMANO, EN LA CONSOLA
 * -------------------------------------------------------------
 * Por cargo: código, cargo, departamento, dependencia, plantilla y las
 * cifras del paquete —SALARIO y BONO TRASLADO en BS; ASISTENCIA,
 * CESTATICKETS y PAQUETE APROBADO en USD—. Cada cifra se GUARDA en su
 * moneda de declaración y la pantalla puede mirarse de TRES formas:
 *
 *  - **Según declaración**: cada columna en la moneda con la que fue cargada.
 *  - **Solo BS**: las USD se convierten a bolívares con la tasa del BCV.
 *  - **Solo USD**: las BS se convierten a dólares con la tasa del BCV.
 *
 * El BONO COMPENSATORIO es la ÚNICA columna que no se carga: es la resta
 * PAQUETE − (SALARIO + TRASLADO + ASISTENCIA + CESTATICKETS), con los BS
 * pasados a USD por la tasa. Sin paquete o sin tasa no hay número: la celda
 * es «—», nunca un resultado de mentira.
 *
 * La conversión es de visualización NOMÁS: la base nunca guarda un número
 * convertido ni el compensatorio calculado.
 *
 * Quién entra: LÍDER y GERENTE TH (la ruta, el menú y el RLS
 * `puede_bonos` dicen lo mismo). Los DOS editan: alta, cambio y borrado.
 *
 * Son pocas filas: se cargan ENTERAS de una y todo el filtro, el orden y la
 * búsqueda corren en memoria — sin una consulta por tecla.
 */

/** Lo que la tabla principal ordena. */
type CampoOrden = 'cargo' | 'departamento'

/** Formato de cifras: dos decimales con separador de miles. Sin símbolo —el rótulo de la columna ya dice si es BS o USD—. */
function formato(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  return new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

/** Fecha corta de un ISO de la API —`· 20/11/2026`—, o '' si es ilegible. */
function fechaCorta(iso: string): string {
  const fecha = new Date(iso)
  return Number.isNaN(fecha.getTime()) ? '' : ` · ${fecha.toLocaleDateString('es-VE')}`
}

/** Un input numérico vacío es `null` = no declarado; con coma, se usa como decimal. */
function numero(texto: string): number | null {
  const t = texto.trim()
  if (!t) return null
  // Con coma decimal, los puntos son de miles ('1.500,50' = 1500.5).
  const limpio = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t
  const valor = Number(limpio)
  return Number.isFinite(valor) ? valor : null
}

const FORM_VACIO = {
  codigo: '',
  cargo: '',
  departamento: '',
  dependencia: '',
  plantilla: '',
  salario_bs: '',
  bono_traslado_bs: '',
  bono_asistencia_usd: '',
  cestatickets_usd: '',
  paquete_aprobado_usd: ''
}

type Form = typeof FORM_VACIO

/** La fila guardada, vuelta al formulario (siempre en su moneda declarada). */
function formDe(fila: FilaTabulador): Form {
  const texto = (n: number | null) => (n == null ? '' : String(n))
  return {
    codigo: fila.codigo,
    cargo: fila.cargo,
    departamento: fila.departamento,
    dependencia: fila.dependencia,
    plantilla: texto(fila.plantilla),
    salario_bs: texto(fila.salario_bs),
    bono_traslado_bs: texto(fila.bono_traslado_bs),
    bono_asistencia_usd: texto(fila.bono_asistencia_usd),
    cestatickets_usd: texto(fila.cestatickets_usd),
    paquete_aprobado_usd: texto(fila.paquete_aprobado_usd)
  }
}

/** La fila del formulario, para prever el compensatorio ANTES de guardar. */
function filaDeForm(form: Form): FilaTabulador {
  return {
    id: '',
    codigo: form.codigo,
    cargo: form.cargo,
    departamento: form.departamento,
    dependencia: form.dependencia,
    plantilla: numero(form.plantilla),
    salario_bs: numero(form.salario_bs),
    bono_traslado_bs: numero(form.bono_traslado_bs),
    bono_asistencia_usd: numero(form.bono_asistencia_usd),
    cestatickets_usd: numero(form.cestatickets_usd),
    paquete_aprobado_usd: numero(form.paquete_aprobado_usd)
  }
}

export function TabuladorPaquetesPage() {
  const [filas, setFilas] = useState<FilaTabulador[] | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  /** La vista: cada columna en su moneda, o TODO en una. */
  const [vista, setVista] = useState<VistaMoneda>('DECLARADO')
  const [busqueda, setBusqueda] = useState('')
  const [departamento, setDepartamento] = useState('')
  const [orden, setOrden] = useState<{ campo: CampoOrden; dir: 1 | -1 }>({ campo: 'cargo', dir: 1 })

  /** El formulario abierto (`null` = cerrado; `id` = edición, sin `id` = alta). */
  const [form, setForm] = useState<Form | null>(null)
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  /** La fila a borrar, con su confirmador. */
  const [aBorrar, setABorrar] = useState<FilaTabulador | null>(null)

  /** La tasa BCV del día (se pide al entrar; sin red, `null`). */
  const [tasaBcv, setTasaBcv] = useState<TasaBcv | null>(null)
  /** La alternativa manual: cargada a mano y guardada en este navegador. */
  const [tasaManual, setTasaManual] = useState<number | null>(() => leerTasaManual())
  const [editandoTasa, setEditandoTasa] = useState(false)
  const [borradorTasa, setBorradorTasa] = useState('')

  // La tasa del BCV: una petición al entrar; si falla, la pantalla se queda
  // con la manual (en ese orden).
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
      setFilas(await listarTabulador())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el tabulador.')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  /** La tasa vigente: la MANUAL (si se cargó) → la del BCV. */
  const tasaValor = tasaManual ?? tasaBcv?.valor ?? null
  const tasaFuente = tasaManual != null ? 'manual' : tasaBcv ? `BCV${fechaCorta(tasaBcv.fecha)}` : ''

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

  /** ¿La vista pide conversión y NO hay tasa? La regla entera de la pantalla. */
  const sinTasa = vista !== 'DECLARADO' && (tasaValor == null || !(tasaValor > 0))

  const departamentos = useMemo(() => {
    const set = new Set<string>()
    for (const fila of filas ?? []) if (fila.departamento) set.add(fila.departamento)
    return [...set].sort((a, b) => a.localeCompare(b, 'es'))
  }, [filas])

  const dependencias = useMemo(() => {
    const set = new Set<string>()
    for (const fila of filas ?? []) if (fila.dependencia) set.add(fila.dependencia)
    return [...set].sort((a, b) => a.localeCompare(b, 'es'))
  }, [filas])

  /** Lo que se muestra: búsqueda (cargo o código) + departamento + orden. */
  const visibles = useMemo(() => {
    const texto = busqueda.trim().toLowerCase()
    const filtradas = (filas ?? []).filter((f) => {
      if (departamento && f.departamento !== departamento) return false
      if (!texto) return true
      return f.cargo.toLowerCase().includes(texto) || f.codigo.toLowerCase().includes(texto)
    })
    const { campo, dir } = orden
    return [...filtradas].sort((a, b) => (a[campo] ?? '').localeCompare(b[campo] ?? '', 'es') * dir)
  }, [filas, busqueda, departamento, orden])

  const cambiarOrden = (campo: CampoOrden) =>
    setOrden((o) => (o.campo === campo ? { campo, dir: o.dir === 1 ? -1 : 1 } : { campo, dir: 1 }))

  /** Plazas de lo visible: lo que la cabecera resume. */
  const plazas = useMemo(() => visibles.reduce((suma, f) => suma + (f.plantilla ?? 0), 0), [visibles])

  /** Abrir el formulario para crear, o para editar ESTA fila. */
  const abrir = (fila?: FilaTabulador) => {
    setEditandoId(fila?.id ?? null)
    setForm(fila ? formDe(fila) : { ...FORM_VACIO })
  }

  /** Cierra el formulario (mientras guarda no se va). */
  const cerrar = () => {
    if (guardando) return
    setForm(null)
    setEditandoId(null)
  }

  /** Cambia un campo del formulario. El estado es `Form | null`, pero un input sólo existe con el formulario abierto. */
  const cambiar =
    (campo: keyof Form) => (e: ChangeEvent<HTMLInputElement>) =>
      setForm((f) => (f ? { ...f, [campo]: e.target.value } : f))

  /** Guardar alta o edición: valida en cliente, escribe y recarga. */
  const guardar = async () => {
    if (!form) return
    const entrada = {
      id: editandoId ?? undefined,
      codigo: form.codigo,
      cargo: form.cargo,
      departamento: form.departamento,
      dependencia: form.dependencia,
      plantilla: numero(form.plantilla),
      salario_bs: numero(form.salario_bs),
      bono_traslado_bs: numero(form.bono_traslado_bs),
      bono_asistencia_usd: numero(form.bono_asistencia_usd),
      cestatickets_usd: numero(form.cestatickets_usd),
      paquete_aprobado_usd: numero(form.paquete_aprobado_usd)
    }
    const problema = validarFila(entrada)
    if (problema) {
      avisar(problema, 'aviso')
      return
    }
    setGuardando(true)
    try {
      await guardarFila(entrada)
      avisar(editandoId ? 'Fila actualizada.' : 'Fila creada.')
      setForm(null)
      setEditandoId(null)
      await cargar()
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo guardar.', 'error')
    } finally {
      setGuardando(false)
    }
  }

  /** Borrar: el confirmador evita el clic de más. */
  const borrar = async () => {
    if (!aBorrar) return
    try {
      await eliminarFila(aBorrar.id)
      avisar('Fila borrada.')
      setABorrar(null)
      await cargar()
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo borrar.', 'error')
    }
  }

  /**
   * El rótulo de una columna monetaria: la moneda EN QUE SE VE —la
   * declarada en «según declaración», la de la vista en las otras dos.
   */
  const monedaDe = (moneda: Moneda): Moneda => (vista === 'DECLARADO' ? moneda : vista)

  /** El texto de una celda: declarada o convertida, con su marca si lo estuvo. */
  const celda = (fila: FilaTabulador, campo: CampoMonetario, moneda: Moneda) => {
    const declarado = fila[campo]
    const convertido = esConvertido(moneda, vista)
    const valor = valorParaVista(declarado, moneda, vista, tasaValor)
    const texto = formato(valor)
    if (!convertido) return <span>{texto}</span>
    const detalle =
      valor == null && declarado != null
        ? `Sin tasa de cambio: ${formato(declarado)} ${moneda} sin convertir`
        : `${formato(declarado)} ${moneda} × tasa ${formato(tasaValor)}`
    return (
      <span title={detalle} className="text-slate-500">
        {texto}
        <span className="text-[10px] text-slate-400"> c</span>
      </span>
    )
  }

  /**
   * EL BONO COMPENSATORIO: la columna que NO se guarda, porque es la resta
   * de las demás —PAQUETE − (SALARIO + TRASLADO en USD) − ASISTENCIA −
   * CESTATICKETS—. Se calcula en USD y se pinta como cualquier otra cifra
   * USD: en «solo BS» se multiplica por la tasa al mostrarla.
   */
  const celdaCompensatorio = (f: FilaTabulador) => {
    const enUsd = bonoCompensatorio(f, tasaValor)
    if (enUsd == null) {
      const motivo =
        f.paquete_aprobado_usd == null
          ? 'Sin paquete aprobado declarado no hay de qué restar'
          : 'Sin tasa de cambio: los BS no se pueden pasar a USD para restar'
      return (
        <span title={motivo} className="text-slate-400">
          —
        </span>
      )
    }
    const convertido = esConvertido('USD', vista)
    const valor = valorParaVista(enUsd, 'USD', vista, tasaValor)
    if (valor == null) {
      return (
        <span title={`Sin tasa de cambio: ${formato(enUsd)} USD sin convertir`} className="text-slate-400">
          —
        </span>
      )
    }
    return (
      <span
        title={`Calculado: ${formato(f.paquete_aprobado_usd)} − (salario + traslado + asistencia + cestatickets) = ${formato(enUsd)} USD`}
      >
        {formato(valor)}
        {convertido ? <span className="text-[10px] text-slate-400"> c</span> : null}
      </span>
    )
  }

  /** El compensatorio que va a quedar si se guarda así: se avisa en el formulario. */
  const compensatorioPrevio = form ? bonoCompensatorio(filaDeForm(form), tasaValor) : null

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

  /**
   * Las columnas de texto de la tabla. VAN JUNTAS para que la tabla entre
   * sin scroll horizontal: el código va debajo del cargo (chiquito, mono)
   * y la dependencia debajo del departamento —la misma idea que el alias
   * en Bonos—, así se ahorran dos columnas sin perder información.
   */
  const columnas: { campo: CampoOrden | null; texto: string; clase: string }[] = [
    { campo: 'cargo', texto: 'Cargo', clase: 'text-left' },
    { campo: 'departamento', texto: 'Departamento', clase: 'text-left' },
    { campo: null, texto: 'Plantilla', clase: 'text-right' }
  ]

  return (
    <div className="space-y-4">
      {/* Fila de controles: la vista de moneda, la tasa y el alta. */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Las TRES formas de mirar la tabla. */}
        <div className="flex rounded-xl border border-slate-200 bg-white p-1" role="group" aria-label="Vista de moneda">
          {VISTAS.map((v) => (
            <button
              key={v.valor}
              type="button"
              aria-pressed={vista === v.valor}
              onClick={() => setVista(v.valor)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                vista === v.valor ? 'bg-primary text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {v.etiqueta}
            </button>
          ))}
        </div>

        {/* La tasa con la que se convierte: BCV o la cargada a mano. */}
        {tasaValor != null && !editandoTasa ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
            Tasa: {formato(tasaValor)} ({tasaFuente})
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

        {editandoTasa ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-white px-2 py-1 text-xs">
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

        {/* Sin tasa no hay chip que editar: este botón es la puerta de entrada
            a la manual (por eso la pantalla nunca queda sin forma de cargarla). */}
        {tasaValor == null && !editandoTasa ? (
          <button
            type="button"
            onClick={() => {
              setBorradorTasa('')
              setEditandoTasa(true)
            }}
            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            Cargar la tasa de cambio
          </button>
        ) : null}

        {sinTasa ? (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">
            Sin tasa de cambio: las columnas convertidas se ven como «—».
          </span>
        ) : null}

        <span className="rounded-full bg-primary-50 px-3 py-1 text-xs font-bold text-primary-700">
          {visibles.length} {visibles.length === 1 ? 'cargo' : 'cargos'} · {plazas}{' '}
          {plazas === 1 ? 'plaza' : 'plazas'}
        </span>

        <Button className="ml-auto" onClick={() => abrir()}>
          <Plus className="h-4 w-4" /> Nueva fila
        </Button>
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
          title={filas?.length ? 'Sin resultados' : 'El tabulador está vacío'}
          subtitle={
            filas?.length
              ? 'Ningún cargo coincide con la búsqueda o el filtro.'
              : 'Creá la primera fila para empezar a cargar el tabulador.'
          }
        />
      ) : (
        <div className="max-h-[70vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white">
          {/* Sin ancho mínimo: la tabla entra entera en la consola. Las
              columnas de texto van juntas (cargo + código, departamento +
              dependencia) para que sobre espacio y no haga falta scrollear. */}
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_theme(colors.slate.200)]">
              <tr className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
                {columnas.map((col) => (
                  <th key={col.texto} className={`px-3 py-3 ${col.clase}`}>
                    {col.campo ? (
                      <button
                        type="button"
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
                {COLUMNAS_MONEDA.map((col) => (
                  <th key={col.campo} className="px-3 py-3 text-right" title={`Declarado en ${col.moneda}`}>
                    {col.etiqueta} ({monedaDe(col.moneda)})
                  </th>
                ))}
                {/* No se carga: es la resta de las de arriba. Su moneda es
                    USD siempre, y la vista puede convertirla. */}
                <th
                  className="px-3 py-3 text-right"
                  title="Paquete aprobado − (salario + traslado + asistencia + cestatickets), con los BS en USD por la tasa"
                >
                  Bono compensatorio ({monedaDe('USD')})
                </th>
                <th className="px-3 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((f) => (
                <tr key={f.id} className="border-t border-slate-100 hover:bg-primary-50/60">
                  <td className="px-3 py-2.5">
                    <span className="font-semibold text-slate-800">{f.cargo}</span>
                    {/* El código, chiquito y monoespaciado: es el mismo
                        puesto, sólo que en la columna van juntos. */}
                    {f.codigo ? (
                      <span className="block font-mono text-xs text-slate-400">{f.codigo}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 text-slate-600">
                    {f.departamento || '—'}
                    {/* La dependencia vive en la MISMA celda: no gasta
                        columna y se lee como segundo renglón. */}
                    {f.dependencia ? (
                      <span className="block text-xs text-slate-400">{f.dependencia}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                    {f.plantilla ?? '—'}
                  </td>
                  {COLUMNAS_MONEDA.map((col) => (
                    <td
                      key={col.campo}
                      className={`px-3 py-2.5 text-right tabular-nums ${
                        esConvertido(col.moneda, vista) ? 'text-slate-500' : 'text-slate-700'
                      }`}
                    >
                      {celda(f, col.campo, col.moneda)}
                    </td>
                  ))}
                  <td
                    className={`px-3 py-2.5 text-right font-semibold tabular-nums ${
                      esConvertido('USD', vista) ? 'text-slate-500' : 'text-primary-700'
                    }`}
                  >
                    {celdaCompensatorio(f)}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <span className="inline-flex gap-1">
                      <button
                        type="button"
                        onClick={() => abrir(f)}
                        aria-label={`Editar ${f.cargo}`}
                        title="Editar la fila"
                        className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-primary"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setABorrar(f)}
                        aria-label={`Borrar ${f.cargo}`}
                        title="Borrar la fila"
                        className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-400">
        Las cifras se cargan y se guardan en su moneda de declaración —BS o USD—; la vista sólo
        las convierte con la tasa de cambio. La celda con <span className="font-bold">c</span> está
        convertida. El <span className="font-bold">Bono compensatorio</span> no se carga: es el
        paquete aprobado menos el resto de las cifras.
      </p>

      {/* El formulario: SIEMPRE en la moneda declarada, sin importar la vista. */}
      <Modal
        open={!!form}
        onClose={cerrar}
        title={editandoId ? 'Editar fila' : 'Nueva fila'}
        wide
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={cerrar} disabled={guardando}>
              Cancelar
            </Button>
            <Button onClick={() => void guardar()} disabled={guardando}>
              {guardando ? <Spinner size={16} /> : null}
              {editandoId ? 'Guardar cambios' : 'Crear fila'}
            </Button>
          </div>
        }
      >
        {form ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Código">
                <Input
                  aria-label="Código"
                  value={form.codigo}
                  onChange={cambiar('codigo')}
                  placeholder="0037000"
                  autoComplete="off"
                />
              </Field>
              <Field label="Cargo" hint="Lo que se busca en la tabla.">
                <Input
                  aria-label="Cargo"
                  value={form.cargo}
                  onChange={cambiar('cargo')}
                  placeholder="AUXILIAR DE PRECIOS"
                  autoComplete="off"
                  autoFocus
                />
              </Field>
              <Field label="Departamento">
                <Input
                  aria-label="Departamento"
                  value={form.departamento}
                  onChange={cambiar('departamento')}
                  placeholder="ALMACÉN"
                  list="tabulador-departamentos"
                  autoComplete="off"
                />
                <datalist id="tabulador-departamentos">
                  {departamentos.map((d) => (
                    <option key={d} value={d} />
                  ))}
                </datalist>
              </Field>
              <Field label="Dependencia">
                <Input
                  aria-label="Dependencia"
                  value={form.dependencia}
                  onChange={cambiar('dependencia')}
                  placeholder="PLANTA"
                  list="tabulador-dependencias"
                  autoComplete="off"
                />
                <datalist id="tabulador-dependencias">
                  {dependencias.map((d) => (
                    <option key={d} value={d} />
                  ))}
                </datalist>
              </Field>
              <Field label="Plantilla" hint="Plazas del puesto. Vacío = no declarado.">
                <Input
                  aria-label="Plantilla"
                  type="number"
                  min={0}
                  step={1}
                  value={form.plantilla}
                  onChange={cambiar('plantilla')}
                  placeholder="0"
                />
              </Field>
            </div>

            <div className="rounded-xl border border-slate-200 p-3">
              <span className="block text-xs font-extrabold uppercase tracking-wide text-slate-400">
                Las cinco cifras que se cargan, en su moneda
              </span>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {COLUMNAS_MONEDA.map((col) => (
                  <Field key={col.campo} label={`${col.etiqueta} (${col.moneda})`}>
                    <Input
                      type="text"
                      inputMode="decimal"
                      aria-label={`${col.etiqueta} (${col.moneda})`}
                      value={form[col.campo]}
                      onChange={cambiar(col.campo)}
                      placeholder="0,00"
                      autoComplete="off"
                    />
                  </Field>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-slate-400">
                Se guardan tal cual: la conversión a la otra moneda es sólo de la vista. Vacío =
                no declarado (se muestra «—»).
              </p>
              {/* El compensatorio NO se carga: acá se le muestra al que
                  llena el formulario cuánto va a dar la resta. */}
              <p className="mt-1 text-[11px] text-slate-500">
                Bono compensatorio (calculado, no se guarda):{' '}
                <span className="font-bold text-primary-700">
                  {compensatorioPrevio == null ? '—' : `${formato(compensatorioPrevio)} USD`}
                </span>{' '}
                = paquete aprobado − (salario + traslado + asistencia + cestatickets), con los BS
                en USD por la tasa.
              </p>
            </div>
          </div>
        ) : (
          <Spinner />
        )}
      </Modal>

      <Confirmar
        open={!!aBorrar}
        texto={`¿Borrar la fila de «${aBorrar?.cargo}» del tabulador?`}
        textoConfirmar="Sí, borrar"
        onConfirm={() => void borrar()}
        onCancel={() => setABorrar(null)}
      />
    </div>
  )
}
