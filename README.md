# Google Gemini 3.5 Live Translate Application

`gemini-3.5-live-translate-preview` 모델과 Google GenAI SDK (`google-genai`)를 활용하여 구현한 **실시간 자막 통역(Live Transcript Translation)** 반응형 웹 애플리케이션입니다. 데스크톱 웹과 iPhone / Android 모바일 브라우저에서 별도 앱 설치 없이 동작합니다.

---

## 🖥️ 화면 구성

<table>
  <tr>
    <th width="70%">데스크톱 웹 (대기 상태)</th>
    <th width="30%">모바일 웹 — iPhone Chrome (통역 중)</th>
  </tr>
  <tr>
    <td><img src="docs/screenshot-main.png" alt="데스크톱 메인 화면" /></td>
    <td><img src="docs/screenshot-mobile.png" alt="iPhone Chrome 통역 중 화면" /></td>
  </tr>
</table>

| 영역 | 설명 |
| :--- | :--- |
| **상단 헤더** | 세션 상태(`대기 중` / `실시간 통역 중` + 경과 시간 / 재연결 중), `회의 요약`(.md 회의록 즉시 저장), `원문/번역문 저장`(.md 기록 즉시 저장), 기록 초기화, 로그아웃 — 모바일에서는 아이콘만 표시 |
| **언어 컨트롤 바** | Source 언어(자동 감지 시 감지 언어 배지 표시) ⇄ Target 언어 선택, `통역 시작` / `통역 종료` 버튼 (통역 중에는 빨간색 + 입력 레벨 이퀄라이저 표시, 모바일에서는 전체 폭) |
| **Source 패널 (위)** | 인식된 원문이 문장 단위로 실시간 표시 (진행 중 문장은 파란색). `복사`, `접기`(접으면 최신 한 줄만 미리보기로 남고 Target 패널이 확장) |
| **Target 패널 (아래)** | 번역문이 문장 단위로 실시간 표시 (진행 중 문장은 초록색). `복사` |

> 모바일 브라우저에서는 HTTPS(Cloud Run 배포 URL)로 접속해야 마이크 권한이 허용됩니다.

---

## ✨ 주요 기능

1. **Gemini 3.5 Live Translate 전용 모델 연동 (`gemini-3.5-live-translate-preview`)**
   - `echo_target_language=True` 기본 활성화 (입력 음성이 이미 Target 언어인 경우 번역 대신 원어 그대로 전사)
   - `input_audio_transcription` 및 `output_audio_transcription` 동시 스트리밍
   - 16kHz 16-bit Mono PCM 마이크 입력을 WebSocket으로 서버에 스트리밍
2. **자막 전용 실시간 통역**
   - 회의실/강연장 등에서 하울링 없이 사용할 수 있도록 **음성 출력 없이 자막(원문/번역문)만 실시간 표시**합니다.
   - `통역 시작` 버튼 하나로 마이크 캡처와 통역 세션을 시작/종료합니다.
3. **Source / Target 언어 설정 및 양방향 전환 (`⇄`)**
   - **Source Language**: 기본값 `English (en)` + `🌐 자동 감지` + 공식 지원 **78개 전체 언어(BCP-47)** (자동 감지 시 실시간 감지 언어 배지 표시)
   - **Target Language**: 기본값 `Korean (ko)` + 공식 지원 **78개 전체 언어(BCP-47)**
   - 통역 진행 중 언어를 변경하거나 `⇄` 스왑 버튼을 누르면 마이크를 끄지 않고도 백엔드에서 세션을 무중단 재연결합니다.
4. **Live API 세션 관리 (장시간 연속 통역 지원)**
   - `ContextWindowCompressionConfig(sliding_window=SlidingWindow())`: 장시간 통역 시 토큰 한계 방지
   - `SessionResumptionConfig(handle=...)` 및 `GoAway` 메시지 감지: 연결 수명 만료 전후로 세션 핸들을 이용해 끊김 없이 자동 재연결
   - 모바일 백그라운드 전환/네트워크 끊김 후 `session_id` 기반 자동 복구, 10분 무음 시 자동 종료
5. **원클릭 회의록 / 기록 저장 (`.md`)**
   - **`회의 요약`**: 누적된 대화를 바탕으로 `핵심 주제·개요 / 안건별 논의 사항 / 결정 사항·Action Items` 구조의 회의록을 생성하여 즉시 `.md` 파일로 저장 (`POST /api/summarize`). 요약 길이는 원본 분량에 비례해 자동 조절되며, STT 오인식 가능성이 있는 약어는 임의로 풀이하지 않습니다.
   - **`원문/번역문 저장`**: 전체 원문(Source) → 전체 번역문(Target) 순으로 분리 기록된 `.md` 파일을 즉시 저장


---

## 📁 프로젝트 구조

```text
live-translate/
├── app/
│   ├── __init__.py
│   ├── config.py          # 환경변수(.env), ADC/API Key 클라이언트 팩토리, 로그인 설정, 78개 지원 언어 정의
│   └── main.py            # FastAPI 서버, 로그인 게이트, /ws/translate 양방향 스트리밍, 세션 관리, /api/summarize
├── static/
│   ├── index.html         # 반응형 웹/모바일 UI (상: Source, 하: Target)
│   ├── login.html         # 로그인 화면
│   ├── styles.css         # Google 4-Color (#4285F4, #EA4335, #FBBC05, #34A853) + 화이트 테마
│   └── app.js             # Web Audio API 16kHz 캡처, WebSocket 스트리밍, 자동 스크롤, .md 저장
├── docs/
│   ├── screenshot-main.png   # README용 데스크톱 화면 캡처
│   └── screenshot-mobile.png # README용 모바일(iPhone) 화면 캡처
├── Dockerfile             # Cloud Run 컨테이너 빌드
├── .dockerignore
├── .env.example           # 환경변수 템플릿
├── requirements.txt       # Python 패키지 의존성
└── README.md
```

---

## ⚙️ 환경변수 (`.env`)

`.env.example`을 복사하여 `.env`를 만들고 값을 채웁니다. `.env`는 Git 및 Cloud Build 업로드에서 제외됩니다.

```bash
cp .env.example .env
```

```dotenv
# 인증 모드: adc (기본값, Google Cloud ADC / Vertex AI) 또는 api_key
AUTH_MODE=adc

# ADC 모드 사용 시 GCP 프로젝트 및 리전 (gemini-3.5-live-translate-preview는 global 리전 사용)
GOOGLE_CLOUD_PROJECT=<YOUR_GCP_PROJECT_ID>
GOOGLE_CLOUD_LOCATION=global

# API Key 모드 사용 시 (AUTH_MODE=api_key)
GEMINI_API_KEY=

# 모델 설정
LIVE_TRANSLATE_MODEL=gemini-3.5-live-translate-preview
SUMMARY_MODEL=gemini-3.8-flash

# 10분(600초) 이상 무음성 시 자동 세션 종료
INACTIVITY_TIMEOUT_SECONDS=600

# 로그인 게이트 (비워두면 로그인 비활성화)
APP_LOGIN_PASSWORD=<YOUR_SHARED_PASSWORD>
# 로그인 쿠키 서명용 비밀키 (openssl rand -hex 32 로 생성, 배포 간 동일하게 유지)
APP_SESSION_SECRET=<RANDOM_HEX_SECRET>
# 로그인 유지 시간 (시간 단위)
APP_SESSION_HOURS=12
```

| 변수 | 설명 |
| :--- | :--- |
| `APP_LOGIN_PASSWORD` | 로그인 화면에서 입력할 고정 비밀번호 |
| `APP_SESSION_SECRET` | 로그인 쿠키를 HMAC 서명하는 서버 전용 비밀키. 비워두면 프로세스마다 랜덤 생성되어 **재시작/다중 인스턴스 시 로그인이 풀리므로** 운영 환경에서는 반드시 고정값을 지정 |
| `APP_SESSION_HOURS` | 로그인 쿠키 유효 시간 |

---

## 💻 로컬 실행 방법

### 1. 사전 준비

- Python 3.11 이상
- Google Cloud SDK (`gcloud`) 및 ADC 로그인

```bash
# Vertex AI 호출용 ADC 인증
gcloud auth application-default login
```

### 2. 가상환경 및 의존성 설치

```bash
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt
```

### 3. 서버 실행

```bash
./.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

브라우저에서 **[http://localhost:8000](http://localhost:8000)** 으로 접속하면 로그인 화면이 표시되고, `APP_LOGIN_PASSWORD`를 입력하면 통역 화면으로 이동합니다.

---

## ☁️ Cloud Run 배포 방법


### 1. 사전 준비

```bash
gcloud auth login
gcloud config set project <YOUR_GCP_PROJECT_ID>
```

다음 API가 활성화되어 있어야 합니다: Cloud Run, Cloud Build, Artifact Registry, Vertex AI.
Cloud Run 서비스 계정(기본: Compute Engine 기본 서비스 계정)에 **`roles/aiplatform.user`** 역할이 필요합니다.

### 2. 배포

`.env`의 값을 셸 환경변수로 로드한 뒤 `--set-env-vars`로 전달하면 비밀값이 명령어에 직접 노출되지 않습니다.

```bash
set -a; source .env; set +a

gcloud run deploy live-translate \
  --source=. \
  --project="${GOOGLE_CLOUD_PROJECT}" \
  --region=asia-northeast3 \
  --allow-unauthenticated \
  --port=8080 \
  --memory=1Gi \
  --cpu=1 \
  --timeout=3600 \
  --concurrency=80 \
  --min-instances=0 \
  --max-instances=1 \
  --session-affinity \
  --no-cpu-throttling \
  --set-env-vars="AUTH_MODE=adc,GOOGLE_CLOUD_PROJECT=${GOOGLE_CLOUD_PROJECT},GOOGLE_CLOUD_LOCATION=global,LIVE_TRANSLATE_MODEL=${LIVE_TRANSLATE_MODEL},SUMMARY_MODEL=${SUMMARY_MODEL},INACTIVITY_TIMEOUT_SECONDS=${INACTIVITY_TIMEOUT_SECONDS},APP_LOGIN_PASSWORD=${APP_LOGIN_PASSWORD},APP_SESSION_SECRET=${APP_SESSION_SECRET},APP_SESSION_HOURS=${APP_SESSION_HOURS}" \
  --quiet
```

| 옵션 | 이유 |
| :--- | :--- |
| `--region=asia-northeast3` | 서울 리전 (모델 호출은 `GOOGLE_CLOUD_LOCATION=global`로 별도 라우팅) |
| `--allow-unauthenticated` | 브라우저에서 직접 접속. 앱 자체 로그인 게이트가 접근을 제어 |
| `--timeout=3600` | 장시간 WebSocket 통역 세션 유지 (최대 60분/요청) |
| `--session-affinity` | 재연결 시 같은 인스턴스로 라우팅하여 인메모리 세션 핸들 재사용 |
| `--no-cpu-throttling` | 요청 사이에도 CPU 유지 → WebSocket 스트리밍 안정화 |

배포가 끝나면 `Service URL: https://live-translate-<hash>.asia-northeast3.run.app` 형태의 주소가 출력됩니다. HTTPS이므로 모바일 브라우저에서도 바로 마이크 권한이 동작합니다.

---

## 🔌 API 요약

| 경로 | 설명 |
| :--- | :--- |
| `GET /` | 통역 화면 (로그인 필요) |
| `GET /login`, `POST /api/login`, `POST /api/logout` | 로그인 게이트 |
| `GET /api/config` | 모델/언어 설정 |
| `WS /ws/translate` | 16kHz PCM 업스트림 + 원문/번역문 자막 다운스트림 |
| `POST /api/summarize` | 대화 기록 기반 회의록(Markdown) 생성 |
