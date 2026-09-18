# DeckSplitter

`.pptx` 파일을 **Markdown + 미디어 파일**로 분해하는 정적 웹앱입니다.
모든 처리는 브라우저 안에서만 이루어지며, 파일은 어디로도 전송되지 않습니다.

```
.pptx  →  파일명.md  +  images/  audio/  video/   (ZIP 하나로 내려받기)
```

## 빠른 시작

```bash
npm install
npm run dev      # 개발 서버
npm run build    # dist/ 에 정적 파일 생성
npm run verify   # 타입검사 + 테스트 + 빌드 + 오프라인 검사
```

`dist/` 는 정적 파일 묶음이라 아무 정적 호스팅에나 올리면 되고,
`file://` 로 열어도 동작합니다(`base: './'`).

## 배포

`main` 에 코드가 들어가면 GitHub Actions 가 빌드해서 GitHub Pages 에 올립니다.

**https://yenniepark.github.io/decksplitter/**

처음 한 번은 저장소 **Settings → Pages → Source** 를 `GitHub Actions` 로 바꿔줘야
합니다. 그 뒤로는 `main` 에 머지될 때마다 자동으로 갱신됩니다.

배포 전에 타입검사 · 테스트 · 빌드 · 오프라인 검사를 모두 돌리므로, 하나라도
실패하면 사이트에 올라가지 않습니다.

| 워크플로 | 시점 | 하는 일 |
| --- | --- | --- |
| `.github/workflows/ci.yml` | PR, `main` 푸시 | 타입검사 · 테스트 · 빌드 · 오프라인 검사 |
| `.github/workflows/deploy.yml` | `main` 푸시 | 위 검사 전부 + Pages 배포 |

`base: './'` 로 상대경로를 쓰기 때문에 `/decksplitter/` 같은 하위 경로에서도 그대로
동작합니다. 다른 호스팅(Netlify · Vercel · 사내 서버)에 올릴 때도 `dist/` 를
통째로 올리면 됩니다.

## 만들어지는 결과물

파일 하나를 넣으면 ZIP 최상위가 평평합니다.

```
발표자료.zip
├── 발표자료.md
├── images/slide03_01.png
├── audio/slide07_01.mp3
└── video/slide09_01.mp4
```

여러 개를 넣으면 파일별 폴더로 나뉩니다(`A/A.md`, `B/B.md`, …).

미디어 파일명은 `slide<슬라이드번호>_<슬라이드 내 순번>.<확장자>` 형식입니다.
슬라이드 매핑은 `ppt/slides/_rels/slideN.xml.rels` 의 관계(rId)를 따라
`../media/…` 를 실제 파일로 풀어서 결정합니다.

### Markdown 변환 규칙

| PPTX | Markdown |
| --- | --- |
| 제목 플레이스홀더(`title` / `ctrTitle`) | `## 제목` (옵션을 끄면 `## 슬라이드 N`) |
| 본문 단락 + `a:pPr@lvl` | `- 항목` / 들여쓴 중첩 목록 |
| `a:buAutoNum` | `1.` `2.` `3.` 번호 목록 |
| `a:buNone` | 글머리표 없는 일반 문단 |
| `a:rPr@b` / `@i` | `**굵게**` / `*기울임*` |
| `a:tbl` | 마크다운 표 (첫 행이 머리글) |
| `p:pic` 의 이미지 | `![대체텍스트](images/slide03_01.png)` |
| `a:videoFile` / `a:audioFile` | `[동영상: …](video/…)` / `[오디오: …](audio/…)` |
| `notesSlide` | `> **발표자 노트**` 인용문 |
| `a:br` | 줄바꿈 (표 셀 안에서는 `<br>`) |

슬라이드 순서는 파일 이름이 아니라 `ppt/presentation.xml` 의 `p:sldIdLst`
순서를 따릅니다. 슬라이드 번호·날짜·바닥글 플레이스홀더는 건너뜁니다.

## 보안

이 앱은 **네트워크에 나가는 코드를 한 줄도 포함하지 않습니다.**
`fetch` · `XMLHttpRequest` · `WebSocket` · `sendBeacon` · `importScripts` 를
쓰지 않고, 분석·추적 스크립트도 없습니다.

### CSP

빌드 산출물 `dist/index.html` 에 다음 정책이 들어갑니다.

```
default-src 'self'; connect-src 'none'; script-src 'self';
style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;
media-src 'self' blob:; font-src 'self'; worker-src 'self' blob:;
object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'
```

`connect-src 'none'` 이므로 설령 코드가 들어가더라도 런타임에서 막힙니다.
개발 서버에서만 HMR WebSocket 을 위해 `connect-src` 를 완화하며
(`vite.config.ts` 의 `cspPlugin`), 배포되는 파일에는 항상 `'none'` 이 들어갑니다.

`npm run check:offline` 이 빌드 결과를 훑어 네트워크 API 호출·외부 출처
참조·CSP 누락을 검사합니다. 하나라도 걸리면 0이 아닌 코드로 종료합니다.

### ZIP 폭탄 방어

압축을 **풀기 전에** 중앙 디렉터리만 읽어 해제 후 크기를 확인합니다
(`src/worker/zipGuard.ts`). 선언된 크기는 위조될 수 있으므로 실제 해제 뒤에도
다시 검사합니다. 한도는 `src/constants.ts` 에 모여 있습니다.

| 항목 | 한도 |
| --- | --- |
| 입력 파일 1개 | 200MB |
| 한 번에 처리할 파일 수 | 50개 |
| 해제 후 전체 크기 | 1GB |
| 해제 후 엔트리 1개 | 512MB |
| 전체 압축률 | 150:1 |
| 엔트리 압축률(8MB 이상) | 500:1 |
| ZIP 엔트리 수 | 20,000개 |

그 밖에:

- `..` · 절대 경로 · NUL 이 섞인 엔트리 이름을 거부합니다.
- 변환에 필요한 파트(`ppt/**`)만 해제합니다.
- `<!DOCTYPE>` 을 파싱하지 않고 커스텀 엔티티를 확장하지 않습니다 (XXE · billion laughs 불가).
- `TargetMode="External"` 미디어는 내려받지 않고 경고로만 남깁니다.

## 구조

```
index.html               UI 뼈대 (한국어, 4단계)
src/
  main.ts                파일 수집 · 옵션 · Worker 호출 · 결과 표시
  styles.css
  constants.ts           크기·개수 한도 (UI 와 Worker 가 공유)
  types.ts               UI ↔ Worker 메시지 타입
  worker/
    convert.worker.ts    Worker 메시지 처리 껍데기
    pipeline.ts          검사 → 해제 → 변환 → ZIP 파이프라인
    pptx.ts              PPTX(OOXML) → Markdown + 미디어
    zipGuard.ts          중앙 디렉터리 검사 (ZIP 폭탄 방어)
    xml.ts               XML 파서
scripts/check-offline.mjs  빌드 산출물 오프라인 검사
tests/                     node:test 기반 테스트 (픽스처를 코드로 생성)
.github/workflows/         CI (ci.yml) · Pages 배포 (deploy.yml)
```

무거운 작업은 전부 Web Worker 에서 돌기 때문에 큰 파일을 넣어도 UI 가 멈추지
않습니다. 결과 ZIP 은 `postMessage` 의 transferable 로 복사 없이 넘어옵니다.

### XML 파싱에 대하여

`DOMParser` 는 `Window` 에만 있는 API 라 **Web Worker 안에서는 쓸 수 없습니다**
(`WorkerGlobalScope` 에 노출되지 않습니다). "처리는 Worker 에서"와 "DOMParser 로
파싱"을 동시에 만족시킬 수 없어, 같은 호출 형태
(`getElementsByTagName` / `getAttribute` / `textContent`)를 제공하는 파서를
`src/worker/xml.ts` 에 직접 구현했습니다. 외부 의존성 없이 번들에 포함되고,
OOXML 에 필요한 범위(네임스페이스 접두사 포함 태그명, CDATA, 주석, 엔티티)만
다룹니다.

## 의존성

런타임 의존성은 [fflate](https://github.com/101arrowz/fflate) 하나뿐이며
번들에 포함됩니다. **CDN 을 쓰지 않습니다.**

## 테스트

```bash
npm test
```

`tests/fixtures.ts` 가 테스트용 `.pptx` 를 코드로 조립하므로 저장소에 바이너리
픽스처가 없습니다. 목록·표·미디어 이름 규칙·옵션 토글·슬라이드 순서·ZIP 폭탄
방어·경로 탈출·XML 파서를 다룹니다.

## 알려진 동작

- 같은 이미지를 여러 슬라이드에서 쓰면 슬라이드마다 복사본이 생깁니다
  (`slideNN_MM` 이름 규칙상 의도된 동작). 한 슬라이드 안에서는 한 번만 저장합니다.
- 마크다운 표에는 셀 병합 개념이 없어, 병합된 셀의 뒤쪽 칸은 빈 칸이 됩니다.
- 차트·SmartArt 는 도형 이름만 `> (이름)` 으로 남깁니다.
- `.pptm`(매크로 포함)은 받지 않습니다.
