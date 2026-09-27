# DC CAT — repo guide

Nokia internship prototype: automated document quality checks (broken links,
keyword search, spell/terminology check) over PDF and DOCX. Four people work in
parallel against one shared contract.

## Current state — everything works

| Feature | Status |
|---|---|
| `features/broken_links/` | Done. Flags internal cross-references that no longer resolve, classifies them, and suggests a fix only from headings or captions that exist in the document. Deterministic, no AI, runs offline. |
| `features/keyword_search/` | Done. Lexical occurrence counting plus BGE + FAISS semantic search over one document. Degrades to lexical when the model is absent. |
| `features/spell_check/` | Done. Nokia terminology allow-list, local T5 contextual correction, difflib diff, edit-distance filter against T5 rewordings. |
| `features/multi_doc_keyword_search/` | Done. One exact keyword across many documents. Corpus-level: runs once over the whole set. |

Shared: `common/contracts.py`, `common/parser.py`, `common/excel.py`,
`app/cli.py`, `app/agent/` (LangGraph orchestration + plain-English routing),
`app/mcp_server.py` (features as MCP tools).

`pytest tests/ -q` → **222 passed** from a fresh clone, 262 with the ML models
installed. Skips are tests needing BGE weights or transformers, provisioned per
machine.

## The contract is frozen

`common/contracts.py` defines `Document`, `Page`, `Paragraph`, `Heading`,
`LinkAnnotation`, `Finding`, `FeatureResult`, and the `FeatureModule` protocol
every feature implements. **Don't modify it.** If a change seems necessary
that's a cross-team conversation — stop and explain instead of editing.
Feature-specific data goes in `Finding.details` (a free-form dict), never in
new contract fields.

## Rules

- `process()` must **never raise** — catch everything internally and return
  `FeatureResult(status="failed", error=str(exc))`.
- Stay inside your own `features/<name>/`. Don't edit another team's feature
  folder, `common/parser.py`, or `common/excel.py` without telling the owner.
- Load models lazily, once per instance: `self._model = None` in `__init__`
  plus an `_ensure_model()` method — never inside `process()`.
- **Degrade, don't crash.** A missing optional dependency disables that
  capability, never the whole tool. `KeywordSearchService.is_available()`
  returns `True` even without the embedding model, because returning `False`
  would take working lexical search down with it. `app/cli.py` falls back to
  direct execution when langgraph is absent. The router falls back to keyword
  rules when the BGE weights are absent.
- **Never invent evidence.** `broken_links` only suggests headings and captions
  that exist in the document. Weak evidence → no suggestion, not a guess.
- **Absence of extraction is not evidence of a fault.** If no captions are
  found, plain-text reference checking does not run — "we found nothing to
  check against" must never become "everything is broken".
- Fully local: no cloud APIs, no external LLM calls, no telemetry, no AI vendor
  SDK dependency.
- Routing reads the user's request only, never document text. A PDF can contain
  instructions aimed at a model.
- Don't log document text.
- New dependency → ask first, and say why an existing one won't do.
- **Test on `fixtures/nokia105.pdf` and the NSP guides, not only the synthetic
  fixtures.** Every significant bug so far surfaced on a real document and none
  on the generated ones.

## Workflow

```bash
source .venv/bin/activate
pytest tests/ -q                    # must stay green

python -m app.cli fixtures/demo_manual.pdf --query login --excel report.xlsx
python -m app.cli fixtures/demo_manual.pdf --features broken_links
python -m app.cli fixtures/demo_manual.pdf --ask "are any cross-references broken?"
python -m app.cli docs/ --features multi_doc_keyword_search --query authentication
python -m app.mcp_server            # features as MCP tools
```

Fixtures are committed, so the suite runs straight from a clone.
`make_fixture.py` and `make_demo.py` regenerate `sample.pdf` and
`demo_manual.pdf` if you change them — regenerate **and commit** the PDF, or
the parser tests compare a new script against an old document.

Semantic search and semantic routing need BGE weights in
`models/bge-base-en-v1.5/` (gitignored, ~438 MB) — see README.

A failing test means the code is wrong — don't edit the test to make it pass.

## Measured, not assumed

- **Broken links:** 178 links across two real Nokia NSP user guides → 0 false
  positives. 76 links in the Nokia 105 guide → 0.
- **Routing:** `tests/test_router.py` holds a labelled request set; rules-only
  accuracy is currently 15/15. Add a row whenever a phrasing routes wrongly, so
  a fix for one request cannot silently break another.
- **Semantic search:** relevant answers score ≈ 0.67–0.81, irrelevant ones cap
  near 0.53. No score threshold is applied yet — an honest one needs calibrating
  against real Nokia documents.

## Commits

Plain conventional commits. No `Co-Authored-By` trailers, no "Generated with …"
lines, no AI attribution. Don't commit generated reports (`*.xlsx` is ignored).
Don't upload files through the GitHub web UI — it bypasses `.gitignore`.

## Known gotchas, each hit once already

- PyMuPDF: `import fitz` is deprecated — use `import pymupdf as fitz`.
- PyMuPDF: `doc.set_toc()` invalidates previously-fetched `Page` objects.
  Re-fetch pages (`doc[i]`) *after* `set_toc()`, before inserting links.
- PyMuPDF: a `LINK_NAMED` destination comes back from `page.get_links()` under
  `nameddest`, not `name` — even though `insert_link()` takes `name` as input.
- PyMuPDF: `get_named_dest()` no longer exists and `resolve_link()` takes a URI
  string, not a link dict. Use `doc.resolve_names()`. **The parser must resolve
  named destinations**, or every named link looks dead: a real Nokia guide with
  76 working links reported all 76 broken.
- Link rectangles rarely align with the reference phrase, so anchor text is
  often truncated ("the product. Se"). Prefer the named destination, then the
  link text, then the containing paragraph.
- A figure reference must not be matched against section headings — "Figure 3"
  is not "Section 3". Only Section/Clause/Chapter/Appendix resolve to headings;
  figures and tables resolve to captions.
- Reference patterns must require a designator. `(Table)\s+(\w+)` matched "the
  table lists the options" as Table "lists".
- openpyxl can't write a `list`/`dict` into a cell — `common/excel.py`
  stringifies them first.
- `difflib`'s `ratio()` cannot separate real spelling errors from T5
  rewordings (0.75 vs 0.74). Use Levenshtein distance: ≤2, or ≤1 for words of
  three characters or fewer.
- Real PDFs often have no blank lines, so splitting paragraphs on `\n\n` put a
  whole page in one paragraph and made semantic search useless on them.
- The BGE encoder must be cached per process. Loading it per `route()` call
  printed a progress bar per question and would look like a hang in a GUI.
- Router descriptions are the tuning surface: "check the links" routed to
  spell_check because the broken-links description said "cross-references" and
  never "links", the word people actually type.
- `_load_feature` in `app/cli.py` swallows `ImportError`/`AttributeError`, so a
  genuine bug in a feature looks identical to a feature nobody has written. If a
  feature reports "not implemented yet", import it directly to see the real
  error.

## Open

- **GUI** — requested by Nokia for next week. Not started. Streamlit is the
  likely choice (it was in the original broken-links proposal); PySide6 if a
  native window is required. Avoid PyQt: GPL or paid commercial licence.
- `features/spell_check/agent/` is imported nowhere — wire it in or remove it.
- Whether `_caption_index` recognises Nokia's caption format in the NSP guides.
- Questions outstanding with Nokia: sample PDFs with real broken links, the
  current DC CAT Excel formats, the Acronym/Parameter Excel, and whether the
  tool should suggest fixes only or also repair documents.