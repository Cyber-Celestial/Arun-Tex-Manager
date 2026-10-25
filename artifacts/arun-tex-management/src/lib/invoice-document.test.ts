import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { createWorker, OEM } from 'tesseract.js';
import { invoicePdfFixture, fixtureIrn, invoiceLines } from './fixtures/invoice-pdfs.ts';
import { readInvoiceDocument } from './invoice-document.ts';
import { dispatchComplete, invoiceErrors } from './dispatch-invoice.ts';

Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
const require = createRequire(import.meta.url);
const langPath = path.join(path.dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0');

async function open(scanned: boolean, lines = invoiceLines) {
  const task = getDocument({ data: invoicePdfFixture(scanned, lines), useSystemFonts: true });
  return { task, pdf: await task.promise };
}

test('text-based PDF fixture bypasses OCR and retains extraction/validation', async () => {
  const { task, pdf } = await open(false);
  try {
    const result = await readInvoiceDocument(pdf, async () => { throw new Error('OCR must not run'); });
    assert.deepEqual(result.ocrPages, []);
    assert.deepEqual(result.fieldReview, {});
    assert.equal(result.fields.invoiceNumber, 'SCAN-2026/001');
    assert.equal(result.fields.eInvoiceIrn, fixtureIrn);
    assert.deepEqual(invoiceErrors(result.fields), []);
  } finally { await task.destroy(); }
});

test('image-only PDF fixture renders and yields invoice, customer and compliance fields with local OCR', { timeout: 90_000 }, async () => {
  const { task, pdf } = await open(true);
  const worker = await createWorker('eng', OEM.LSTM_ONLY, {
    langPath, cacheMethod: 'none',
    corePath: require.resolve('tesseract.js-core/tesseract-core-lstm.wasm.js'),
  });
  try {
    assert.equal((await (await pdf.getPage(1)).getTextContent()).items.length, 0);
    const result = await readInvoiceDocument(pdf, async page => {
      const viewport = page.getViewport({ scale: 3 });
      const canvas = createCanvas(viewport.width, viewport.height);
      await page.render({ canvas: canvas as never, canvasContext: canvas.getContext('2d') as never, viewport }).promise;
      const { data } = await worker.recognize(canvas.toBuffer('image/png'));
      return { text: data.text, confidence: data.confidence };
    });
    assert.deepEqual(result.ocrPages, [1]);
    assert.equal(result.fields.invoiceNumber, 'SCAN-2026/001');
    assert.equal(result.fields.date, '2026-10-24');
    assert.equal(result.fields.customerName, 'Example Buyer');
    assert.equal(result.fields.customerGstin, '24ABCDE1234F1Z5');
    assert.equal(result.fields.customerPhone, '9876543210');
    assert.match(result.fields.shipToDetails, /Mumbai 400001/);
    assert.equal(result.fields.shipToGstin, '27ABCDE1234F1Z5');
    assert.equal(result.fields.shipToPhone, '9876543211');
    assert.equal(result.fields.eInvoiceIrn, fixtureIrn);
    assert.equal(result.fields.eWayBillNumber, '123456789012');
    assert.deepEqual(invoiceErrors(result.fields), []);
    assert(result.fieldReview.eInvoiceIrn);
    assert(!dispatchComplete(result.fields));
  } finally { await worker.terminate(); await task.destroy(); }
});

test('low confidence stays visible, invalid formats stay invalid, and shipping is never inferred', async () => {
  const { task, pdf } = await open(true);
  try {
    const text = invoiceLines.slice(0, invoiceLines.indexOf('Ship To:')).join('\n');
    const result = await readInvoiceDocument(pdf, async () => ({ text, confidence: 42 }));
    assert.equal(result.fieldReview.invoiceNumber, 'low-confidence');
    assert(result.warnings.some(w => w.includes('Low OCR confidence')));
    assert.equal(result.fields.shipToDetails, '');
    assert(invoiceErrors(result.fields).includes('Confirm the delivery address.'));
    assert(invoiceErrors({ ...result.fields, eInvoiceIrn: 'g'.repeat(64), eWayBillNumber: '123' }).length >= 3);
  } finally { await task.destroy(); }
});

test('OCR failure or blank scan returns editable fields and actionable warnings', async () => {
  for (const recognize of [
    async () => { throw new Error('engine unavailable'); },
    async () => ({ text: '', confidence: 0 }),
  ]) {
    const { task, pdf } = await open(true, []);
    try {
      const result = await readInvoiceDocument(pdf, recognize);
      assert.equal(result.fields.invoiceNumber, '');
      assert(result.warnings.some(w => w.includes('could not read page(s) 1')));
    } finally { await task.destroy(); }
  }
});

test('mixed PDFs OCR only sparse pages and retain readable text when OCR fails', async () => {
  const a = await open(false);
  const b = await open(true);
  try {
    const calls: number[] = [];
    const result = await readInvoiceDocument({
      numPages: 2, getPage: n => n === 1 ? a.pdf.getPage(1) : b.pdf.getPage(1),
    }, async (_, n) => { calls.push(n); throw new Error('unreadable'); });
    assert.deepEqual(calls, [2]);
    assert.equal(result.fields.invoiceNumber, 'SCAN-2026/001');
    assert(result.warnings.some(w => w.includes('could not read page(s) 2')));
  } finally { await a.task.destroy(); await b.task.destroy(); }
});

test('page limit rejects before rendering or OCR', async () => {
  await assert.rejects(readInvoiceDocument({
    numPages: 31, getPage: async () => { throw new Error('must not load'); },
  }, async () => { throw new Error('must not recognize'); }), /30 pages/);
});
