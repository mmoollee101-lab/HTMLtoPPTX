# compare — HTML vs PPTX 슬라이드별 비교 이미지

변환 결과(PPTX)가 원본 HTML과 얼마나 같은지 **슬라이드별로 나란히** 보기 위한 도구.

```bash
# 1) HTML 슬라이드를 이미지로 (변환과 동일하게 noscale + print)
node compare/render-html.js "<deck.html>" compare/html

# 2) PPTX 슬라이드를 이미지로 (PPTXjs 브라우저 렌더러 + 실제 폰트 로드)
node compare/render-pptx.js "<deck.pptx>" compare/pptx

# 3) 위(HTML)/아래(PPT)로 합쳐 슬라이드별 비교 이미지 생성
node compare/combine.js          # -> compare/cmp/cmp_NN.png
```

## 왜 PowerPoint로 직접 안 뽑나
PowerPoint COM(`Slides.Export`)/PDF 내보내기는 가능하지만, 일부 기업 문서보안
DRM(예: "DOCUMENT SAFER")이 PowerPoint **출력 파일을 암호화**해 일반 프로세스가 못 읽습니다.
그래서 PPT 측은 **PPTXjs**(브라우저용 pptx 렌더러)로 렌더합니다.

## 한계 (중요)
PPTXjs는 우리가 만든 pptx의 **박스 좌표·크기·텍스트·폰트**를 반영하지만 PowerPoint와
**픽셀 동일하지는 않습니다**. 특히 `::before` 같은 의사요소 불릿, 줄간격, 미세 위치는 다르게
보일 수 있으니 — 이미지의 차이는 "참고"이지 PowerPoint의 최종 모습 그대로는 아닙니다.
가장 정확한 확인은 실제 PowerPoint에서 여는 것입니다.
