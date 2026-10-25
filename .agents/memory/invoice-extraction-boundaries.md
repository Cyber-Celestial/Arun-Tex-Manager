---
name: Invoice extraction boundaries
description: Safety and privacy decisions for invoice extraction and courier labels.
---

Keep invoice extraction local to the app/browser rather than introducing a third-party document or AI service without an explicit product decision.

**Why:** B2B invoices contain customer addresses, contact details and tax identifiers. The existing private document store should not implicitly become permission to send their contents to another provider.

**How to apply:** Future OCR or extraction improvements should preserve this boundary or explicitly address the privacy consequences of changing it.

Local OCR must also self-host its worker, recognition engine and language data; do not rely on a library's default CDN paths.

**Why:** An OCR library can execute locally while still silently introducing third-party network dependencies. Keeping every OCR asset on the app's origin makes the privacy boundary explicit and avoids external-service availability requirements.

**How to apply:** Check all runtime asset paths when replacing or upgrading OCR dependencies. Confidence is a review aid, not proof that tax IDs or delivery details are correct; retain explicit human confirmation.

Exercise PDF rendering in the supported browser when changing the PDF engine, not only in Node fixture tests.

**Why:** PDF.js can depend on newly introduced JavaScript built-ins that work in the project's Node runtime but are missing in browser runtimes. Text extraction alone does not exercise the scan-rendering path.

**How to apply:** Keep browser-compatible PDF distributions and verify a real rasterized scan when upgrading PDF.js or its worker.

Do not silently treat a billing address as the delivery address when the PDF has no reliable Ship To section.

**Why:** Billing and receiving locations can differ, and a plausible but unconfirmed address can send a courier to the wrong location.

**How to apply:** Keep missing or ambiguous delivery fields visibly incomplete and require the operator to review or correct them before saving a usable dispatch label.
