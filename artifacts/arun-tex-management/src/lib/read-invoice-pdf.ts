import { readInvoiceDocument } from './invoice-document';
import { createInvoiceOcr } from './invoice-ocr';
// The legacy distribution includes platform polyfills needed by supported browsers.
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

export async function readInvoicePdf(file: File, onProgress?: (message: string) => void) {
  if (!file.name.toLowerCase().endsWith('.pdf') || (file.type && file.type !== 'application/pdf') || file.size > 25 * 1024 * 1024 || file.size === 0)
    throw new Error('Choose a non-empty PDF no larger than 25 MB.');
  const data = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(data.slice(0, 5)) !== '%PDF-') throw new Error('This file is not a valid PDF.');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const task = pdfjs.getDocument({
    data,
    wasmUrl: new URL(`${import.meta.env.BASE_URL}ocr/pdfjs/`, window.location.origin).href,
  });
  const ocr = createInvoiceOcr();
  try {
    const pdf = await task.promise;
    return await readInvoiceDocument(pdf, ocr.recognize, onProgress);
  } finally {
    await ocr.dispose();
    await task.destroy();
  }
}
