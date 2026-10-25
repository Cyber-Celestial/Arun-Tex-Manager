import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseInvoicePages, normalizeDate, type PdfPage } from './parse-invoice';
import { emptyInvoice, invoiceErrors, toDispatchInvoice } from './invoice-model';

test('supplied multi-column invoice: all metadata and safe movement warning', async () => {
  const before = process.memoryUsage();
  const start = performance.now();
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(await readFile(
    new URL('../../../../attached_assets/Tax-Invoice-INV26-27-5996_1792955805775.pdf', import.meta.url))),
    useSystemFonts: true, isEvalSupported: false });
  const pages: PdfPage[] = [];
  try {
    const pdf = await task.promise;
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n), viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      pages.push({ page: n, width: viewport.width, height: viewport.height,
        tokens: content.items.flatMap(i => {
          if (!('str' in i) || !i.str.trim()) return [];
          const t = pdfjs.Util.transform(viewport.transform, i.transform);
          return [{ text:i.str, x:t[4], y:t[5], width:i.width, height:i.height }];
        }) });
      page.cleanup();
    }
    const pdfMs = performance.now() - start;
    const result = parseInvoicePages(pages);
    const f = result.fields;
    assert.equal(f.invoice_number, 'INV26-27-5996');
    assert.equal(f.invoice_date, '2026-10-24');
    assert.equal(f.customer_name, 'SHRI RATHNA AKSHAYA ESTATES PVT LTD - CHENNAI');
    assert.equal(f.customer_gst_number, '33AAVCS4243B1ZF');
    assert.equal(f.bill_to.city, 'Chennai');
    assert.equal(f.bill_to.state_code, '33');
    assert.equal(f.bill_to.state, 'Tamil Nadu');
    assert.equal(f.bill_to.pincode, '600077');
    assert.equal(f.bill_to.phone, '+91-9444387774');
    assert.equal(f.bill_to.address, '241, AVADI POONAMALLEE ROAD, KADUVETTI, Chennai-600077');
    assert.equal(f.ship_to.name, 'SHRI RATHANA AKSHAYA ESTATES PVT.LTD');
    assert.equal(f.ship_to.city, 'Tirunelveli');
    assert.equal(f.ship_to.pincode, '627005');
    assert.equal(f.ship_to.address, 'NO.241 SOUTH BYE PASS ROAD, MELAPALAYAM, TIRUNELVELI-627005');
    assert.equal(f.ship_to.phone, null);
    assert.equal(f.ship_to.gstin, f.customer_gst_number);
    assert.equal(f.irn_number, '4f7291194aea948be817174a92e75377f79809a90b0d17b83ddc52feca7170c4');
    assert.equal(f.ack_number, '152627640083859');
    assert.equal(f.eway_bill_number, '512095038416');
    assert.equal(f.lr_number, null);
    assert.equal(f.courier_number, null);
    assert.equal(f.bale_reference, 'BALE-2');
    assert.equal(f.delivery_challan, 'DC-6002');
    assert.equal(f.transporter, 'AKR');
    assert.equal(f.total, 77355);
    assert.equal(result.movementBlocked, true);
    assert.match(result.movementWarning!, /Not Valid for Movement/);
    assert.ok(result.warnings.some(w => w.includes('differs from invoice Ship To')));
    assert.deepEqual(invoiceErrors(f), []);
    assert.equal(toDispatchInvoice(f).eWayBillNumber, f.eway_bill_number);
    const after = process.memoryUsage();
    console.log('Invoice extraction benchmark', JSON.stringify({
      pdfDecodeAndColdStartupMs: Math.round(pdfMs), pureParserMs: +result.timing.parseMs.toFixed(2),
      heapUsedMB: +(after.heapUsed / 1048576).toFixed(2),
      heapGrowthMB: +((after.heapUsed-before.heapUsed)/1048576).toFixed(2),
      rssMB: +(after.rss/1048576).toFixed(2), pages: pages.length,
    }));
  } finally { await task.destroy(); }
});

function synthetic(lines: string[]): PdfPage {
  return { page:1, width:600, height:800, tokens:lines.map((text,i)=>({text,x:20,y:20+i*15,width:200,height:10})) };
}
test('empty/image-only PDFs do not invent metadata', () => {
  const result = parseInvoicePages([synthetic([])]);
  assert.equal(result.fields.invoice_number, null);
  assert.ok(result.warnings.some(w => w.includes('No readable text')));
});
test('never mistakes supplier GSTIN or acknowledgement date for buyer or invoice', () => {
  const r = parseInvoicePages([synthetic(['Supplier GSTIN: 33AASFT2830R1ZH', 'Ack Date: 25-10-2026'])]);
  assert.equal(r.fields.customer_gst_number, null);
  assert.equal(r.fields.invoice_date, null);
});
test('empty or hyphen LR and courier do not consume next line labels', () => {
  const r = parseInvoicePages([synthetic(['Invoice No: SYN-100', 'LR. No:-', 'Manual Challan No:', 'Bale No:- BALE-3'])]);
  assert.equal(r.fields.lr_number, null);
  assert.equal(r.fields.courier_number, null);
  assert.equal(r.fields.bale_reference, 'BALE-3');
});
test('identifiers stay strings and conflicts are reported', () => {
  const r = parseInvoicePages([synthetic(['Invoice No: SYN-100','Document No. SYN-101',
    'Eway Bill No: 012345678901','Unique No. 999999999999','Ack No: 012345678901234'])]);
  assert.equal(r.fields.eway_bill_number, '012345678901');
  assert.equal(r.fields.ack_number, '012345678901234');
  assert.ok(r.warnings.some(w=>w.includes('Conflicting invoice')));
  assert.ok(r.warnings.some(w=>w.includes('Conflicting E-Way')));
});
test('dates are calendar-valid and normalised deterministically', () => {
  for (const date of ['October 24, 2026','24-10-2026','24/10/2026','24-Oct-26','2026-10-24'])
    assert.equal(normalizeDate(date), '2026-10-24');
  for (const date of ['31-02-2026','2026-13-01','unknown']) assert.equal(normalizeDate(date), null);
});
test('manual whitespace/hyphen values normalize to null on persistence', () => {
  const f = emptyInvoice();
  f.lr_number = ' - '; f.courier_number = '...'; f.ship_to.phone = ' : / ';
  const mapped = toDispatchInvoice(f);
  assert.equal(mapped.lrNumber, null);
  assert.equal(mapped.courierNumber, null);
  assert.equal((mapped.invoiceMetadata as typeof f).ship_to.phone, null);
  assert.ok(invoiceErrors(f).length > 0);
});
