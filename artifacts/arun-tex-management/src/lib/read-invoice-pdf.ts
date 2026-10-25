import { parseInvoicePages, type PdfPage } from './parse-invoice';
import type { InvoiceReadResult } from './invoice-model';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

export async function readInvoicePdf(
  file: File, onProgress?: (message: string) => void, signal?: AbortSignal,
): Promise<InvoiceReadResult> {
  if (!file.name.toLowerCase().endsWith('.pdf') || (file.type && file.type !== 'application/pdf') ||
    file.size === 0 || file.size > 25 * 1024 * 1024)
    throw new Error('Choose a non-empty PDF no larger than 25 MB.');
  signal?.throwIfAborted();
  const start = performance.now();
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') throw new Error('This file is not a valid PDF.');
  onProgress?.('Loading the local PDF reader…');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs').catch(() => {
    throw new Error('The PDF reader could not load. This is an application-loading problem, not an invalid invoice. Refresh the preview, then select the PDF again. No invoice has been saved.');
  });
  signal?.throwIfAborted();
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const task = pdfjs.getDocument({ data: bytes, stopAtErrors: true });
  const abort = () => { void task.destroy(); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 30) throw new Error('This PDF has more than 30 pages. Split it into individual invoices.');
    const pages: PdfPage[] = [];
    let tokenCount = 0;
    for (let n = 1; n <= pdf.numPages; n++) {
      signal?.throwIfAborted();
      onProgress?.(`Reading page ${n} of ${pdf.numPages} locally…`);
      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      tokenCount += content.items.length;
      if (tokenCount > 60000) throw new Error('This PDF contains too much text. Split it into individual invoices.');
      pages.push({ page: n, width: viewport.width, height: viewport.height,
        tokens: content.items.flatMap(item => {
          if (!('str' in item) || !item.str.trim()) return [];
          const transform = pdfjs.Util.transform(viewport.transform, item.transform);
          return [{ text: item.str, x: transform[4], y: transform[5],
            width: item.width, height: item.height }];
        }) });
      page.cleanup();
    }
    signal?.throwIfAborted();
    const pdfMs = performance.now() - start;
    const result = parseInvoicePages(pages);
    result.timing.pdfMs = pdfMs;
    return result;
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Reading cancelled.', 'AbortError');
    if (error instanceof Error && error.name === 'PasswordException')
      throw new Error('This PDF is password-protected. Upload an unlocked copy or enter details manually.');
    throw error instanceof Error ? error : new Error('Could not read this PDF. Enter details manually or try another file.');
  } finally {
    signal?.removeEventListener('abort', abort);
    await task.destroy();
  }
}
