# RF447 검증 DB 배포 전환 (준비 단계)

이 브랜치는 기존 운영 서비스에 영향을 주지 않는 배포 차단 설계 초안입니다.

- `data.json`: 수집 및 수정용 후보 DB
- `published/data.json`: 마지막으로 검증을 통과한 운영용 DB 스냅샷
- `scripts/validate-db.cjs`: DB 구조와 현장 사례의 필수 근거 검증
- `scripts/verify-parity.cjs`: 후보 웹앱과 현재 Cloudflare API의 판정 비교
- `rf447-guarded-promotion.yml`: 수동 실행으로 모든 검증 통과 후 운영용 DB 스냅샷 갱신

## 아직 필요한 작업
1. Cloudflare Worker의 SOURCE를 GitHub Pages의 `published/data.json`으로 전환
2. 웹앱의 데이터 조회 URL도 동일한 `published/data.json`으로 전환
3. 전환 직후 양쪽의 실제 판정 검증
4. 신규 DB 업데이트에 대한 자동 승격과 알림 설정

**주의:** 이 브랜치를 병합하거나 배포 워크플로를 실행하기만 해서는 운영 API가 새 DB 경로로 전환되지 않습니다. 또한 현재 `main/data.json`은 GitHub Pages에서 바로 공개되므로 웹앱 경로를 바꾸기 전에는 배포 차단이 성립하지 않습니다. 새로운 데이터가 API 로직의 변경을 요구하는 경우 현행 API와의 비교가 실패하므로 별도 검토가 필요합니다.
