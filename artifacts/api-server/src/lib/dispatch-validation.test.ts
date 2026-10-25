import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDispatchState } from './dispatch-validation';

const invoice = () => ({
  invoiceNumber:'SYN-1', customerName:'Synthetic buyer', date:'2026-10-24',
  status:'Pending', eInvoiceIrn:'a'.repeat(64), eWayBillNumber:'012345678901',
  invoicePdfObjectPath:'/objects/uploads/12345678-1234-1234-1234-123456789abc',
  invoiceMetadata: {
    invoice_number:'SYN-1', invoice_date:'2026-10-24', customer_name:'Synthetic buyer',
    customer_gst_number:null, total:100, bill_to:{ name:'Synthetic buyer', address:'Test billing' },
    ship_to:{ name:'Synthetic consignee', address:'Test shipping', pincode:'600001' },
    irn_number:'a'.repeat(64), eway_bill_number:'012345678901', ack_number:'012345678901234',
  },
});
test('complete imported draft can be saved without ticking compliance', () => {
  assert.equal(validateDispatchState({invoices:[invoice()]}), null);
});
test('Part A blocks direct API checkbox and completion bypasses', () => {
  for (const patch of [{eWayDone:true}, {status:'Completed'}]) {
    const v = { ...invoice(), ewayMovementBlocked:true, ...patch };
    assert.match(validateDispatchState({invoices:[v]})!, /movement is not valid/);
  }
});
test('warning text also blocks falsifying the boolean flag', () => {
  assert.match(validateDispatchState({invoices:[{ ...invoice(), ewayMovementBlocked:false,
    ewayMovementWarning:'Not Valid for Movement as Part B is not Entered', eWayDone:true }]})!, /movement is not valid/);
});
test('existing movement block cannot be cleared or detached for the same source', () => {
  const prior = { ...invoice(), ewayMovementBlocked:true, ewayMovementWarning:'Part B is not entered' };
  for (const path of [prior.invoicePdfObjectPath, null]) {
    assert.match(validateDispatchState({invoices:[{...invoice(),invoicePdfObjectPath:path,ewayMovementBlocked:false}]},
      {invoices:[prior]})!, /replacement document/);
  }
});
test('replacement source may carry corrected movement metadata', () => {
  const prior = { ...invoice(), ewayMovementBlocked:true, ewayMovementWarning:'Part B is not entered' };
  assert.equal(validateDispatchState({invoices:[{...invoice(),
    invoicePdfObjectPath:'/objects/uploads/99999999-1234-1234-1234-123456789abc',ewayMovementBlocked:false}]},
    {invoices:[prior]}), null);
});
test('invalid dates, IDs, shipping and object paths are rejected', () => {
  assert.match(validateDispatchState({invoices:[{...invoice(),date:'2026-02-31'}]})!, /valid invoice date/);
  assert.match(validateDispatchState({invoices:[{...invoice(),eInvoiceIrn:'invalid'}]})!, /IRN/);
  assert.match(validateDispatchState({invoices:[{...invoice(),eWayBillNumber:'123'}]})!, /12 digits/);
  assert.match(validateDispatchState({invoices:[{...invoice(),invoicePdfObjectPath:'https://external.test/a.pdf'}]})!, /document reference/);
  const v = invoice(); v.invoiceMetadata.ship_to.address='';
  assert.match(validateDispatchState({invoices:[v]})!, /shipping address/);
});
test('duplicates are rejected and old manual records remain compatible', () => {
  assert.match(validateDispatchState({invoices:[invoice(),invoice()]})!, /already exists/);
  assert.equal(validateDispatchState({invoices:[{invoiceNumber:'legacy',status:'Pending'}]}), null);
});
