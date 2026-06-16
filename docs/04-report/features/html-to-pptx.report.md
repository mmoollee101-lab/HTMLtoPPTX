# 완료 보고서 — HTML → 편집가능 PPTX 변환기 (html-to-pptx)

- 상태: ✅ 완료 (사용자 승인)
- 기간: 2026-06-16 ~ 2026-06-17
- 매칭률(Check): 100% (요구사항 7/7 충족)
- 저장소: https://github.com/mmoollee101-lab/HTMLtoPPT

## 1. 목표 (Plan)
완성된 HTML 발표자료를 **편집 가능한** 네이티브 PPTX(클릭하면 글자 수정)로 변환.
받는 사람이 텍스트만 갈아끼워 템플릿으로 재사용하는 용도. 스크린샷 방식 금지.

## 2. 설계 (Design)
- 엔진: `dom-to-pptx@1.1.10` (computed style → 절대좌표 박스 + 폰트 임베드 + SVG 벡터).
- 렌더: headless Chromium(`puppeteer`)으로 실제 페이지 렌더 후 변환.
- 공유 엔진(`src/convert.js`)을 CLI/웹/단독앱이 함께 사용.

## 3. 구현 (Do)
| 파일 | 역할 |
|------|------|
| `src/convert.js` | 변환 엔진 + 모든 충실도 후처리 |
| `src/cli.js` | CLI(셀렉터·배치·에러·옵션) |
| `src/server.js` | 웹 서버(Node 내장 http) |
| `src/app.js` | 단독 창 런처(Chromium --app) |
| `public/index.html` | 웹 UI |
| `start-app.bat` + 바탕화면 바로가기 | 더블클릭 실행 |
| `samples/sample.html` | 3장 16:9 샘플 |
| `compare/*` | HTML↔PPT 슬라이드별 비교 도구 |

### CLI 옵션
`-s/--selector`, `-o/--out`, `--no-lock-breaks`, `--no-embed-fonts`,
`--no-enhance`, `--print`/`--no-print`, 폴더 입력 시 배치.

## 4. 검증 (Check) — 실사용 덱으로 확인
실제 파일(`직무소개(실무)_발표용.html`, 20슬라이드 deck-stage 덱)로 반복 검증.
사용자 실제 PowerPoint 캡처 20장과 HTML 렌더를 슬라이드별로 비교 → 매우 충실.

| 완료 기준 | 결과 |
|-----------|------|
| 편집가능 네이티브 텍스트 | ✅ `<a:t>` 런 |
| 16:9 유지 | ✅ 9144000×5143500 |
| 줄바꿈 화면과 일치 | ✅ 측정 후 `<br>` 고정 + wrap=none |
| 셀렉터 인자/배치/에러 | ✅ |
| 웹앱 + 단독앱 | ✅ |

## 5. 해결한 이슈 (반복 개선 이력)
1. **흰 슬라이드** — 슬라이드쇼 덱(`<deck-stage>`)이 슬라이드를 겹쳐 숨김 →
   자동 감지 + `noscale` + `@media print` 에뮬레이션으로 전 슬라이드 펼쳐 캡처.
2. **줄바꿈 어긋남** — 브라우저 실제 줄바꿈을 측정해 `<br>`로 고정.
3. **단어 중간 쪼개짐**(유정희→유정/희) — 후처리로 전 텍스트박스 `wrap=none`.
4. **레이아웃 밀림**(이름·직책 겹침) — CDN 폰트가 cross-origin이라 임베드 실패 →
   Node에서 CSS 직접 fetch해 woff/ttf 추출 후 임베드.
5. **글씨 굵기 차이** — family당 Regular만 임베드되던 것에 `<p:bold>` 슬롯 추가.
6. **큰 숫자 배치 어색**(±0.1mm) — line-height:1 혼합폰트 줄간격 버그 →
   문단별 줄간격을 최대 폰트 크기로 보정.
7. **자잘한 충실도 일반화** — 인라인 가로 margin→공백(±0.1 mm), 그린 장식
   의사요소(::before 원)→●/○ 글리프.

## 6. 알려진 한계 (수용)
- 편집가능 변환은 100% 픽셀 동일 아님(PowerPoint 재흐름·렌더 차이). 템플릿 용도라 허용.
- woff2-only 폰트는 임베드 불가(woff/ttf/otf 필요). 볼드 슬롯은 1개(700)만 채움.
- 장식 마커는 글리프 근사(테두리 두께·정확 크기까지 동일하진 않음).
- 본 PC의 문서보안 DRM("DOCUMENT SAFER")이 PowerPoint 이미지/PDF 출력을 암호화 →
  자동 PPT 렌더 불가, 비교는 PPTXjs 근사 또는 사용자 실제 캡처 사용.

## 7. 사용법
```bash
npm install
npm run app            # 단독 창
node src/cli.js deck.html               # 변환 (모든 보정 기본 ON)
node src/cli.js ./decks ./out -s ".page"  # 배치
```

## 8. 학습 포인트
- 슬라이드쇼/웹컴포넌트 덱은 print 미디어 에뮬레이션이 핵심.
- cross-origin CSS는 브라우저 cssRules 차단 → 폰트 임베드는 Node-side fetch로 우회.
- dom-to-pptx의 단일 슬롯 한계는 PPTX(zip) XML 후처리로 보완(jszip+fonteditor-core).
- 충실도 차이는 print-모드 캡처 vs PPTX XML 비교로 원인을 정확히 격리.
