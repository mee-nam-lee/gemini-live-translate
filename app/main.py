import asyncio
import base64
import hashlib
import hmac
import json
import logging
import secrets
import time
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from google.genai import errors as genai_errors
from google.genai import types
from pydantic import BaseModel

from app.config import (
    APP_LOGIN_PASSWORD,
    APP_SESSION_HOURS,
    APP_SESSION_SECRET,
    AUTH_MODE,
    GOOGLE_CLOUD_LOCATION,
    GOOGLE_CLOUD_PROJECT,
    INACTIVITY_TIMEOUT_SECONDS,
    LIVE_TRANSLATE_MODEL,
    SUMMARY_MODEL,
    SUPPORTED_LANGUAGES,
    create_genai_client,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("live-translate")

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"

app = FastAPI(
    title="Google Gemini 3.5 Live Translate",
    description="Real-time Speech-to-Speech & Transcript Live Translation powered by gemini-3.5-live-translate-preview",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Login gate (fixed shared password from .env, HMAC-signed HttpOnly cookie)
# ---------------------------------------------------------------------------
AUTH_COOKIE_NAME = "lt_auth"
LOGIN_ENABLED = bool(APP_LOGIN_PASSWORD)
# Paths reachable without a login cookie
PUBLIC_PATH_PREFIXES = ("/login", "/api/login", "/static/", "/favicon.ico")


def _sign(payload: str) -> str:
    return hmac.new(
        APP_SESSION_SECRET.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256
    ).hexdigest()


def _make_auth_token() -> str:
    """Token format: <expiry_epoch>.<nonce>.<hmac>"""
    expires = int(time.time()) + APP_SESSION_HOURS * 3600
    payload = f"{expires}.{secrets.token_urlsafe(16)}"
    return f"{payload}.{_sign(payload)}"


def _is_valid_auth_token(token: Optional[str]) -> bool:
    if not token:
        return False
    try:
        expires_str, nonce, sig = token.rsplit(".", 2)
        payload = f"{expires_str}.{nonce}"
        if not hmac.compare_digest(_sign(payload), sig):
            return False
        return int(expires_str) > int(time.time())
    except Exception:
        return False


def _is_authenticated(cookies: dict) -> bool:
    if not LOGIN_ENABLED:
        return True
    return _is_valid_auth_token(cookies.get(AUTH_COOKIE_NAME))


def _is_https(request: Request) -> bool:
    proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    return proto == "https"


class LoginRequest(BaseModel):
    password: str


@app.middleware("http")
async def disable_static_cache(request, call_next):
    # Redirect 0.0.0.0 to localhost so browsers treat the page as a Secure Context for getUserMedia
    host = request.headers.get("host", "")
    if host.startswith("0.0.0.0"):
        new_url = str(request.url).replace("://0.0.0.0", "://localhost", 1)
        return RedirectResponse(url=new_url, status_code=307)

    # Login gate: everything except login page/API and static assets requires a valid cookie
    path = request.url.path
    if LOGIN_ENABLED and not path.startswith(PUBLIC_PATH_PREFIXES):
        if not _is_authenticated(request.cookies):
            if path.startswith("/api/"):
                return JSONResponse(
                    status_code=401, content={"detail": "로그인이 필요합니다."}
                )
            return RedirectResponse(url="/login", status_code=303)

    response = await call_next(request)
    if path in ("/", "/login") or path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    return response


@app.get("/login")
async def serve_login(request: Request):
    if not LOGIN_ENABLED or _is_authenticated(request.cookies):
        return RedirectResponse(url="/", status_code=303)
    return FileResponse(str(STATIC_DIR / "login.html"))


@app.post("/api/login")
async def api_login(req: LoginRequest, request: Request):
    if not LOGIN_ENABLED:
        return {"ok": True}
    # Constant-time compare to avoid timing leaks
    if not hmac.compare_digest(req.password.strip(), APP_LOGIN_PASSWORD):
        await asyncio.sleep(0.6)  # slow down brute-force attempts
        raise HTTPException(status_code=401, detail="비밀번호가 올바르지 않습니다.")

    response = JSONResponse(content={"ok": True})
    response.set_cookie(
        key=AUTH_COOKIE_NAME,
        value=_make_auth_token(),
        max_age=APP_SESSION_HOURS * 3600,
        httponly=True,
        samesite="lax",
        secure=_is_https(request),
        path="/",
    )
    return response


@app.post("/api/logout")
async def api_logout():
    response = JSONResponse(content={"ok": True})
    response.delete_cookie(AUTH_COOKIE_NAME, path="/")
    return response


class TranscriptEntry(BaseModel):
    role: str  # "source" or "target"
    text: str
    timestamp: Optional[str] = None
    lang: Optional[str] = None


class SummarizeRequest(BaseModel):
    entries: List[TranscriptEntry]
    source_lang: str = "en"
    target_lang: str = "ko"
    api_key: Optional[str] = None


@app.get("/api/config")
async def get_config():
    """Return application configuration and supported languages."""
    return {
        "auth_mode": AUTH_MODE,
        "project": GOOGLE_CLOUD_PROJECT,
        "location": GOOGLE_CLOUD_LOCATION,
        "live_translate_model": LIVE_TRANSLATE_MODEL,
        "summary_model": SUMMARY_MODEL,
        "inactivity_timeout_seconds": INACTIVITY_TIMEOUT_SECONDS,
        "default_source_language": "en",
        "default_target_language": "ko",
        "echo_target_language": True,
        "supported_languages": SUPPORTED_LANGUAGES,
    }


@app.post("/api/summarize")
async def summarize_meeting(req: SummarizeRequest):
    """Generate comprehensive, length-adaptive Meeting Minutes (회의록) from the accumulated transcript."""
    if not req.entries:
        raise HTTPException(status_code=400, detail="요약할 대화 내용이 없습니다.")

    # Format transcript lines clearly for summarization and measure conversation scale
    formatted_lines = []
    timestamps = []
    source_chars = 0
    target_chars = 0
    source_count = 0
    target_count = 0
    for item in req.entries:
        text = item.text.strip()
        if not text:
            continue
        if item.role == "source":
            source_chars += len(text)
            source_count += 1
            role_label = "원문(Source)"
        else:
            target_chars += len(text)
            target_count += 1
            role_label = "번역(Target)"
        if item.timestamp:
            timestamps.append(item.timestamp)
        ts = f"[{item.timestamp}] " if item.timestamp else ""
        lang_tag = f"({item.lang}) " if item.lang else ""
        formatted_lines.append(f"{ts}{role_label} {lang_tag}: {text}")

    if not formatted_lines:
        raise HTTPException(status_code=400, detail="유효한 텍스트 내용이 없습니다.")

    turn_count = max(source_count, target_count)
    base_chars = target_chars if target_chars > 0 else source_chars
    # Hard ceiling for the generated minutes: roughly 70% of the single-language transcript length
    max_summary_chars = max(150, int(base_chars * 0.7))
    time_span_info = (
        f"{timestamps[0]} ~ {timestamps[-1]}" if len(timestamps) >= 2 else "실시간 세션"
    )
    transcript_block = "\n".join(formatted_lines)

    prompt = f"""# 역할
당신은 글로벌 비즈니스 회의 및 기술 논의를 정리하는 전문 **실무 회의록(Meeting Minutes) 작성자**입니다.
아래 [대화 기록]은 실시간 통역(Live Translate) 세션에서 기록된 원문(Source)과 번역문(Target)입니다.
원문과 번역문은 동일한 발화를 두 언어로 기록한 것이므로, 내용 파악 시 **번역문을 기준으로 하고 원문은 보조 참고**로만 사용하세요.

# 대화 기록 지표
- 발화 수: 약 {turn_count}문장
- 번역문 기준 분량: 약 {base_chars}자
- 시간대: {time_span_info}
- **회의록 최대 허용 분량: {max_summary_chars}자** (번역문 분량의 약 70%)

# 작성 원칙

## 1. 분량 — 번역문 분량에 비례하여 압축
- 회의록은 원본을 압축·구조화하는 문서이므로 **어떤 경우에도 번역문 분량({base_chars}자)보다 길어서는 안 되며, 위 최대 허용 분량({max_summary_chars}자)을 넘지 마세요.**
- 분량이 적은 대화일수록 더 간결하게, 분량이 많은 대화일수록 누락 없이 상세하게 작성하되 항상 원본보다 짧게 유지하세요.
- 핵심과 무관한 잡담(인사, 화면/슬라이드 확인, 추임새 등)은 회의록에서 제외하세요.

## 2. 구조 — 대화의 주제 수에 맞게 유연하게 조절
- 아래 3개 섹션(`###`)은 항상 유지하세요.
- 2번 섹션 안에서 논의 주제가 **명확히 여러 개로 구분되는 경우에만** `#### 1) [안건명]` 소제목으로 나누고, 주제가 하나이거나 대화가 짧으면 소제목 없이 불릿(`- `)만 사용하세요.
- 같은 내용을 1번(개요), 2번(논의), 3번(결정)에 반복해서 쓰지 마세요.

## 3. 사실성 — 기록에 있는 내용만 작성
- 대화 기록에 없는 배경·수치·결정 사항·Action Item을 추론하여 지어내지 마세요.
- 결정 사항이나 후속 조치가 언급되지 않았다면 억지로 도출하지 말고 `별도 결정 사항 없음` / `별도 후속 조치 언급 없음`으로 표기하세요.
- **약어·고유명사 임의 풀이 금지**: 실시간 음성 인식(STT) 특성상 영문 약어나 고유명사(예: `IDV`)는 발음 유사성으로 오인식되었을 수 있습니다. 대화 기록에 풀네임이나 정의가 직접 언급되지 않았다면, **괄호 안에 임의의 영문 풀네임이나 용어 설명을 추측하여 붙이지 말고 기록된 표기 그대로만** 사용하세요.

## 4. 언어
- 한국어(또는 Target 언어: `{req.target_lang}`)로 작성하세요.

# 출력 형식 (Markdown)

### 📋 1. 회의 핵심 주제 및 종합 개요
- **핵심 주제**: 이번 대화가 다룬 핵심 주제 (1줄)
- **요약 개요**: 전체 논의 흐름과 핵심 요지 (대화 분량에 비례하여 서술)

### 💬 2. 주요 안건별 상세 논의 사항
- 논의된 핵심 내용을 개조식 불릿(`- `)으로 정리 (주제가 여러 개인 경우에만 `#### 1) [안건명]` 소제목 사용)

### ✅ 3. 결정 사항 및 Action Items
- **결정/합의 사항**: 대화 중 확정되거나 합의된 내용
- **Action Items**: 대화에서 실제로 언급된 후속 조치나 할 일 (담당자·기한이 언급된 경우에만 함께 표기)

---
[대화 기록]
{transcript_block}
"""

    try:
        client = create_genai_client(api_key_override=req.api_key)
        response = await client.aio.models.generate_content(
            model=SUMMARY_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                temperature=0.2,
                max_output_tokens=8192,
            ),
        )
        summary_text = response.text or "회의록을 생성하지 못했습니다."
        return {
            "summary": summary_text,
            "model": SUMMARY_MODEL,
        }
    except Exception as exc:
        logger.exception("Failed to generate meeting summary")
        raise HTTPException(
            status_code=500,
            detail=f"회의 요약 생성 중 오류가 발생했습니다: {str(exc)}",
        ) from exc


def build_live_connect_config(
    target_language_code: str,
    echo_target_language: bool = True,
    session_handle: Optional[str] = None,
    enable_session_management: bool = True,
) -> types.LiveConnectConfig:
    """
    Build LiveConnectConfig for gemini-3.5-live-translate-preview.
    Includes:
    - response_modalities=["AUDIO"]
    - input_audio_transcription & output_audio_transcription
    - translation_config (target_language_code, echo_target_language=True)
    - context_window_compression (SlidingWindow) & session_resumption (handle)
    """
    kwargs = {
        "response_modalities": ["AUDIO"],
        "input_audio_transcription": types.AudioTranscriptionConfig(),
        "output_audio_transcription": types.AudioTranscriptionConfig(),
        "translation_config": types.TranslationConfig(
            target_language_code=target_language_code,
            echo_target_language=echo_target_language,
        ),
    }

    if enable_session_management:
        kwargs["context_window_compression"] = types.ContextWindowCompressionConfig(
            sliding_window=types.SlidingWindow()
        )
        kwargs["session_resumption"] = types.SessionResumptionConfig(
            handle=session_handle
        )

    return types.LiveConnectConfig(**kwargs)


# In-memory registry of recent session resumption handles keyed by client session_id.
# Allows mobile (iOS/Android) & web clients to seamlessly resume after brief network drops or app switches.
SESSION_HANDLE_TTL_SECONDS = 600  # 10 minutes
RESUMABLE_SESSIONS: dict[str, dict] = {}


def _cleanup_expired_sessions() -> None:
    now = time.monotonic()
    expired = [
        sid
        for sid, info in RESUMABLE_SESSIONS.items()
        if now - info.get("updated_at", now) > SESSION_HANDLE_TTL_SECONDS
    ]
    for sid in expired:
        RESUMABLE_SESSIONS.pop(sid, None)


@app.websocket("/ws/translate")
async def websocket_translate(websocket: WebSocket):
    """
    Bidirectional WebSocket endpoint bridging browser audio/UI with
    Gemini 3.5 Live Translate (gemini-3.5-live-translate-preview).
    Implements:
    - Automatic session resumption (SessionResumptionConfig) & GoAway handling for 2+ hour meetings
    - Client session_id handle persistence across mobile network/app switches
    - Context window compression (SlidingWindow)
    - 10-minute inactivity timeout auto-termination
    - Explicit session termination when the meeting ends
    - Seamless mid-session language switching
    """
    # Login gate for WebSocket (HTTP middleware does not run for WS upgrades)
    if not _is_authenticated(websocket.cookies):
        await websocket.close(code=4401, reason="Login required")
        return

    await websocket.accept()
    _cleanup_expired_sessions()

    query = websocket.query_params
    session_id = (query.get("session_id") or "").strip()
    source_lang = query.get("source_lang", "en")
    target_lang = query.get("target_lang", "ko")
    echo_str = query.get("echo_target_language", "true").lower()
    echo_target_language = echo_str != "false"
    api_key_override = query.get("api_key") or None

    # Restore previous resumption handle if this client is reconnecting with the same target language
    prior_handle: Optional[str] = None
    if session_id and session_id in RESUMABLE_SESSIONS:
        saved = RESUMABLE_SESSIONS[session_id]
        if saved.get("target_lang") == target_lang:
            prior_handle = saved.get("handle")

    # Queue for 16kHz PCM audio chunks coming from browser microphone
    audio_queue: asyncio.Queue[Optional[bytes]] = asyncio.Queue(maxsize=300)

    # Shared state across seamless session reconnections
    session_state = {
        "session_id": session_id,
        "source_lang": source_lang,
        "target_lang": target_lang,
        "echo_target_language": echo_target_language,
        "resumption_handle": prior_handle,
        "explicitly_stopped": False,
        "enable_session_management": True,
        "client_disconnected": False,
        "reconnect_requested": False,
        "reconnect_reason": "",
        "last_activity_ts": time.monotonic(),
        "location_override": "global" if AUTH_MODE == "adc" else None,
    }
    force_reconnect_event = asyncio.Event()

    async def send_ws_json(payload: dict):
        if session_state["client_disconnected"]:
            return
        try:
            await websocket.send_text(json.dumps(payload, ensure_ascii=False))
        except Exception:
            session_state["client_disconnected"] = True

    async def inactivity_watchdog():
        """
        Monitor conversation/audio activity and automatically terminate the session
        if inactive for INACTIVITY_TIMEOUT_SECONDS (default: 600s = 10 minutes).
        """
        try:
            while not session_state["client_disconnected"]:
                await asyncio.sleep(5.0)
                if session_state["client_disconnected"]:
                    break
                idle_seconds = time.monotonic() - session_state["last_activity_ts"]
                if idle_seconds >= INACTIVITY_TIMEOUT_SECONDS:
                    mins = INACTIVITY_TIMEOUT_SECONDS // 60
                    logger.info(
                        "Session inactive for %.1fs (>= %ds). Terminating session.",
                        idle_seconds,
                        INACTIVITY_TIMEOUT_SECONDS,
                    )
                    await send_ws_json(
                        {
                            "type": "inactive_timeout",
                            "timeout_seconds": INACTIVITY_TIMEOUT_SECONDS,
                            "message": f"{mins}분 이상 음성 입력 및 대화가 없어 세션이 자동으로 종료되었습니다.",
                        }
                    )
                    session_state["client_disconnected"] = True
                    force_reconnect_event.set()
                    break
        except asyncio.CancelledError:
            pass

    async def client_reader_loop():
        """Read incoming PCM audio bytes or JSON control messages from the browser."""
        try:
            while not session_state["client_disconnected"]:
                msg = await websocket.receive()
                if msg.get("type") == "websocket.disconnect":
                    session_state["client_disconnected"] = True
                    break

                if "bytes" in msg and msg["bytes"] is not None:
                    pcm_bytes = msg["bytes"]
                    if pcm_bytes:
                        if audio_queue.full():
                            try:
                                audio_queue.get_nowait()
                            except asyncio.QueueEmpty:
                                pass
                        await audio_queue.put(pcm_bytes)

                elif "text" in msg and msg["text"] is not None:
                    try:
                        data = json.loads(msg["text"])
                    except json.JSONDecodeError:
                        continue

                    msg_type = data.get("type")
                    if msg_type == "audio":
                        b64_data = data.get("data", "")
                        if b64_data:
                            pcm_bytes = base64.b64decode(b64_data)
                            if audio_queue.full():
                                try:
                                    audio_queue.get_nowait()
                                except asyncio.QueueEmpty:
                                    pass
                            await audio_queue.put(pcm_bytes)

                    elif msg_type == "activity":
                        # Voice activity detected on client microphone
                        session_state["last_activity_ts"] = time.monotonic()

                    elif msg_type == "update_config":
                        session_state["last_activity_ts"] = time.monotonic()
                        new_source = data.get("source_lang", session_state["source_lang"])
                        new_target = data.get("target_lang", session_state["target_lang"])
                        new_echo = data.get(
                            "echo_target_language", session_state["echo_target_language"]
                        )

                        target_changed = new_target != session_state["target_lang"] or (
                            bool(new_echo) != bool(session_state["echo_target_language"])
                        )
                        session_state["source_lang"] = new_source
                        session_state["target_lang"] = new_target
                        session_state["echo_target_language"] = bool(new_echo)

                        if target_changed:
                            # Reset resumption handle when translation target config changes
                            session_state["resumption_handle"] = None
                            if session_state["session_id"]:
                                RESUMABLE_SESSIONS.pop(session_state["session_id"], None)
                            session_state["reconnect_requested"] = True
                            session_state["reconnect_reason"] = (
                                f"Target 언어 변경 ({new_target})으로 세션을 재연결합니다."
                            )
                            force_reconnect_event.set()
                        else:
                            await send_ws_json(
                                {
                                    "type": "config_updated",
                                    "source_lang": new_source,
                                    "target_lang": new_target,
                                    "echo_target_language": session_state[
                                        "echo_target_language"
                                    ],
                                }
                            )

                    elif msg_type == "stop":
                        logger.info("Client requested explicit session termination.")
                        session_state["explicitly_stopped"] = True
                        if session_state["session_id"]:
                            RESUMABLE_SESSIONS.pop(session_state["session_id"], None)
                        await send_ws_json(
                            {
                                "type": "session_closed",
                                "reason": data.get("reason", "explicit_stop"),
                                "message": "회의 종료 요청에 따라 Live API 세션이 명시적으로 종료되었습니다.",
                            }
                        )
                        session_state["client_disconnected"] = True
                        force_reconnect_event.set()
                        break

        except WebSocketDisconnect:
            session_state["client_disconnected"] = True
        except Exception as exc:
            logger.debug("Client reader loop ended: %s", exc)
            session_state["client_disconnected"] = True
        finally:
            force_reconnect_event.set()
            try:
                audio_queue.put_nowait(None)
            except asyncio.QueueFull:
                pass

    async def run_gemini_session(session):
        """Run concurrent audio sender and response receiver for an active Gemini Live session."""
        session_closed = asyncio.Event()

        async def upstream_sender():
            chunk_count = 0
            try:
                while (
                    not session_state["client_disconnected"]
                    and not session_closed.is_set()
                    and not force_reconnect_event.is_set()
                ):
                    try:
                        chunk = await asyncio.wait_for(audio_queue.get(), timeout=0.25)
                    except asyncio.TimeoutError:
                        continue

                    if chunk is None:
                        break

                    chunk_count += 1
                    if chunk_count == 1 or chunk_count % 50 == 0:
                        # Check peak 16-bit PCM sample amplitude for diagnostics
                        import array
                        samples = array.array("h", chunk[: len(chunk) - (len(chunk) % 2)])
                        peak = max((abs(s) for s in samples), default=0)
                        if peak > 350:
                            session_state["last_activity_ts"] = time.monotonic()
                        logger.info(
                            "Streaming audio chunk #%d (%d bytes, peak_amp=%d/32767)",
                            chunk_count,
                            len(chunk),
                            peak,
                        )

                    await session.send_realtime_input(
                        audio=types.Blob(
                            data=chunk,
                            mime_type="audio/pcm;rate=16000",
                        )
                    )
            except asyncio.CancelledError:
                pass
            except Exception as exc:
                if not session_state["client_disconnected"]:
                    logger.warning("Upstream sender ended: %s", exc)
                session_closed.set()

        async def upstream_receiver():
            try:
                while (
                    not session_state["client_disconnected"]
                    and not session_closed.is_set()
                    and not force_reconnect_event.is_set()
                ):
                    async for response in session.receive():
                        if (
                            session_state["client_disconnected"]
                            or force_reconnect_event.is_set()
                        ):
                            break

                        # 1. Handle Session Resumption Token Update
                        if response.session_resumption_update:
                            update = response.session_resumption_update
                            if update.resumable and update.new_handle:
                                session_state["resumption_handle"] = update.new_handle
                                if (
                                    session_state["session_id"]
                                    and not session_state["explicitly_stopped"]
                                ):
                                    RESUMABLE_SESSIONS[session_state["session_id"]] = {
                                        "handle": update.new_handle,
                                        "target_lang": session_state["target_lang"],
                                        "updated_at": time.monotonic(),
                                    }
                                handle_preview = (
                                    update.new_handle[:10] + "..."
                                    if len(update.new_handle) > 10
                                    else update.new_handle
                                )
                                await send_ws_json(
                                    {
                                        "type": "session_resumption",
                                        "resumable": True,
                                        "handle_preview": handle_preview,
                                    }
                                )

                        # 2. Handle GoAway Message (Proactive connection termination notice for 2+ hour sessions)
                        if response.go_away is not None:
                            time_left = getattr(response.go_away, "time_left", None)
                            logger.info(
                                "Received GoAway from Live API (time_left=%s)", time_left
                            )
                            await send_ws_json(
                                {
                                    "type": "go_away",
                                    "time_left": str(time_left or "곧 만료"),
                                }
                            )
                            session_state["reconnect_requested"] = True
                            session_state["reconnect_reason"] = (
                                f"세션 수명 만료 알림(GoAway, 남은 시간: {time_left}) 수신 — 세션 핸들로 자동 연장합니다."
                            )
                            force_reconnect_event.set()
                            break

                        # 3. Handle Server Content (Transcriptions & Translated Audio)
                        server_content = response.server_content
                        if server_content:
                            # Interim input transcription (if provided)
                            interim_in = getattr(
                                server_content, "interim_input_transcription", None
                            )
                            if interim_in and getattr(interim_in, "text", None):
                                session_state["last_activity_ts"] = time.monotonic()
                                await send_ws_json(
                                    {
                                        "type": "input_transcription",
                                        "text": interim_in.text,
                                        "finished": bool(
                                            getattr(interim_in, "finished", False)
                                        ),
                                        "language_code": getattr(
                                            interim_in, "language_code", None
                                        ),
                                        "interim": True,
                                    }
                                )

                            # Input (Source) audio transcription
                            in_trans = server_content.input_transcription
                            if in_trans and in_trans.text:
                                session_state["last_activity_ts"] = time.monotonic()
                                logger.info(
                                    "[Source Transcript] (%s): %s",
                                    getattr(in_trans, "language_code", "-"),
                                    in_trans.text,
                                )
                                await send_ws_json(
                                    {
                                        "type": "input_transcription",
                                        "text": in_trans.text,
                                        "finished": bool(
                                            getattr(in_trans, "finished", False)
                                        ),
                                        "language_code": getattr(
                                            in_trans, "language_code", None
                                        ),
                                        "interim": False,
                                    }
                                )

                            # Output (Target translated) audio transcription
                            out_trans = server_content.output_transcription
                            if out_trans and out_trans.text:
                                session_state["last_activity_ts"] = time.monotonic()
                                logger.info(
                                    "[Target Translation] (%s): %s",
                                    session_state["target_lang"],
                                    out_trans.text,
                                )
                                await send_ws_json(
                                    {
                                        "type": "output_transcription",
                                        "text": out_trans.text,
                                        "finished": bool(
                                            getattr(out_trans, "finished", False)
                                        ),
                                        "language_code": getattr(
                                            out_trans, "language_code", None
                                        )
                                        or session_state["target_lang"],
                                    }
                                )

                            # Model turn activity (pure subtitle mode — no audio output sent to client)
                            if server_content.model_turn and server_content.model_turn.parts:
                                session_state["last_activity_ts"] = time.monotonic()

                            # Turn / Generation completion signals
                            if (
                                server_content.turn_complete
                                or server_content.generation_complete
                            ):
                                await send_ws_json(
                                    {
                                        "type": "turn_complete",
                                        "turn_complete": bool(
                                            server_content.turn_complete
                                        ),
                                        "generation_complete": bool(
                                            server_content.generation_complete
                                        ),
                                    }
                                )

            except asyncio.CancelledError:
                pass
            except genai_errors.APIError as api_err:
                if not session_state["client_disconnected"]:
                    logger.warning("Gemini Live session closed/error: %s", api_err)
                    session_state["reconnect_requested"] = True
                    session_state["reconnect_reason"] = (
                        "연결 주기가 도달하여 세션을 자동으로 연장합니다."
                    )
            except Exception as exc:
                if not session_state["client_disconnected"]:
                    logger.warning("Receiver loop ended with exception: %s", exc)
                    session_state["reconnect_requested"] = True
                    session_state["reconnect_reason"] = (
                        "일시적 연결 끊김이 감지되어 자동 재연결합니다."
                    )
            finally:
                session_closed.set()

        sender_task = asyncio.create_task(upstream_sender())
        receiver_task = asyncio.create_task(upstream_receiver())

        done, pending = await asyncio.wait(
            [sender_task, receiver_task],
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)

    # Start reading from client browser WebSocket and inactivity watchdog in background
    reader_task = asyncio.create_task(client_reader_loop())
    watchdog_task = asyncio.create_task(inactivity_watchdog())

    client = create_genai_client(
        api_key_override=api_key_override,
        location_override=session_state["location_override"],
    )
    retry_count = 0

    try:
        while not session_state["client_disconnected"]:
            force_reconnect_event.clear()
            target_lang_now = session_state["target_lang"]
            echo_now = session_state["echo_target_language"]
            handle_now = session_state["resumption_handle"]

            config = build_live_connect_config(
                target_language_code=target_lang_now,
                echo_target_language=echo_now,
                session_handle=handle_now,
                enable_session_management=session_state["enable_session_management"],
            )

            status_mode = "resuming" if handle_now else "connecting"
            await send_ws_json(
                {
                    "type": "status",
                    "status": status_mode,
                    "model": LIVE_TRANSLATE_MODEL,
                    "source_lang": session_state["source_lang"],
                    "target_lang": target_lang_now,
                    "echo_target_language": echo_now,
                    "session_management": session_state["enable_session_management"],
                    "resumed": bool(handle_now),
                    "message": session_state["reconnect_reason"]
                    or (
                        "이전 세션 핸들로 연결을 자동 연장 중입니다..."
                        if handle_now
                        else "Gemini 3.5 Live Translate 세션 연결 중..."
                    ),
                }
            )
            session_state["reconnect_reason"] = ""

            try:
                async with client.aio.live.connect(
                    model=LIVE_TRANSLATE_MODEL, config=config
                ) as session:
                    retry_count = 0
                    session_state["last_activity_ts"] = time.monotonic()
                    await send_ws_json(
                        {
                            "type": "status",
                            "status": "connected",
                            "model": LIVE_TRANSLATE_MODEL,
                            "source_lang": session_state["source_lang"],
                            "target_lang": target_lang_now,
                            "echo_target_language": echo_now,
                            "session_management": session_state[
                                "enable_session_management"
                            ],
                            "resumed": bool(handle_now),
                            "message": "실시간 통역 세션이 활성화되었습니다.",
                        }
                    )
                    await run_gemini_session(session)

            except Exception as conn_err:
                if session_state["client_disconnected"]:
                    break

                err_msg = str(conn_err)
                logger.warning("Live connect exception: %s", err_msg)

                # If resumption handle expired or was rejected, clear it and retry immediately
                if session_state["resumption_handle"] is not None:
                    logger.info(
                        "Clearing expired/invalid resumption handle and retrying..."
                    )
                    session_state["resumption_handle"] = None
                    continue

                # If preview model endpoint rejected compression/resumption setup fields, fallback cleanly
                if session_state["enable_session_management"] and (
                    "compression" in err_msg.lower()
                    or "resumption" in err_msg.lower()
                    or "invalid" in err_msg.lower()
                    or "unsupported" in err_msg.lower()
                    or "1007" in err_msg
                ):
                    logger.info(
                        "Falling back to standard LiveConnectConfig without optional session management fields"
                    )
                    session_state["enable_session_management"] = False
                    continue

                retry_count += 1
                if retry_count > 3:
                    await send_ws_json(
                        {
                            "type": "error",
                            "message": f"Gemini Live API 연결 실패: {err_msg}",
                        }
                    )
                    break

                await send_ws_json(
                    {
                        "type": "status",
                        "status": "reconnecting",
                        "message": f"연결 재시도 중 ({retry_count}/3)...",
                    }
                )
                await asyncio.sleep(1.0)

    finally:
        session_state["client_disconnected"] = True
        reader_task.cancel()
        watchdog_task.cancel()
        await asyncio.gather(reader_task, watchdog_task, return_exceptions=True)
        try:
            await websocket.close()
        except Exception:
            pass
        logger.info("Live Translate WebSocket session explicitly closed.")


# Serve static files and root index.html
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
async def serve_index():
    return FileResponse(str(STATIC_DIR / "index.html"))
