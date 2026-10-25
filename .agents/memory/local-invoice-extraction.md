---
name: Local invoice extraction policy
description: Privacy, trust and performance boundaries for invoice imports.
---

Invoice extraction must use local deterministic text/layout matching without external document APIs, LLMs or heavy AI services.

**Why:** The user supplied a low-compute local extraction specification and asked to follow it. Private originals may be stored in the existing private App Storage flow, but third-party document processing is not authorised.

**How to apply:** Preserve this boundary for future extraction enhancements; do not silently add hosted OCR or AI. QR payload decoding alone is not signature verification. Finding an E-Way ID must not mark transport compliance complete when the document itself says movement is invalid.

Keep the pure field-parser performance budget separate from PDF-engine startup, decoding, workers and total runtime memory.

**Why:** Fast field matching does not establish the supplied specification's total-memory or end-to-end timing targets. PDF.js runtime overhead is materially larger than the matching stage.

**How to apply:** Measure and disclose both stages. Do not advertise under-50-ms end-to-end processing or under-50-MB total runtime without measurements that actually establish those bounds.
