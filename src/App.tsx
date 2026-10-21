import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Login } from './auth/Login'
import { Cargando, RequireRol, SinAcceso } from './auth/RequireRol'
import { SesionProvider, useSesion } from './auth/useSesion'
import { PanelInicio } from './pages/PanelInicio'
import { PlantaInicio } from './pages/PlantaInicio'
import './ui/app.css'

function Inicio() {
  const { cargando, usuario, rol } = useSesion()
  if (cargando) return <Cargando />
  if (!usuario) return <Navigate to="/login" replace />
  if (rol === 'panel') return <Navigate to="/panel" replace />
  if (rol === 'planta') return <Navigate to="/planta" replace />
  return <SinAcceso />
}

function App() {
  return (
    <SesionProvider>
      <BrowserRouter basename="/Produccion">
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/panel"
            element={
              <RequireRol rol="panel">
                <PanelInicio />
              </RequireRol>
            }
          />
          <Route
            path="/planta"
            element={
              <RequireRol rol="planta">
                <PlantaInicio />
              </RequireRol>
            }
          />
          <Route path="*" element={<Inicio />} />
        </Routes>
      </BrowserRouter>
    </SesionProvider>
  )
}

export default App
