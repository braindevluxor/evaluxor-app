import { useEffect, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { homePorRol } from '../../lib/roles'
import { Button, Field, Input } from '../../components/ui'

export function LoginPage() {
  const { session, profile, signIn } = useAuth()
  const [usuario, setUsuario] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  const navigate = useNavigate()
  const location = useLocation() as { state?: { from?: { pathname?: string } } }

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
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-primary px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center text-white">
          <div className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-2xl bg-white/10 text-3xl">🛒</div>
          <h1 className="text-3xl font-extrabold">EvaLuxor</h1>
          <p className="mt-1 text-sm text-primary-200">Evaluaciones 360 de supermercados</p>
        </div>
        <form onSubmit={onSubmit} className="rounded-2xl bg-white p-6 shadow-xl">
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
      </div>
    </div>
  )
}