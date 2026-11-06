#!/usr/bin/env python3
"""Import approved RF447 completion successes without publishing private order data."""
import datetime
import hashlib
import hmac
import json
import os
import re
import sys
import urllib.request
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

def main():
    key = os.environ.get("AQARA_WALLPAD_API_KEY", "").strip()
    if not key:
        raise RuntimeError("Missing AQARA_WALLPAD_API_KEY GitHub secret")
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

    db = json.loads(DB.read_text(encoding="utf-8"))
    existing = db.setdefault("fieldCases", [])
    # Keep compatibility with earlier imports, while using non-reversible IDs for new entries.
    prior = {str(c.get("apiCaseId")) for c in existing if c.get("apiCaseId")}
    hashes = {str(c.get("sourceCaseHash")) for c in existing if c.get("sourceCaseHash")}
    added = eligible = skipped = 0
    needs_apartment_review = 0
    for c in cases:
        if not isinstance(c, dict) or c.get("source") != "COMPLETION" or c.get("result") != "SUCCESS":
            continue
        eligible += 1
        case_id = c.get("id")
        order_id = c.get("installationOrderId")
        raw_id = order_id or case_id
        apt = safe_apartment_name(c.get("siteName"))
        if not raw_id or not apt:
            skipped += 1
            if raw_id and not apt:
                needs_apartment_review += 1
            continue
        case_hash = fingerprint(raw_id, key)
        if case_hash in hashes or (case_id is not None and str(case_id) in prior):
            continue
        # siteAddress is used neither as a fallback nor published: it can identify a customer site.
        record = {
            "apartment": apt,
            "doorlock": "아카라 도어락 (모델 미확인)",
            "wallpadBrand": c.get("brand") or None,
            "wallpadModel": c.get("model") or None,
            "assessment": "site_report",
            "evidence": "아카라라이프 설치 완료 및 본사 승인 기록의 월패드 연동 성공 사례.",
            "sourceType": "아카라라이프 설치 완료 기록",
            "sourceCaseHash": case_hash,
            "publishedOn": c.get("occurredOn") or None
        }
        existing.append(record)
        hashes.add(case_hash)
        added += 1
    if added:
        db["updated"] = datetime.date.today().isoformat()
        DB.write_text(json.dumps(db, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Approved completion successes: {eligible}; newly imported: {added}; skipped missing/unsafe site or ID: {skipped}; cases requiring apartment-name review: {needs_apartment_review}")

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Sync stopped safely: {type(exc).__name__}: {exc}", file=sys.stderr)
        sys.exit(1)
