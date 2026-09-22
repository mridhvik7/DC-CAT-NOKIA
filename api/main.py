from __future__ import annotations

import os
import tempfile

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from common.parser import parse

app = FastAPI(title="DC-CAT-NOKIA API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173","http://localhost:5174",],
    
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


FEATURE_NAME_MAP = {
    "spell-check": "spell_check",
    "broken-links": "broken_links",
    "keyword-search": "keyword_search",
}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/analyze")
async def analyze(
    file: UploadFile = File(...),
    features: str = Form(...),
    query: str | None = Form(None),
):
    selected_features = [
        FEATURE_NAME_MAP[name.strip()]
        for name in features.split(",")
        if name.strip() in FEATURE_NAME_MAP
    ]

    if not selected_features:
        return {
            "status": "error",
            "message": "No valid features selected.",
        }

    suffix = os.path.splitext(file.filename or "")[1].lower()

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
        temp_file.write(await file.read())
        temp_path = temp_file.name

    try:
        document = parse(temp_path)
        from app.agent.graph import agent_graph
        result = agent_graph.invoke(
            {
                "document": document,
                "options": {"query": query},
                "selected_features": selected_features,
            }
        )

        return {
            "status": "success",
            "filename": file.filename,
            "page_count": document.page_count,
            "results": [
                {
                    "feature": feature_result.feature,
                    "status": feature_result.status,
                    "error": feature_result.error,
                    "meta": feature_result.meta,
                    "findings": [
                        {
                            "feature": finding.feature,
                            "severity": finding.severity,
                            "page": finding.page,
                            "message": finding.message,
                            "confidence": finding.confidence,
                            "details": finding.details,
                        }
                        for finding in feature_result.findings
                    ],
                }
                for feature_result in result["results"]
            ],
        }

    finally:
        os.unlink(temp_path)