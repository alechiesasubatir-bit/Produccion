import type { Fragmento } from '../domain/formulaPdf'

// Extrae los fragmentos de texto (str, x, y, pagina) de un PDF en el navegador, con el mismo
// mapeo que scripts/fragmentos-pdf.mjs. Import dinámico para no sumar pdf.js al bundle principal.
export async function extraerFragmentos(archivo: File): Promise<Fragmento[]> {
  const pdfjs = await import('pdfjs-dist')
  const workerUrl = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.default

  const datos = new Uint8Array(await archivo.arrayBuffer())
  const pdf = await pdfjs.getDocument({ data: datos }).promise

  const fragmentos: Fragmento[] = []
  for (let pagina = 1; pagina <= pdf.numPages; pagina++) {
    const pag = await pdf.getPage(pagina)
    const contenido = await pag.getTextContent()
    for (const item of contenido.items) {
      if (!('str' in item) || !item.str.trim()) continue
      fragmentos.push({ str: item.str, x: item.transform[4], y: item.transform[5], pagina })
    }
  }
  return fragmentos
}
