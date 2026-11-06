#!/usr/bin/env python3
"""Read-only test of Juso building lookup and existing RF447 deduplication."""
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

# Public street address of the previously confirmed apartment complex; no unit or customer details.
TEST_ADDRESS = "경기도 남양주시 순화궁로 384"
EXPECTED_NAME = "대원 칸타빌"

def main():
    key = os.environ.get("JUSO_API_KEY", "").strip()
    if not key:
        print("FAIL: JUSO_API_KEY secret is missing")
        return 1
    query = urllib.parse.urlencode({
        "confmKey": key, "currentPage": "1", "countPerPage": "10",
        "keyword": TEST_ADDRESS, "resultType": "json"
    })
    req = urllib.request.Request("https://business.juso.go.kr/addrlink/addrLinkApi.do?" + query)
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            result = json.load(response)["results"]
    except Exception as exc:
        print("FAIL: Juso request failed (" + type(exc).__name__ + ")")
        return 1
    common = result.get("common", {})
    if str(common.get("errorCode")) != "0":
        print("FAIL: Juso returned error code " + str(common.get("errorCode")))
        return 1
    entries = result.get("juso", [])
    print("Juso matching candidates:", len(entries))
    norm = lambda x: re.sub(r"\\s+", "", str(x or "").split("(")[0])
    exact = [e for e in entries if norm(e.get("roadAddrPart1")) == norm(TEST_ADDRESS)]
    names = sorted({str(e.get("bdNm", "")).strip() for e in exact if e.get("bdNm")})
    print("Exact street-address matches:", len(exact))
    print("Exact-match building names:", names)
    if len(exact) != 1 or len(names) != 1:
        print("REVIEW: ambiguous or missing building name; no database change")
        return 1
    actual = names[0]
    if norm(actual) != norm(EXPECTED_NAME):
        print("REVIEW: official building name differs from existing name; no database change")
        return 1
    data = json.loads(Path("data.json").read_text(encoding="utf-8"))
    cases = data.get("fieldCases", [])
    matches = [c for c in cases if EXPECTED_NAME in json.dumps(c, ensure_ascii=False)]
    print("Existing field-case matches:", len(matches))
    if not matches:
        print("REVIEW: expected case not found; no database change")
        return 1
    print("PASS: Juso address resolution and existing case match; read-only test")
    return 0

if __name__ == "__main__":
    sys.exit(main())
