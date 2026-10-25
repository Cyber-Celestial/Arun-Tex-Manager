import type { PDFPageProxy } from 'pdfjs-dist';
import type { Worker } from 'tesseract.js';
import type { OcrPage } from './invoice-document';

export function createInvoiceOcr() {
  let worker: Worker | undefined;
  let disposed = false;
  async function recognize(page: PDFPageProxy): Promise<OcrPage> {
    if (disposed) throw new Error('OCR is no longer available.');
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stage = 'Starting the local OCR engine';
    const operation = async () => {
      if (!worker) {
        const { createWorker, OEM } = await import('tesseract.js');
        const assets = new URL(`${import.meta.env.BASE_URL}ocr/`, window.location.origin).href;
        const created = await createWorker('eng', OEM.LSTM_ONLY, {
          workerPath: `${assets}worker.min.js`,
          corePath: `${assets}tesseract-core-lstm.wasm.js`,
          langPath: assets,
          workerBlobURL: false,
          cacheMethod: 'none',
          // Worker failures are handled by the operation/timeout, not thrown globally.
          errorHandler: () => {},
        });
        if (disposed) {
          await created.terminate();
          throw new Error('OCR was stopped.');
        }
        worker = created;
      }
      const natural = page.getViewport({ scale: 1 });
      stage = 'Rendering the scanned PDF page';
      // ~216 DPI for normal invoices, capped to avoid exhausting browser memory.
      const scale = Math.min(3, 3000 / Math.max(natural.width, natural.height),
        Math.sqrt(8_000_000 / (natural.width * natural.height)));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      try {
        await page.render({ canvas, viewport, background: '#ffffff' }).promise;
        if (disposed) throw new Error('OCR was stopped.');
        stage = 'Recognizing the scanned text';
        const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
        const scores = data.blocks?.flatMap(block => block.paragraphs.flatMap(paragraph =>
          paragraph.lines.flatMap(line => line.words.filter(word => /[a-z0-9]/i.test(word.text)).map(word => word.confidence)))) || [];
        return { text: data.text, confidence: Math.min(data.confidence, ...scores) };
      } finally {
        canvas.width = canvas.height = 0;
      }
    };
    try {
      return await Promise.race([
        operation(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            disposed = true;
            void worker?.terminate();
            reject(new Error('OCR timed out. Try a clearer scan.'));
          }, 90_000);
        }),
      ]);
    } catch (error) {
      throw new Error(`${stage} failed: ${error instanceof Error ? error.message : 'OCR engine error'}`);
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    recognize,
    async dispose() {
      disposed = true;
      await worker?.terminate();
      worker = undefined;
    },
  };
}
