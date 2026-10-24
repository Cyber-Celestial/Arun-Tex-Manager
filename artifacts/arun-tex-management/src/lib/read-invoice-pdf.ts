import { extractInvoice } from './dispatch-invoice';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export async function readInvoicePdf(file: File) {
  if (!file.name.toLowerCase().endsWith('.pdf') || (file.type && file.type !== 'application/pdf') || file.size > 25 * 1024 * 1024 || file.size === 0)
    throw new Error('Choose a non-empty PDF no larger than 25 MB.');
  const data = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(data.slice(0, 5)) !== '%PDF-') throw new Error('This file is not a valid PDF.');
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const task = pdfjs.getDocument({ data });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 30) throw new Error('Use an invoice PDF of 30 pages or fewer.');
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const items = content.items.filter(item => 'str' in item);
      items.sort((a, b) => Math.abs(a.transform[5] - b.transform[5]) > 3 ? b.transform[5] - a.transform[5] : a.transform[4] - b.transform[4]);
      let y: number | undefined;
      let text = '';
      for (const item of items) {
        text += y === undefined || Math.abs(item.transform[5] - y) > 3 ? `\n${item.str}` : ` ${item.str}`;
        y = item.transform[5];
      }
      pages.push(text);
    }
    return extractInvoice(pages.join('\n'));
  } finally {
    await task.destroy();
  }
}
