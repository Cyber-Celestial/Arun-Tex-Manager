import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dispatchComplete, emptyInvoice, extractInvoice, invoiceErrors, validEway, validIrn } from './dispatch-invoice.ts';

const irn = 'abcdef0123456789'.repeat(4);
const text = `THE ARUN TEX
GSTIN: 24AAAAA0000A1Z5
Invoice Number: TEST-INV/001
Invoice Date: 24-Oct-2026
IRN: ${irn.slice(0,32)}
${irn.slice(32)}
E-way Bill No: 1234 5678 9012
Bill To:
Example Buyer
12 Market Street
Surat 395001
GSTIN: 24ABCDE1234F1Z5
Phone: 9876543210
Ship To:
Example Warehouse
44 Industrial Road
Mumbai 400001
GSTIN: 27ABCDE1234F1Z5
Description of Goods
Fabric`;

test('extracts reviewable invoice, party, compliance and contact data', () => {
  const {fields} = extractInvoice(text);
  assert.equal(fields.invoiceNumber, 'TEST-INV/001');
  assert.equal(fields.date, '2026-10-24');
  assert.equal(fields.customerName, 'Example Buyer');
  assert.equal(fields.eInvoiceIrn, irn);
  assert.equal(fields.eWayBillNumber, '123456789012');
  assert.equal(fields.customerGstin, '24ABCDE1234F1Z5');
  assert.equal(fields.shipToGstin, '27ABCDE1234F1Z5');
  assert.equal(fields.customerPhone, '9876543210');
  assert.match(fields.shipToDetails, /Mumbai 400001/);
  assert.doesNotMatch(fields.shipToDetails, /Fabric|GSTIN/);
  assert.deepEqual(invoiceErrors(fields), []);
});

test('does not silently reuse the billing address as the shipping address', () => {
  const result = extractInvoice(text.split('Ship To:')[0]);
  assert.equal(result.fields.shipToDetails, '');
  assert(result.warnings.some(w=>w.includes('Delivery address')));
});

test('empty/scanned and unrecognized PDFs return explicit warnings and editable blanks', () => {
  assert.deepEqual(extractInvoice('').fields, emptyInvoice());
  assert(extractInvoice('').warnings.some(w=>w.includes('scanned')));
  assert.equal(extractInvoice('random text').fields.invoiceNumber, '');
});

test('supports numeric dates and rejects invalid dates', () => {
  assert.equal(extractInvoice(text.replace('24-Oct-2026','24/10/2026')).fields.date,'2026-10-24');
  assert.equal(extractInvoice(text.replace('Invoice Date: 24-Oct-2026','Issue Date: October 22, 2026')).fields.date,'2026-10-22');
  assert(invoiceErrors({...extractInvoice(text).fields,date:'2026-02-31'}).some(e=>e.includes('date')));
});

test('compliance formats are strict, not length-only or numeric coercion', () => {
  assert(validIrn(irn.toUpperCase()));
  for (const bad of ['', 'g'.repeat(64),irn.slice(1),irn+'a']) assert(!validIrn(bad));
  assert(validEway('123456789012'));
  for (const bad of ['', '12345678901','1234567890123','1234e6789012']) assert(!validEway(bad));
});

test('completion requires valid IDs and every existing dispatch requirement', () => {
  const invoice = {...extractInvoice(text).fields, eInvoiceDone:true,eWayDone:true,bundleDone:true,
    whatsappSent:true,courierSent:true,vastraCourierUpdated:true,lrNumber:'LR-001',
    lrPdfObjectPath:'/objects/uploads/test',courierPdfObjectPath:'/objects/uploads/test'};
  assert(dispatchComplete(invoice));
  for (const key of ['eInvoiceIrn','eWayBillNumber','lrNumber','lrPdfObjectPath','courierPdfObjectPath','shipToDetails']) {
    assert(!dispatchComplete({...invoice,[key]:''}), key);
  }
  for (const key of ['eInvoiceDone','eWayDone','bundleDone','whatsappSent','courierSent','vastraCourierUpdated']) {
    assert(!dispatchComplete({...invoice,[key]:false}), key);
  }
});

test('a courier tracking number uses the same LR number field for dispatch completion', () => {
  const invoice = {...extractInvoice(text).fields, eInvoiceDone:true,eWayDone:true,bundleDone:true,
    whatsappSent:true,courierSent:true,vastraCourierUpdated:true,lrNumber:'COURIER-TRACK-001',
    lrPdfObjectPath:'/objects/uploads/test',courierPdfObjectPath:'/objects/uploads/test'};
  assert(dispatchComplete(invoice));
  assert(!dispatchComplete({...invoice,lrNumber:''}));
});
