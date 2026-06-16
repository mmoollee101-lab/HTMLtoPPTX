# html-to-pptx

완성된 **HTML 발표자료**를 클릭하면 글자가 수정되는 **편집 가능한 PowerPoint(.pptx)** 로 변환하는
간단한 CLI + 웹 앱입니다. 받는 사람이 PPT를 템플릿처럼 내용만 갈아끼워 재사용하는 용도에 맞춰
**스크린샷이 아니라 네이티브 텍스트박스/도형**으로 변환합니다.

## 동작 원리

1. `puppeteer`(headless Chromium)로 HTML을 실제 페이지처럼 렌더링하고 웹폰트 로딩을 기다립니다.
2. `dom-to-pptx`가 각 요소의 computed style을 측정해 절대좌표 PPTX 박스로 배치합니다.
   - 폰트 임베드 → 줄바꿈 안정화
   - SVG는 벡터로 유지 → 차트도 편집 가능
   - 16:9(LAYOUT_16x9) 자동 스케일링
3. 결과 Blob을 Node로 받아 `.pptx` 파일로 저장합니다.

> 편집 가능한 변환은 원리상 **100% 픽셀 동일이 아닙니다**(PowerPoint가 텍스트를 다시 흘림).
> 템플릿 용도라 미세한 어긋남은 정상입니다. 픽셀 완벽 동일이 필요하면 PDF 변환을 쓰세요(범위 밖).

## 설치

```bash
npm install        # puppeteer(크로미움 포함) + dom-to-pptx 설치
```

## CLI 사용법

```bash
# 단일 파일 (출력명 자동: deck.html -> deck.pptx)
node src/cli.js deck.html

# 출력 경로 지정
node src/cli.js deck.html slides.pptx

# 슬라이드 셀렉터 지정 (덱마다 다를 수 있음, 기본값 ".slide")
node src/cli.js deck.html -s "section.slide"

# 배치 모드: 폴더 안의 모든 .html 일괄 변환
node src/cli.js ./decks ./out -s ".page"

# 도움말
node src/cli.js --help
```

| 옵션 | 설명 | 기본값 |
|------|------|--------|
| `<input>` | 입력 .html 파일 **또는** 폴더(배치) | (필수) |
| `[output]` / `-o, --out` | 출력 .pptx(단일) 또는 출력 폴더(배치) | 입력명 기반 자동 |
| `-s, --selector` | 슬라이드 1장에 해당하는 CSS 셀렉터 | `.slide` |
| `-h, --help` | 도움말 | |

셀렉터로 슬라이드를 못 찾으면 **문서에서 발견된 후보 id/class 목록**을 함께 출력합니다.

## 단독 앱 (브라우저 탭이 아닌 독립 창)

```bash
npm run app        # 또는 node src/app.js
```

주소창 없는 **독립 창**으로 떠서 데스크톱 프로그램처럼 사용합니다(Chromium `--app` 모드).
내부적으로 로컬 서버를 띄우고 puppeteer 번들 Chromium으로 창을 관리하며, **창을 닫으면 서버까지
함께 종료**됩니다. 별도 브라우저 설치가 필요 없습니다.

## 웹 앱 (일반 브라우저로 열기)

```bash
npm run web        # 또는 node src/server.js  →  http://localhost:3000
```

HTML 파일을 드래그&드롭(또는 선택)하고 셀렉터를 입력하면 변환된 `.pptx`가 바로 다운로드됩니다.
업로드한 HTML은 임시 파일로 저장 후 변환하고 즉시 삭제합니다.

> 웹 앱은 업로드한 HTML의 **상대 경로 자원을 해석하지 못합니다**. 이미지·폰트가 절대 URL이나
> data: URI로 들어간 **self-contained HTML**을 사용하세요. (로컬 상대 자원이 많은 덱은 CLI 권장.)

## 슬라이드쇼/웹컴포넌트 덱 자동 처리 (흰 슬라이드 방지)

`<deck-stage>`, reveal.js 류처럼 **한 번에 한 슬라이드만 보여주는** 덱은 나머지 슬라이드가
`visibility:hidden`이라 그대로 변환하면 **흰 슬라이드**만 나옵니다. 이 도구는 그런 덱을 자동
감지해, 덱이 제공하는 **print 레이아웃**(모든 슬라이드를 원본 1920×1080로 펼치고 발표자 UI를
숨김)으로 전환한 뒤 변환합니다.

- `<deck-stage>` 덱은 자동으로 print 레이아웃 + `noscale`(1:1 원본 크기) + 슬라이드 단위
  `deck-stage > section` 으로 잡습니다. (셀렉터를 직접 주면 그 값을 우선)
- 다른 프레임워크에서도 강제로 쓰려면 `--print`, 끄려면 `--no-print`.
- 셀렉터를 비우면(또는 생략) 자동 감지합니다.

## 줄바꿈 고정 (기본 동작)

화면의 줄바꿈이 PPT에서 어긋나는 문제를 막기 위해 두 가지를 합니다:

1. **줄바꿈 측정·고정**: 브라우저에서 실제로 줄이 나뉘는 위치를 측정해 그대로 `<br>`로 굽습니다.
2. **자동 줄바꿈 끄기**: 변환된 PPTX의 모든 텍스트박스를 `wrap=none`으로 후처리합니다. 그래서
   PowerPoint가 (Pretendard 등 폰트가 없어) **더 넓은 대체 폰트로 바꿔도 단어를 쪼개지 않습니다**
   (예: "유정희"가 "유정 / 희"로 깨지던 문제 해결).

- 기본값: 켜짐. 끄려면 CLI에 `--no-lock-breaks`.
- 트레이드오프: 줄바꿈이 고정되므로, 글자를 많이 늘려 넣으면 자동으로 다음 줄로 흐르지 않고
  수동으로 줄을 조정해야 할 수 있습니다. (템플릿처럼 비슷한 분량으로 교체하면 문제 없음.)

## 폰트 자동 임베드 (레이아웃 어긋남 방지)

웹폰트(Pretendard, Google Fonts 등)를 **자동으로 임베드**합니다. 핵심은 CDN 스타일시트가
cross-origin이라 브라우저에서는 `@font-face`를 못 읽는데(그래서 임베드 실패 → 더 넓은 대체
폰트로 바뀌어 레이아웃이 어긋남, 예: 이름과 직책이 겹침), 이 도구는 **Node에서 스타일시트를
직접 받아** woff/ttf/otf URL을 추출해 임베드합니다.

- woff2만 제공하는 폰트는 임베드 불가(임베더가 디코드 못 함) → woff/ttf/otf 소스를 추가하세요.
  (Pretendard 정적 CSS는 woff 제공 → 임베드됨. Google Fonts는 Node fetch 시 ttf로 받아져 임베드됨.)
- **굵기(Bold)까지 임베드**: dom-to-pptx는 기본적으로 Regular 한 종류만 임베드해서 두꺼운 글씨가
  "가짜 볼드"로 흐릿하게 보입니다. 이 도구는 볼드가 실제로 쓰인 폰트에 한해 **Bold(700) 굵기를
  추가 임베드**해, 제목 같은 두꺼운 글씨도 진짜 굵기로 렌더되게 합니다.
- 파일이 커지는 게 부담이면 `--no-embed-fonts` 로 끌 수 있습니다(대신 레이아웃이 밀릴 수 있음).

## 자잘한 충실도 보정 (자동)

변환 전 두 가지를 자동 보정합니다(`--no-enhance`로 끔):

1. **인라인 가로 여백 → 공백**: `<span style="margin-left:6px">mm</span>`처럼 인라인 요소의
   좌우 margin은 PPT에서 인접 글자에 붙어버립니다(`±0.1mm`). 여백을 공백 문자로 환산해
   `±0.1 mm`로 유지합니다.
2. **그린 장식 마커 → 글리프**: `::before { content:""; border-radius:50%; border:... }`처럼
   "빈 콘텐츠로 그린 원/사각" 불릿은 텍스트가 없어 dom-to-pptx가 버립니다. 같은 위치에
   ●/○/■/□ 글리프로 살려서 불릿이 사라지지 않게 합니다.

## 충실도 팁 (중요)

- **고정 px 권장**: 슬라이드를 `1920×1080` 같은 고정 px로 작성하세요. `vw/vh/%` 가변 단위는
  16:9 자동 스케일링 시 비율이 흔들립니다.
- **한글**: `word-break: keep-all` + 텍스트박스에 약간의 여유 공간을 두면 내용 교체 시 안 넘칩니다.

## 샘플로 빠르게 확인

```bash
npm run sample     # samples/sample.html -> samples/sample.pptx (3장 16:9 덱)
```

`samples/sample.html`은 제목/부제, 불릿(볼드 포함), 이미지, SVG 막대차트가 있는 3장짜리 16:9 덱입니다.
변환 후 PowerPoint에서 열면 텍스트박스 클릭 시 글자가 편집되고, 차트와 이미지가 도형/그림으로 들어갑니다.

## 프로젝트 구조

```
src/convert.js   변환 엔진 (puppeteer + dom-to-pptx, 줄바꿈 고정) — CLI/웹/앱 공유
src/cli.js       CLI (인자 파싱, 배치, 에러 처리)
src/server.js    웹 서버 (Node 내장 http, 추가 의존성 없음)
src/app.js       단독 창 런처 (Chromium --app 모드)
public/index.html 웹 UI
samples/sample.html 샘플 덱
docs/            PDCA 문서(계획/설계/분석/보고)
```

## 알려진 한계 (수용)

- 편집 가능 변환은 픽셀 완벽 동일이 아님 (정상).
- 픽셀 완벽 동일·편집 불필요 → PDF 변환 사용(범위 밖).
- 웹 앱은 self-contained HTML 권장(상대 자원 미해석).
