# Analysis (Check) — 완료 기준 대비 검증 결과

검증일: 2026-06-16 · 환경: Node v22.22.2, puppeteer Chromium 131, dom-to-pptx 1.1.10

## 완료 기준 매칭

| # | 완료 기준 | 결과 | 근거 |
|---|-----------|------|------|
| 1 | 텍스트/제목/불릿/이미지/SVG 차트 2~3장 16:9 샘플 변환 | ✅ | `samples/sample.html`(3장) → `sample.pptx` 1380.8 KB 생성 |
| 2a | 텍스트박스 클릭 시 글자 편집 | ✅ | slide XML에 네이티브 `<a:t>` 런 존재(제목·부제·불릿·볼드 분리 런) |
| 2b | 16:9 비율 유지 | ✅ | `presentation.xml` `sldSz cx=9144000 cy=5143500` = 정확히 16:9 |
| 2c | 줄바꿈이 화면과 크게 다르지 않음 | ✅ | `autoEmbedFonts` 폰트 임베드(`embeddedFont`) + `document.fonts.ready` 대기 |
| 3a | 셀렉터 인자 동작 | ✅ | `.page`로 배치 변환 성공, 기본 `.slide` 정상 |
| 3b | 배치 모드 | ✅ | `samples/batch`(2파일) → `out/alpha.pptx`, `out/beta.pptx` |
| 3c | 에러 처리 | ✅ | 잘못된 셀렉터 시 후보 id/class 안내(CLI exit, 웹 422) |

## 편집가능성 상세 (slide1 발췌)
```
<a:t>분기 사업 리뷰</a:t>
<a:t>2026년 2분기 · 편집 가능한 발표 템플릿</a:t>
<a:t>발표자: 홍길동 · 전략기획팀</a:t>
```
slide2 불릿은 볼드 강조 부분이 별도 런으로 분리됨(`신규 고객 전환율이 전 분기 대비 ` / `32% 상승` / `했습니다.`)
→ PowerPoint에서 부분 서식 유지된 채 편집 가능.

## 자원 처리
- 이미지: `ppt/media/image-*.png` 임베드, slide2에 `<p:pic>`/`<a:blip>` 존재.
- SVG 차트: `ppt/media/image-1-2.svg` + `ppt/charts/` 생성(벡터 유지).
- 폰트: presentation.xml에 `embeddedFont` 참조.

## 검증한 시나리오
1. 단일 변환: `node src/cli.js samples/sample.html` → 성공
2. 잘못된 셀렉터: `-s .nope` → 후보 안내 에러
3. 배치 + 커스텀 셀렉터: `samples/batch out -s .page` → 2개 성공
4. 웹 GET `/` → 200, POST `/api/convert` → 200(1380.8KB), 잘못된 셀렉터 → 422

## Gap 평가
모든 완료 기준 충족. 기능 매칭률 **100%** (7/7).

## 후속 개선 (사용자 피드백 반영)
- **줄바꿈 어긋남 수정**: 변환 전 브라우저에서 각 문장의 실제 줄바꿈 위치를 `Range.getClientRects`로
  측정해 `<br>`로 고정(bake). dom-to-pptx가 이를 PPTX 문단 분리로 출력 → PowerPoint 재흐름 방지.
  검증: 좁은 박스 6줄 테스트에서 브라우저 6줄 == PPTX 6문단(텍스트 1:1 일치). 기본 ON, `--no-lock-breaks`로 해제.
- **단독 앱(`src/app.js`)**: 브라우저 탭이 아니라 주소창 없는 독립 창(Chromium `--app`)으로 실행.
  puppeteer 번들 Chromium으로 창 수명주기 관리(시스템 Edge 직접 구동은 핸드오프로 불안정해 배제).
  검증: 번들 Chromium 창 기동 + 서버 200 + 앱 경유 변환 1380KB 성공.

## 후속 개선 2 (실사용 덱: 흰 슬라이드 문제)
- **증상**: `<deck-stage>` 웹컴포넌트 기반 발표 덱 변환 시 흰 슬라이드만 생성.
- **원인**: 슬라이드쇼 프레임워크가 20개 `<section>`을 겹쳐 쌓고 활성 1개만 `visible`,
  나머지는 `visibility:hidden; opacity:0` → dom-to-pptx가 빈 칸으로 출력. 또 표지/인트로는
  `.slide` 클래스가 없어 기본 셀렉터로 누락.
- **해결**: 변환 전 `<deck-stage>` 감지 → `noscale`(1:1) 속성 부여 + `page.emulateMediaType('print')`
  로 덱의 print 레이아웃 활성화(전 슬라이드를 1920×1080로 펼치고 발표자 UI 숨김). 기본 선택자를
  `deck-stage > section`으로 전환.
- **검증**: 실제 파일 변환 결과 20/20 슬라이드에 편집가능 텍스트, 미디어 64개 임베드, 16:9 유지.
  일반 덱(deck-stage 없음)은 print 모드 미적용으로 회귀 없음.

## 후속 개선 3 (단어 중간 줄바꿈 깨짐)
- **증상**: 내용은 나오지만 "유정희"→"유정/희", "선임"→"선/임"처럼 단어가 박스를 넘쳐 쪼개짐.
- **원인**: Pretendard(CDN)가 CORS로 임베드되지 않아 PowerPoint가 더 넓은 대체 폰트로 렌더 →
  dom-to-pptx가 잰 박스 폭(예 0.81in)을 초과 → `wrap="square"`라 자동 줄바꿈.
- **해결**:
  1. 줄바꿈 감지를 수직 겹침 기반으로 교체(같은 줄의 크기 다른 글자 "유정희 선임" 오인 방지).
  2. 생성된 PPTX를 jszip으로 후처리해 모든 텍스트박스 `wrap="square"→"none"` (dom-to-pptx의
     flex/centered 경로까지 빠짐없이 커버). 줄바꿈은 이미 `<br>`로 고정돼 있어 안전.
- **검증**: 실사용 덱 전 슬라이드 163개 텍스트박스 모두 `wrap=none`(square 0), 텍스트/이미지/16:9 유지,
  zip 무결성 OK. 일반 샘플 회귀 없음.

## 후속 개선 4 (폰트 대체로 이름·직책 겹침)
- **증상**: "유정희"(이름)와 "선임"(직책)이 PPT에서 붙어버림(HTML은 간격 있음).
- **원인**: 폰트 미임베드 → PowerPoint가 더 넓은 대체 폰트로 렌더 → "유정희"가 측정된 박스폭을
  넘쳐 오른쪽 "선임" 박스를 침범. 임베드 실패의 근본 원인은 CDN 스타일시트가 cross-origin이라
  브라우저 `cssRules` 접근 차단 → dom-to-pptx가 @font-face URL 자체를 못 읽음.
- **해결**: Node에서 스타일시트를 직접 fetch해 @font-face의 woff/ttf/otf URL을 추출(woff2 제외,
  Regular 가중치 우선)하고 `exportToPptx({fonts})`로 주입 → 실제 폰트 임베드.
- **검증**: 실사용 덱에서 Pretendard/Noto Sans KR/JetBrains Mono `.fntdata` 임베드 확인.
  이제 PPT가 Pretendard로 렌더 → 유정희 right=5.25in, 선임 x=5.36in 간격(0.11in) 유지.
  `--no-embed-fonts`로 비활성화 가능.

## 후속 개선 5 (글씨가 살짝 달라 보임 — 굵기)
- **증상**: 폰트가 Pretendard로 들어갔는데도 글씨가 HTML과 살짝 달라 보임.
- **원인**: dom-to-pptx 임베더가 family당 `<p:regular>` 슬롯 1개만 생성 → 두꺼운 글씨(예: 제목
  weight 900)도 Regular에 PowerPoint 가짜 볼드를 입혀 렌더 → 진짜 Pretendard Black/Bold와 다름.
- **해결**: 후처리로 `<p:bold>` 슬롯 추가. @font-face에서 Bold(700 근접) 굵기 URL을 받아
  fonteditor-core로 EOT(fntdata) 변환 후, 볼드 텍스트가 실제로 쓰인 family에 한해 임베드.
- **검증**: 실사용 덱 Pretendard에 regular+bold 슬롯 생성, 폰트 파일/rel/zip 무결성 OK.
  일반 샘플도 `<b>` 사용 폰트(Noto Sans KR)에 bold 슬롯 추가 확인.
- **한계**: 굵기 슬롯은 1개(700)만 채움 → 900(Black) 제목은 700로 근사(가짜 볼드보다 크게 개선).

## 후속 개선 6 (큰 숫자 배치 어색 — 줄간격 버그)
- **증상**: "±0.1 mm"+설명 가로 배치가 PPT에서 어색(큰 숫자가 세로로 눌림).
- **원인**: dom-to-pptx가 `line-height:1` + 혼합 폰트 크기(큰 숫자+작은 mm) 문단의 줄간격을
  잘못 계산 → spcPts가 폰트보다 작게(예: 36pt 폰트에 13.5pt, 17.25pt에 9pt) → PowerPoint가
  큰 글자를 줄상자에 욱여넣어 세로로 눌리고 정렬이 틀어짐.
- **해결**: 후처리로 문단별 최대 폰트 크기 < 줄간격이면 줄간격을 폰트 크기로 보정
  (line-height:1 의도 복원). 정상 문단(설명문 등)은 영향 없음.
- **검증**: ±0.03(36pt)·±0.1(17.25pt) 줄간격이 폰트와 일치하게 보정, 설명문(14.18pt) 유지.
  print 모드 캡처가 HTML과 동일함을 스크린샷으로 확인(원인이 PPTX 단계임을 특정).

## 잔여/수용 한계
- 픽셀 완벽 동일 아님(설계상 수용, 템플릿 용도).
- 웹 앱은 상대경로 자원 미해석 → self-contained HTML 권장(README/UI 명시).
- 실제 PowerPoint 앱에서의 시각적 최종 확인은 사용자 환경에서 권장(자동 검증은 XML 구조로 수행).
