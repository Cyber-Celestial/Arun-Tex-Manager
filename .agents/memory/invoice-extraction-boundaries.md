---
name: Invoice extraction boundaries
description: Safety and privacy decisions for invoice extraction and courier labels.
---

Keep invoice extraction local to the app/browser rather than introducing a third-party document or AI service without an explicit product decision.

**Why:** B2B invoices contain customer addresses, contact details and tax identifiers. The existing private document store should not implicitly become permission to send their contents to another provider.

**How to apply:** Future OCR or extraction improvements should preserve this boundary or explicitly address the privacy consequences of changing it.

Do not silently treat a billing address as the delivery address when the PDF has no reliable Ship To section.

**Why:** Billing and receiving locations can differ, and a plausible but unconfirmed address can send a courier to the wrong location.

**How to apply:** Keep missing or ambiguous delivery fields visibly incomplete and require the operator to review or correct them before saving a usable dispatch label.
