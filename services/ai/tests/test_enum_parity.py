"""Fails CI if the Python enums drift from packages/shared/enums.json."""

import json
from pathlib import Path

from app.enums import Category, ComplaintStatus, Priority

ENUMS_JSON = Path(__file__).resolve().parents[3] / "packages" / "shared" / "enums.json"


def test_enums_match_shared_contract() -> None:
    shared = json.loads(ENUMS_JSON.read_text(encoding="utf-8"))
    assert [e.value for e in ComplaintStatus] == shared["ComplaintStatus"]
    assert [e.value for e in Category] == shared["Category"]
    assert [e.value for e in Priority] == shared["Priority"]
