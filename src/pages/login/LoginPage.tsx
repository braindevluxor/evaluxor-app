import { useEffect, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ShieldCheck, ShoppingCart } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { homePorRol } from '../../lib/roles'
import { Button, Field, Input } from '../../components/ui'

export function LoginPage() {
  const { session, profile, signIn, verificarTotp, totpPendiente } = useAuth()
  const [usuario, setUsuario] = useState('')
  const [password, setPassword] = useState('')
  const [codigo, setCodigo] = useState('')
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
    const r = await signIn(usuario, password)
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
    <div className="flex min-h-screen items-center justify-center bg-primary px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center text-white">
          <div className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-2xl bg-white/10"><ShoppingCart className="h-8 w-8" /></div>
          <h1 className="text-3xl font-extrabold">EvaLuxor</h1>
          <p className="mt-1 text-sm text-primary-200">Evaluaciones 360 de supermercados</p>
        </div>

        {enTotp ? (
          <form onSubmit={onSubmitTotp} className="rounded-2xl bg-white p-6">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary" />
                <p className="text-sm font-semibold text-slate-800">Verificación en dos pasos</p>
              </div>
              <p className="text-sm text-slate-500">Ingresa el código de 6 dígitos de tu app de autenticación.</p>
              <Field label="Código">
                <Input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
                  required
                  placeholder="••••••"
                  className="text-center text-lg tracking-[0.5em]"
                  autoFocus
                />
              </Field>
              {error ? <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-600">{error}</p> : null}
              <Button type="submit" disabled={enviando} className="w-full">
                {enviando ? 'Verificando…' : 'Ingresar'}
              </Button>
            </div>
          </form>
        ) : (
          <form onSubmit={onSubmit} className="rounded-2xl bg-white p-6">
            <div className="space-y-4">
              <Field label="Usuario">
                <Input type="text" autoComplete="username" value={usuario} onChange={(e) => setUsuario(e.target.value)} required placeholder="tu.usuario" />
              </Field>
              <Field label="Contraseña">
                <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="••••••••" />
              </Field>
              {error ? <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-600">{error}</p> : null}
              <Button type="submit" disabled={enviando} className="w-full">
                {enviando ? 'Ingresando…' : 'Ingresar'}
              </Button>
              <p className="text-center text-xs text-slate-400">
                ¿No tienes cuenta? Solo se accede por invitación del Líder.
              </p>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}