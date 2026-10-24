import { test } from "node:test";
import assert from "node:assert/strict";
import { validateDispatchState } from "./dispatch-validation.ts";

const invoice = {
  invoiceNumber:"TEST-INV/001",customerName:"Example Buyer",shipToDetails:"44 Industrial Road",
  date:"2026-10-24",eInvoiceIrn:"abcdef0123456789".repeat(4),eWayBillNumber:"123456789012",
  status:"Completed",eInvoiceDone:true,eWayDone:true,bundleDone:true,whatsappSent:true,
  courierSent:true,vastraCourierUpdated:true,lrNumber:"LR-001",
  lrPdfObjectPath:"/objects/uploads/12345678-abcd-1234-abcd-123456789abc",
  courierPdfObjectPath:"/objects/uploads/12345678-abcd-1234-abcd-123456789abc",
};
test("server accepts valid completion and drafts with missing IDs", () => {
  assert.equal(validateDispatchState({invoices:[invoice]}),null);
  assert.equal(validateDispatchState({invoices:[{invoiceNumber:"DRAFT-1",status:"Pending"}]}),null);
});
test("server rejects bypassing ID format and completion requirements", () => {
  for (const key of ["eInvoiceIrn","eWayBillNumber","lrNumber","lrPdfObjectPath","courierPdfObjectPath","shipToDetails","date"]) {
    assert(validateDispatchState({invoices:[{...invoice,[key]:""}]}),key);
  }
  for (const key of ["eInvoiceDone","eWayDone","bundleDone","whatsappSent","courierSent","vastraCourierUpdated"]) {
    assert(validateDispatchState({invoices:[{...invoice,[key]:false}]}),key);
  }
  assert(validateDispatchState({invoices:[{...invoice,eInvoiceIrn:"g".repeat(64)}]}));
  assert(validateDispatchState({invoices:[{...invoice,eWayBillNumber:"1234567890123"}]}));
  assert(validateDispatchState({invoices:[{...invoice,date:"2026-02-31"}]}));
});
test("server requires valid IDs even if done flags are set on Pending records", () => {
  assert(validateDispatchState({invoices:[{...invoice,status:"Pending",eInvoiceIrn:""}]}));
  assert(validateDispatchState({invoices:[{...invoice,status:"Pending",eWayBillNumber:""}]}));
});
test("server rejects duplicate invoice references and unsafe document URLs", () => {
  assert(validateDispatchState({invoices:[invoice,{...invoice,invoiceNumber:"test-inv/001 "}]}));
  assert(validateDispatchState({invoices:[{...invoice,invoicePdfObjectPath:"https://example.com/file.pdf"}]}));
  assert(validateDispatchState({invoices:[null]}));
});
