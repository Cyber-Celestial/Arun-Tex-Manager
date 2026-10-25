import { useState } from "react";
import { useRequestUploadUrl } from "@workspace/api-client-react";
import {
  emptyInvoice,
  invoiceErrors,
  validEway,
  type InvoiceFields,
} from "@/lib/dispatch-invoice";
import { readInvoicePdf } from "@/lib/read-invoice-pdf";
import type { InvoiceReadResult } from "@/lib/invoice-document";

type Invoice = Record<string, any>;
export function DispatchInvoiceForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Invoice;
  onSave: (invoice: Invoice) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [fields, setFields] = useState<InvoiceFields>(
    () =>
      Object.fromEntries(
        Object.entries(emptyInvoice()).map(([k, v]) => [k, initial?.[k] ?? v]),
      ) as InvoiceFields,
  );
  const [warnings, setWarnings] = useState<string[]>([]);
  const [fieldReview, setFieldReview] = useState<
    InvoiceReadResult["fieldReview"]
  >({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [sourcePath, setSourcePath] = useState(
    initial?.invoicePdfObjectPath || "",
  );
  const [reviewed, setReviewed] = useState(false);
  const upload = useRequestUploadUrl();
  const errors = invoiceErrors(fields);
  async function choose(file?: File) {
    if (!file) return;
    setBusy(true);
    setMessage("Reading invoice PDF…");
    setReviewed(false);
    try {
      const result = await readInvoicePdf(file, setMessage);
      setMessage("Saving the original PDF privately…");
      const target = await upload.mutateAsync({
        data: {
          name: file.name,
          size: file.size,
          contentType: "application/pdf",
        },
      });
      const response = await fetch(target.uploadURL, {
        method: "PUT",
        headers: { "Content-Type": "application/pdf" },
        body: file,
      });
      if (!response.ok)
        throw new Error("The private PDF upload failed. Try again.");
      setFields(result.fields);
      setWarnings(result.warnings);
      setFieldReview(result.fieldReview);
      setSourcePath(target.objectPath);
      setMessage(
        result.ocrPages.length
          ? "Scanned PDF read locally with OCR. Check the marked values against the original before saving."
          : "PDF extracted. Correct the fields below before saving.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not read this PDF. Try another file or enter details manually.",
      );
    } finally {
      setBusy(false);
    }
  }
  const labels: [keyof InvoiceFields, string][] = [
    ["invoiceNumber", "Invoice No:"],
    ["date", "Issue Date:"],
    ["customerName", "M/S:"],
    ["customerGstin", "GST No:"],
    ["customerPhone", "Phone No.:"],
    ["billToDetails", "Bill To"],
    ["shipToDetails", "Ship To"],
    ["shipToGstin", "Ship-to GSTIN"],
    ["shipToPhone", "Ship-to phone"],
    ["eInvoiceIrn", "Unique No."],
    ["eWayBillNumber", "Eway Bill No:"],
  ];
  return (
    <section className="panel invoice-review">
      <h2>{initial ? "Review / correct invoice" : "Add B2B invoice"}</h2>
      <label className="doc-upload">
        Read B2B invoice PDF
        <input
          type="file"
          accept=".pdf,application/pdf"
          disabled={busy}
          onChange={(e) => {
            void choose(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </label>
      <p>
        Scanned English invoices are read locally in your browser. Invoice
        contents are not sent to an external OCR service. The original is saved
        privately as before.
      </p>
      {message && <p role="status">{message}</p>}
      {warnings.length > 0 && (
        <ul className="invoice-warnings">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy || errors.length || !reviewed) return;
          setBusy(true);
          try {
            await onSave({
              ...initial,
              ...fields,
              invoicePdfObjectPath: sourcePath,
              eWayDone: validEway(fields.eWayBillNumber),
            });
          } catch (error) {
            setMessage(
              error instanceof Error
                ? error.message
                : "Could not save. Your reviewed fields are still here; try again.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy} className="invoice-fieldset">
          <div className="invoice-review-grid">
            {labels.map(([key, label]) => (
              <label key={key}>
                {label}
                {fieldReview[key] && (
                  <small className="invoice-ocr-review" id={`review-${key}`}>
                    {fieldReview[key] === "low-confidence"
                      ? "Low OCR confidence — check and correct"
                      : "OCR value — check against original"}
                  </small>
                )}
                {key.endsWith("Details") ? (
                  <textarea
                    aria-label={label}
                    aria-describedby={
                      fieldReview[key] ? `review-${key}` : undefined
                    }
                    rows={3}
                    maxLength={600}
                    value={fields[key]}
                    onChange={(e) => {
                      setReviewed(false);
                      setFields({ ...fields, [key]: e.target.value });
                    }}
                  />
                ) : (
                  <input
                    aria-label={label}
                    aria-describedby={
                      fieldReview[key] ? `review-${key}` : undefined
                    }
                    type={key === "date" ? "date" : "text"}
                    maxLength={
                      key === "eInvoiceIrn"
                        ? 64
                        : key === "eWayBillNumber"
                          ? 12
                          : 150
                    }
                    value={fields[key]}
                    onChange={(e) => {
                      setReviewed(false);
                      setFields({
                        ...fields,
                        [key]: key.endsWith("Gstin")
                          ? e.target.value.toUpperCase()
                          : e.target.value,
                      });
                    }}
                  />
                )}
              </label>
            ))}
          </div>
          <p>
            IRN: 64 hexadecimal characters. E-way bill: 12 digits; a valid
            reviewed number marks that step done on save. These are format
            checks, not government verification. Missing IDs can be saved as
            Pending, but cannot be marked done or completed.
          </p>
          {errors.length > 0 && (
            <ul className="invoice-warnings" aria-live="polite">
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          )}
          {sourcePath && (
            <a
              href={`/api/storage${sourcePath}`}
              target="_blank"
              rel="noreferrer"
            >
              Open original invoice PDF
            </a>
          )}
          <label className="invoice-review-confirm">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
            />{" "}
            I have checked the invoice, customer, delivery address and
            compliance IDs.
          </label>
          <div className="intro-actions">
            <button
              className="btn btn-primary"
              disabled={errors.length > 0 || !reviewed}
              type="submit"
            >
              Save reviewed invoice
            </button>
            <button
              className="btn btn-secondary"
              type="button"
              onClick={onCancel}
            >
              Cancel
            </button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}
