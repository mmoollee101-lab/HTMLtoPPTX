# Design — HTML → 편집가능 PPTX

## 아키텍처 개요
```
                 ┌────────────────────────┐
   CLI  ───────► │  src/convert.js        │
                 │  convertHtmlToPptx()   │ ──► .pptx Buffer
   Web ────────► │  (puppeteer+dom-to-pptx)│
                 └────────────────────────┘
```
CLI와 웹 앱은 동일한 변환 엔진(`convert.js`)을 공유한다. 중복 로직 없음.

## 모듈

### src/convert.js — 변환 엔진 (핵심)
- `resolveBundlePath()`: `require.resolve('dom-to-pptx')`(=dist/dom-to-pptx.cjs)에서
  같은 디렉터리의 `dom-to-pptx.bundle.js`(전역 `domToPptx` 노출)를 해석.
  ※ 패키지 exports가 `./package.json` 서브패스를 막아 메인 해석 경로 사용.
- `convertHtmlToPptx(htmlPath, { slideSelector, browser, log })`:
  1. puppeteer 실행(없으면 자체 실행, 배치 시 외부 browser 재사용) — `--no-sandbox`.
  2. viewport 1920×1080, `file://` 로드, `waitUntil:'networkidle0'`.
  3. `document.fonts.ready` 대기(폰트 메트릭 정확도).
  4. **셀렉터 사전 검증** — 0개면 후보 id/class를 모아 친절한 에러(`code:'NO_SLIDES'`).
  5. `addScriptTag`로 번들 주입 → `domToPptx.exportToPptx(els, {...})`.
     - `skipDownload:true, autoEmbedFonts:true, svgAsVector:true, layout:'LAYOUT_16x9'`.
  6. Blob → FileReader.readAsDataURL → base64 → `Buffer.from(base64,'base64')`.

### src/cli.js — CLI
- 인자: `<input>` `[output]` `-s/--selector` `-o/--out` `-h/--help`.
- 입력이 폴더면 **배치 모드**: 내부 `.html` 정렬 후 browser 1개를 재사용해 순회.
  개별 실패는 모아서 보고하고 마지막에 exit 1.
- 단일 파일: 출력 생략 시 `deck.html → deck.pptx`.

### src/server.js — 웹 앱 (Node 내장 http만)
- `GET /` 정적 서빙(public), `POST /api/convert`(JSON: html/selector/name).
- 업로드 HTML을 OS 임시파일로 저장 → 공유 browser로 변환 → `.pptx` 스트리밍 → 임시파일 삭제.
- 페이로드 25MB 제한, 에러는 422 + 메시지.

### public/index.html — 웹 UI
- 드래그&드롭/파일선택 → FileReader로 텍스트 읽어 POST → Blob 다운로드.
- 셀렉터 입력 + 충실도 팁 표시.

## 핵심 설계 결정
| 결정 | 이유 |
|------|------|
| browser 재사용(배치/웹) | 크로미움 기동 비용 절감 |
| 셀렉터 사전 검증 | 무거운 번들 주입 전에 빠른 실패 + 후보 안내 |
| 엔진 공유(convert.js) | CLI/웹 동작 일치, 유지보수 단순화 |
| 웹은 내장 http | 추가 의존성 0, 단순 |

## 한계 (설계상 수용)
- 픽셀 완벽 동일 아님(PowerPoint 재흐름).
- 웹 앱은 상대 경로 자원 미해석 → self-contained HTML 권장.
