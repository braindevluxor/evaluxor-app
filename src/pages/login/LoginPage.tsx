import { useEffect, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Check, Eye, EyeOff, ShieldCheck } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { homePorRol } from '../../lib/roles'
import { Button, Field, Input } from '../../components/ui'
import { AuthShell, MarcaAuth, botonAuth, inputAuth, labelAuth } from '../../components/auth/AuthShell'

export function LoginPage() {
  const { session, profile, signIn, verificarTotp, totpPendiente } = useAuth()
  const [usuario, setUsuario] = useState('')
  const [password, setPassword] = useState('')
  const [codigo, setCodigo] = useState('')
  const [recordar, setRecordar] = useState(true)
  const [ver, setVer] = useState(false)
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [pasoTotp, setPasoTotp] = useState(false)
  const navigate = useNavigate()
  const location = useLocation() as { state?: { from?: { pathname?: string } } }

  const enTotp = pasoTotp || totpPendiente

  useEffect(() => {
    if (session && profile) {
      const destino = location.state?.from?.pathname || homePorRol(profile.rol)
      navigate(destino, { replace: true })
    }
  }, [session, profile, navigate, location.state?.from?.pathname])

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

  return (
    <AuthShell>
      <MarcaAuth titulo="EvaLuxor" subtitulo="Evaluaciones 360 de supermercados" />

      {enTotp ? (
        <form onSubmit={onSubmitTotp} className="space-y-5">
          <div className="flex items-center gap-2 text-white">
            <ShieldCheck className="h-5 w-5 text-primary-200" />
            <p className="text-sm font-semibold">Verificación en dos pasos</p>
          </div>
          <p className="text-sm leading-relaxed text-primary-200/90">
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
            <p className="rounded-xl border border-red-400/30 bg-red-500/15 px-3 py-2 text-sm font-medium text-red-200">{error}</p>
          ) : null}
          <Button type="submit" disabled={enviando} className={botonAuth}>
            {enviando ? 'Verificando…' : 'Ingresar'}
          </Button>
        </form>
      ) : (
        <form onSubmit={onSubmit} className="space-y-5">
          <Field label="Usuario" labelClassName={labelAuth}>
            <Input
              type="text"
              autoComplete="username"
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              required
              placeholder="tu.usuario"
              className={inputAuth}
            />
          </Field>
          <Field label="Contraseña" labelClassName={labelAuth}>
            <div className="relative">
              <Input
                type={ver ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                className={`${inputAuth} pr-11!`}
              />
              <button
                type="button"
                onClick={() => setVer((v) => !v)}
                aria-label={ver ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                aria-pressed={ver}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
              >
                {ver ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </Field>
          {error ? (
            <p className="rounded-xl border border-red-400/30 bg-red-500/15 px-3 py-2 text-sm font-medium text-red-200">{error}</p>
          ) : null}
          <div className="flex items-center justify-between gap-2">
            <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-primary-200">
              <input
                type="checkbox"
                checked={recordar}
                onChange={(e) => setRecordar(e.target.checked)}
                className="peer sr-only"
              />
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md border border-white/25 bg-white/10 transition-colors peer-checked:border-primary-300 peer-checked:bg-primary-400 peer-focus-visible:ring-2 peer-focus-visible:ring-white/25">
                {recordar ? <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} /> : null}
              </span>
              Recordarme
            </label>
          </div>
          <Button type="submit" disabled={enviando} className={botonAuth}>
            {enviando ? 'Ingresando…' : 'Ingresar'}
          </Button>
          <p className="pt-1 text-center text-xs text-primary-200/70">
            ¿No tienes cuenta? Solo se accede por invitación del Líder.
          </p>
        </form>
      )}
    </AuthShell>
  )
}