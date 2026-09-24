import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { Badge, Button, Card, Field, Input, Modal } from '../components/ui'
import { confirmarConfigTotp, desactivarTotp, factorsTotpActivos, iniciarConfigTotp } from '../lib/mfa'
import type { FactorTotp } from '../lib/mfa'

export function PerfilPage() {
  const { profile, session, cambiarPassword } = useAuth()
  const [actual, setActual] = useState('')
  const [nueva, setNueva] = useState('')
  const [confirmar, setConfirmar] = useState('')
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'err'; texto: string } | null>(null)
  const [cargando, setCargando] = useState(false)

  const [totps, setTotps] = useState<FactorTotp[]>([])
  const [configAbierto, setConfigAbierto] = useState(false)
  const [config, setConfig] = useState<{ factorId: string; secret: string; qr: string } | null>(null)
  const [codigoConfig, setCodigoConfig] = useState('')
  const [desAbierto, setDesAbierto] = useState(false)
  const [codigoDes, setCodigoDes] = useState('')
  const [cargandoTotp, setCargandoTotp] = useState(false)
  const [msgTotp, setMsgTotp] = useState<{ tipo: 'ok' | 'err'; texto: string } | null>(null)

  const cargarTotps = async () => setTotps(await factorsTotpActivos())

  useEffect(() => {
    void cargarTotps()
  }, [])

  const abrirConfig = async () => {
    setMsgTotp(null)
    setCargandoTotp(true)
    try {
      const c = await iniciarConfigTotp()
      setConfig(c)
      setCodigoConfig('')
      setConfigAbierto(true)
    } catch (e) {
      setMsgTotp({ tipo: 'err', texto: e instanceof Error ? e.message : 'No se pudo iniciar la configuración.' })
    }
    setCargandoTotp(false)
  }

  const confirmarConfig = async (e: FormEvent) => {
    e.preventDefault()
    if (!config) return
    setMsgTotp(null)
    setCargandoTotp(true)
    try {
      await confirmarConfigTotp(config.factorId, codigoConfig)
      setMsgTotp({ tipo: 'ok', texto: 'Verificación en dos pasos activada. En tu próximo ingreso se te pedirá el código.' })
      setConfigAbierto(false)
      setConfig(null)
      setCodigoConfig('')
      await cargarTotps()
    } catch (e) {
      setMsgTotp({ tipo: 'err', texto: e instanceof Error ? e.message : 'El código no es válido.' })
    }
    setCargandoTotp(false)
  }

  const desactivar = async (e: FormEvent) => {
    e.preventDefault()
    setMsgTotp(null)
    setCargandoTotp(true)
    try {
      await desactivarTotp(codigoDes)
      setMsgTotp({ tipo: 'ok', texto: 'Verificación en dos pasos desactivada.' })
      setDesAbierto(false)
      setCodigoDes('')
      await cargarTotps()
    } catch (e) {
      setMsgTotp({ tipo: 'err', texto: e instanceof Error ? e.message : 'No se pudo desactivar.' })
    }
    setCargandoTotp(false)
  }

  const totpActiva = totps.length > 0

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-6">
      <div>
        <Link to={profile?.rol === 'EVALUADOR' ? '/evaluar' : '/dashboard'} className="text-sm text-primary hover:underline">
          ← Volver
        </Link>
        <h2 className="mt-1 text-xl font-extrabold text-primary-900">Mi perfil</h2>
      </div>

      <Card className="space-y-1">
        <p className="text-sm text-slate-500">Nombre</p>
        <p className="font-semibold text-slate-800">{profile?.nombre || '—'}</p>
        <p className="mt-2 text-sm text-slate-500">Usuario</p>
        <p className="font-semibold text-slate-800">{profile?.usuario || '—'}</p>
        <p className="mt-2 text-sm text-slate-500">Correo</p>
        <p className="font-semibold text-slate-800">{session?.user?.email || profile?.email || '—'}</p>
      </Card>

      <Card>
        <h3 className="mb-3 text-base font-bold text-slate-800">Seguridad</h3>

        {msgTotp ? (
          <div className={`mb-3 rounded-xl border px-3 py-2 text-sm ${msgTotp.tipo === 'ok' ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
            {msgTotp.texto}
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary-50">
              <ShieldCheck className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800">Verificación en dos pasos</p>
              <p className="text-xs text-slate-500">Inicio de sesión con código TOTP de tu app de autenticación.</p>
              <div className="mt-1">
                <Badge color={totpActiva ? 2 : 0}>{totpActiva ? 'Activo' : 'No configurado'}</Badge>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-3 flex gap-2">
          {totpActiva ? (
            <Button variant="secondary" onClick={() => setDesAbierto(true)} disabled={cargandoTotp}>
              Desactivar
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => void abrirConfig()} disabled={cargandoTotp}>
              {cargandoTotp ? 'Generando…' : 'Activar con autenticador'}
            </Button>
          )}
        </div>
      </Card>

      <Card>
        <h3 className="mb-3 text-base font-bold text-slate-800">Cambiar contraseña</h3>

        {msg ? (
          <div className={`mb-3 rounded-xl border px-3 py-2 text-sm ${msg.tipo === 'ok' ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
            {msg.texto}
          </div>
        ) : null}

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            void (async () => {
              if (nueva.length < 6) {
                setMsg({ tipo: 'err', texto: 'La nueva contraseña debe tener al menos 6 caracteres.' })
                return
              }
              if (nueva !== confirmar) {
                setMsg({ tipo: 'err', texto: 'Las contraseñas no coinciden.' })
                return
              }
              setCargando(true)
              setMsg(null)
              const r = await cambiarPassword(actual, nueva)
              setCargando(false)
              if (r.error) {
                setMsg({ tipo: 'err', texto: r.error })
              } else {
                setMsg({ tipo: 'ok', texto: 'Contraseña actualizada correctamente.' })
                setActual('')
                setNueva('')
                setConfirmar('')
              }
            })()
          }}
        >
          <Field label="Contraseña actual">
            <Input type="password" value={actual} onChange={(e) => setActual(e.target.value)} required placeholder="••••••••" />
          </Field>
          <Field label="Nueva contraseña" hint="Mínimo 6 caracteres">
            <Input type="password" value={nueva} onChange={(e) => setNueva(e.target.value)} required placeholder="••••••••" />
          </Field>
          <Field label="Confirmar nueva contraseña">
            <Input type="password" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} required placeholder="••••••••" />
          </Field>
          <Button type="submit" className="w-full" disabled={cargando}>
            {cargando ? 'Guardando…' : 'Actualizar contraseña'}
          </Button>
        </form>
      </Card>

      <Modal
        open={configAbierto}
        onClose={() => setConfigAbierto(false)}
        title="Activar verificación en dos pasos"
        sinCerrarFuera
      >
        {config ? (
          <form onSubmit={confirmarConfig} className="space-y-4">
            <div className="grid place-items-center rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <img src={config.qr} alt="Código QR para tu autenticador" className="h-52 w-52" />
            </div>
            <p className="text-sm text-slate-600">
              Escanea el código QR con tu app de autenticación (Google Authenticator, Authy, etc.) o ingresa la clave manualmente:
            </p>
            <p className="break-all rounded-xl bg-slate-100 px-3 py-2 font-mono text-xs text-slate-700">{config.secret}</p>
            <Field label="Código de 6 dígitos" hint="Se genera en tu app después de escanear el QR.">
              <Input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={codigoConfig}
                onChange={(e) => setCodigoConfig(e.target.value.replace(/\D/g, ''))}
                required
                placeholder="••••••"
                className="text-center text-lg tracking-[0.5em]"
                autoFocus
              />
            </Field>
            {msgTotp?.tipo === 'err' ? <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-600">{msgTotp.texto}</p> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setConfigAbierto(false)} disabled={cargandoTotp}>
                Cancelar
              </Button>
              <Button type="submit" disabled={cargandoTotp}>
                {cargandoTotp ? 'Verificando…' : 'Activar'}
              </Button>
            </div>
          </form>
        ) : (
          <p className="text-sm text-slate-500">Generando código QR…</p>
        )}
      </Modal>

      <Modal open={desAbierto} onClose={() => setDesAbierto(false)} title="Desactivar verificación en dos pasos">
        <form onSubmit={desactivar} className="space-y-4">
          <p className="text-sm text-slate-600">
            Ingresa el código actual de tu app de autenticación para confirmar que eres tú.
          </p>
          <Field label="Código de 6 dígitos">
            <Input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={codigoDes}
              onChange={(e) => setCodigoDes(e.target.value.replace(/\D/g, ''))}
              required
              placeholder="••••••"
              className="text-center text-lg tracking-[0.5em]"
            />
          </Field>
          {msgTotp?.tipo === 'err' ? <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-600">{msgTotp.texto}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setDesAbierto(false)} disabled={cargandoTotp}>
              Cancelar
            </Button>
            <Button type="submit" variant="danger" disabled={cargandoTotp}>
              {cargandoTotp ? 'Desactivando…' : 'Desactivar'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}