import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { extractInvoice, type InvoiceFields } from './dispatch-invoice.ts';

export type OcrPage = { text: string; confidence: number };
export type InvoiceReadResult = ReturnType<typeof extractInvoice> & {
  ocrPages: number[];
  fieldReview: Partial<Record<keyof InvoiceFields, 'ocr' | 'low-confidence'>>;
};

// Shared by the browser reader and real PDF/OCR fixture tests.
export async function readInvoiceDocument(
  pdf: Pick<PDFDocumentProxy, 'numPages' | 'getPage'>,
  recognize: (page: PDFPageProxy, pageNumber: number) => Promise<OcrPage>,
  onProgress?: (message: string) => void,
): Promise<InvoiceReadResult> {
  if (pdf.numPages > 30) throw new Error('Use an invoice PDF of 30 pages or fewer.');
  const texts: string[] = [];
  const ocrPages: number[] = [];
  const failures: number[] = [];
  const failureReasons: string[] = [];
  let lowConfidence = false;
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    onProgress?.(`Reading invoice page ${pageNumber} of ${pdf.numPages}…`);
    const page = await pdf.getPage(pageNumber);
    try {
      const content = await page.getTextContent();
      const items = content.items.filter(item => 'str' in item);
      items.sort((a, b) => Math.abs(a.transform[5] - b.transform[5]) > 3
        ? b.transform[5] - a.transform[5] : a.transform[4] - b.transform[4]);
      let y: number | undefined;
      let text = '';
      for (const item of items) {
        text += y === undefined || Math.abs(item.transform[5] - y) > 3 ? `\n${item.str}` : ` ${item.str}`;
        y = item.transform[5];
      }
      // Sparse covers scans with a selectable header/footer, as well as blank text layers.
      if (text.replace(/[^a-z0-9]/gi, '').length < 80) {
        ocrPages.push(pageNumber);
        onProgress?.(`Reading scanned page ${pageNumber} of ${pdf.numPages} locally with OCR…`);
        try {
          const recognized = await recognize(page, pageNumber);
          if (recognized.text.trim()) text = recognized.text;
          else failures.push(pageNumber);
          lowConfidence ||= !Number.isFinite(recognized.confidence) || recognized.confidence < 85;
        } catch (error) {
          failures.push(pageNumber);
          failureReasons.push(error instanceof Error ? error.message : 'The local OCR engine was unavailable.');
          lowConfidence = true;
        }
      }
      texts.push(text);
    } finally {
      page.cleanup();
    }
  }
  const result = extractInvoice(texts.join('\n'));
  const fieldReview: InvoiceReadResult['fieldReview'] = {};
  if (ocrPages.length) {
    // A page score is not a field probability. Conservatively flag every populated
    // field in mixed/OCR documents rather than claiming per-field accuracy.
    for (const key of Object.keys(result.fields) as (keyof InvoiceFields)[]) {
      if (result.fields[key]) fieldReview[key] = lowConfidence ? 'low-confidence' : 'ocr';
    }
    result.warnings.push('OCR ran locally in your browser. Check every value against the private original, especially addresses and long compliance IDs; recognition confidence does not verify correctness.');
    if (lowConfidence) result.warnings.push('Low OCR confidence: the highlighted values may contain recognition mistakes. Correct them before confirming your review.');
    if (failures.length) result.warnings.push(`OCR could not read page(s) ${failures.join(', ')}. Retry with a clearer scan or enter the missing fields manually.`);
    if (failureReasons.length) result.warnings.push(...new Set(failureReasons));
  }
  return { ...result, ocrPages, fieldReview };
}
