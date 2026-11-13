#!/usr/bin/env python3
"""Import apartment-level RF447 completion outcomes without publishing private order data."""
import datetime
import hashlib
import hmac
import json
import os
import re
import sys
import urllib.request
import urllib.parse
from pathlib import Path

API = "https://www.aqaralife-service.kr/api/wallpad"
DB = Path("data.json")

def fingerprint(value, secret):
    return hmac.new(secret.encode("utf-8"), str(value).encode("utf-8"), hashlib.sha256).hexdigest()

def safe_apartment_name(value):
    name = str(value or "").strip()
    if not name or len(name) > 90 or re.search(r"\b\d{1,4}\s*(?:동|호)\b", name):
        return None
    # Reject strings that look like full street/parcel addresses or contact information.
    if re.search(r"(?:로|길)\s*\d|\d{2,4}-\d{2,4}|@", name):
        return None
    return name

def resolve_site_name(address, key):
    """Return a unique, exact-address building name; otherwise require manual review."""
    if not address or not key:
        return None
    query = urllib.parse.urlencode({
        "confmKey": key, "currentPage": 1, "countPerPage": 5,
        "keyword": str(address), "resultType": "json"
    })
    try:
        with urllib.request.urlopen(
            "https://business.juso.go.kr/addrlink/addrLinkApi.do?" + query, timeout=15
        ) as response:
            data = json.load(response)["results"]
        if str(data["common"]["errorCode"]) != "0" or str(data["common"]["totalCount"]) != "1":
            return None
        item = data["juso"][0]
        expected = re.sub(r"\\s+", "", str(address).split("(")[0])
        returned = re.sub(r"\\s+", "", item.get("roadAddrPart1", ""))
        if expected != returned:
            return None
        name = safe_apartment_name(item.get("bdNm"))
        if not name or "," in name or "，" in name:
            return None
        return name
    except (OSError, ValueError, KeyError, TypeError, IndexError):
        return None

def main():
    key = os.environ.get("AQARA_WALLPAD_API_KEY", "").strip()
    if not key:
        raise RuntimeError("Missing AQARA_WALLPAD_API_KEY GitHub secret")
    juso_key = os.environ.get("JUSO_API_KEY", "").strip()
    req = urllib.request.Request(API, headers={
        "Authorization": "Bearer " + key, "Accept": "application/json"
    })
    with urllib.request.urlopen(req, timeout=35) as response:
        payload = json.load(response)
    if not isinstance(payload, dict):
        raise RuntimeError("Unexpected API response format")
    cases = payload.get("cases")
    scope = payload.get("scope")
    print(f"API scope: {scope!r}; total cases: {len(cases) if isinstance(cases, list) else 'missing'}", flush=True)
    if scope == "public":
        raise RuntimeError("API still returned public scope with Bearer key; no data imported. Check server authentication.")
    if not isinstance(cases, list):
        raise RuntimeError("API cases missing; no data imported")

    # Schema diagnostics only: never log order details, addresses or field values.
    from collections import Counter
    from itertools import chain
    keys = sorted({k for c in cases if isinstance(c, dict) for k in c.keys()})
    print("API case field names: " + ", ".join(keys), flush=True)
    source_counts = Counter(str(c.get("source", "<missing>")) for c in cases if isinstance(c, dict))
    result_counts = Counter(str(c.get("result", "<missing>")) for c in cases if isinstance(c, dict))
    print("Source categories: " + json.dumps(dict(sorted(source_counts.items())), ensure_ascii=False), flush=True)
    print("Result categories: " + json.dumps(dict(sorted(result_counts.items())), ensure_ascii=False), flush=True)
    # Display field presence counts, not private values.
    relevant = ("status", "installationStatus", "completionStatus", "wallpad", "wallpadStatus",
                "wallpadLinkage", "wallpadLinked", "wallpadIntegration", "linkage",
                "linkageStatus", "isLinked", "completed", "completion")
    present = {k: sum(k in c and c[k] is not None for c in cases if isinstance(c, dict))
               for k in relevant if any(k in c for c in cases if isinstance(c, dict))}
    print("Possible completion/linkage fields (presence counts): " + json.dumps(present, ensure_ascii=False), flush=True)

    db = json.loads(DB.read_text(encoding="utf-8"))
    existing = db.setdefault("fieldCases", [])
    # Keep compatibility with earlier imports, while using non-reversible IDs for new entries.
    prior = {str(c.get("apiCaseId")) for c in existing if c.get("apiCaseId")}
    hashes = {str(c.get("sourceCaseHash")) for c in existing if c.get("sourceCaseHash")}
    added = eligible = skipped = 0
    imported_results = {"SUCCESS": 0, "FAIL": 0, "SPECIAL": 0}
    needs_apartment_review = 0
    for c in cases:
        if not isinstance(c, dict) or c.get("source") != "COMPLETION" or c.get("result") not in ("SUCCESS", "FAIL", "SPECIAL"):
            continue
        # A non-success record is only an outcome at this site, never a model-wide verdict.
        if c.get("result") in ("FAIL", "SPECIAL") and not c.get("siteName") and not c.get("siteAddress"):
            continue
        eligible += 1
        case_id = c.get("id")
        order_id = c.get("installationOrderId")
        raw_id = order_id or case_id
        apt = safe_apartment_name(c.get("siteName"))
        if not apt:
            apt = resolve_site_name(c.get("siteAddress"), juso_key)
        if not raw_id or not apt:
            skipped += 1
            if raw_id and not apt:
                needs_apartment_review += 1
            continue
        case_hash = fingerprint(raw_id, key)
        if case_hash in hashes or (case_id is not None and str(case_id) in prior):
            continue
        # siteAddress is used neither as a fallback nor published: it can identify a customer site.
        outcome = c["result"]
        assessment = {"SUCCESS": "site_report", "FAIL": "site_failure", "SPECIAL": "site_special_review"}[outcome]
        evidence = {"SUCCESS": "아카라라이프 설치 완료 기록의 월패드 연동 성공 사례.", "FAIL": "아카라라이프 설치 완료 기록의 해당 현장 연동 실패 이력.", "SPECIAL": "아카라라이프 설치 완료 기록의 특수 사례. 성공 여부 및 시공 조건 확인 필요."}[outcome]
        record = {
            "apartment": apt,
            "doorlock": "아카라 도어락 (모델 미확인)",
            "wallpadBrand": c.get("brand") or None,
            "wallpadModel": c.get("model") or None,
            "assessment": assessment,
            "evidence": evidence,
            "sourceType": "아카라라이프 설치 완료 기록",
            "sourceCaseHash": case_hash,
            "publishedOn": c.get("occurredOn") or None
        }
        existing.append(record)
        hashes.add(case_hash)
        added += 1
        imported_results[outcome] += 1
    if added:
        db["updated"] = datetime.date.today().isoformat()
        DB.write_text(json.dumps(db, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Eligible completion outcomes: {eligible}; newly imported: {added}; by result: {imported_results}; skipped missing/unsafe site or ID: {skipped}; cases requiring apartment-name review: {needs_apartment_review}")

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Sync stopped safely: {type(exc).__name__}: {exc}", file=sys.stderr)
        sys.exit(1)
