import { PlantaApp } from '../planta/PlantaApp'

// Lo mismo que ven las operarias en la tablet de planta, dentro del panel y en tamaño tablet.
export function VistaTablet({ demo = false }: { demo?: boolean }) {
  return (
    <section className="vista-tablet" aria-label="Vista de la tablet">
      <p className="vista-tablet-aviso">
        {demo
          ? 'Vista de la tablet con los datos de la demo: cualquier PIN funciona.'
          : 'Vista real de la tablet: lo que se haga acá con el PIN de una operaria queda registrado igual que en planta.'}
      </p>
      <div className="marco-tablet">
        <PlantaApp embebida />
      </div>
    </section>
  )
}
