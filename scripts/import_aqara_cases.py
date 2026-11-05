#!/usr/bin/env python3
"""Read-only Aqara wallpad case importer. Never publishes addresses or order IDs."""
import json, os, sys, urllib.request, datetime
from pathlib import Path

API = "https://www.aqaralife-service.kr/api/wallpad"
DB = Path("data.json")
def main():
    key = os.environ.get("AQARA_WALLPAD_API_KEY", "").strip()
    if not key:
        print("Missing AQARA_WALLPAD_API_KEY secret; no changes.")
        return 0
    req = urllib.request.Request(API, headers={"Authorization": "Bearer " + key, "Accept":"application/json"})
    with urllib.request.urlopen(req, timeout=35) as response:
        payload = json.load(response)
    if payload.get("scope") == "public":
        raise RuntimeError("Authenticated full-scope API access required; refusing partial import")
    cases = payload.get("cases")
    if not isinstance(cases, list):
        raise RuntimeError("API cases missing; refusing changes")
    db = json.loads(DB.read_text(encoding="utf-8"))
    existing = db.setdefault("fieldCases", [])
    ids = {str(c.get("apiCaseId")) for c in existing if c.get("apiCaseId")}
    added = 0
    for c in cases:
        if not isinstance(c, dict) or c.get("source") != "COMPLETION":
            continue
        result = c.get("result")
        if result not in ("SUCCESS", "SPECIAL"):
            continue
        case_id = str(c.get("id") or "").strip()
        apt = str(c.get("siteName") or "").strip()
        if not case_id or not apt or case_id in ids:
            continue
        # Publish only site-level, non-personal data; never publish siteAddress,
        # installationOrderId, failReason, installer notes, or raw API records.
        record = {
            "apartment": apt,
            "doorlock": "아카라 도어락 (모델 미확인)",
            "wallpadBrand": c.get("brand") or None,
            "wallpadModel": c.get("model") or None,
            "assessment": "special_installation" if result == "SPECIAL" else "site_report",
            "evidence": "아카라라이프 설치 완료 시스템에 등록된 RF447 연동 성공 사례." if result == "SUCCESS" else "아카라라이프 설치 완료 시스템에 등록된 특수 시공 성공 사례.",
            "sourceType": "아카라라이프 설치 완료 기록",
            "apiCaseId": case_id,
            "publishedOn": c.get("occurredOn") or None
        }
        existing.append(record)
        ids.add(case_id)
        added += 1
    if added:
        db["updated"] = datetime.date.today().isoformat()
        DB.write_text(json.dumps(db, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"API cases: {len(cases)}, new verified completion successes: {added}")
    return 0
if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(f"Sync failed safely: {type(exc).__name__}: {exc}", file=sys.stderr)
        sys.exit(1)
