// Extrae los fragmentos de texto (str, x, y, pagina) de un PDF de Movimientos de Produccion,
// con el mismo mapeo que `extraerFragmentos` de src/panel/leerPdf.ts, para generar fixtures de
// test o inspeccionar un PDF real. Uso: node scripts/fragmentos-pdf.mjs <pdf> <salida.json>
import { readFile, writeFile } from 'node:fs/promises'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

async function main() {
  const [entrada, salida] = process.argv.slice(2)
  if (!entrada || !salida) {
    console.error('Uso: node scripts/fragmentos-pdf.mjs <pdf> <salida.json>')
    process.exit(1)
  }

  const datos = new Uint8Array(await readFile(entrada))
  const pdf = await getDocument({ data: datos }).promise

  const fragmentos = []
  for (let pagina = 1; pagina <= pdf.numPages; pagina++) {
    const pag = await pdf.getPage(pagina)
    const contenido = await pag.getTextContent()
    for (const item of contenido.items) {
      if (!item.str || !item.str.trim()) continue
      fragmentos.push({ str: item.str, x: item.transform[4], y: item.transform[5], pagina })
    }
  }

  await writeFile(salida, JSON.stringify(fragmentos, null, 2) + '\n')
  console.log(`${fragmentos.length} fragmentos → ${salida}`)
}

main()
