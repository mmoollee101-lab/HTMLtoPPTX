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

## 잔여/수용 한계
- 픽셀 완벽 동일 아님(설계상 수용, 템플릿 용도).
- 웹 앱은 상대경로 자원 미해석 → self-contained HTML 권장(README/UI 명시).
- 실제 PowerPoint 앱에서의 시각적 최종 확인은 사용자 환경에서 권장(자동 검증은 XML 구조로 수행).
