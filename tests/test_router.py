"""Routing: a plain-English request -> which features to run.

The encoder is injected throughout so these run without the 438 MB BGE
weights. The semantic path is exercised with a deterministic bag-of-words
encoder: it is not BGE-quality, but it proves the code path, the threshold
and the fallback behave.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.agent.router import FEATURE_DESCRIPTIONS, route

_VOCAB = sorted(
    {word for text in FEATURE_DESCRIPTIONS.values() for word in text.lower().split()}
    | {"broken", "dead", "links", "spelling", "topic", "keyword", "folder"}
)


def fake_encoder(texts):
    """Bag-of-words vectors — deterministic, no model required."""
    rows = []
    for text in texts:
        words = set(text.lower().replace("?", "").replace(",", "").split())
        rows.append([1.0 if token in words else 0.0 for token in _VOCAB])
    return np.asarray(rows)


def exploding_encoder(texts):
    raise RuntimeError("model unavailable")


# --- rules path: always available, no model ---

@pytest.mark.parametrize(
    "request_text, expected",
    [
        ("are any of the cross-references broken?", "broken_links"),
        ("check the table of contents links", "broken_links"),
        ("check the spelling", "spell_check"),
        ("any typos in here?", "spell_check"),
        ("find every mention of SIM across these files", "multi_doc_keyword_search"),
        ("how do I charge the battery", "keyword_search"),
    ],
)
def test_rules_route_to_the_expected_feature(request_text, expected):
    decision = route(request_text, encoder=lambda texts: None)
    assert decision.features == [expected]


def test_unrecognised_request_defaults_to_search():
    """Better to search than to guess at a check the user did not ask for."""
    decision = route("asdf qwerty zxcv", encoder=lambda texts: None)
    assert decision.features == ["keyword_search"]
    assert decision.method == "rules"


def test_empty_request_runs_the_standard_checks():
    decision = route("", encoder=lambda texts: None)
    assert set(decision.features) == {"broken_links", "keyword_search", "spell_check"}


# --- options ---

def test_search_receives_the_whole_question():
    """BGE embeds sentences fine, so the request is passed through as-is."""
    decision = route("how do I charge the battery", encoder=lambda texts: None)
    assert decision.options["query"] == "how do I charge the battery"


@pytest.mark.parametrize(
    "request_text, expected_keyword",
    [
        ('search all documents for "battery life"', "battery life"),
        ("find every mention of SIM across these files", "SIM"),
        ("find charging across these files", "charging"),
    ],
)
def test_exact_match_search_gets_a_term_not_a_sentence(request_text, expected_keyword):
    decision = route(request_text, encoder=lambda texts: None)
    assert decision.options["query"] == expected_keyword


# --- semantic path ---

def test_semantic_routing_picks_the_closest_description():
    decision = route(
        "are any of the cross-references broken?",
        encoder=fake_encoder,
        threshold=0.15,
    )
    assert decision.features == ["broken_links"]
    assert decision.method == "semantic"
    assert 0.0 <= decision.confidence <= 1.0


def test_a_weak_match_falls_back_to_rules():
    """Being wrong is worse than falling back, so an unconvincing best match
    hands over to keyword rules."""
    decision = route("are the links dead?", encoder=fake_encoder, threshold=0.99)
    assert decision.method == "rules"
    assert decision.features == ["broken_links"]


def test_a_failing_encoder_never_breaks_routing():
    decision = route("check the spelling", encoder=exploding_encoder)
    assert decision.method == "rules"
    assert decision.features == ["spell_check"]


# --- the request is the only input ---

def test_routing_never_reads_document_text():
    """A PDF can contain instructions aimed at a model. Routing takes the
    user's request and nothing else, so document content cannot redirect it.

    Checked structurally rather than by reading the source: the module must
    not import the parser or the Document type, and route() must accept only
    a request string plus its own configuration.
    """
    import inspect

    from app.agent import router

    assert not hasattr(router, "parse"), "router must not import the PDF parser"
    assert not hasattr(router, "Document"), "router must not take document objects"

    parameters = list(inspect.signature(router.route).parameters)
    assert parameters == ["request", "encoder", "threshold"]


# --- compound and "everything" requests ---

@pytest.mark.parametrize(
    "request_text",
    ["check everything", "run all checks", "do a full check"],
)
def test_asking_for_everything_runs_the_standard_checks(request_text):
    decision = route(request_text, encoder=lambda texts: None)
    assert set(decision.features) == {"broken_links", "keyword_search", "spell_check"}


def test_a_compound_request_runs_both_features():
    decision = route("check the links and the spelling", encoder=lambda texts: None)
    assert set(decision.features) == {"broken_links", "spell_check"}


def test_a_sentence_that_merely_contains_and_is_not_compound():
    """Splitting on "and" must not turn one search into several checks."""
    decision = route(
        "how do I charge the battery and what about the SIM",
        encoder=lambda texts: None,
    )
    assert decision.features == ["keyword_search"]


# --- accuracy over a labelled set ---
#
# Routing quality is a measurable property, not a matter of taste. This is the
# set we tune against; add a row whenever a phrasing routes wrongly, so a fix
# for one request cannot silently break another.

LABELLED_REQUESTS = [
    ("are any of the cross-references broken?", "broken_links"),
    ("do the table of contents links still work", "broken_links"),
    # Added after "check the links" routed to spell_check: the broken-links
    # description said "cross-references" but never "links", the word people
    # actually type.
    ("check the links", "broken_links"),
    ("do the links still work", "broken_links"),
    ("check for dead references", "broken_links"),
    ("is the TOC pointing anywhere real", "broken_links"),
    ("check the spelling", "spell_check"),
    ("is anything misspelled?", "spell_check"),
    ("any typos", "spell_check"),
    ("look for grammar problems", "spell_check"),
    ("where does this explain signing in?", "keyword_search"),
    ("how do I charge the battery", "keyword_search"),
    ("what does it say about alarms", "keyword_search"),
    ("find every mention of SIM across these files", "multi_doc_keyword_search"),
    ('search all documents for "battery life"', "multi_doc_keyword_search"),
]


def test_rule_based_routing_accuracy():
    """The rules alone — no model — must get most of the labelled set right."""
    correct = sum(
        1
        for request_text, expected in LABELLED_REQUESTS
        if route(request_text, encoder=lambda texts: None).features[0] == expected
    )
    accuracy = correct / len(LABELLED_REQUESTS)
    assert accuracy >= 0.75, (
        f"rule-based routing accuracy {accuracy:.0%} "
        f"({correct}/{len(LABELLED_REQUESTS)})"
    )
