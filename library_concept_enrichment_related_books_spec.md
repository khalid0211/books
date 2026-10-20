# Library Application — AI Concept Enrichment and Automated Related Books

**Status:** Implementation specification (MVP)  
**Scope:** Existing catalogue (~700 books); retain current database and Open Library integration.  
**Decision:** Use automated links derived from concepts. Do **not** require Apache AGE in the first release.

## 1. Objective

Add an opt-in enrichment process that produces useful, reviewable information about catalogue books without scanning the full books. Use the resulting concepts to recommend other books in the collection, with a brief explanation of *why* each is related. Prepare the data model so that an Apache AGE graph layer can be added later if graph queries prove valuable.

### In scope
- Reuse existing catalogue title, author, ISBN and Open Library IDs where available.
- Retrieve additional metadata from Open Library where available, with respectful request pacing.
- Use a **cloud LLM API** to create structured book overviews, major concepts and (where defensible) the book's perspective on those concepts.
- Automatically calculate book-to-book relatedness through concepts.
- Display related books with interpretable reasons and provenance.
- Support human review and reruns without overwriting manually corrected records.

### Out of scope (first release)
- Full-text book ingestion or scanning.
- Claims to have verified contents against full books.
- Generating an unlimited free-form network of asserted author influence or historical causal links.
- Requiring Apache AGE, Neo4j or graph visualization for MVP.

## 2. Design principles

1. **No invented certainty:** AI overviews are generated from model knowledge and supplied metadata, not certified book summaries. The model can return `insufficient_knowledge` instead of guessing.
2. **Identity first:** Match books by ISBN or verified title + author, not title alone. Handle editions and homonyms.
3. **Separate evidence:** Keep Open Library descriptions distinct from LLM-generated narratives; store source type, timestamp, model and prompt version.
4. **Concepts over keywords:** Normalize overlapping labels (e.g. `rapid cognition`, `intuitive judgement`) to canonical concepts while retaining original terms.
5. **Explain recommendations:** Every automated related-book link must be traceable to one or more shared concepts; do not show opaque similarity alone.
6. **Iterate:** Run a seven-book pilot, then 25–50 books, then process the remainder. Support resumable runs.
7. **Privacy and cost:** Send only catalogue metadata and optionally public descriptions to an approved cloud API. Make usage and spend visible.

## 3. User workflow

1. Admin selects **Enrich Catalogue**, optionally filtered to unenriched books.
2. Job resolves catalogue identity, requests Open Library work/edition descriptions where available, and records metadata and attribution.
3. Cloud LLM returns strictly validated JSON per book, including overview, concepts, central argument/perspective, limitations and a knowledge assessment.
4. App normalizes concepts; ambiguous or low-confidence results are marked **Needs review**, not silently published.
5. App rebuilds concept-derived related-book recommendations for affected books.
6. Book detail page shows an **About this book (AI-generated)** section and **Related books in your library** with shared concepts and a plain-language reason.
7. Admin can review, suppress or regenerate descriptions/concepts; regeneration updates derived links.

## 4. Suggested relational schema (adapt names/types to existing stack)

**Do not replace the current books table.** Add tables or equivalent ORM models:

```sql
-- Existing books(id, title, author, isbn, open_library_id, ...)
CREATE TABLE book_enrichment (
  book_id BIGINT PRIMARY KEY REFERENCES books(id),
  ol_description TEXT,
  ol_description_source TEXT,
  ai_overview TEXT,
  ai_central_argument TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, enriched, needs_review, failed
  knowledge_level TEXT,                    -- high, medium, low, insufficient
  model_name TEXT,
  prompt_version TEXT,
  input_fingerprint TEXT,
  enriched_at TIMESTAMPTZ,
  last_error TEXT,
  manually_locked BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE concepts (
  id BIGSERIAL PRIMARY KEY,
  canonical_name TEXT NOT NULL UNIQUE,
  description TEXT
);

CREATE TABLE concept_aliases (
  alias TEXT PRIMARY KEY,
  concept_id BIGINT NOT NULL REFERENCES concepts(id)
);

CREATE TABLE book_concepts (
  book_id BIGINT NOT NULL REFERENCES books(id),
  concept_id BIGINT NOT NULL REFERENCES concepts(id),
  weight NUMERIC(4,3) NOT NULL DEFAULT 0.5,
  perspective TEXT,
  provenance TEXT NOT NULL DEFAULT 'llm_inferred',
  review_status TEXT NOT NULL DEFAULT 'unreviewed',
  PRIMARY KEY (book_id, concept_id)
);

CREATE TABLE book_related_cache (
  book_id BIGINT NOT NULL REFERENCES books(id),
  related_book_id BIGINT NOT NULL REFERENCES books(id),
  score NUMERIC(8,5) NOT NULL,
  explanation TEXT NOT NULL,
  shared_concept_ids JSONB NOT NULL,
  algorithm_version TEXT NOT NULL,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (book_id, related_book_id),
  CHECK (book_id <> related_book_id)
);

CREATE INDEX idx_book_concepts_concept ON book_concepts(concept_id, book_id);
CREATE INDEX idx_related_rank ON book_related_cache(book_id, score DESC);
```

The SQL is illustrative PostgreSQL; adapt to the application's actual DB and migration conventions. If a book can have multiple editions, decide whether enrichment attaches to the **work** and is shared by editions.

## 5. Enrichment API contract

Provide title, author(s), publication year/ISBN/OL ID (if known), and any verified Open Library description. Request **JSON only**, validated server-side against a schema similar to:

```json
{
  "identity_match": "confirmed",
  "knowledge_level": "high",
  "overview": "Two or three sentences explaining the book.",
  "central_argument": "One concise statement of the book's main argument.",
  "concepts": [
    {"name": "Intuition", "salience": 0.95,
     "perspective": "Examines when rapid judgements help or mislead."}
  ],
  "limitations": "Generated from general model knowledge and supplied metadata; not full-text verified."
}
```

Allowed `identity_match`: `confirmed`, `ambiguous`, `unmatched`.  
Allowed `knowledge_level`: `high`, `medium`, `low`, `insufficient`.

**Required model instructions:**
- Identify the exact book; avoid mixing similarly titled works.
- Say `insufficient` for unfamiliar books; do not fabricate arguments or concepts.
- Generate ~80–150 word overview only when confident, plus 3–8 concepts ranked by importance. For a short UI view, display a two-to-three-sentence excerpt.
- Distinguish *book's position* from *general topic*, and avoid attributing exact quotations or chapter details without a source.
- If source description contradicts model knowledge, flag for review.

Start with a capable OpenAI cloud model via API; keep the provider/model configurable. ChatGPT app subscriptions and API usage are separate; estimate cost from token counts and published API prices at implementation time, and enforce a configurable budget cap. Batch carefully with rate-limit backoff and resumable checkpoints.

## 6. Concept normalization

- Normalize capitalization, plurality, Unicode, and punctuation.
- Maintain a curated concept dictionary and alias table rather than letting every LLM response create a new concept indiscriminately.
- Propose new canonical concepts for review when a strong match is not found.
- Preserve original LLM term and perspective for auditability.
- Avoid merging near-neighbours indiscriminately (e.g. **decision-making** is broader than **cognitive bias**).
- Initially use deterministic aliases plus editorial review. Optional embedding similarity may propose candidate merges but should never auto-merge uncertain concepts.

## 7. Automated related-books algorithm (MVP)

Treat books and concepts as a **logical bipartite graph**:

`Book -> HAS_CONCEPT -> Concept <- HAS_CONCEPT <- Book`

This is a graph **data model**, not a dependency on a graph DB engine.

For two books *a* and *b*:

1. Find their shared canonical concepts.
2. Weight each shared concept by both books' concept salience, and down-weight concepts that occur in many books (IDF-style specificity).
3. Normalize the result so books with many generic concepts do not dominate; weighted Jaccard or cosine is an acceptable initial metric.
4. Require a minimum overlap (e.g. one highly distinctive concept or two meaningful concepts), a quality threshold and an enrichment record not in `insufficient` status.
5. Show up to five recommendations, ranked by score; generate the explanation **from the actual shared concepts and saved perspectives**. Do not invent a relationship from title similarity.

Suggested deterministic scoring prototype:

```
idf(c) = log(1 + N / (1 + number_of_books_tagged(c)))
shared(a,b) = sum_over_common_c(min(weight[a,c],weight[b,c]) * idf(c))
union(a,b) = sum_over_all_c(max(weight[a,c],weight[b,c]) * idf(c))
score(a,b) = shared(a,b) / union(a,b)  # weighted Jaccard, if union > 0
```

For stronger recommendations, optionally boost shared concepts where both books have detailed perspectives and present the relationship as `similar`, `complementary`, or `contrasting` **only when an additional supported analysis justifies that label**. Shared concepts alone establish topical relatedness, not agreement, disagreement or influence.

**Example:** *Blink* and *Thinking, Fast and Slow* share intuition, rapid cognition and cognitive bias. Display: “Both examine intuitive judgement; *Blink* discusses its potential power, while *Thinking, Fast and Slow* systematically examines its biases and limits.” This comparison is AI-derived and should be labeled as such.

## 8. API/backend functions

- `POST /admin/enrichment/jobs` — create controlled batch (filter, max books, dry_run).
- `GET /admin/enrichment/jobs/{id}` — totals: queued, completed, needs_review, failed, skipped, token use, estimated cost.
- `POST /admin/books/{id}/enrich` — enrich one book.
- `GET /books/{id}/enrichment` — return labelled overview, argument and concepts.
- `GET /books/{id}/related?limit=5` — list only in-catalogue books with scores, shared concepts and explanation.
- `POST /admin/books/{id}/rebuild-related` — recompute links after edits.

Adapt endpoints to the framework already in use. Cache derived relationships; invalidate when the enriched book or relevant concept assignments change. Run jobs asynchronously (worker/queue or robust background task), with concurrency throttles, retries on 429/5xx, and logs that do not expose API secrets.

## 9. UI requirements

**Book detail:**
- **AI-generated overview** and **Central idea** with small provenance label.
- Concept chips linking to other books sharing that concept.
- **Related books in your library** (maximum five initially), showing title, author, overlapping concepts, and a human-readable reason.
- Graceful empty state: “No strong matches identified yet.”

**Admin:**
- Enrichment run button, progress, cost estimate/actual, rerun failures, review queue, manual lock and regeneration action.
- Editable concept mappings and suppress/publish controls.
- Counts of books enriched, those lacking sufficient model knowledge, and recommendations generated.

## 10. Pilot and acceptance criteria

Pilot titles:
1. *The Soul of a New Machine* — Tracy Kidder
2. *Blink* — Malcolm Gladwell
3. *Jinnah of Pakistan* — Stanley Wolpert
4. *War* (2024) — Bob Woodward
5. *The Invisible Government* — David Wise and Thomas B. Ross
6. *The World Is Flat* — Thomas L. Friedman
7. *Thinking, Fast and Slow* — Daniel Kahneman

**Acceptance tests**
- All seven titles match the intended authors/works, including potentially ambiguous titles.
- Each model response validates against the JSON schema; failures are recoverable.
- No description is treated as verified full-text evidence.
- *Blink* and *Thinking, Fast and Slow* appear as high-quality reciprocal recommendations with a supported explanation.
- Broader cross-topic connections are not misrepresented as strong merely because they share “leadership” or “technology.”
- Missing or uncertain descriptions do not produce fabricated book claims.
- Batch can resume without duplicate rows or losing manual edits.
- Related books are strictly drawn from titles already in the user's library.
- A sampled set of at least 25–50 later titles is manually reviewed for factual accuracy, concept quality, and usefulness before the full 700-book rollout.

## 11. Phased implementation

**Phase A — Data & enrichment:** add schema, Open Library description retrieval, API enrichment, validation, provenance, and single-book screen. Test seven titles.

**Phase B — Concepts & related books:** normalization, scoring, cached book links, recommendations UI and editorial controls. Test for false links.

**Phase C — Scale:** process 25–50 diverse titles, review quality/cost, then roll out incrementally to remaining catalogue with checkpoints and budget limits.

**Phase D — Optional graph engine:** only consider Apache AGE if users need multi-hop exploration (e.g. *books -> concepts -> books -> historical periods*) or relationship-specific graph queries that are cumbersome or slow in the relational model. If adopted, derive graph vertices/edges from the same canonical SQL data; never make AGE the sole source of truth without a migration plan.

## 12. Instructions for coding agent

1. **Inspect current codebase and schema before changing anything**; identify existing Open Library integration, ISBN/work IDs, admin pages, ORM, job infrastructure, and DB engine.
2. Propose a minimal migration and file-by-file implementation plan before writing code.
3. Preserve all existing catalogue, search and import features.
4. Add environment variables for API key, model, concurrency, per-run cap and budget; never hardcode secrets.
5. Implement and test seven-book pilot first; present sample enriched JSON and related-book explanations for approval before bulk processing.
6. Add tests for ambiguous book identity, schema validation, API failures/rate limits, idempotency, manual locks, normalization, scoring, and empty states.
7. Do not install Apache AGE during this milestone unless separately authorized.

---

**Decision summary:** Enrich the existing 700-book catalogue with cloud-LLM overviews and curated concepts; generate **automated concept-based related-book links** in the current database; retain a clean upgrade path to a dedicated graph engine later.
