import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import type { Rol } from './lib/types'
import { AuthProvider } from './context/AuthContext'
import { CatalogProvider } from './context/CatalogContext'
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
import { Spinner } from './components/ui'

const EvaluarResumen = lazy(() => import('./pages/evaluar/EvaluarResumen').then((m) => ({ default: m.EvaluarResumen })))
const MisEvaluaciones = lazy(() => import('./pages/evaluar/MisEvaluaciones').then((m) => ({ default: m.MisEvaluaciones })))
const DashboardHome = lazy(() => import('./pages/dashboard/DashboardHome').then((m) => ({ default: m.DashboardHome })))
const Historial = lazy(() => import('./pages/dashboard/Historial').then((m) => ({ default: m.Historial })))
const SucursalesPage = lazy(() => import('./pages/config/Sucursales').then((m) => ({ default: m.SucursalesPage })))
const ModulosPage = lazy(() => import('./pages/config/Modulos').then((m) => ({ default: m.ModulosPage })))
const ItemsPage = lazy(() => import('./pages/config/Items').then((m) => ({ default: m.ItemsPage })))
const UsuariosPage = lazy(() => import('./pages/config/Usuarios').then((m) => ({ default: m.UsuariosPage })))
const AsignacionesPage = lazy(() => import('./pages/config/Asignaciones').then((m) => ({ default: m.AsignacionesPage })))

const ROLES_DASHBOARD: Rol[] = ['LIDER', 'GERENTE_S', 'GERENTE_C', 'GERENTE_TH']

function Susp() {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <Spinner className="h-8 w-8" />
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <OfflineProvider>
          <CatalogProvider>
            <Suspense fallback={<Susp />}>
              <Routes>
                <Route path="/" element={<HomeRedirect />} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="/registro" element={<RegisterPage />} />
                <Route path="/perfil" element={<RequireAuth><PerfilPage /></RequireAuth>} />
                <Route
                  path="/evaluaciones/:evaluacionId"
                  element={
                    <RequireAuth>
                      <RequireRol roles={[...ROLES_DASHBOARD, 'EVALUADOR']}>
                        <EvaluacionDetalle />
                      </RequireRol>
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
                  <Route path="/config/sucursales" element={<SoloLider><SucursalesPage /></SoloLider>} />
                  <Route path="/config/modulos" element={<SoloLider><ModulosPage /></SoloLider>} />
                  <Route path="/config/items" element={<SoloLider><ItemsPage /></SoloLider>} />
                  <Route path="/config/usuarios" element={<SoloLider><UsuariosPage /></SoloLider>} />
                  <Route path="/config/asignaciones" element={<SoloLider><AsignacionesPage /></SoloLider>} />
                </Route>

                <Route path="*" element={<HomeRedirect />} />
              </Routes>
            </Suspense>
          </CatalogProvider>
        </OfflineProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}