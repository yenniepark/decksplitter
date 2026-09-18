# DeckSplitter

`.pptx` 파일을 **Markdown + 이미지 · 오디오 · 동영상**으로 분해합니다.
설치할 것 없이 브라우저에서 바로 씁니다.

### 👉 https://yenniepark.github.io/decksplitter/

```
발표자료.pptx  →  발표자료.md  +  images/  audio/  video/   (ZIP 하나로 내려받기)
```

> **파일은 어디로도 전송되지 않습니다.** 변환은 전부 여러분의 브라우저 안에서만
> 일어납니다. 자세한 내용은 [자료는 어디로도 가지 않습니다](#자료는-어디로도-가지-않습니다).

---

## 쓰는 법

링크를 열고 화면의 4단계를 따라가면 됩니다.

| 단계 | 할 일 |
| --- | --- |
| **1. 업로드** | `.pptx` 파일을 네모 칸에 끌어다 놓습니다. 클릭해서 골라도 되고, 여러 개를 한꺼번에 넣어도 됩니다. |
| **2. 옵션** | 뭘 뽑을지 고릅니다. 기본값 그대로 둬도 됩니다. |
| **3. 실행** | «변환 시작» 을 누르고 기다립니다. 파일이 크면 몇십 초 걸릴 수 있습니다. |
| **4. 다운로드** | «ZIP 내려받기» 를 누릅니다. 압축을 풀면 `.md` 파일과 미디어 폴더가 나옵니다. |

파일 하나당 **200MB** 까지, 한 번에 **50개** 까지 넣을 수 있습니다.

### 옵션 설명

**추출할 미디어** — 체크한 종류만 ZIP 에 담깁니다.

| 옵션 | 설명 |
| --- | --- |
| 이미지 | 슬라이드에 들어간 그림을 `images/` 폴더에 |
| 오디오 | 삽입된 소리 파일을 `audio/` 폴더에 |
| 동영상 | 삽입된 영상을 `video/` 폴더에 |

**Markdown 출력**

| 옵션 | 켰을 때 | 껐을 때 |
| --- | --- | --- |
| 슬라이드 제목 | 제목 도형의 글자를 제목으로 사용 | `## 슬라이드 1`, `## 슬라이드 2` … |
| 구분선 | 슬라이드 사이에 `---` 을 넣어 구분 | 제목만으로 구분 |
| 발표자 노트 | 노트를 인용문으로 덧붙임 | 노트를 넣지 않음 |

글머리표 목록과 표는 **항상** 유지되고, 이미지는 본문의 제자리에 들어갑니다.

## 만들어지는 결과물

파일 하나를 넣으면 ZIP 최상위가 평평합니다.

```
발표자료.zip
├── 발표자료.md
├── images/slide03_01.png
├── audio/slide07_01.mp3
└── video/slide09_01.mp4
```

여러 개를 넣으면 파일별 폴더로 나뉩니다 (`A/A.md`, `B/B.md`, …).

미디어 파일 이름은 `slide<슬라이드번호>_<슬라이드 안에서의 순번>.<확장자>` 입니다.
`slide03_01.png` 는 **3번 슬라이드의 첫 번째 이미지**라는 뜻입니다. 어느 슬라이드에서
나온 파일인지 이름만 보고 알 수 있습니다.

`.md` 파일 안에서는 이미지가 `images/slide03_01.png` 같은 상대경로로 들어가므로,
ZIP 을 푼 폴더 구조를 그대로 두면 Obsidian · Typora · VS Code 등에서 그림이 바로
보입니다.

### 변환 규칙

| PowerPoint | Markdown |
| --- | --- |
| 슬라이드 제목 | `## 제목` |
| 글머리표 목록 (들여쓰기 포함) | `- 항목` / 중첩 목록 |
| 번호 매기기 목록 | `1.` `2.` `3.` |
| **굵게** · *기울임* | `**굵게**` · `*기울임*` |
| 표 | 마크다운 표 (첫 행이 머리글) |
| 이미지 | `![설명](images/slide03_01.png)` |
| 동영상 · 오디오 | `[동영상: …](video/…)` |
| 발표자 노트 | `> **발표자 노트**` 인용문 |
| 하이퍼링크 | `[글자](주소)` |

슬라이드 순서는 파일 이름이 아니라 실제 발표 순서를 따릅니다. 슬라이드 번호 ·
날짜 · 바닥글처럼 모든 장에 반복되는 요소는 건너뜁니다.

## 잘 안 되는 것

- **차트 · SmartArt** 는 그림으로 저장되지 않고 도형 이름만 `> (이름)` 으로 남습니다.
- **셀 병합된 표** 는 마크다운에 병합 개념이 없어서, 병합된 뒤쪽 칸이 빈 칸이 됩니다.
- 같은 이미지를 여러 슬라이드에서 쓰면 **슬라이드마다 복사본**이 생깁니다
  (`slideNN_MM` 이름 규칙상 의도된 동작입니다).
- **`.pptm`**(매크로 포함 파일)은 받지 않습니다. `.pptx` 로 저장한 뒤 넣어주세요.
- 인터넷 주소로 연결된 미디어(파일에 포함되지 않고 링크만 걸린 것)는 내려받지
  않습니다. 화면에 경고로 알려줍니다.

## 자료는 어디로도 가지 않습니다

팀에 공유할 때 가장 많이 받는 질문입니다. 정리하면:

**서버가 없습니다.** `.pptx` 를 올리는 곳이 아예 없습니다. 페이지를 한 번 받아온
뒤로는 브라우저가 혼자 다 합니다. 압축 해제도, 슬라이드 분석도, ZIP 만들기도
전부 여러분 컴퓨터 안에서 일어나고, 결과 파일도 여러분 컴퓨터에만 저장됩니다.

**확인하는 방법 세 가지:**

1. **코드에 네트워크 요청이 없습니다.** `fetch` · `XMLHttpRequest` · `WebSocket` ·
   `sendBeacon` · `importScripts` 를 한 줄도 쓰지 않습니다. 소스가 공개돼 있으니
   직접 확인하실 수 있습니다.
2. **브라우저가 막고 있습니다.** 페이지에 `connect-src 'none'` CSP 가 걸려 있어,
   설령 어떤 코드가 밖으로 나가려 해도 브라우저가 차단합니다.
3. **자동으로 검사합니다.** 배포될 때마다 `check:offline` 이 빌드 결과를 훑어
   네트워크 API 호출 · 외부 주소 참조 · CSP 누락을 확인하고, 하나라도 걸리면
   배포를 중단합니다.

**직접 확인해 보려면** 브라우저에서 `F12` → **Network** 탭을 열어둔 채 변환해
보세요. 페이지를 처음 받아올 때 말고는 아무 요청도 일어나지 않습니다.

**추적 · 분석 도구도 없습니다.** 누가 무엇을 변환했는지 기록되지 않습니다.

> 사이트 주소를 아는 사람은 누구나 접속할 수 있습니다. 다만 위 이유로,
> 다른 사람이 접속해도 여러분이 변환한 자료를 볼 방법은 없습니다.
> 공개되는 것은 도구 자체뿐입니다.

## 인터넷 없이 쓰기

사내망에서 `github.io` 가 막혀 있거나 오프라인에서 써야 한다면, 빌드한
`dist/` 폴더를 사내 웹서버에 그대로 올리면 됩니다. 아래 [개발](#개발) 참고.

> `dist/index.html` 을 `file://` 로 직접 여는 것은 **동작하지 않습니다.**
> ES 모듈과 CSS 가 `origin: null` 에서 CORS 로 차단됩니다. HTTP 로 서빙해야
> 합니다.

---

# 개발

여기부터는 코드를 고치거나 직접 돌려볼 분을 위한 내용입니다.

```bash
npm install
npm run dev       # 개발 서버 (http://localhost:5173)
npm run build     # dist/ 에 정적 파일 생성
npm run preview   # 빌드 결과를 HTTP 로 확인
npm test          # 테스트
npm run verify    # 타입검사 + 테스트 + 빌드 + 오프라인 검사
```

Node.js 18 이상이 필요합니다.

## 배포

`main` 에 코드가 들어가면 GitHub Actions 가 빌드해서 GitHub Pages 에 올립니다.
직접 빌드하거나 파일을 올릴 필요가 없습니다.

| 워크플로 | 시점 | 하는 일 |
| --- | --- | --- |
| `.github/workflows/ci.yml` | PR, `main` 푸시 | 타입검사 · 테스트 · 빌드 · 오프라인 검사 |
| `.github/workflows/deploy.yml` | `main` 푸시 | 위 검사 전부 + Pages 배포 |

검사가 하나라도 실패하면 사이트에 올라가지 않습니다.

처음 한 번은 저장소 **Settings → Pages → Source** 를 `GitHub Actions` 로
바꿔줘야 합니다.

`base: './'` 로 상대경로를 쓰기 때문에 `/decksplitter/` 같은 하위 경로에서도
그대로 동작합니다. 다른 호스팅(Netlify · Vercel · 사내 서버)에 올릴 때도 `dist/`
를 통째로 올리면 됩니다.

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

무거운 작업(압축 해제 · XML 파싱 · 재압축)은 전부 Web Worker 에서 돌기 때문에
큰 파일을 넣어도 UI 가 멈추지 않습니다. 결과 ZIP 은 `postMessage` 의
transferable 로 복사 없이 넘어옵니다.

### XML 파싱에 대하여

`DOMParser` 는 `Window` 에만 있는 API 라 **Web Worker 안에서는 쓸 수 없습니다**
(`WorkerGlobalScope` 에 노출되지 않습니다). "처리는 Worker 에서"와 "DOMParser 로
파싱"을 동시에 만족시킬 수 없어, 같은 호출 형태
(`getElementsByTagName` / `getAttribute` / `textContent`)를 제공하는 파서를
`src/worker/xml.ts` 에 직접 구현했습니다. 외부 의존성 없이 번들에 포함되고,
OOXML 에 필요한 범위(네임스페이스 접두사 포함 태그명, CDATA, 주석, 엔티티)만
다룹니다.

## 보안

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

Vite 의 modulepreload 폴리필이 `fetch()` 를 쓰기 때문에 꺼두었습니다
(`modulePreload: { polyfill: false }`).

`npm run check:offline` 이 빌드 결과를 훑어 네트워크 API 호출 · 외부 출처
참조 · CSP 누락을 검사합니다. 하나라도 걸리면 0이 아닌 코드로 종료합니다.

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
- `<!DOCTYPE>` 을 파싱하지 않고 커스텀 엔티티를 확장하지 않습니다
  (XXE · billion laughs 불가).
- `TargetMode="External"` 미디어는 내려받지 않고 경고로만 남깁니다.

## 의존성

런타임 의존성은 [fflate](https://github.com/101arrowz/fflate) 하나뿐이며
번들에 포함됩니다. **CDN 을 쓰지 않습니다.**

## 테스트

```bash
npm test
```

`tests/fixtures.ts` 가 테스트용 `.pptx` 를 코드로 조립하므로 저장소에 바이너리
픽스처가 없습니다. 목록 · 표 · 미디어 이름 규칙 · 옵션 토글 · 슬라이드 순서 ·
ZIP 폭탄 방어 · 경로 탈출 · XML 파서를 다룹니다.
