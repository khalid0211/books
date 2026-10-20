# Catalogue enrichment implementation

Scope: owner-configured OpenAI enrichment of existing book-number ranges. Related-book scoring is deferred. Validate using an owner-selected catalogue range (initially B0001–B0010), not fixed external titles.

Implementation order and files:

1. `prisma/schema.prisma`: additive settings, enrichment/revision/concept, job/item and worker lease models. Keep existing Book metadata unchanged. Concepts attach to revisions so regeneration preserves corrections and history.
2. `src/lib/enrichment/`: encryption, validation/identity helpers, Open Library and OpenAI clients, job processing and review services. `src/instrumentation.ts`: start one durable, throttled worker inside the single Next.js server. Interrupted jobs pause on restart; database leases prevent competing workers. No independent queue infrastructure.
3. `src/app/api/enrichment/`: owner-only settings/test/preview/job controls; authenticated book enrichment reads and owner review writes. Same-origin checks use existing authorization.
4. `src/components/EnrichmentManager.tsx`, `/enrichment`, navigation: settings and inclusive range preview, explicit paid-run button, progress, pause/resume/cancel/retry.
5. `BookEnrichmentPanel.tsx`, BookForm and book detail page: source description, generated overview/central idea/concepts, provenance, owner correction/approval/lock. Other users see published content only.
6. Database restore: validate/upgrade an uploaded staging database before swapping; quiesce worker; restore jobs paused. Backup retains all new tables automatically. Retain deployment safety snapshots.
7. Airtable export: approved enrichment fields on Books plus Concepts and Book Concepts; stable IDs, inactive assignments and explicit null clearing; never export credentials or internal job records. Document exact new Airtable fields.
8. Tests: isolated SQLite database with mocked external requests, identity/schema/normalization, encryption, budget/retries/restart/locks, publication, backup/restore compatibility and Airtable projections; TypeScript and production build checks.

Security/operations: encrypted API key uses a dedicated ENRICHMENT_SECRET (32 random bytes, base64) outside backups. Model and user-confirmed USD token rates are required before paid runs. Per-call conservative reservations count against the snapshotted job budget, including uncertain network failures. Model output is untrusted; no model-generated URL is fetched. Pilot outputs require owner review before publication. No live API calls or Airtable writes during automated verification.
