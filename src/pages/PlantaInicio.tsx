import { Encabezado } from './Encabezado'
import { ParedTanques } from './ParedTanques'

export function PlantaInicio() {
  return (
    <div className="app">
      <Encabezado titulo="Planta" />
      <main className="contenido">
        <ParedTanques />
      </main>
    </div>
  )
}
