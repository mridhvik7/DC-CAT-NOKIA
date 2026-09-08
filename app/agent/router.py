"""Pick features from a plain-English request.

The CLI's --features flag requires the user to know internal feature names.
This turns "are any cross-references broken?" into ["broken_links"] instead.

Two strategies, tried in order:

  1. SEMANTIC. Embed one description per feature with the BGE model the
     project already uses for keyword search, embed the request, and take the
     closest by cosine similarity. Handles paraphrase: "are the links dead?"
     matches without "dead" appearing anywhere in the description.
  2. RULES. Keyword matching. Always available, needs no model, and is used
     whenever the model is absent or no description scores above the
     threshold.

Routing reads the USER'S REQUEST ONLY. Document text is never an input here:
a PDF can contain instructions aimed at a model, and nothing a document says
should influence which checks we run on it.

Nothing in this module changes what a feature does — it only decides which
ones to call.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from typing import Any, Callable, Optional, Sequence

# One sentence per feature, written the way a user would describe the problem
# rather than the way the code is organised. These are what get embedded, so
# the wording matters more than it looks.
FEATURE_DESCRIPTIONS: dict[str, str] = {
    "broken_links": (
        "Check the links and cross-references in the document. Finds broken "
        "links, dead links, and references that no longer point anywhere: "
        "table of contents entries, section references, and figure or table "
        "references."
    ),
    "keyword_search": (
        "Find where a topic or subject is discussed in the document, and show "
        "the pages and passages that cover it, including passages that use "
        "different wording for the same idea. Answers questions about what the "
        "document says."
    ),
    "spell_check": (
        "Find spelling mistakes and typos in the wording: words spelled "
        "wrongly, and correctly spelled words used in the wrong place."
    ),
    "multi_doc_keyword_search": (
        "Find every occurrence of one exact keyword across many documents in "
        "a folder, listing each hit per document."
    ),
}

# Below this cosine similarity, the closest description is not a convincing
# match and the rule-based fallback answers instead. Chosen deliberately low:
# BGE scores sit in a narrow band, and being wrong is worse than falling back.
SIMILARITY_THRESHOLD = 0.55

_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("broken_links", ("link", "links", "cross-reference", "cross reference",
                      "reference", "toc", "table of contents", "broken")),
    ("spell_check", ("spell", "spelling", "typo", "typos", "misspell",
                     "grammar", "wrong word")),
    ("multi_doc_keyword_search", ("across", "every document", "all documents",
                                  "each document", "folder", "these files")),
]

# Requests that mean "run the standard checks", handled before anything else
# because they are common and unambiguous.
_EVERYTHING_RE = re.compile(
    r"\b(everything|all (?:the )?checks?|full check|check it all|"
    r"complete check|run all)\b",
    re.IGNORECASE,
)

_DEFAULT_FEATURES = ["broken_links", "keyword_search", "spell_check"]

# "check the links and the spelling" is two requests, not one. Splitting on
# conjunctions and routing each clause separately is more predictable than
# asking one similarity score to represent two intents.
_CLAUSE_SPLIT_RE = re.compile(r"\s*(?:,|;|\band\b|\balso\b|\bplus\b)\s*", re.IGNORECASE)

_STOPWORDS = frozenset({
    "a", "about", "across", "all", "an", "and", "any", "are", "be", "ch",
    "check", "doc", "docs", "document", "documents", "does", "each", "every",
    "explain", "explains", "file", "files", "find", "for", "in", "is", "it",
    "list", "look", "me", "mention", "mentions", "occurrence", "occurrences",
    "of", "pdf", "pdfs", "say", "says", "search", "show", "tell", "that",
    "the", "these", "this", "those", "to", "what", "where", "which", "with",
})

_QUOTED_RE = re.compile(r"[\"\u201c\u2018\'](.+?)[\"\u201d\u2019\']")
_UPPERCASE_RE = re.compile(r"\b([A-Z][A-Z0-9_]{1,})\b")


@dataclass
class RouteDecision:
    """What to run, and why — the reason is shown to the user."""

    features: list[str]
    options: dict[str, Any] = field(default_factory=dict)
    method: str = "rules"          # "semantic" | "rules"
    confidence: Optional[float] = None
    reason: str = ""


def route(
    request: str,
    encoder: Optional[Callable[[Sequence[str]], Any]] = None,
    threshold: float = SIMILARITY_THRESHOLD,
) -> RouteDecision:
    """Choose features for a plain-English request.

    `encoder` takes a list of strings and returns one vector per string. It is
    injectable so tests can run without the 438 MB model; when omitted the BGE
    model is loaded if it has been provisioned, and the rules are used if not.
    Never raises: an unroutable request falls back to search.
    """
    text = (request or "").strip()
    if not text:
        return RouteDecision(
            features=["broken_links", "keyword_search", "spell_check"],
            method="rules",
            reason="empty request; running the standard checks",
        )

    if _EVERYTHING_RE.search(text):
        return RouteDecision(
            features=list(_DEFAULT_FEATURES),
            method="rules",
            reason="asked for a full check",
        )

    if encoder is None:
        encoder = _load_encoder()

    clauses = [c for c in _CLAUSE_SPLIT_RE.split(text) if c.strip()]
    if len(clauses) > 1:
        combined = _route_clauses(clauses, encoder, threshold)
        if combined is not None:
            return combined

    return _route_single(text, encoder, threshold)


def _route_single(
    text: str,
    encoder: Optional[Callable[[Sequence[str]], Any]],
    threshold: float,
) -> RouteDecision:
    if encoder is not None:
        decision = _route_semantically(text, encoder, threshold)
        if decision is not None:
            return decision
    return _route_by_rules(text)


def _route_clauses(
    clauses: list[str],
    encoder: Optional[Callable[[Sequence[str]], Any]],
    threshold: float,
) -> Optional[RouteDecision]:
    """Route each clause of a compound request and keep every distinct feature.

    Returns None when the clauses all resolve to the same feature, so the
    caller falls back to routing the sentence as a whole — that keeps a normal
    sentence containing "and" from being treated as a compound request.
    """
    features: list[str] = []
    options: dict[str, Any] = {}
    methods: set[str] = set()

    for clause in clauses:
        decision = _route_single(clause.strip(), encoder, threshold)
        methods.add(decision.method)
        for name in decision.features:
            if name not in features:
                features.append(name)
                options.update(decision.options)

    if len(features) < 2:
        return None

    return RouteDecision(
        features=features,
        options=options,
        method="+".join(sorted(methods)),
        reason=f"compound request; routed {len(clauses)} clauses separately",
    )


def _route_semantically(
    text: str, encoder: Callable[[Sequence[str]], Any], threshold: float
) -> Optional[RouteDecision]:
    """Nearest feature description by cosine similarity, or None if unconvincing."""
    try:
        import numpy as np

        names = list(FEATURE_DESCRIPTIONS)
        vectors = np.asarray(encoder(list(FEATURE_DESCRIPTIONS.values())), dtype=float)
        query = np.asarray(encoder([text]), dtype=float)[0]

        scores = _cosine(vectors, query)
        best_index = int(scores.argmax())
        best_score = float(scores[best_index])
        if best_score < threshold:
            return None

        name = names[best_index]
        return RouteDecision(
            features=[name],
            options=_options_for(name, text),
            method="semantic",
            confidence=round(best_score, 3),
            reason=f"closest match to the {name} description ({best_score:.2f})",
        )
    except Exception:
        # Any failure here is a routing problem, not a user problem: fall back.
        return None


def _cosine(matrix, vector):
    import numpy as np

    matrix_norms = np.linalg.norm(matrix, axis=1)
    vector_norm = np.linalg.norm(vector)
    denominator = np.where(matrix_norms * vector_norm == 0, 1e-12,
                           matrix_norms * vector_norm)
    return (matrix @ vector) / denominator


def _route_by_rules(text: str) -> RouteDecision:
    """Keyword matching. Always available, deliberately conservative."""
    lowered = text.lower()
    for name, keywords in _RULES:
        for keyword in keywords:
            if keyword in lowered:
                return RouteDecision(
                    features=[name],
                    options=_options_for(name, text),
                    method="rules",
                    reason=f"matched the keyword {keyword!r}",
                )

    return RouteDecision(
        features=["keyword_search"],
        options=_options_for("keyword_search", text),
        method="rules",
        reason="no check-specific wording; treating the request as a search",
    )


def _options_for(name: str, text: str) -> dict[str, Any]:
    """Only the search features take a parameter."""
    if name == "keyword_search":
        # Semantic search embeds whole sentences perfectly well, so the request
        # is passed through as-is rather than guessing at a keyword.
        return {"query": text}
    if name == "multi_doc_keyword_search":
        # This one matches an exact literal, so a whole question would never
        # match. Strip the question words and keep the content terms.
        return {"query": _keywords(text)}
    return {}


def _keywords(text: str) -> str:
    """Best guess at the single literal term the user wants matched.

    Exact-match search needs one term, not a sentence, so the strongest signal
    wins: an explicitly quoted phrase, then an acronym-shaped token (SIM, PIN),
    then the remaining content words. Rules cannot do this reliably — a request
    with no clear term is exactly the case worth handing to an LLM later.
    """
    quoted = _QUOTED_RE.search(text)
    if quoted and quoted.group(1).strip():
        return quoted.group(1).strip()

    acronym = _UPPERCASE_RE.search(text)
    if acronym:
        return acronym.group(1)

    words = [w for w in re.findall(r"[A-Za-z0-9_]+", text.lower())
             if w not in _STOPWORDS]
    return " ".join(words) if words else text


# The encoder is loaded once per process. route() is called per request, and
# reloading ~438 MB of weights each time made the CLI print a progress bar per
# question; in a GUI it would look like a hang.
_ENCODER_CACHE: list[Any] = []


def _load_encoder() -> Optional[Callable[[Sequence[str]], Any]]:
    """BGE encoder if the weights are provisioned, otherwise None. Cached.

    Uses the same location convention as keyword search (DCCAT_BGE_MODEL_PATH,
    else models/bge-base-en-v1.5). Nothing is ever downloaded at runtime.
    """
    if _ENCODER_CACHE:
        return _ENCODER_CACHE[0]

    path = os.environ.get("DCCAT_BGE_MODEL_PATH") or os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        "models",
        "bge-base-en-v1.5",
    )
    if not os.path.isdir(path):
        _ENCODER_CACHE.append(None)
        return None
    try:
        from sentence_transformers import SentenceTransformer

        model = SentenceTransformer(path, local_files_only=True)
        encoder = lambda texts: model.encode(list(texts), normalize_embeddings=True)
    except Exception:
        encoder = None

    _ENCODER_CACHE.append(encoder)
    return encoder
