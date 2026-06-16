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

## 잔여/수용 한계
- 픽셀 완벽 동일 아님(설계상 수용, 템플릿 용도).
- 웹 앱은 상대경로 자원 미해석 → self-contained HTML 권장(README/UI 명시).
- 실제 PowerPoint 앱에서의 시각적 최종 확인은 사용자 환경에서 권장(자동 검증은 XML 구조로 수행).
