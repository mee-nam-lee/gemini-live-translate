import asyncio
import base64
import datetime
import json
import logging
import os
import subprocess
import threading
import time
from pathlib import Path
from typing import Optional
from dotenv import load_dotenv
import google.auth
import google.auth.credentials
from google.auth import _helpers as auth_helpers
from google.auth.transport.requests import AuthorizedSession, Request
from google.oauth2.credentials import Credentials as UserCredentials
from google import genai
from google.genai import types

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


# Gemini credential mode (chosen in .env):
#   adc            : Cloud Run project == Gemini project. GenAI calls use the runtime's ADC identity
#                    (Cloud Run service account / local `gcloud auth application-default login`).
#   secret_manager : Cloud Run project != Gemini project. GenAI calls use user OAuth credentials
#                    loaded from Secret Manager (USER_CREDENTIALS_SECRET in GOOGLE_CLOUD_PROJECT).
#   api_key        : Gemini Developer API key (GEMINI_API_KEY).
AUTH_MODE_ADC = "adc"
AUTH_MODE_SECRET_MANAGER = "secret_manager"
AUTH_MODE_API_KEY = "api_key"
SUPPORTED_AUTH_MODES = (AUTH_MODE_ADC, AUTH_MODE_SECRET_MANAGER, AUTH_MODE_API_KEY)

AUTH_MODE: str = _clean_env("AUTH_MODE", AUTH_MODE_ADC).lower().replace("-", "_")
if AUTH_MODE not in SUPPORTED_AUTH_MODES:
    raise ValueError(
        f"Invalid AUTH_MODE={AUTH_MODE!r}. Use one of: {', '.join(SUPPORTED_AUTH_MODES)}."
    )

# Project where Cloud Run and Secret Manager run (e.g., "your-cloud-run-project-id")
GOOGLE_CLOUD_PROJECT: str = (
    _clean_env("GOOGLE_CLOUD_PROJECT") or _detect_gcloud_project()
)
GOOGLE_CLOUD_LOCATION: str = (
    _clean_env("GOOGLE_CLOUD_LOCATION", "global") or "global"
)
# Project where Gemini 3.5 Live Translate & Summary models are invoked (e.g., "your-gemini-project-id").
# In adc mode it defaults to GOOGLE_CLOUD_PROJECT.
_ENV_GEMINI_PROJECT = _clean_env("GEMINI_PROJECT")
GEMINI_PROJECT: str = _ENV_GEMINI_PROJECT or GOOGLE_CLOUD_PROJECT
# Secret Manager secret ID in GOOGLE_CLOUD_PROJECT containing the user OAuth credentials JSON.
# Only used (and required) when AUTH_MODE=secret_manager. No default: set it explicitly.
USER_CREDENTIALS_SECRET: str = _clean_env("USER_CREDENTIALS_SECRET")

# Fail fast on configuration that cannot work in secret_manager mode.
if AUTH_MODE == AUTH_MODE_SECRET_MANAGER:
    _missing = [
        name
        for name, value in (
            ("GOOGLE_CLOUD_PROJECT", GOOGLE_CLOUD_PROJECT),
            ("GEMINI_PROJECT", _ENV_GEMINI_PROJECT),
            ("USER_CREDENTIALS_SECRET", USER_CREDENTIALS_SECRET),
        )
        if not value
    ]
    if _missing:
        raise ValueError(
            f"AUTH_MODE=secret_manager requires: {', '.join(_missing)}."
        )

# Non-fatal configuration warnings, logged by the app at startup.
AUTH_CONFIG_WARNINGS: list = []
if (
    AUTH_MODE == AUTH_MODE_ADC
    and _ENV_GEMINI_PROJECT
    and GOOGLE_CLOUD_PROJECT
    and _ENV_GEMINI_PROJECT != GOOGLE_CLOUD_PROJECT
):
    AUTH_CONFIG_WARNINGS.append(
        f"AUTH_MODE=adc but GEMINI_PROJECT ({_ENV_GEMINI_PROJECT}) differs from "
        f"GOOGLE_CLOUD_PROJECT ({GOOGLE_CLOUD_PROJECT}). The runtime identity needs "
        f"roles/aiplatform.user on {_ENV_GEMINI_PROJECT}; otherwise use AUTH_MODE=secret_manager."
    )
if (
    AUTH_MODE == AUTH_MODE_SECRET_MANAGER
    and _ENV_GEMINI_PROJECT == GOOGLE_CLOUD_PROJECT
):
    AUTH_CONFIG_WARNINGS.append(
        "AUTH_MODE=secret_manager but GEMINI_PROJECT equals GOOGLE_CLOUD_PROJECT; "
        "AUTH_MODE=adc is simpler for a single project."
    )
if AUTH_MODE == AUTH_MODE_API_KEY and not _clean_env("GEMINI_API_KEY"):
    AUTH_CONFIG_WARNINGS.append(
        "AUTH_MODE=api_key but GEMINI_API_KEY is empty; falling back to Vertex AI with ADC."
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

# Refresh OAuth2 access token proactively whenever < 15 minutes (900s) remain out of 60m lifetime
PROACTIVE_REFRESH_MARGIN_SECONDS = 900
CLOUD_PLATFORM_SCOPES = ["https://www.googleapis.com/auth/cloud-platform"]


def _fetch_credentials_from_secret_manager(
    secret_project: str, secret_id: str
) -> Optional[dict]:
    """
    Fetch user OAuth credentials JSON from Google Cloud Secret Manager:
    projects/{secret_project}/secrets/{secret_id}/versions/latest:access
    """
    if not secret_project or not secret_id:
        return None
    try:
        adc_creds, _ = google.auth.default(scopes=CLOUD_PLATFORM_SCOPES)
        session = AuthorizedSession(adc_creds)
        url = (
            f"https://secretmanager.googleapis.com/v1/projects/{secret_project}"
            f"/secrets/{secret_id}/versions/latest:access"
        )
        resp = session.get(url, timeout=10)
        if resp.status_code != 200:
            logger.warning(
                "Secret Manager access for '%s' in project '%s' returned HTTP %d: %s",
                secret_id,
                secret_project,
                resp.status_code,
                resp.text[:200],
            )
            return None
        payload_b64 = resp.json().get("payload", {}).get("data", "")
        if not payload_b64:
            return None
        raw_json = base64.b64decode(payload_b64).decode("utf-8")
        info = json.loads(raw_json)
        logger.info(
            "Loaded user credentials from Secret Manager 'projects/%s/secrets/%s/versions/latest'",
            secret_project,
            secret_id,
        )
        return info
    except Exception as exc:
        logger.warning(
            "Failed to fetch secret '%s' from Secret Manager (project=%s): %s",
            secret_id,
            secret_project,
            exc,
        )
        return None


def _load_user_credentials_info() -> Optional[dict]:
    """
    Load user credentials dictionary from Google Cloud Secret Manager
    ('projects/{GOOGLE_CLOUD_PROJECT}/secrets/{USER_CREDENTIALS_SECRET}/versions/latest').
    Only used when AUTH_MODE=secret_manager.
    """
    if AUTH_MODE != AUTH_MODE_SECRET_MANAGER or not USER_CREDENTIALS_SECRET:
        return None
    return _fetch_credentials_from_secret_manager(
        GOOGLE_CLOUD_PROJECT, USER_CREDENTIALS_SECRET
    )


class AutoRefreshingUserCredentials(UserCredentials):
    """
    OAuth2 User Credentials with:
    1) Proactive 15-minute expiration buffer (`expired` is True when <15m left out of 60m)
       so long-lived Gemini Live WebSocket sessions never connect with a nearly-expired token.
    2) Thread-safe `refresh()` lock so concurrent WebSocket/HTTP calls never race.
    3) Automatic reload from Secret Manager (USER_CREDENTIALS_SECRET) if `refresh_token` was rotated.
    """

    def __init__(
        self,
        *args,
        refresh_margin_seconds: int = PROACTIVE_REFRESH_MARGIN_SECONDS,
        **kwargs,
    ):
        super().__init__(*args, **kwargs)
        self._refresh_lock = threading.RLock()
        self._refresh_margin = datetime.timedelta(seconds=refresh_margin_seconds)

    @property
    def expired(self) -> bool:
        if not self.expiry:
            return True if not self.token else False
        skewed_expiry = self.expiry - self._refresh_margin
        return auth_helpers.utcnow() >= skewed_expiry

    def remaining_seconds(self) -> float:
        if not self.expiry:
            return 0.0
        return (self.expiry - auth_helpers.utcnow()).total_seconds()

    def refresh(self, request=None) -> None:
        with self._refresh_lock:
            if request is None:
                request = Request()
            try:
                super().refresh(request)
                logger.info(
                    "Refreshed Gemini OAuth2 access token (project=%s, valid_for=%.0fs, expires_at=%s UTC)",
                    self.quota_project_id or GEMINI_PROJECT,
                    self.remaining_seconds(),
                    self.expiry.strftime("%Y-%m-%d %H:%M:%S") if self.expiry else "unknown",
                )
            except Exception as first_err:
                logger.warning(
                    "OAuth2 token refresh error (%s); attempting credential reload from Secret Manager (%s)...",
                    first_err,
                    USER_CREDENTIALS_SECRET,
                )
                reloaded_info = _load_user_credentials_info()
                if reloaded_info and reloaded_info.get("refresh_token"):
                    self._refresh_token = reloaded_info.get("refresh_token")
                    self._client_id = reloaded_info.get("client_id", self._client_id)
                    self._client_secret = reloaded_info.get(
                        "client_secret", self._client_secret
                    )
                    super().refresh(request)
                    logger.info(
                        "Refreshed Gemini OAuth2 access token after reloading latest credentials from Secret Manager."
                    )
                else:
                    raise first_err


_CREDENTIALS_LOCK = threading.RLock()
_ASYNC_CREDENTIALS_LOCK: Optional[asyncio.Lock] = None
_CACHED_GEMINI_CREDENTIALS: Optional[google.auth.credentials.Credentials] = None
# Negative cache: after a failed Secret Manager load, don't retry for this many seconds.
CREDENTIAL_LOAD_FAILURE_TTL_SECONDS = 60
_LAST_CREDENTIAL_LOAD_FAILURE_TS: Optional[float] = None


def _get_async_credentials_lock() -> asyncio.Lock:
    global _ASYNC_CREDENTIALS_LOCK
    if _ASYNC_CREDENTIALS_LOCK is None:
        _ASYNC_CREDENTIALS_LOCK = asyncio.Lock()
    return _ASYNC_CREDENTIALS_LOCK


def _needs_refresh(creds: google.auth.credentials.Credentials) -> bool:
    """True when the token is missing or has < PROACTIVE_REFRESH_MARGIN_SECONDS left."""
    if not creds.token or not creds.expiry:
        return True
    margin = datetime.timedelta(seconds=PROACTIVE_REFRESH_MARGIN_SECONDS)
    return auth_helpers.utcnow() >= creds.expiry - margin


def _load_adc_credentials() -> google.auth.credentials.Credentials:
    """AUTH_MODE=adc: the runtime's ADC identity (Cloud Run service account / local gcloud ADC)."""
    creds, adc_project = google.auth.default(scopes=CLOUD_PLATFORM_SCOPES)
    logger.info(
        "Loaded ADC credentials (%s, adc_project=%s, gemini_project=%s)",
        type(creds).__name__,
        adc_project,
        GEMINI_PROJECT,
    )
    return creds


def _load_secret_manager_credentials() -> google.auth.credentials.Credentials:
    """AUTH_MODE=secret_manager: user OAuth credentials from USER_CREDENTIALS_SECRET."""
    global _LAST_CREDENTIAL_LOAD_FAILURE_TS
    if (
        _LAST_CREDENTIAL_LOAD_FAILURE_TS is not None
        and time.monotonic() - _LAST_CREDENTIAL_LOAD_FAILURE_TS
        < CREDENTIAL_LOAD_FAILURE_TTL_SECONDS
    ):
        # Recently failed; don't hammer Secret Manager on every request.
        raise RuntimeError(
            "Gemini user credentials are unavailable (recent Secret Manager load failed)."
        )
    info = _load_user_credentials_info()
    if not info:
        _LAST_CREDENTIAL_LOAD_FAILURE_TS = time.monotonic()
        logger.error(
            "Could not load Gemini user credentials from Secret Manager "
            "(project=%s, secret=%s); retrying in %ds.",
            GOOGLE_CLOUD_PROJECT,
            USER_CREDENTIALS_SECRET,
            CREDENTIAL_LOAD_FAILURE_TTL_SECONDS,
        )
        raise RuntimeError(
            "Could not load Gemini user credentials from Secret Manager "
            f"(project={GOOGLE_CLOUD_PROJECT}, secret={USER_CREDENTIALS_SECRET})."
        )
    _LAST_CREDENTIAL_LOAD_FAILURE_TS = None
    cred_type = info.get("type", "authorized_user")
    target_quota_project = (
        GEMINI_PROJECT
        or info.get("quota_project_id")
        or GOOGLE_CLOUD_PROJECT
    )
    if cred_type == "authorized_user":
        merged_info = {
            **info,
            "quota_project_id": target_quota_project,
        }
        return AutoRefreshingUserCredentials.from_authorized_user_info(
            merged_info,
            scopes=CLOUD_PLATFORM_SCOPES,
        )
    creds, _ = google.auth.load_credentials_from_dict(
        info,
        scopes=CLOUD_PLATFORM_SCOPES,
        quota_project_id=target_quota_project,
    )
    return creds


def get_gemini_credentials(
    force_refresh: bool = False,
) -> Optional[google.auth.credentials.Credentials]:
    """
    Return the shared credentials for calling Gemini in GEMINI_PROJECT, ensuring the access
    token has at least 15 minutes left (proactive refresh margin):
    - adc            : the runtime's ADC identity.
    - secret_manager : user OAuth credentials from Secret Manager. Raises RuntimeError if they
                       cannot be loaded (no silent fallback to the runtime's ADC identity).
    - api_key        : returns None.
    Blocking (network I/O): call via `async_ensure_valid_gemini_credentials()` from async code.
    """
    global _CACHED_GEMINI_CREDENTIALS
    if AUTH_MODE == AUTH_MODE_API_KEY:
        return None
    with _CREDENTIALS_LOCK:
        if _CACHED_GEMINI_CREDENTIALS is None:
            _CACHED_GEMINI_CREDENTIALS = (
                _load_secret_manager_credentials()
                if AUTH_MODE == AUTH_MODE_SECRET_MANAGER
                else _load_adc_credentials()
            )

        creds = _CACHED_GEMINI_CREDENTIALS
        if force_refresh or _needs_refresh(creds):
            creds.refresh(Request())
            if AUTH_MODE == AUTH_MODE_ADC:
                logger.info(
                    "Refreshed ADC access token (expires_at=%s UTC)",
                    creds.expiry.strftime("%Y-%m-%d %H:%M:%S") if creds.expiry else "unknown",
                )
        return creds


async def async_ensure_valid_gemini_credentials(
    force_refresh: bool = False,
) -> Optional[google.auth.credentials.Credentials]:
    """
    Asynchronously ensure that the Gemini OAuth2 token is fresh without blocking the event loop.
    Safe to call before every Live WebSocket connect/reconnect and HTTP summarize request.
    No-op (returns None) when AUTH_MODE=api_key.
    """
    if AUTH_MODE == AUTH_MODE_API_KEY:
        return None
    lock = _get_async_credentials_lock()
    async with lock:
        return await asyncio.to_thread(get_gemini_credentials, force_refresh)


def create_genai_client(
    location_override: Optional[str] = None,
    credentials: Optional[google.auth.credentials.Credentials] = None,
) -> genai.Client:
    """
    Create a Google GenAI Client for GEMINI_PROJECT according to AUTH_MODE:
    - adc            : Vertex AI with the runtime's ADC identity (Cloud Run service account).
    - secret_manager : Vertex AI with the auto-refreshing user credentials from Secret Manager
                       (USER_CREDENTIALS_SECRET), while Cloud Run runs in GOOGLE_CLOUD_PROJECT.
    - api_key        : Gemini Developer API key.

    Performs no credential network I/O itself: pass the credentials returned by
    `async_ensure_valid_gemini_credentials()`; otherwise already-cached credentials are used.
    """
    if AUTH_MODE == AUTH_MODE_API_KEY and GEMINI_API_KEY:
        return genai.Client(api_key=GEMINI_API_KEY)

    target_location = location_override or GOOGLE_CLOUD_LOCATION or "global"
    target_project = GEMINI_PROJECT or GOOGLE_CLOUD_PROJECT
    creds = credentials if credentials is not None else _CACHED_GEMINI_CREDENTIALS

    if AUTH_MODE == AUTH_MODE_SECRET_MANAGER:
        if creds is None:
            raise RuntimeError(
                "AUTH_MODE=secret_manager but Gemini user credentials are not loaded."
            )
        return genai.Client(
            vertexai=True,
            project=target_project,
            location=target_location,
            credentials=creds,
            http_options=types.HttpOptions(
                headers={"x-goog-user-project": target_project}
            ),
        )

    # adc (or api_key without a key): shared ADC credentials when loaded, else the SDK
    # resolves the runtime's ADC identity itself.
    client_kwargs = {"vertexai": True, "location": target_location}
    if target_project:
        client_kwargs["project"] = target_project
    if creds is not None and AUTH_MODE == AUTH_MODE_ADC:
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
