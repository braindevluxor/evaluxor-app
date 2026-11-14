import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { Rol } from './lib/types'
import { AuthProvider } from './context/AuthContext'
import { CatalogProvider } from './context/CatalogContext'
import { VersionProvider } from './context/VersionContext'
import { OfflineProvider } from './context/OfflineContext'
import { RequireAuth, RequireRol, RequireSesion, SoloLider } from './components/guards'
import { ConsoleLayout } from './components/layouts/ConsoleLayout'
import { HomeRedirect, PendientePage } from './pages/PendientePage'
import { LoginPage } from './pages/login/LoginPage'
import { RegisterPage } from './pages/login/RegisterPage'
import { PerfilPage } from './pages/PerfilPage'
import { EvaluarHome } from './pages/evaluar/EvaluarHome'
import { EvaluarSucursal } from './pages/evaluar/EvaluarSucursal'
import { EvaluacionDetalle } from './pages/EvaluacionDetalle'
import { EditarConciliacion } from './pages/EditarConciliacion'
import { CargadorPantalla } from './components/ui'
import { AvisoHost } from './components/AvisoHost'
import { ErrorBoundary } from './components/ErrorBoundary'

const EvaluarResumen = lazy(() => import('./pages/evaluar/EvaluarResumen').then((m) => ({ default: m.EvaluarResumen })))
const MisEvaluaciones = lazy(() => import('./pages/evaluar/MisEvaluaciones').then((m) => ({ default: m.MisEvaluaciones })))
const IncidenciasPage = lazy(() => import('./pages/evaluar/IncidenciasPage').then((m) => ({ default: m.IncidenciasPage })))
const DashboardHome = lazy(() => import('./pages/dashboard/DashboardHome').then((m) => ({ default: m.DashboardHome })))
const Historial = lazy(() => import('./pages/dashboard/Historial').then((m) => ({ default: m.Historial })))
const Comparativas = lazy(() => import('./pages/dashboard/Comparativas').then((m) => ({ default: m.Comparativas })))
const Responsables = lazy(() => import('./pages/dashboard/Responsables').then((m) => ({ default: m.Responsables })))
const ModuloDashboard = lazy(() => import('./pages/dashboard/ModuloDashboard').then((m) => ({ default: m.ModuloDashboard })))
const UnidadesPage = lazy(() => import('./pages/config/Unidades').then((m) => ({ default: m.UnidadesPage })))
const ModulosPage = lazy(() => import('./pages/config/Modulos').then((m) => ({ default: m.ModulosPage })))
const ItemsPage = lazy(() => import('./pages/config/Items').then((m) => ({ default: m.ItemsPage })))
const UsuariosPage = lazy(() => import('./pages/config/Usuarios').then((m) => ({ default: m.UsuariosPage })))
// Bonos por desempeño: qué cargos gozan de bono y el pago de los mismos.
const BonosPage = lazy(() => import('./pages/config/Bonos').then((m) => ({ default: m.BonosPage })))
// Gran Cosecha: el concurso trimestral de proyectos. Sin `RequireRol` —lo
// crean los trabajadores y lo siguen los jueces— pero con lazy, porque es la
// única pantalla que no entra nadie si no entra a la consola.
const GranCosechaPage = lazy(() => import('./pages/GranCosecha').then((m) => ({ default: m.GranCosechaPage })))
// El editor del contenido que publica la landing (bases, calendario, premios,
// jurado, FAQ y ganadores): sólo JUEZ y LÍDER, la misma cerradura que la RLS
// de `gran_cosecha_contenido`.
const GranCosechaContenido = lazy(() =>
  import('./pages/GranCosechaContenido').then((m) => ({ default: m.GranCosechaContenido }))
)
// Pantalla de invitado: la conciliación de UNA evaluación para quien no tiene
// cuenta. Va con lazy porque sólo se descarga quien abre el enlace.
const ConciliacionPublica = lazy(() =>
  import('./pages/publico/ConciliacionPublica').then((m) => ({ default: m.ConciliacionPublica }))
)
// La landing del concurso trimestral: pública como las de arriba.
const ConcursoPublico = lazy(() =>
  import('./pages/publico/ConcursoPublico').then((m) => ({ default: m.ConcursoPublico }))
)
// La otra de invitado: las fallas por cargo (la bitácora de atención del
// trabajador), también con lazy.
const CargosPublicos = lazy(() =>
  import('./pages/publico/CargosPublicos').then((m) => ({ default: m.CargosPublicos }))
)
// Inspección de vehículo (estética + mecánica + gas vehicular): herramienta
// fuera de la evaluación, con fotos, registro local y PDF.
const InspeccionVehiculo = lazy(() =>
  import('./pages/herramientas/InspeccionVehiculo').then((m) => ({ default: m.InspeccionVehiculo }))
)
// Su historial: misma puerta y mismo flujo móvil; de ahí se reabre cualquier
// inspección anterior para regenerar su PDF.
const InspeccionHistorial = lazy(() =>
  import('./pages/herramientas/InspeccionHistorial').then((m) => ({ default: m.InspeccionHistorial }))
)
// Revisión Pre-Entrega: fuera del menú y de las rutas por decisión de producto;
// el módulo (`pages/herramientas/RevisionPreEntrega`) sigue en el repo.

const ROLES_DASHBOARD: Rol[] = ['LIDER', 'GERENTE_S', 'GERENTE_C', 'GERENTE_TH', 'EVALUADOR']

function Susp() {
  // A pantalla completa: si el cargador cubriera sólo una parte, debajo se
  // vería el fondo del documento y el arranque se leía como dos colores.
  return <CargadorPantalla completa />
}

/** Envuelve las rutas en un error boundary que se limpia al navegar: si algo
 *  lanza durante el render de una pantalla, se muestra el fallback en vez de
 *  dejar la app en blanco, y cambiar de ruta reintenta solo. */
function Rutas() {
  const location = useLocation()
  return (
    <ErrorBoundary resetKey={location.pathname}>
      <Suspense fallback={<Susp />}>
        <Routes>
                    <Route path="/" element={<HomeRedirect />} />
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/registro" element={<RegisterPage />} />
                    {/* Sin `RequireAuth` a propósito: es el enlace que un Líder
                        le pasa al coordinador de inventario para que vea la
                        conciliación sin tener cuenta. La autorización es el
                        token, y sólo da lectura — ver `supabase/compartir-evaluacion.sql`. */}
                    {/* Enlace de INVITADO: la otra pantalla pública, con su
                        propia ruta para no pisar el de conciliación. */}
                    {/* Landing pública del concurso: se comparte por WhatsApp y
                        se abre SIN cuenta — lee por ver_concurso_publico, que es
                        SECURITY DEFINER y no toca permisos de tabla de anon. */}
                    <Route path="/concurso" element={<ConcursoPublico />} />
                    <Route path="/compartir/cargos/:token" element={<CargosPublicos />} />
                    <Route path="/compartir/:token" element={<ConciliacionPublica />} />
                    <Route
                      path="/evaluaciones/:evaluacionId"
                      element={
                        <RequireAuth loadingFallback={<CargadorPantalla completa />}>
                          <RequireRol roles={[...ROLES_DASHBOARD, 'EVALUADOR']}>
                            <EvaluacionDetalle />
                          </RequireRol>
                        </RequireAuth>
                      }
                    />
                    <Route
                      path="/evaluaciones/:evaluacionId/conciliacion"
                      element={
                        <RequireAuth>
                          <SoloLider>
                            <EditarConciliacion />
                          </SoloLider>
                        </RequireAuth>
                      }
                    />
                    <Route path="/pendiente" element={<RequireSesion><PendientePage /></RequireSesion>} />

                    <Route
                      path="/evaluar"
                      element={
                        <RequireAuth>
                          <RequireRol roles={['EVALUADOR', 'LIDER']}>
                            <EvaluarHome />
                          </RequireRol>
                        </RequireAuth>
                      }
                    />
                    <Route
                      path="/evaluar/historial"
                      element={
                        <RequireAuth>
                          <RequireRol roles={['EVALUADOR', 'LIDER']}>
                            <MisEvaluaciones />
                          </RequireRol>
                        </RequireAuth>
                      }
                    />
                    <Route
                      path="/evaluar/incidencias"
                      element={
                        <RequireAuth>
                          <RequireRol roles={['EVALUADOR', 'LIDER']}>
                            <IncidenciasPage />
                          </RequireRol>
                        </RequireAuth>
                      }
                    />
                    {/* Inspección de vehículo particular: misma puerta que la
                        evaluación y en el mismo flujo móvil (se llena desde el
                        teléfono), pero sin evaluación detrás — se llena y se
                        imprime. No tiene sucursal: no es de ninguna unidad. */}
                    <Route
                      path="/evaluar/inspeccion-vehiculo"
                      element={
                        <RequireAuth>
                          <RequireRol roles={['EVALUADOR', 'LIDER']}>
                            <InspeccionVehiculo />
                          </RequireRol>
                        </RequireAuth>
                      }
                    />
                    {/* El historial de esas inspecciones: misma puerta. Las
                        filas reabren la herramienta con ?registro=<id>. */}
                    <Route
                      path="/evaluar/inspeccion-vehiculo/historial"
                      element={
                        <RequireAuth>
                          <RequireRol roles={['EVALUADOR', 'LIDER']}>
                            <InspeccionHistorial />
                          </RequireRol>
                        </RequireAuth>
                      }
                    />

                    {/* La herramienta Revisión Pre-Entrega quedó fuera del menú y
                        de las rutas: se rearmará aparte. El código y la tabla
                        siguen intactos, así que volver es reponer este Route. */}
                    {/* El mismo flujo de evaluación, pero sobre un departamento
                        centralizado: la unidad se lee de la ruta. */}
                    <Route
                      path="/evaluar/departamento/:departamentoId"
                      element={
                        <RequireAuth>
                          <RequireRol roles={['EVALUADOR', 'LIDER']}>
                            <EvaluarSucursal />
                          </RequireRol>
                        </RequireAuth>
                      }
                    />
                    <Route
                      path="/evaluar/departamento/:departamentoId/resumen"
                      element={
                        <RequireAuth>
                          <RequireRol roles={['EVALUADOR', 'LIDER']}>
                            <EvaluarResumen />
                          </RequireRol>
                        </RequireAuth>
                      }
                    />
                    <Route
                      path="/evaluar/:sucursalId"
                      element={
                        <RequireAuth>
                          <RequireRol roles={['EVALUADOR', 'LIDER']}>
                            <EvaluarSucursal />
                          </RequireRol>
                        </RequireAuth>
                      }
                    />
                    <Route
                      path="/evaluar/:sucursalId/resumen"
                      element={
                        <RequireAuth>
                          <RequireRol roles={['EVALUADOR', 'LIDER']}>
                            <EvaluarResumen />
                          </RequireRol>
                        </RequireAuth>
                      }
                    />

                    <Route
                      element={
                        <RequireAuth>
                          <ConsoleLayout />
                        </RequireAuth>
                      }
                    >
                      <Route
                        path="/dashboard"
                        element={
                          <RequireRol roles={ROLES_DASHBOARD}>
                            <DashboardHome />
                          </RequireRol>
                        }
                      />
                      <Route
                        path="/dashboard/historial"
                        element={
                          <RequireRol roles={ROLES_DASHBOARD}>
                            <Historial />
                          </RequireRol>
                        }
                      />
                      <Route
                        path="/dashboard/comparativas"
                        element={
                          <RequireRol roles={ROLES_DASHBOARD}>
                            <Comparativas />
                          </RequireRol>
                        }
                      />
                      <Route
                        path="/dashboard/responsables"
                        element={
                          <SoloLider>
                            <Responsables />
                          </SoloLider>
                        }
                      />
                      <Route
                        path="/dashboard/modulo/:moduloId"
                        element={
                          <RequireRol roles={ROLES_DASHBOARD}>
                            <ModuloDashboard />
                          </RequireRol>
                        }
                      />
                      <Route path="/config/unidades" element={<SoloLider><UnidadesPage /></SoloLider>} />
                      {/* Módulos se abre al EVALUADOR en modo consulta: necesita
                          descargar la explicación de cada módulo (PDF de
                          metodología). La escritura la decide la página con
                          `soloLectura` y, de última, el RLS (`modulos_lider` /
                          `items_lider`) bloquea cualquier cambio. */}
                      <Route
                        path="/config/modulos"
                        element={
                          <RequireRol roles={['EVALUADOR', 'LIDER']}>
                            <ModulosPage />
                          </RequireRol>
                        }
                      />
                      <Route path="/config/items" element={<SoloLider><ItemsPage /></SoloLider>} />
                      <Route path="/config/usuarios" element={<SoloLider><UsuariosPage /></SoloLider>} />
                      {/* Bonos por desempeño: es manejo de plata de RRHH, así
                          que entran los DOS roles que lo gestionan —LÍDER y
                          GERENTE TH— y el RLS (`puede_bonos`) vuelve a pedir
                          lo mismo desde la base. */}
                      <Route
                        path="/config/bonos"
                        element={
                          <RequireRol roles={['LIDER', 'GERENTE_TH']}>
                            <BonosPage />
                          </RequireRol>
                        }
                      />
                      {/* La cuenta de cualquiera que haya entrado: por eso no
                          lleva `RequireRol`. Va adentro de la consola para que
                          se vea con su barra y su menú, igual que el resto. */}
                      <Route path="/perfil" element={<PerfilPage />} />
                      {/* Gran Cosecha es de TODA la empresa: cualquiera con
                          sesión presenta su proyecto y cualquiera lo mira; el
                          seguimiento lo dan los jueces, que entra por el mismo
                          RLS (`puede_gran_cosecha`) que pide el menú. */}
                      <Route path="/gran-cosecha" element={<GranCosechaPage />} />
                      {/* Lo que se PUBLICA en la landing pública: el mismo
                          contenido que se ve en /concurso, editado sin tocar
                          SQL. `RequireRol` con JUEZ y LÍDER, igual que la
                          política de la tabla. */}
                      <Route
                        path="/gran-cosecha/contenido"
                        element={
                          <RequireRol roles={['JUEZ', 'LIDER']}>
                            <GranCosechaContenido />
                          </RequireRol>
                        }
                      />
                    </Route>

                    <Route path="*" element={<HomeRedirect />} />
                  </Routes>
      </Suspense>
    </ErrorBoundary>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <OfflineProvider>
          <CatalogProvider>
            {/* Versión: avisa (o actualiza sola) cuando hay una build nueva en
                el servidor, sin cortar a quien está evaluando. */}
            <VersionProvider>
              <Rutas />
              {/* El cartel flotante de confirmaciones va fuera de las rutas:
                  cambia de pantalla no debe apagar lo que se está avisando. */}
              <AvisoHost />
            </VersionProvider>
          </CatalogProvider>
        </OfflineProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
