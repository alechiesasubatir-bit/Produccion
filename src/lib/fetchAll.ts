// PostgREST corta en 1000 filas por request: pide páginas hasta recibir una incompleta.
export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 1000,
): Promise<T[]> {
  const filas: T[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1)
    if (error) throw error
    const pagina = data ?? []
    filas.push(...pagina)
    if (pagina.length < pageSize) return filas
  }
}
