# Local invoice import

The Add B2B invoice form reads the PDF text layer in the browser. No external
document-processing API, LLM, or OCR service receives invoice contents. Only when
the user confirms Save is the original uploaded to private App Storage; the
workspace stores its object path and structured, reviewable metadata.

## Supported input and limits

- Non-empty PDFs up to 25 MB and 30 pages, with at most 60,000 text items.
- Text-layer invoices, e-invoices and E-Way documents with recognisable labels.
- Geometric party columns, wrapped names/addresses, Indian numeric and English
  month dates, contextual buyer GSTIN and labelled logistics/compliance IDs.
- Password-protected, malformed and oversized PDFs show errors. Image-only
  documents do not run OCR; users can enter details manually.
- Partial/missing data and unrecognised layouts require staff review. This is
  not a universal invoice-format recognition engine.

## Trust and compliance

An extracted identifier is not proof of registration, cancellation status,
signature validity or permission to transport goods. No GST/NIC lookup runs.
The importer never automatically ticks dispatch compliance.

The sample contains distinct billing and shipping locations, but its E-Way
delivery location matches billing rather than shipping. That conflict is
displayed without changing the invoice's Ship To address.

The sample also explicitly says movement is not valid because Part B has not
been entered. That warning prevents E-Way confirmation and completion. The API
checks both the flag and warning text and prevents clearing the saved warning
without a replacement document. Staff must review the updated document; a new
PDF is not automatically proof of legal compliance either.

QR decoding is not included in this version. Text fields remain the source of
reviewable suggestions. A future QR decoder must distinguish decoded payloads
from trusted, cryptographically verified signatures.

## Performance measurements

Run from the workspace root:

```sh
pnpm --filter @workspace/arun-tex-management exec tsx --test \
  src/lib/parse-invoice.test.ts ../api-server/src/lib/dispatch-validation.test.ts
```

The supplied five-page fixture measured **6–8 ms for the deterministic field
parser** in this development container. Cold PDF.js import/decoding/text
extraction took **2.4–2.9 seconds** in the Node test runner. Observed process heap
after import/extraction varied from **123–254 MB**, with RSS around **482–509 MB**.
These process-wide figures include the test runner, PDF.js, its worker/platform
dependencies and allocator behaviour; they are not isolated browser memory
measurements.

The under-50-ms target is met by the field parser on this fixture, **not by the
complete cold-start PDF pipeline**. A complete under-50-MB runtime budget is
**not met or guaranteed** with the current PDF.js pipeline. The form reports PDF
reading and field parsing separately. Browser performance varies by document
and device; there is no universal latency guarantee. Pages are processed
sequentially, resources are destroyed after reading, and reading can be
cancelled. Strict total-runtime memory/latency targets require a separately
profiled native/local extraction path.

## Regression checks

Parser fixtures assert all specified sample metadata, separate party columns,
empty LR/courier handling, retained identifier strings, conflicting references,
contextual GSTIN/date selection, safe no-text results and date validity.
Server fixtures cover imported record validation, direct checklist/completion
bypasses, sticky movement warnings, replacement sources, duplicate invoices and
backward compatibility with pending manual records.
