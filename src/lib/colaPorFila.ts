// Encadena las tareas de una misma fila: la siguiente arranca recién cuando termina la anterior.
// Así dos guardados seguidos de la misma MP (salir del lote y tildar pesado) llegan a la base
// en el orden en que se hicieron y el último valor es el que queda.
export function crearColaPorFila() {
  const colas = new Map<string, Promise<unknown>>()
  return function encolar<T>(fila: string, tarea: () => Promise<T>): Promise<T> {
    const previa = colas.get(fila) ?? Promise.resolve()
    const p = previa.then(tarea)
    colas.set(
      fila,
      p.catch(() => undefined),
    )
    return p
  }
}
