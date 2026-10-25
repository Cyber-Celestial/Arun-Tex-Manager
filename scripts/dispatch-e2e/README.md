# Dispatch browser regression

From the workspace root:

```sh
pnpm --filter @workspace/scripts exec playwright install chromium
pnpm test:dispatch:browser
```

Requires Node 24, the existing development PostgreSQL database (with permission
to create schemas), development Clerk keys, and the Replit App Storage sidecar.
It refuses production Clerk keys. No manually signed-in session is needed.

The test launches the real API and Vite on temporary local ports, signs into
real short-lived Clerk sessions, uploads a generated non-customer invoice using
the real private storage service, corrects extracted values and reloads them.
It checks anonymous and pending-role storage denial, UI and API compliance
guards, a valid completed-dispatch positive control, exact printed PDF page
count/dimensions/content/bounds, and rejection of overflowing labels.

Each run copies **table definitions only** into a uniquely named PostgreSQL
schema. The isolated API uses that schema without a `public` fallback, so it
cannot read or overwrite staff records. Two synthetic Clerk accounts and a
unique private object prefix belong only to the run. Cleanup runs on success,
assertion failure and setup failure, tries every resource even if one fails,
and fails the command if cleanup fails. A cleanup error identifies the run ID.
Do not force-kill the test process; as with other test runners, `SIGKILL` or a
container crash cannot execute cleanup. After such an interruption, remove only
the matching `dispatch_e2e_<run ID>` schema, `dispatch-<run ID>-…` Clerk users,
and `dispatch-e2e/<run ID>/` storage prefix.

Browser traces, video and auth state files are deliberately disabled to avoid
retaining sessions and signed upload URLs. Generated fixtures/results live in
the ignored `generated-artifacts/dispatch-tests/` directory.

The PDF assertions validate Chromium output, not a physical printer's driver
settings. Staff must still select 4×2-inch stock, actual size and no headers.
