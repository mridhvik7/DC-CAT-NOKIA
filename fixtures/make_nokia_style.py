"""Generate fixtures/nokia_style.pdf — a document in Nokia's cross-reference style.

Nokia's documentation team sent us examples of how their cross-references are
written. They carry the destination TITLE as the link text rather than a
number, so a broken one leaves a gap in the sentence:

    working : "See Modifying XYZ parameters to find information on..."
    broken  : "See  to find information on..."

They also flagged a case that must NOT be reported: "See/Refer to XYZ
technical support note." is a reference to another document, not a
cross-reference.

This fixture puts all three kinds in one document so the behaviour can be
demonstrated and checked. Nothing here is real Nokia content; it is generated
from this script and uses their placeholder "XYZ" naming.

Usage:
    python fixtures/make_nokia_style.py
"""

from __future__ import annotations

import os
import textwrap

import pymupdf

OUT = os.path.join(os.path.dirname(__file__), "nokia_style.pdf")

MARGIN = 62
WIDTH = 80
LINE = 15

# (heading, [paragraphs])
SECTIONS = [
    ("Modifying XYZ parameters", [
        "This section describes how to interrogate and modify XYZ parameter "
        "values on the RNC. Parameter changes take effect after the next "
        "configuration commit.",
    ]),
    ("Configuring Signaling Connections", [
        "Signaling connections are configured per adjacent network element. "
        "The connection state is reported by the XYZ Service Indicator.",
    ]),
    ("Activating XYZ Service Indicator", [
        "Activate the service indicator before commissioning. The indicator "
        "reports availability to the network management layer.",
    ]),
    ("Overview", [
        # Intact cross-references — must not be reported.
        "See Modifying XYZ parameters to find information on how to "
        "interrogate and modify XYZ parameter values.",
        "For more information, see Configuring Signaling Connections in XYZ "
        "RNC Network.",
        "For instructions, refer to Activating XYZ Service Indicator in the "
        "XYZ documentation.",
        "Figure: WCDMA RAN upgrade path shows the top-down approach of the "
        "upgrade path for the radio network.",
        "The software versions supporting the different releases of the XYZ "
        "elements are depicted in Table: XYZ Compatibility.",
        # Not a cross-reference — Nokia asked for these to be ignored.
        "See/Refer to XYZ technical support note.",
    ]),
    ("Commissioning", [
        # Broken cross-references: the linked title has been removed, leaving
        # a gap. These are the two cases Nokia showed us.
        "See  to find information on how to interrogate and modify XYZ "
        "parameter values.",
        "For more information, see  in XYZ RNC Network.",
        "Once commissioning is complete, verify the configuration against the "
        "compatibility table before handover.",
    ]),
]


def build() -> str:
    doc = pymupdf.open()

    title = doc.new_page()
    title.insert_text((MARGIN, 150), "XYZ RNC", fontsize=22)
    title.insert_text((MARGIN, 180), "Configuration and Commissioning Guide",
                      fontsize=16)
    title.insert_text((MARGIN, 215),
                      "Synthetic demonstration document - not real Nokia "
                      "documentation.", fontsize=9)

    toc_entries = []
    for heading, paragraphs in SECTIONS:
        page = doc.new_page()
        toc_entries.append([1, heading, doc.page_count])
        page.insert_text((MARGIN, 90), heading, fontsize=14)
        y = 130.0
        for paragraph in paragraphs:
            for line in textwrap.wrap(paragraph, WIDTH):
                page.insert_text((MARGIN, y), line, fontsize=10)
                y += LINE
            y += LINE * 0.7

    doc.set_toc(toc_entries)
    doc.save(OUT)
    pages = doc.page_count
    doc.close()
    print(f"wrote {OUT} ({pages} pages)")
    print("expected: 2 missing cross-references, on the Commissioning page")
    return OUT


if __name__ == "__main__":
    build()
