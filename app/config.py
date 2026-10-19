import asyncio
import datetime
import logging
import os
import subprocess
import threading
from pathlib import Path
from typing import Optional
from dotenv import load_dotenv
import google.auth
import google.auth.credentials
from google.auth import _helpers as auth_helpers
from google.auth.transport.requests import Request
from google import genai

BASE_DIR = Path(__file__).resolve().parent.parent
# Real environment variables (e.g. Cloud Run --set-env-vars / secrets) take precedence over .env.
load_dotenv(BASE_DIR / ".env", override=False)

logger = logging.getLogger("live-translate.auth")


def _clean_env(key: str, default: str = "") -> str:
    val = os.getenv(key, default).strip()
    if len(val) >= 2 and ((val[0] == '"' and val[-1] == '"') or (val[0] == "'" and val[-1] == "'")):
        val = val[1:-1].strip()
    return val


def _detect_gcloud_project() -> str:
    """Fallback to active gcloud project if GOOGLE_CLOUD_PROJECT is not set."""
    try:
        res = subprocess.run(
            ["gcloud", "config", "get-value", "project"],
            capture_output=True,
            text=True,
            timeout=3,
            check=False,
        )
        proj = res.stdout.strip()
        if proj and proj != "(unset)":
            return proj
    except Exception:
        pass
    return ""


AUTH_MODE: str = _clean_env("AUTH_MODE", "adc").lower()
# Project where Cloud Run runs AND Gemini (Vertex AI) models are invoked (e.g., "your-gcp-project-id")
GOOGLE_CLOUD_PROJECT: str = (
    _clean_env("GOOGLE_CLOUD_PROJECT") or _detect_gcloud_project()
)
GOOGLE_CLOUD_LOCATION: str = (
    _clean_env("GOOGLE_CLOUD_LOCATION", "global") or "global"
)

GEMINI_API_KEY: str = _clean_env("GEMINI_API_KEY")

LIVE_TRANSLATE_MODEL: str = (
    _clean_env("LIVE_TRANSLATE_MODEL", "gemini-3.5-live-translate-preview")
    or "gemini-3.5-live-translate-preview"
)
SUMMARY_MODEL: str = (
    _clean_env("SUMMARY_MODEL", "gemini-3.8-flash") or "gemini-3.8-flash"
)
INACTIVITY_TIMEOUT_SECONDS: int = int(
    _clean_env("INACTIVITY_TIMEOUT_SECONDS", "600") or "600"
)

# True when running on Cloud Run (K_SERVICE is injected by the platform).
IS_CLOUD_RUN: bool = bool(os.getenv("K_SERVICE"))

# Simple shared-password login gate (set APP_LOGIN_PASSWORD in .env). Empty = login disabled.
APP_LOGIN_PASSWORD: str = _clean_env("APP_LOGIN_PASSWORD")
# Explicit opt-out of the login gate (e.g. local dev / intentionally public deployments).
APP_LOGIN_DISABLED: bool = _clean_env("APP_LOGIN_DISABLED").lower() in ("1", "true", "yes")
# Secret used to sign the auth cookie. Falls back to a random per-process value if unset
# (sessions then reset whenever the server restarts or scales to a new instance).
_ENV_SESSION_SECRET = _clean_env("APP_SESSION_SECRET")
APP_SESSION_SECRET_IS_EPHEMERAL: bool = not _ENV_SESSION_SECRET
APP_SESSION_SECRET: str = _ENV_SESSION_SECRET or os.urandom(32).hex()
# Login session lifetime in hours (default 12h)
APP_SESSION_HOURS: int = int(_clean_env("APP_SESSION_HOURS", "12") or "12")

# Refresh the ADC access token proactively whenever < 15 minutes (900s) remain, so
# long-lived Gemini Live WebSocket sessions never connect with a nearly-expired token.
PROACTIVE_REFRESH_MARGIN_SECONDS = 900
CLOUD_PLATFORM_SCOPES = ["https://www.googleapis.com/auth/cloud-platform"]

_CREDENTIALS_LOCK = threading.RLock()
_ASYNC_CREDENTIALS_LOCK: Optional[asyncio.Lock] = None
_CACHED_GEMINI_CREDENTIALS: Optional[google.auth.credentials.Credentials] = None


def _get_async_credentials_lock() -> asyncio.Lock:
    global _ASYNC_CREDENTIALS_LOCK
    if _ASYNC_CREDENTIALS_LOCK is None:
        _ASYNC_CREDENTIALS_LOCK = asyncio.Lock()
    return _ASYNC_CREDENTIALS_LOCK


def _needs_refresh(creds: google.auth.credentials.Credentials) -> bool:
    if not creds.token or not creds.expiry:
        return True
    margin = datetime.timedelta(seconds=PROACTIVE_REFRESH_MARGIN_SECONDS)
    return auth_helpers.utcnow() >= creds.expiry - margin


def get_gemini_credentials(
    force_refresh: bool = False,
) -> google.auth.credentials.Credentials:
    """
    Return shared Application Default Credentials (ADC) for calling Gemini on Vertex AI,
    ensuring the access token is valid (with a 15-minute proactive refresh margin).
    - Cloud Run: the service account attached to the service (metadata server).
    - Local: `gcloud auth application-default login` or GOOGLE_APPLICATION_CREDENTIALS.
    Blocking (network I/O): call via `async_ensure_valid_gemini_credentials()` from async code.
    """
    global _CACHED_GEMINI_CREDENTIALS
    with _CREDENTIALS_LOCK:
        if _CACHED_GEMINI_CREDENTIALS is None:
            creds, adc_project = google.auth.default(scopes=CLOUD_PLATFORM_SCOPES)
            quota_project = GOOGLE_CLOUD_PROJECT or adc_project
            if quota_project and hasattr(creds, "with_quota_project"):
                creds = creds.with_quota_project(quota_project)
            _CACHED_GEMINI_CREDENTIALS = creds
            logger.info(
                "Loaded ADC credentials (%s, project=%s)",
                type(creds).__name__,
                quota_project,
            )

        creds = _CACHED_GEMINI_CREDENTIALS
        if force_refresh or _needs_refresh(creds):
            creds.refresh(Request())
            logger.info(
                "Refreshed ADC access token (expires_at=%s UTC)",
                creds.expiry.strftime("%Y-%m-%d %H:%M:%S") if creds.expiry else "unknown",
            )
        return creds


async def async_ensure_valid_gemini_credentials(
    force_refresh: bool = False,
) -> Optional[google.auth.credentials.Credentials]:
    """
    Asynchronously ensure that the ADC access token is fresh without blocking the event loop.
    Safe to call before every Live WebSocket connect/reconnect and HTTP summarize request.
    """
    if AUTH_MODE == "api_key":
        return None
    lock = _get_async_credentials_lock()
    async with lock:
        return await asyncio.to_thread(get_gemini_credentials, force_refresh)


def create_genai_client(
    location_override: Optional[str] = None,
    credentials: Optional[google.auth.credentials.Credentials] = None,
) -> genai.Client:
    """
    Create a Google GenAI Client on Vertex AI in GOOGLE_CLOUD_PROJECT using ADC.

    Performs no credential network I/O itself: pass the credentials returned by
    `async_ensure_valid_gemini_credentials()`; otherwise already-cached ADC credentials
    are used, or the SDK resolves ADC on its own.
    """
    if AUTH_MODE == "api_key" and GEMINI_API_KEY:
        return genai.Client(api_key=GEMINI_API_KEY)

    client_kwargs = {
        "vertexai": True,
        "location": location_override or GOOGLE_CLOUD_LOCATION or "global",
    }
    if GOOGLE_CLOUD_PROJECT:
        client_kwargs["project"] = GOOGLE_CLOUD_PROJECT
    creds = credentials if credentials is not None else _CACHED_GEMINI_CREDENTIALS
    if creds is not None:
        client_kwargs["credentials"] = creds
    return genai.Client(**client_kwargs)


# Official 78 languages supported by gemini-3.5-live-translate-preview
# Popular languages are marked with popular=True so UI can group them at the top.
SUPPORTED_LANGUAGES = [
    {"code": "en", "name": "English", "ko_name": "영어", "popular": True},
    {"code": "ko", "name": "Korean", "ko_name": "한국어", "popular": True},
    {"code": "ja", "name": "Japanese", "ko_name": "일본어", "popular": True},
    {"code": "zh-Hans", "name": "Chinese (Simplified)", "ko_name": "중국어 (간체)", "popular": True},
    {"code": "zh-Hant", "name": "Chinese (Traditional)", "ko_name": "중국어 (번체)", "popular": True},
    {"code": "es", "name": "Spanish", "ko_name": "스페인어", "popular": True},
    {"code": "fr", "name": "French", "ko_name": "프랑스어", "popular": True},
    {"code": "de", "name": "German", "ko_name": "독일어", "popular": True},
    {"code": "vi", "name": "Vietnamese", "ko_name": "베트남어", "popular": True},
    {"code": "th", "name": "Thai", "ko_name": "태국어", "popular": True},
    {"code": "id", "name": "Indonesian", "ko_name": "인도네시아어", "popular": True},
    {"code": "ru", "name": "Russian", "ko_name": "러시아어", "popular": True},
    {"code": "pt-BR", "name": "Portuguese (Brazil)", "ko_name": "포르투갈어 (브라질)", "popular": True},
    {"code": "ar", "name": "Arabic", "ko_name": "아랍어", "popular": True},
    {"code": "hi", "name": "Hindi", "ko_name": "힌디어", "popular": True},
    # Full alphabetical list of remaining supported BCP-47 languages
    {"code": "af", "name": "Afrikaans", "ko_name": "아프리칸스어", "popular": False},
    {"code": "ak", "name": "Akan", "ko_name": "아칸어", "popular": False},
    {"code": "sq", "name": "Albanian", "ko_name": "알바니아어", "popular": False},
    {"code": "am", "name": "Amharic", "ko_name": "암하라어", "popular": False},
    {"code": "hy", "name": "Armenian", "ko_name": "아르메니아어", "popular": False},
    {"code": "az", "name": "Azerbaijani", "ko_name": "아제르바이잔어", "popular": False},
    {"code": "eu", "name": "Basque", "ko_name": "바스크어", "popular": False},
    {"code": "be", "name": "Belarusian", "ko_name": "벨라루스어", "popular": False},
    {"code": "bn", "name": "Bengali", "ko_name": "벵골어", "popular": False},
    {"code": "bg", "name": "Bulgarian", "ko_name": "불가리아어", "popular": False},
    {"code": "my", "name": "Burmese (Myanmar)", "ko_name": "미얀마어 (버마어)", "popular": False},
    {"code": "ca", "name": "Catalan", "ko_name": "카탈로니아어", "popular": False},
    {"code": "hr", "name": "Croatian", "ko_name": "크로아티아어", "popular": False},
    {"code": "cs", "name": "Czech", "ko_name": "체코어", "popular": False},
    {"code": "da", "name": "Danish", "ko_name": "덴마크어", "popular": False},
    {"code": "nl", "name": "Dutch", "ko_name": "네덜란드어", "popular": False},
    {"code": "et", "name": "Estonian", "ko_name": "에스토니아어", "popular": False},
    {"code": "fil", "name": "Filipino", "ko_name": "필리핀어", "popular": False},
    {"code": "fi", "name": "Finnish", "ko_name": "핀란드어", "popular": False},
    {"code": "gl", "name": "Galician", "ko_name": "갈리시아어", "popular": False},
    {"code": "ka", "name": "Georgian", "ko_name": "조지아어", "popular": False},
    {"code": "el", "name": "Greek", "ko_name": "그리스어", "popular": False},
    {"code": "gu", "name": "Gujarati", "ko_name": "구자라트어", "popular": False},
    {"code": "ha", "name": "Hausa", "ko_name": "하우사어", "popular": False},
    {"code": "he", "name": "Hebrew", "ko_name": "히브리어", "popular": False},
    {"code": "hu", "name": "Hungarian", "ko_name": "헝가리어", "popular": False},
    {"code": "is", "name": "Icelandic", "ko_name": "아이슬란드어", "popular": False},
    {"code": "it", "name": "Italian", "ko_name": "이탈리아어", "popular": False},
    {"code": "jv", "name": "Javanese", "ko_name": "자바어", "popular": False},
    {"code": "kn", "name": "Kannada", "ko_name": "칸나다어", "popular": False},
    {"code": "kk", "name": "Kazakh", "ko_name": "카자흐어", "popular": False},
    {"code": "km", "name": "Khmer", "ko_name": "크메르어", "popular": False},
    {"code": "rw", "name": "Kinyarwanda", "ko_name": "키냐르완다어", "popular": False},
    {"code": "lo", "name": "Lao", "ko_name": "라오어", "popular": False},
    {"code": "lv", "name": "Latvian", "ko_name": "라트비아어", "popular": False},
    {"code": "lt", "name": "Lithuanian", "ko_name": "리투아니아어", "popular": False},
    {"code": "mk", "name": "Macedonian", "ko_name": "마케도니아어", "popular": False},
    {"code": "ms", "name": "Malay", "ko_name": "말레이어", "popular": False},
    {"code": "ml", "name": "Malayalam", "ko_name": "말라얄람어", "popular": False},
    {"code": "mr", "name": "Marathi", "ko_name": "마라티어", "popular": False},
    {"code": "mn", "name": "Mongolian", "ko_name": "몽골어", "popular": False},
    {"code": "ne", "name": "Nepali", "ko_name": "네팔어", "popular": False},
    {"code": "no", "name": "Norwegian", "ko_name": "노르웨이어", "popular": False},
    {"code": "nb", "name": "Norwegian Bokmål", "ko_name": "노르웨이어 (보크몰)", "popular": False},
    {"code": "fa", "name": "Persian", "ko_name": "페르시아어", "popular": False},
    {"code": "pl", "name": "Polish", "ko_name": "폴란드어", "popular": False},
    {"code": "pt-PT", "name": "Portuguese (Portugal)", "ko_name": "포르투갈어 (포르투갈)", "popular": False},
    {"code": "pa", "name": "Punjabi", "ko_name": "펀자브어", "popular": False},
    {"code": "ro", "name": "Romanian", "ko_name": "루마니아어", "popular": False},
    {"code": "sr", "name": "Serbian", "ko_name": "세르비아어", "popular": False},
    {"code": "sd", "name": "Sindhi", "ko_name": "신디어", "popular": False},
    {"code": "si", "name": "Sinhala", "ko_name": "싱할라어", "popular": False},
    {"code": "sk", "name": "Slovak", "ko_name": "슬로바키아어", "popular": False},
    {"code": "sl", "name": "Slovenian", "ko_name": "슬로베니아어", "popular": False},
    {"code": "su", "name": "Sundanese", "ko_name": "순다어", "popular": False},
    {"code": "sw", "name": "Swahili", "ko_name": "스와힐리어", "popular": False},
    {"code": "sv", "name": "Swedish", "ko_name": "스웨덴어", "popular": False},
    {"code": "ta", "name": "Tamil", "ko_name": "타밀어", "popular": False},
    {"code": "te", "name": "Telugu", "ko_name": "텔루구어", "popular": False},
    {"code": "tr", "name": "Turkish", "ko_name": "튀르키예어", "popular": False},
    {"code": "uk", "name": "Ukrainian", "ko_name": "우크라이나어", "popular": False},
    {"code": "ur", "name": "Urdu", "ko_name": "우르두어", "popular": False},
    {"code": "uz", "name": "Uzbek", "ko_name": "우즈베크어", "popular": False},
    {"code": "zu", "name": "Zulu", "ko_name": "줄루어", "popular": False},
]

SUPPORTED_LANGUAGE_CODES = frozenset(lang["code"] for lang in SUPPORTED_LANGUAGES)
LANGUAGE_NAMES = {lang["code"]: lang["name"] for lang in SUPPORTED_LANGUAGES}
