import { useEffect, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Check, Eye, EyeOff, ShieldCheck } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { homePorRol } from '../../lib/roles'
import { Button, Field, Input, Spinner } from '../../components/ui'
import { AuthShell, MarcaAuth, botonAuth, inputAuth, labelAuth } from '../../components/auth/AuthShell'

/**
 * PANTALLA DE ACCESO
 * ------------------
 * Tres caras, en este orden de prioridad:
 *
 *  1. RECUPERACIÓN: llegó el enlace por correo (evento PASSWORD_RECOVERY) y
 *     lo único que importa es definir la contraseña nueva. El login no se
 *     muestra para no mandar al usuario al dashboard a medio trámite.
 *  2. TOTP: el segundo factor, si la cuenta lo pide.
 *  3. LOGIN: usuario o correo —la identidad de Supabase es el correo y el
 *     usuario es su alias, así que el campo acepta las dos formas—, con el
 *     enlace de recuperación al lado de la contraseña.
 *
 * El encabezado (Bienvenido + bajada) es el mismo en las tres caras: cambia el
 * título y la bajada, no la estructura.
 */
export function LoginPage() {
  const {
    session,
    profile,
    signIn,
    verificarTotp,
    totpPendiente,
    recuperando,
    recuperarAcceso,
    definirNuevaContrasena
  } = useAuth()
  const [usuario, setUsuario] = useState('')
  const [password, setPassword] = useState('')
  const [codigo, setCodigo] = useState('')
  const [recordar, setRecordar] = useState(true)
  const [ver, setVer] = useState(false)
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [pasoTotp, setPasoTotp] = useState(false)
  // Recuperación: primero se pide el enlace, después (si el usuario hizo
  // clic en el correo) se define la contraseña.
  const [modoRecuperar, setModoRecuperar] = useState(false)
  const [entradaRecuperar, setEntradaRecuperar] = useState('')
  const [msgRecuperar, setMsgRecuperar] = useState<{ tipo: 'ok' | 'err'; texto: string } | null>(null)
  const [enviandoRecuperar, setEnviandoRecuperar] = useState(false)
  const [claveNueva, setClaveNueva] = useState('')
  const [claveRepetir, setClaveRepetir] = useState('')
  const [guardandoClave, setGuardandoClave] = useState(false)

  const navigate = useNavigate()
  const location = useLocation() as { state?: { from?: { pathname?: string } } }

  const enTotp = pasoTotp || totpPendiente

  useEffect(() => {
    // Con el enlace de recuperación en la mano NO se navega: si no, el usuario
    // aterrizaría en el dashboard sin haber definido la contraseña nueva.
    if (session && profile && !recuperando) {
      const destino = location.state?.from?.pathname || homePorRol(profile.rol)
      navigate(destino, { replace: true })
    }
  }, [session, profile, recuperando, navigate, location.state?.from?.pathname])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setEnviando(true)
    const r = await signIn(usuario, password, recordar)
    setEnviando(false)
    if (r.error) setError(r.error)
    else if (r.totp) setPasoTotp(true)
  }

  async function onSubmitTotp(e: FormEvent) {
    e.preventDefault()
    setError('')
    setEnviando(true)
    const r = await verificarTotp(codigo)
    setEnviando(false)
    if (r.error) setError(r.error)
    else setCodigo('')
  }

  async function pedirEnlace(e: FormEvent) {
    e.preventDefault()
    setMsgRecuperar(null)
    setEnviandoRecuperar(true)
    const r = await recuperarAcceso(entradaRecuperar)
    setEnviandoRecuperar(false)
    if (r.error) setMsgRecuperar({ tipo: 'err', texto: r.error })
    else
      setMsgRecuperar({
        tipo: 'ok',
        texto: 'Si la cuenta existe, te enviamos un enlace. Revisá la bandeja y también el correo no deseado.'
      })
  }

  async function guardarClaveNueva(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (claveNueva !== claveRepetir) {
      setError('Las contraseñas no coinciden.')
      return
    }
    setGuardandoClave(true)
    const r = await definirNuevaContrasena(claveNueva)
    setGuardandoClave(false)
    if (r.error) setError(r.error)
    else {
      setClaveNueva('')
      setClaveRepetir('')
    }
  }

  const encabezado = recuperando
    ? { titulo: 'Nueva contraseña', bajada: 'Elegí una contraseña nueva para tu cuenta.' }
    : modoRecuperar
      ? { titulo: 'Recuperar contraseña', bajada: 'Si la cuenta existe, te enviamos un enlace para definirla.' }
      : { titulo: 'Bienvenido', bajada: 'Ingresa a tu cuenta para continuar' }

  return (
    <AuthShell>
      <MarcaAuth titulo="EvaLuxor" soloLogo />

      <div className="mb-6">
        <h1 className="text-2xl font-extrabold tracking-tight text-primary-900">{encabezado.titulo}</h1>
        <p className="mt-1 text-sm text-slate-500">{encabezado.bajada}</p>
      </div>

      {recuperando ? (
        <form onSubmit={guardarClaveNueva} className="space-y-5">
          <div className="relative">
            <label htmlFor="clave-nueva" className="mb-1.5 block text-sm font-medium text-slate-700">
              Contraseña nueva
            </label>
            <Input
              id="clave-nueva"
              type={ver ? 'text' : 'password'}
              autoComplete="new-password"
              value={claveNueva}
              onChange={(e) => setClaveNueva(e.target.value)}
              required
              placeholder="••••••••"
              className={`${inputAuth} w-full pr-11!`}
            />
            <button
              type="button"
              onClick={() => setVer((v) => !v)}
              aria-label={ver ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              aria-pressed={ver}
              className="absolute right-3 bottom-2.5 rounded-full p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            >
              {ver ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          </div>
          <Field label="Repetir contraseña" labelClassName={labelAuth}>
            <Input
              type={ver ? 'text' : 'password'}
              autoComplete="new-password"
              value={claveRepetir}
              onChange={(e) => setClaveRepetir(e.target.value)}
              required
              placeholder="••••••••"
              className={`${inputAuth} w-full`}
            />
          </Field>
          {error ? (
            <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>
          ) : null}
          <Button type="submit" disabled={guardandoClave} className={botonAuth}>
            {guardandoClave ? (
              <>
                <Spinner size={16} light /> Guardando…
              </>
            ) : (
              'Guardar contraseña'
            )}
          </Button>
        </form>
      ) : enTotp ? (
        <form onSubmit={onSubmitTotp} className="space-y-5">
          <div className="flex items-center gap-2 text-primary-900">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <p className="text-sm font-semibold">Verificación en dos pasos</p>
          </div>
          <p className="text-sm leading-relaxed text-slate-500">
            Ingresa el código de 6 dígitos de tu app de autenticación.
          </p>
          <Field label="Código" labelClassName={labelAuth}>
            <Input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
              required
              placeholder="••••••"
              className={`${inputAuth} w-full text-center text-lg tracking-[0.5em]`}
              autoFocus
            />
          </Field>
          {error ? (
            <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>
          ) : null}
          <Button type="submit" disabled={enviando} className={botonAuth}>
            {enviando ? (
              <>
                <Spinner size={16} light /> Verificando…
              </>
            ) : (
              'Ingresar'
            )}
          </Button>
        </form>
      ) : modoRecuperar ? (
        <form onSubmit={pedirEnlace} className="space-y-5">
          <Field label="Usuario o correo" labelClassName={labelAuth}>
            <Input
              type="text"
              autoComplete="username"
              value={entradaRecuperar}
              onChange={(e) => setEntradaRecuperar(e.target.value)}
              required
              placeholder="tu.usuario o tu@email.com"
              className={inputAuth}
            />
          </Field>
          {msgRecuperar ? (
            <p
              className={`rounded-xl border px-3 py-2 text-sm font-medium ${
                msgRecuperar.tipo === 'ok'
                  ? 'border-green-200 bg-green-50 text-green-800'
                  : 'border-red-200 bg-red-50 text-red-700'
              }`}
            >
              {msgRecuperar.texto}
            </p>
          ) : null}
          <Button type="submit" disabled={enviandoRecuperar} className={botonAuth}>
            {enviandoRecuperar ? (
              <>
                <Spinner size={16} light /> Enviando…
              </>
            ) : (
              'Enviar enlace'
            )}
          </Button>
          <button
            type="button"
            onClick={() => {
              setModoRecuperar(false)
              setMsgRecuperar(null)
              setEntradaRecuperar('')
            }}
            className="w-full text-center text-sm font-medium text-primary hover:text-primary-700"
          >
            Volver al inicio de sesión
          </button>
        </form>
      ) : (
        <form onSubmit={onSubmit} className="space-y-5">
          <Field label="Correo electrónico" labelClassName={labelAuth}>
            <Input
              type="text"
              autoComplete="username"
              inputMode="email"
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              required
              placeholder="tu@email.com"
              className={inputAuth}
            />
          </Field>

          {/* La etiqueta y el enlace van en el mismo renglón: es donde los mira
              quien olvidó la clave. */}
          <div>
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <label htmlFor="clave" className="text-sm font-medium text-slate-700">
                Contraseña
              </label>
              <button
                type="button"
                onClick={() => {
                  setModoRecuperar(true)
                  setError('')
                  setMsgRecuperar(null)
                  setEntradaRecuperar(usuario)
                }}
                className="text-xs font-medium text-primary hover:text-primary-700"
              >
                ¿Olvidaste tu contraseña?
              </button>
            </div>
            <div className="relative">
              <Input
                id="clave"
                type={ver ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                className={`${inputAuth} w-full pr-11!`}
              />
              <button
                type="button"
                onClick={() => setVer((v) => !v)}
                aria-label={ver ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                aria-pressed={ver}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              >
                {ver ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </div>

          {error ? (
            <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>
          ) : null}

          <label className="flex w-fit cursor-pointer select-none items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={recordar}
              onChange={(e) => setRecordar(e.target.checked)}
              className="peer sr-only"
            />
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md border border-slate-300 bg-white transition-colors peer-checked:border-primary peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary/20">
              {recordar ? <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} /> : null}
            </span>
            Recordarme
          </label>

          <Button type="submit" disabled={enviando} className={botonAuth}>
            {enviando ? (
              <>
                <Spinner size={16} light /> Ingresando…
              </>
            ) : (
              'Iniciar sesión'
            )}
          </Button>
          <p className="pt-1 text-center text-xs text-slate-400">
            ¿No tienes cuenta? Solo se accede por invitación del Líder.
          </p>
        </form>
      )}
    </AuthShell>
  )
}
