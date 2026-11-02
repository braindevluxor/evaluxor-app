import { useEffect, useState, type FormEvent } from 'react'
import { ShieldCheck } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { ETIQUETAS_ROL } from '../lib/roles'
import { Badge, Button, Card, Field, Input, Modal, cn } from '../components/ui'
import { PortalCabecera } from '../components/PortalCabecera'
import { TarjetaVersionApp } from '../components/VersionApp'
import { confirmarConfigTotp, desactivarTotp, factorsTotpActivos, iniciarConfigTotp } from '../lib/mfa'
import type { FactorTotp } from '../lib/mfa'

/**
 * CONFIGURACIÓN DE LA CUENTA
 * --------------------------
 * Dos pestañas, porque son dos preguntas distintas: «quién soy» (Perfil) y
 * «cómo protejo el acceso» (Seguridad). Antes vivían en una sola columna
 * larga donde la contraseña y el correo se mezclaban con el 2FA.
 *
 * El nombre y el usuario son de la nómina y NO se editan acá: los asigna la
 * administración, y un campo editable que la base no acepta sería una mentira
 * en la pantalla justa. El correo sí se edita porque es el que usa Supabase
 * Auth para iniciar sesión y avisar.
 */

type Pestana = 'perfil' | 'seguridad'

const PESTANAS: { id: Pestana; texto: string; bajada: string }[] = [
  { id: 'perfil', texto: 'Perfil', bajada: 'Consulta tus datos institucionales y gestiona tu información de contacto' },
  { id: 'seguridad', texto: 'Seguridad', bajada: 'Contraseña y verificación en dos pasos' }
]

export function PerfilPage() {
  const { profile, session, cambiarPassword } = useAuth()
  const [pestana, setPestana] = useState<Pestana>('perfil')

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

  const emailActual = session?.user?.email || profile?.email || ''
  const [correo, setCorreo] = useState(emailActual)
  const [guardandoCorreo, setGuardandoCorreo] = useState(false)
  const [msgCorreo, setMsgCorreo] = useState<{ tipo: 'ok' | 'err'; texto: string } | null>(null)
  const correoCambiado = correo.trim() !== emailActual

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

  const guardarCorreo = async () => {
    if (!correoCambiado) return
    setGuardandoCorreo(true)
    setMsgCorreo(null)
    const { error } = await supabase.auth.updateUser({ email: correo.trim() })
    setGuardandoCorreo(false)
    if (error) {
      setMsgCorreo({ tipo: 'err', texto: error.message })
      return
    }
    setMsgCorreo({
      tipo: 'ok',
      texto: 'Correo actualizado. Revisa ambas bandejas: el cambio se confirma desde un enlace que llega al correo nuevo.'
    })
  }

  const totpActiva = totps.length > 0
  const nombre = profile?.nombre || 'Sin nombre'
  const inicial = (nombre || profile?.email || 'U').slice(0, 1).toUpperCase()

  return (
    // Sin título ni «Volver» propios: los pone la cabecera de la consola
    // (`titulosVista` en ConsoleLayout) y el menú lateral. Tampoco trae padding
    // ni ancho máximo: ya los trae el `<main>` del layout.
    <div className="mx-auto max-w-5xl">
      {/* Las secciones se eligen en el selector de la BARRA SUPERIOR, junto a
          Filtros: es el mismo portal y la misma píldora que usa Unidades para
          sus pestañas. Sacadas del cuerpo de la página porque ocupaban una
          columna entera de 200px para dos palabras. */}
      <PortalCabecera>
        <div role="group" aria-label="Secciones de configuración" className="flex p-1 bg-slate-100 rounded-xl">
          {PESTANAS.map((p) => (
            <Button
              key={p.id}
              type="button"
              variant="ghost"
              aria-pressed={pestana === p.id}
              onClick={() => setPestana(p.id)}
              className={cn(
                'rounded-lg px-4 py-1.5 text-xs transition-all',
                pestana === p.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              )}
            >
              {p.texto}
            </Button>
          ))}
        </div>
      </PortalCabecera>

      <div className="min-w-0">
          {pestana === 'perfil' ? (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-bold text-primary-900">Perfil</h2>
                <p className="text-sm text-slate-500">
                  {PESTANAS[0].bajada}
                </p>
              </div>

              {/* La identidad, con el avatar a la izquierda como en la app. */}
              <Card>
                <div className="flex items-center gap-4">
                  <div className="grid h-20 w-20 shrink-0 place-items-center rounded-full bg-primary-900 text-3xl font-black text-white" aria-hidden>
                    {inicial}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-xl font-extrabold text-primary-900">{nombre}</p>
                      <Badge color={profile?.rol === 'LIDER' ? 2 : 0}>
                        {ETIQUETAS_ROL[profile?.rol ?? 'SIN_ROL']}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">Usuario: {profile?.usuario || '—'}</p>
                    <p className="text-sm text-slate-500">{emailActual || '—'}</p>
                  </div>
                </div>
              </Card>

              <Card className="space-y-4">
                <div>
                  <h3 className="text-base font-bold text-slate-800">Información de acceso y contacto</h3>
                  <p className="text-sm text-slate-500">
                    Gestiona tu correo electrónico para inicio de sesión y comunicaciones oficiales
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Nombre institucional"
                    hint="Para corregir tu nombre institucional, contacta a la administración."
                  >
                    <Input value={nombre} disabled readOnly />
                  </Field>
                  <Field
                    label="Correo electrónico"
                    hint="Dirección empleada para iniciar sesión y recibir notificaciones."
                  >
                    <Input
                      type="email"
                      value={correo}
                      onChange={(e) => setCorreo(e.target.value)}
                      placeholder="tu@correo.com"
                    />
                  </Field>
                </div>
                {msgCorreo ? (
                  <div className={`rounded-xl border px-3 py-2 text-sm ${msgCorreo.tipo === 'ok' ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
                    {msgCorreo.texto}
                  </div>
                ) : null}
              </Card>

              {/* Lo que la aplicación sabe de vos y que nadie edita desde acá:
                  es el dato que usa el resto de las pantallas para dirigirse a
                  la persona correcta. */}
              <Card className="space-y-4">
                <div>
                  <h3 className="text-base font-bold text-slate-800">Identidad institucional</h3>
                  <p className="text-sm text-slate-500">Datos asignados y administrados por la institución</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {[
                    { rotulo: 'Nombre completo', valor: nombre },
                    { rotulo: 'Usuario', valor: profile?.usuario || '—' },
                    { rotulo: 'Rol en la aplicación', valor: ETIQUETAS_ROL[profile?.rol ?? 'SIN_ROL'] },
                    { rotulo: 'Correo de acceso', valor: emailActual || '—' }
                  ].map((d) => (
                    <div key={d.rotulo} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{d.rotulo}</p>
                      <p className="mt-1 truncate text-sm font-semibold text-slate-800" title={d.valor}>{d.valor}</p>
                    </div>
                  ))}
                </div>
              </Card>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
                <p className="text-sm text-slate-500">Los cambios de correo se aplican al confirmar el enlace que llega a las dos bandejas.</p>
                <Button onClick={() => void guardarCorreo()} disabled={!correoCambiado || guardandoCorreo}>
                  {guardandoCorreo ? 'Guardando…' : 'Guardar cambios'}
                </Button>
              </div>

              <TarjetaVersionApp />
            </div>
          ) : (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-bold text-primary-900">Seguridad</h2>
                <p className="text-sm text-slate-500">{PESTANAS[1].bajada}</p>
              </div>

              <Card>
                <h3 className="mb-3 text-base font-bold text-slate-800">Verificación en dos pasos</h3>

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

              <TarjetaVersionApp />
            </div>
          )}
      </div>

      <Modal
        open={configAbierto}
        onClose={() => setConfigAbierto(false)}
        title="Activar verificación en dos pasos"
        footer={
          config ? (
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setConfigAbierto(false)} disabled={cargandoTotp}>
                Cancelar
              </Button>
              <Button type="submit" form="form-totp-config" disabled={cargandoTotp}>
                {cargandoTotp ? 'Verificando…' : 'Activar'}
              </Button>
            </div>
          ) : undefined
        }
      >
        {config ? (
          <form id="form-totp-config" onSubmit={confirmarConfig} className="space-y-4">
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
          </form>
        ) : (
          <p className="text-sm text-slate-500">Generando código QR…</p>
        )}
      </Modal>

      <Modal
        open={desAbierto}
        onClose={() => setDesAbierto(false)}
        title="Desactivar verificación en dos pasos"
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setDesAbierto(false)} disabled={cargandoTotp}>
              Cancelar
            </Button>
            <Button type="submit" form="form-totp-des" variant="danger" disabled={cargandoTotp}>
              {cargandoTotp ? 'Desactivando…' : 'Desactivar'}
            </Button>
          </div>
        }
      >
        <form id="form-totp-des" onSubmit={desactivar} className="space-y-4">
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
        </form>
      </Modal>
    </div>
  )
}
