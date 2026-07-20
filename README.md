# 🎨 이모티콘 메이커 (Imoticon Maker)

캐릭터와 상황을 설명하면 Cloudflare Workers AI의 무료 할당량으로 이모티콘 세트를 기획하고 그리는 웹앱입니다.

브라우저에 OpenAI·Gemini·xAI API 키를 입력하거나 저장하지 않습니다. 프론트엔드와 AI API를 하나의 Cloudflare Worker에서 제공하며, 비밀 인증정보 대신 Workers AI 바인딩을 사용합니다.

## 주요 기능

- **무료 우선 모델 조합**
  - 기획: `@cf/google/gemma-4-26b-a4b-it`
  - 이미지 생성·편집: `@cf/black-forest-labs/flux-2-klein-4b`
- **실제 캐릭터 기준 이미지** — 참조 이미지가 없으면 먼저 기준 이미지를 한 장 만들고 모든 컷에서 재사용합니다.
- **캐릭터 참조 이미지** — 업로드 이미지는 브라우저에서 511px 이하 PNG로 축소한 뒤 Worker로 전송합니다.
- **한글 문구 로컬 합성** — 이미지 모델이 글자를 그리지 않습니다. 브라우저 Canvas가 같은 글꼴과 위치로 문구를 합성합니다.
- **비용 없는 기본 애니메이션** — AI 이미지 한 장을 브라우저에서 6프레임으로 움직입니다.
- **선택형 AI 애니메이션** — 컷마다 6장을 생성하며, 시작 전에 예상 이미지 수와 Neurons를 확인합니다.
- **취소 보장** — 중단 신호 이후에는 새 이미지 작업을 꺼내지 않으며 진행 상태를 완료로 잘못 표시하지 않습니다.
- **중단 후 이어 만들기** — 대기 중인 전체 항목 또는 개별 컷을 다시 생성할 수 있습니다.
- **메모리 관리** — 대형 base64 문자열을 세션에 쌓지 않고 Blob Object URL을 사용하고 재생성·세션 종료 시 해제합니다.
- **안전한 서버 프롬프트** — 브라우저는 캐릭터·장면·스타일 같은 구조화 필드만 전송하고 Worker가 허용된 템플릿으로 최종 프롬프트를 조립합니다.
- **부분 결과 보존** — 실패나 중단이 있어도 완성된 결과만 부분 ZIP으로 받을 수 있으며, 제출용 전체 ZIP과 구분됩니다.
- **플랫폼별 프로필과 다운로드 전 검사**
  - 일반: 360×360 PNG/APNG/GIF, 카드별 APNG·GIF 다운로드, 10·12·15개
  - 카카오 정지 시안: 360×360 PNG, 32개
  - LINE 정지: 최대 캔버스 370×320 PNG, 8·16·24개
  - LINE 애니메이션: 320×270 APNG, 6프레임, 4회 반복, 8·16·24개
  - Telegram 정지: 512×512 PNG, 512KB 이하

> Telegram 애니메이션은 TGS 또는 VP9 WebM, 카카오 애니메이션은 별도 WebP 제작 과정이 필요하므로 현재 버전은 해당 애니메이션 형식을 제출용이라고 표시하지 않습니다.

## 무료 할당량과 제한

Cloudflare Workers AI는 계정당 하루 10,000 Neurons 무료 할당량을 제공합니다. FLUX.2 Klein 4B의 1024×1024 출력은 약 104.2 Neurons, 511px 참조 입력은 약 5.37 Neurons으로 추정합니다. 기획 호출은 출력 토큰 변동을 고려해 120 Neurons로 보수적으로 예약합니다.

- 정지 15개 + 자동 기준 이미지: 약 16회 이미지 호출
- 로컬 애니메이션 15개 + 자동 기준 이미지: 약 16회 이미지 호출
- AI 6프레임 애니메이션 10개 + 자동 기준 이미지: 약 61회 이미지 호출
- AI 6프레임 애니메이션 15개: 네트워크별 일일 이미지 한도 80장을 초과하므로 UI에서 차단

앱은 사용자가 변경할 수 있는 브라우저 ID를 보안 판단에 사용하지 않습니다. 대신 두 단계 제한을 적용합니다.

- 서비스 전체: 하루 최대 9,000 Neurons 예약 후 자동 차단
- 접속 IP 해시별 기획: 하루 12회
- 접속 IP 해시별 이미지: 하루 80장
- 접속 IP 해시별 요청 속도: 분당 24회

9,000 Neurons 상한은 `wrangler.jsonc`의 `GLOBAL_DAILY_NEURON_BUDGET`으로 더 낮출 수 있으며 10,000보다 높게 설정할 수 없습니다. 무료 플랜은 Cloudflare 한도를 넘으면 추가 호출이 실패하고, Paid 플랜에서는 이 앱의 전역 상한이 예상치 못한 초과 비용을 막는 kill switch 역할을 합니다. 앱과 Cloudflare의 일일 기준은 모두 00:00 UTC에 초기화됩니다.

AI 바인딩 호출 자체가 예외를 반환하면 IP별 호출 횟수는 환불합니다. 실제 추론 시작 여부를 확실히 알 수 없으므로 서비스 전체 Neurons 예약은 비용 방어를 위해 유지합니다.

## 로컬 실행

요구 사항: Node.js 20 이상, Cloudflare 계정

```bash
npm install
npx wrangler login
npm run dev
```

Wrangler가 표시하는 로컬 URL로 접속합니다. 정적 파일 서버만 실행하면 `/api/*`와 AI 바인딩이 없으므로 생성 기능이 동작하지 않습니다.

## 배포

```bash
npm run deploy
```

`wrangler.jsonc`가 다음 리소스를 함께 연결합니다.

- `AI`: Workers AI 바인딩
- `ASSETS`: `public/` 정적 파일
- `QUOTA_COUNTER`: 전역 예산과 IP별 할당량을 원자적으로 관리하는 SQLite Durable Object
- `GLOBAL_DAILY_NEURON_BUDGET`: 서비스 전체 일일 보호 예산, 기본 9,000 Neurons

첫 배포 시 `v1` Durable Object 마이그레이션이 자동 적용됩니다. 별도의 API 키나 `.dev.vars`는 필요하지 않습니다.

## 동작 구조

```text
브라우저
  ├─ POST /api/plan  ──> Worker ──> Gemma 기획 JSON ──> 스키마 보정
  ├─ 구조화 이미지 필드 ──> Worker 프롬프트 템플릿 ──> FLUX.2 Klein 4B
  └─ Canvas/APNG/GIF/ZIP: 브라우저 내부 처리

Worker
  ├─ AI 바인딩: 공급자 비밀키가 브라우저에 없음
  ├─ Durable Object: 전역 Neurons 예산 + IP별 일일/분당 할당량
  ├─ 동일 Origin 및 Sec-Fetch-Site 검사
  └─ 보안 헤더: CSP, no-referrer, nosniff, frame 차단
```

1. 모델이 캐릭터 설명과 정확한 개수의 장면 JSON을 반환합니다.
2. JSON에 누락·중복이 있으면 Worker가 안전한 기본 장면으로 보정하고 보완 개수를 UI에 알립니다.
3. 참조 이미지가 없으면 캐릭터 기준 이미지를 한 장 생성합니다.
4. 모든 컷은 같은 기준 이미지를 FLUX 편집 입력으로 사용합니다.
5. 흰 배경 제거와 한글 문구는 브라우저에서 처리합니다.
6. 내보내기 직전에 크기, 세트 개수, 프레임 수, 파일 용량을 검사합니다.

## 개인정보와 보안

- API 키는 브라우저·`localStorage`·저장소에 존재하지 않습니다.
- 프롬프트와 참조 이미지는 이 사이트의 Cloudflare Worker 및 Workers AI로 전송됩니다.
- Worker는 원본 IP를 저장하지 않고 IP만 SHA-256으로 해시해 Durable Object 이름을 결정합니다.
- 모든 생성 POST는 현재 Worker와 정확히 같은 Origin만 허용하며 교차 사이트 요청을 403으로 거부합니다.
- 참조 이미지는 MIME·2MB 용량뿐 아니라 실제 픽셀 크기도 서버에서 판독해 가로·세로 511px 이하만 허용합니다.
- 프롬프트와 이미지 결과를 별도 데이터베이스에 저장하지 않습니다.
- `Content-Security-Policy`는 동일 출처 API, data/blob 이미지 외의 외부 연결과 스크립트를 차단합니다.

## 프로젝트 구조

```text
public/
  index.html            UI
  css/style.css         반응형 스타일
  js/app.js             생성·취소·카드·다운로드 파이프라인
  js/providers.js       동일 출처 Worker API 어댑터와 구조화 이미지 요청
  js/profiles.js        플랫폼 규격과 사용량 추정
  js/imageproc.js       리사이즈·문구·로컬 애니메이션·투명화
  js/apng.js            APNG 인코더
  js/gif.js             GIF 인코더
  js/zip.js             ZIP 인코더
worker/index.js         AI 프록시, 입력 검증, JSON 보정, 할당량
tests/                  Node 내장 테스트
wrangler.jsonc          Cloudflare 배포 설정
```

## 검사와 테스트

```bash
npm run check
npx wrangler deploy --dry-run
```

자동 테스트는 다음을 검증합니다.

- 기획 JSON의 정확한 개수, 중복 제거, 문구 모드
- 서비스 전체 Neurons 상한과 IP별 일일·분당 Durable Object 할당량
- 클라이언트 ID 변경 우회 방지 및 교차 사이트 요청 차단
- 서버 프롬프트 템플릿과 참조 이미지 픽셀 판독
- 플랫폼별 개수·형식·용량·프레임 검사
- 중단 재개·부분 ZIP·카드별 GIF 컨트롤 존재
- 로컬 애니메이션과 AI 애니메이션의 호출량 계산
- APNG의 프레임/반복 제어 청크
- GIF89a 반복 스트림과 ZIP 헤더
- HTML에 공급자 API 키 입력이 다시 추가되지 않았는지

GitHub Actions는 모든 PR과 `main` 푸시에서 `npm ci`와 `npm run check`를 실행합니다.
