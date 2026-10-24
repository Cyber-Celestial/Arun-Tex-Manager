import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export function DispatchLabels({ invoices, onClose }: { invoices: Record<string, any>[]; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [error,setError] = useState('');
  function print() {
    const labels = root.current?.querySelectorAll<HTMLElement>('.courier-label-content');
    if (!labels?.length) return;
    if ([...labels].some(label => label.scrollHeight > label.clientHeight + 1 || label.scrollWidth > label.clientWidth + 1)) {
      setError('A label is too long for 4×2 inches. Correct or shorten the delivery details before printing; nothing has been clipped or printed.');
      return;
    }
    window.print();
  }
  return createPortal(<div className="label-print-root" role="dialog" aria-modal="true" aria-label="4×2-inch courier labels" ref={root}>
    <style>{`@page {size:4in 2in;margin:0}`}</style>
    <div className="label-preview-tools"><h2>Courier label preview · {invoices.length} label(s)</h2>
      <p>TVS LP46 Neo: choose 4×2-inch (101.6×50.8 mm) stock, 100% / actual size, no margins, headers or footers. One label per invoice. This is a courier label, not a replacement for the tax invoice or e-way bill.</p>
      <button className="btn btn-primary" onClick={print}>Print 4×2 labels</button> <button className="btn" onClick={onClose}>Close preview</button>
      {error&&<p role="alert">{error}</p>}
    </div>
    {invoices.map((invoice,i)=><article className="courier-label" key={i}><div className="courier-label-content">
      <header><strong>THE ARUN TEX</strong><span>COURIER / B2B</span></header>
      <div className="label-invoice"><b>INV {invoice.invoiceNumber}</b><span>{String(invoice.date || '').slice(0,10)}</span></div>
      <strong className="label-customer">{invoice.customerName}</strong>
      <div className="label-parties"><div><b>BILL TO</b><div className="label-address">{invoice.billToDetails || invoice.customerName}</div>{invoice.customerGstin&&<div>GSTIN: {invoice.customerGstin}</div>}{invoice.customerPhone&&<div>Ph: {invoice.customerPhone}</div>}</div>
        <div><b>SHIP TO</b><div className="label-address">{invoice.shipToDetails}</div>{invoice.shipToGstin&&<div>GSTIN: {invoice.shipToGstin}</div>}{invoice.shipToPhone&&<div>Ph: {invoice.shipToPhone}</div>}</div></div>
      <footer><div><b>LR:</b> {invoice.lrNumber || 'Not assigned'}{invoice.courierName ? ` · ${invoice.courierName}` : ''}</div>
        <div><b>EWB:</b> {invoice.eWayBillNumber || 'Not recorded'}</div></footer>
    </div></article>)}
  </div>,document.body);
}
