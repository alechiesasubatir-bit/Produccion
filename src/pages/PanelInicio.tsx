import { Encabezado } from './Encabezado'
import { ParedTanques } from './ParedTanques'

export function PanelInicio() {
  return (
    <div className="app">
      <Encabezado titulo="Panel" />
      <main className="contenido">
        <ParedTanques />
      </main>
    </div>
  )
}
