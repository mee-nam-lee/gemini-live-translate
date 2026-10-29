/**
 * Google Gemini 3.5 Live Translate — Frontend Web Application
 * Works across Desktop Web, iPhone (iOS Safari/Chrome), and Android browsers.
 *
 * Features:
 * - Single smart microphone capture (16kHz mono PCM) with automatic noise suppression
 *   and voice-band filtering (85Hz high-pass + 7.5kHz low-pass)
 * - Automatic device & speaker-aware echo control (captures PC conference speaker when muted,
 *   prevents self-translation feedback loop when speaker output is enabled)
 * - Collapsible Source panel so Target panel expands to full height with larger text
 * - Smart auto-scroll that pauses when the user scrolls up to read earlier sentences
 * - Mobile browser resilience (iOS Safari interrupted AudioContext recovery, Wake Lock,
 *   seamless WebSocket auto-reconnect with session_id handle persistence)
 */

(() => {
  "use strict";

  const POPULAR_LANG_CODES = [
    "en",
    "ko",
    "ja",
    "zh-Hans",
    "zh-Hant",
    "es",
    "fr",
    "de",
    "vi",
    "th",
    "id",
    "pt-BR",
    "ru",
    "ar",
    "hi",
  ];

  // Official supported languages for Gemini 3.5 Live Translate
  // (https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-5-live-translate#supported-languages)
  const DEFAULT_SUPPORTED_LANGUAGES = [
    { code: "en", name: "English", ko_name: "영어", popular: true },
    { code: "ko", name: "Korean", ko_name: "한국어", popular: true },
    { code: "ja", name: "Japanese", ko_name: "일본어", popular: true },
    { code: "zh-Hans", name: "Chinese (Simplified)", ko_name: "중국어 (간체)", popular: true },
    { code: "zh-Hant", name: "Chinese (Traditional)", ko_name: "중국어 (번체)", popular: true },
    { code: "es", name: "Spanish", ko_name: "스페인어", popular: true },
    { code: "fr", name: "French", ko_name: "프랑스어", popular: true },
    { code: "de", name: "German", ko_name: "독일어", popular: true },
    { code: "vi", name: "Vietnamese", ko_name: "베트남어", popular: true },
    { code: "th", name: "Thai", ko_name: "태국어", popular: true },
    { code: "id", name: "Indonesian", ko_name: "인도네시아어", popular: true },
    { code: "ru", name: "Russian", ko_name: "러시아어", popular: true },
    { code: "pt-BR", name: "Portuguese (Brazil)", ko_name: "포르투갈어 (브라질)", popular: true },
    { code: "ar", name: "Arabic", ko_name: "아랍어", popular: true },
    { code: "hi", name: "Hindi", ko_name: "힌디어", popular: true },
    { code: "af", name: "Afrikaans", ko_name: "아프리칸스어", popular: false },
    { code: "ak", name: "Akan", ko_name: "아칸어", popular: false },
    { code: "sq", name: "Albanian", ko_name: "알바니아어", popular: false },
    { code: "am", name: "Amharic", ko_name: "암하라어", popular: false },
    { code: "hy", name: "Armenian", ko_name: "아르메니아어", popular: false },
    { code: "az", name: "Azerbaijani", ko_name: "아제르바이잔어", popular: false },
    { code: "eu", name: "Basque", ko_name: "바스크어", popular: false },
    { code: "be", name: "Belarusian", ko_name: "벨라루스어", popular: false },
    { code: "bn", name: "Bengali", ko_name: "벵골어", popular: false },
    { code: "bg", name: "Bulgarian", ko_name: "불가리아어", popular: false },
    { code: "my", name: "Burmese (Myanmar)", ko_name: "미얀마어 (버마어)", popular: false },
    { code: "ca", name: "Catalan", ko_name: "카탈로니아어", popular: false },
    { code: "hr", name: "Croatian", ko_name: "크로아티아어", popular: false },
    { code: "cs", name: "Czech", ko_name: "체코어", popular: false },
    { code: "da", name: "Danish", ko_name: "덴마크어", popular: false },
    { code: "nl", name: "Dutch", ko_name: "네덜란드어", popular: false },
    { code: "et", name: "Estonian", ko_name: "에스토니아어", popular: false },
    { code: "fil", name: "Filipino", ko_name: "필리핀어", popular: false },
    { code: "fi", name: "Finnish", ko_name: "핀란드어", popular: false },
    { code: "gl", name: "Galician", ko_name: "갈리시아어", popular: false },
    { code: "ka", name: "Georgian", ko_name: "조지아어", popular: false },
    { code: "el", name: "Greek", ko_name: "그리스어", popular: false },
    { code: "gu", name: "Gujarati", ko_name: "구자라트어", popular: false },
    { code: "ha", name: "Hausa", ko_name: "하우사어", popular: false },
    { code: "he", name: "Hebrew", ko_name: "히브리어", popular: false },
    { code: "hu", name: "Hungarian", ko_name: "헝가리어", popular: false },
    { code: "is", name: "Icelandic", ko_name: "아이슬란드어", popular: false },
    { code: "it", name: "Italian", ko_name: "이탈리아어", popular: false },
    { code: "jv", name: "Javanese", ko_name: "자바어", popular: false },
    { code: "kn", name: "Kannada", ko_name: "칸나다어", popular: false },
    { code: "kk", name: "Kazakh", ko_name: "카자흐어", popular: false },
    { code: "km", name: "Khmer", ko_name: "크메르어", popular: false },
    { code: "rw", name: "Kinyarwanda", ko_name: "키냐르완다어", popular: false },
    { code: "lo", name: "Lao", ko_name: "라오어", popular: false },
    { code: "lv", name: "Latvian", ko_name: "라트비아어", popular: false },
    { code: "lt", name: "Lithuanian", ko_name: "리투아니아어", popular: false },
    { code: "mk", name: "Macedonian", ko_name: "마케도니아어", popular: false },
    { code: "ms", name: "Malay", ko_name: "말레이어", popular: false },
    { code: "ml", name: "Malayalam", ko_name: "말라얄람어", popular: false },
    { code: "mr", name: "Marathi", ko_name: "마라티어", popular: false },
    { code: "mn", name: "Mongolian", ko_name: "몽골어", popular: false },
    { code: "ne", name: "Nepali", ko_name: "네팔어", popular: false },
    { code: "no", name: "Norwegian", ko_name: "노르웨이어", popular: false },
    { code: "nb", name: "Norwegian Bokmål", ko_name: "노르웨이어 (보크몰)", popular: false },
    { code: "fa", name: "Persian", ko_name: "페르시아어", popular: false },
    { code: "pl", name: "Polish", ko_name: "폴란드어", popular: false },
    { code: "pt-PT", name: "Portuguese (Portugal)", ko_name: "포르투갈어 (포르투갈)", popular: false },
    { code: "pa", name: "Punjabi", ko_name: "펀자브어", popular: false },
    { code: "ro", name: "Romanian", ko_name: "루마니아어", popular: false },
    { code: "sr", name: "Serbian", ko_name: "세르비아어", popular: false },
    { code: "sd", name: "Sindhi", ko_name: "신디어", popular: false },
    { code: "si", name: "Sinhala", ko_name: "싱할라어", popular: false },
    { code: "sk", name: "Slovak", ko_name: "슬로바키아어", popular: false },
    { code: "sl", name: "Slovenian", ko_name: "슬로베니아어", popular: false },
    { code: "su", name: "Sundanese", ko_name: "순다어", popular: false },
    { code: "sw", name: "Swahili", ko_name: "스와힐리어", popular: false },
    { code: "sv", name: "Swedish", ko_name: "스웨덴어", popular: false },
    { code: "ta", name: "Tamil", ko_name: "타밀어", popular: false },
    { code: "te", name: "Telugu", ko_name: "텔루구어", popular: false },
    { code: "tr", name: "Turkish", ko_name: "튀르키예어", popular: false },
    { code: "uk", name: "Ukrainian", ko_name: "우크라이나어", popular: false },
    { code: "ur", name: "Urdu", ko_name: "우르두어", popular: false },
    { code: "uz", name: "Uzbek", ko_name: "우즈베크어", popular: false },
    { code: "zu", name: "Zulu", ko_name: "줄루어", popular: false },
  ];

  // Detect mobile browser (iPhone / iPad / Android) vs Desktop PC browser
  const IS_MOBILE_BROWSER =
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "") ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  // Unique client session ID for seamless server-side resumption across mobile network/tab switches
  const CLIENT_SESSION_ID = (() => {
    try {
      const key = "live_translate_session_id";
      let existing = sessionStorage.getItem(key);
      if (!existing) {
        existing =
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `sess-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        sessionStorage.setItem(key, existing);
      }
      return existing;
    } catch (_) {
      return `sess-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }
  })();

  // Application State
  const state = {
    config: null,
    languagesMap: new Map(), // code -> { code, name, ko_name }
    isRecording: false,
    userWantsRecording: false, // True while user has not pressed Stop (used for auto-reconnect)
    isSourceCollapsed: false,
    isAudioOutputEnabled: false, // "번역 음성 듣기" toggle state (AEC policy: see shouldEnableEchoCancellation)
    ws: null,
    reconnectTimer: null,
    reconnectAttempts: 0,
    reconnectStableTimer: null, // resets reconnectAttempts after ~10s of stable connection
    wakeLock: null,
    captureGen: 0, // bumped on every stop/start so stale in-flight captures abort
    micSourceNode: null,
    muteSinkNode: null,
    noiseFloorRms: 0.003, // EMA of quiet-chunk RMS (adaptive noise floor)
    toggleChain: Promise.resolve(), // serializes "번역 음성 듣기" toggle handling
    persistentStatusMessage: "",

    // Audio Capture & Playback Context & Nodes
    audioInputSource: "mic", // "mic" (내장 마이크/주변 소리) | "desktop" (PC 오디오 단독, Desktop only)
    audioCtx: null,
    playbackAudioCtx: null,
    micStream: null,
    desktopStream: null, // System/Tab audio stream via getDisplayMedia (Chrome tab / QuickTime / Desktop apps)
    captureWorkletNode: null,
    captureScriptNode: null,
    captureSourceNode: null,
    desktopCaptureSourceNode: null,
    captureInFlight: null, // Promise of a startMicrophoneCapture() currently running (serialization guard)
    nativeCaptureActive: false, // True when iOS Native AVAudioEngine bridge is capturing
    activeMicLabel: "",
    activeDesktopAudioLabel: "",
    activeOutputLabel: "",
    activeOutputSinkId: "",
    earphoneConnected: false,
    playbackNextTime: 0,
    activePlaybackSources: new Set(),

    // Live latency indicator ("pending lag": speech received but text not yet shown)
    latency: {
      lastVoiceAt: 0, // last time mic RMS exceeded the voice threshold (performance.now)
      runStartAt: 0, // start of the current speech run (after >=350ms silence)
      lastSourceTextAt: 0, // last time source text arrived
      lastTargetTextAt: 0, // last time target text arrived
      sourceLagMs: null,
      targetLagMs: null,
      tickerId: null,
    },

    // Session Timer & Activity Tracking
    sessionStartTime: null,
    sessionTimerInterval: null,
    lastActivityAt: Date.now(),
    lastActivityPingAt: 0,

    // Auto-scroll lock per panel (true = stick to bottom automatically)
    autoScrollSource: true,
    autoScrollTarget: true,

    // Transcript Data & Active Streaming Lines
    sourceEntries: [], // [{ id, text, timestamp, lang }]
    targetEntries: [], // [{ id, text, timestamp, lang }]
    chronologicalEntries: [], // [{ role: 'source'|'target', text, timestamp, lang }]
    activeSourceCard: null,
    activeTargetCard: null,
    lastDetectedSourceLang: null,

    // Meeting Summary Cache
    summaryMarkdown: "",
    summaryEntryCountAtGeneration: -1,
    isSummarizing: false,
  };

  // DOM Elements
  const dom = {
    sessionStatusPill: document.getElementById("sessionStatusPill"),
    sessionStatusText: document.getElementById("sessionStatusText"),
    sessionTimer: document.getElementById("sessionTimer"),

    btnSummary: document.getElementById("btnSummary"),
    summaryBtnIcon: document.getElementById("summaryBtnIcon"),
    summaryBtnLabel: document.getElementById("summaryBtnLabel"),
    btnOpenDownload: document.getElementById("btnOpenDownload"),
    btnClear: document.getElementById("btnClear"),

    sourceLangSelect: document.getElementById("sourceLangSelect"),
    targetLangSelect: document.getElementById("targetLangSelect"),
    btnSwapLang: document.getElementById("btnSwapLang"),
    detectedLangChip: document.getElementById("detectedLangChip"),

    audioOutputToggleLabel: document.getElementById("audioOutputToggleLabel"),
    toggleAudioOutput: document.getElementById("toggleAudioOutput"),
    audioOutputIcon: document.getElementById("audioOutputIcon"),

    desktopSourceSegment: document.getElementById("desktopSourceSegment"),
    btnSourceMic: document.getElementById("btnSourceMic"),
    btnSourceDesktop: document.getElementById("btnSourceDesktop"),
    desktopAudioIcon: document.getElementById("desktopAudioIcon"),
    desktopAudioText: document.getElementById("desktopAudioText"),

    btnToggleMic: document.getElementById("btnToggleMic"),
    micIcon: document.getElementById("micIcon"),
    micBtnText: document.getElementById("micBtnText"),
    audioBars: document.getElementById("audioBars"),

    splitStage: document.getElementById("splitStage"),
    sourcePanel: document.getElementById("sourcePanel"),
    targetPanel: document.getElementById("targetPanel"),

    sourcePanelLangTag: document.getElementById("sourcePanelLangTag"),
    targetPanelLangTag: document.getElementById("targetPanelLangTag"),
    sourceCollapsedPreview: document.getElementById("sourceCollapsedPreview"),
    sourceCountBadge: document.getElementById("sourceCountBadge"),
    targetCountBadge: document.getElementById("targetCountBadge"),
    sourceLatencyBadge: document.getElementById("sourceLatencyBadge"),
    sourceLatencyValue: document.getElementById("sourceLatencyValue"),
    targetLatencyBadge: document.getElementById("targetLatencyBadge"),
    targetLatencyValue: document.getElementById("targetLatencyValue"),
    btnCopySource: document.getElementById("btnCopySource"),
    btnCopyTarget: document.getElementById("btnCopyTarget"),
    btnToggleSourceCollapse: document.getElementById("btnToggleSourceCollapse"),
    sourceCollapseIcon: document.getElementById("sourceCollapseIcon"),
    sourceCollapseLabel: document.getElementById("sourceCollapseLabel"),

    sourceScrollArea: document.getElementById("sourceScrollArea"),
    targetScrollArea: document.getElementById("targetScrollArea"),
    sourceEmptyState: document.getElementById("sourceEmptyState"),
    targetEmptyState: document.getElementById("targetEmptyState"),
    sourceUtteranceList: document.getElementById("sourceUtteranceList"),
    targetUtteranceList: document.getElementById("targetUtteranceList"),
    btnJumpSourceLatest: document.getElementById("btnJumpSourceLatest"),
    btnJumpTargetLatest: document.getElementById("btnJumpTargetLatest"),

    toastMessage: document.getElementById("toastMessage"),
    srAnnouncer: document.getElementById("srAnnouncer"),
  };

  // Cached once: queried on every 100ms capture chunk otherwise.
  const visualizerBars = dom.audioBars
    ? Array.from(dom.audioBars.querySelectorAll(".bar"))
    : [];

  let toastTimeoutId = null;

  // =========================================================================
  // 1. Initialization & Config Loading
  // =========================================================================

  async function initApp() {
    setupSwitchControlFallbacks();
    setupDesktopAudioButtonVisibility();
    if (isNativeIosAudioAvailable()) {
      // Register early so Swift can deliver capture-state / route-change callbacks at any time.
      registerNativeIosAudioCallbacks();
    }
    bindEventListeners();
    updateAudioOutputToggleUI();
    updateDesktopAudioBtnUI();

    // Immediately populate language dropdowns from built-in official list
    DEFAULT_SUPPORTED_LANGUAGES.forEach((lang) => {
      state.languagesMap.set(lang.code, lang);
    });
    populateLanguageSelectors(DEFAULT_SUPPORTED_LANGUAGES, "en", "ko");
    updateLanguageTagsUI();

    try {
      const res = await fetch("/api/config");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const cfg = await res.json();
      state.config = cfg;

      if (Array.isArray(cfg.supported_languages) && cfg.supported_languages.length > 0) {
        const currentSrc = dom.sourceLangSelect.value || cfg.default_source_language || "en";
        const currentTgt = dom.targetLangSelect.value || cfg.default_target_language || "ko";
        cfg.supported_languages.forEach((lang) => {
          state.languagesMap.set(lang.code, lang);
        });
        populateLanguageSelectors(
          cfg.supported_languages,
          currentSrc,
          currentTgt
        );
      }
    } catch (err) {
      console.warn("Using built-in supported languages list:", err);
    }

    updateLanguageTagsUI();
  }

  function populateLanguageSelectors(languages, defaultSource, defaultTarget) {
    const popularList = [];
    const allList = [...languages].sort((a, b) =>
      String(a.ko_name || a.name || a.code).localeCompare(
        String(b.ko_name || b.name || b.code),
        "ko"
      )
    );

    POPULAR_LANG_CODES.forEach((code) => {
      const found = state.languagesMap.get(code);
      if (found) popularList.push(found);
    });

    const orderedLanguages = [
      ...popularList,
      ...allList.filter((lang) => !POPULAR_LANG_CODES.includes(lang.code)),
    ];

    // Populate Source Select (Auto Detect + all supported languages without optgroup headers)
    dom.sourceLangSelect.innerHTML = "";
    const autoOpt = document.createElement("option");
    autoOpt.value = "auto";
    autoOpt.textContent = "🌐 자동 감지 (Auto Detect)";
    if (defaultSource === "auto") autoOpt.selected = true;
    dom.sourceLangSelect.appendChild(autoOpt);

    orderedLanguages.forEach((lang) => {
      const opt = document.createElement("option");
      opt.value = lang.code;
      opt.textContent = `${lang.ko_name || lang.name} (${lang.name} · ${lang.code})`;
      if (lang.code === defaultSource) opt.selected = true;
      dom.sourceLangSelect.appendChild(opt);
    });

    // Populate Target Select (all supported languages without optgroup headers)
    dom.targetLangSelect.innerHTML = "";
    orderedLanguages.forEach((lang) => {
      const opt = document.createElement("option");
      opt.value = lang.code;
      opt.textContent = `${lang.ko_name || lang.name} (${lang.name} · ${lang.code})`;
      if (lang.code === defaultTarget) opt.selected = true;
      dom.targetLangSelect.appendChild(opt);
    });
  }

  function formatLanguageLabel(code) {
    if (!code) return "-";
    if (code === "auto") return "자동 감지 (Auto)";
    const normalized = code.split("-")[0].toLowerCase();
    const entry =
      state.languagesMap.get(code) || state.languagesMap.get(normalized);
    if (entry) {
      return `${entry.ko_name || entry.name} (${entry.code})`;
    }
    return code;
  }

  /**
   * Prevents Source === Target. Uses the previously selected value of the other select
   * (remembered in data-prev by updateLanguageTagsUI) as the replacement when possible.
   * Returns true if a value was changed.
   */
  function guardSameLanguage(changed) {
    const src = dom.sourceLangSelect.value;
    const tgt = dom.targetLangSelect.value;
    if (!src || !tgt || src !== tgt) return false;
    const hasOption = (select, value) =>
      Array.from(select.options).some((o) => o.value === value);
    if (changed === "source") {
      const prevSrc = dom.sourceLangSelect.dataset.prev;
      let replacement =
        prevSrc && prevSrc !== "auto" && prevSrc !== src ? prevSrc : "";
      if (!replacement || !hasOption(dom.targetLangSelect, replacement)) {
        replacement = src === "ko" ? "en" : "ko";
      }
      dom.targetLangSelect.value = replacement;
    } else {
      const prevTgt = dom.targetLangSelect.dataset.prev;
      dom.sourceLangSelect.value =
        prevTgt && prevTgt !== tgt && hasOption(dom.sourceLangSelect, prevTgt)
          ? prevTgt
          : "auto";
    }
    return true;
  }

  function updateLanguageTagsUI() {
    const srcCode = dom.sourceLangSelect.value;
    const tgtCode = dom.targetLangSelect.value;
    dom.sourceLangSelect.dataset.prev = srcCode;
    dom.targetLangSelect.dataset.prev = tgtCode;
    dom.sourcePanelLangTag.textContent = formatLanguageLabel(srcCode);
    dom.targetPanelLangTag.textContent = formatLanguageLabel(tgtCode);

    if (srcCode !== "auto" && !state.lastDetectedSourceLang) {
      dom.detectedLangChip.hidden = true;
    }
  }

  // =========================================================================
  // 2. Dialog Fallbacks, Source Collapse & UI Event Listeners
  // =========================================================================

  function setupSwitchControlFallbacks() {
    // Only apply custom switch fallback when native <input type="checkbox" switch> is unsupported
    if (!("switch" in HTMLInputElement.prototype)) {
      document
        .querySelectorAll('input[type="checkbox"][switch]')
        .forEach((input) => {
          input.setAttribute("role", "switch");
          input.setAttribute("data-switch-fallback", "true");
        });
    }
  }

  function updateAudioOutputToggleUI() {
    const enabled = Boolean(state.isAudioOutputEnabled);
    if (dom.toggleAudioOutput && dom.toggleAudioOutput.checked !== enabled) {
      dom.toggleAudioOutput.checked = enabled;
    }
    if (dom.audioOutputToggleLabel) {
      dom.audioOutputToggleLabel.setAttribute(
        "data-active",
        enabled ? "true" : "false"
      );
    }
    if (dom.audioOutputIcon) {
      dom.audioOutputIcon.textContent = enabled ? "headphones" : "volume_off";
    }
  }

  function isDesktopAudioCaptureSupported() {
    return Boolean(
      !IS_MOBILE_BROWSER &&
        !isNativeIosAudioAvailable() &&
        navigator.mediaDevices &&
        typeof navigator.mediaDevices.getDisplayMedia === "function"
    );
  }

  function setupDesktopAudioButtonVisibility() {
    if (dom.desktopSourceSegment) {
      // Only show on Desktop where getDisplayMedia is available; completely hidden on iPhone/Mobile
      dom.desktopSourceSegment.hidden = !isDesktopAudioCaptureSupported();
    }
  }

  function hasLiveDesktopAudioStream() {
    return Boolean(
      state.desktopStream &&
        state.desktopStream
          .getAudioTracks()
          .some((t) => t.readyState === "live")
    );
  }

  function updateDesktopAudioBtnUI() {
    if (!dom.desktopSourceSegment) return;
    const isDesktopMode =
      state.audioInputSource === "desktop" && hasLiveDesktopAudioStream();

    if (dom.btnSourceMic) {
      dom.btnSourceMic.setAttribute(
        "data-active",
        isDesktopMode ? "false" : "true"
      );
      dom.btnSourceMic.setAttribute(
        "aria-pressed",
        isDesktopMode ? "false" : "true"
      );
    }
    if (dom.btnSourceDesktop) {
      dom.btnSourceDesktop.setAttribute(
        "data-active",
        isDesktopMode ? "true" : "false"
      );
      dom.btnSourceDesktop.setAttribute(
        "aria-pressed",
        isDesktopMode ? "true" : "false"
      );
    }
    if (dom.desktopAudioIcon) {
      dom.desktopAudioIcon.textContent = isDesktopMode
        ? "cast_connected"
        : "desktop_windows";
    }
  }

  /**
   * Captures audio playing on the same Desktop exclusively (Chrome tab, QuickTime Player,
   * Zoom/Teams/video players) via getDisplayMedia. When active, the built-in microphone
   * is turned off so room/keyboard noise is never mixed into the PC audio.
   */
  async function startDesktopAudioCapture() {
    if (!isDesktopAudioCaptureSupported()) return false;

    // Re-start the capture graph on the mic (or keep the previous PC audio stream) when the
    // picker is cancelled / has no audio, so an active session never goes silent.
    const recoverAfterFailure = async () => {
      if (!hasLiveDesktopAudioStream()) {
        state.audioInputSource = "mic";
      }
      updateDesktopAudioBtnUI();
      if (
        (state.userWantsRecording || state.isRecording) &&
        !hasLiveDesktopAudioStream()
      ) {
        try {
          await startMicrophoneCapture();
        } catch (_) {}
      }
    };

    let stream;
    try {
      // Acquire the new stream BEFORE tearing down any previous one.
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 1, max: 5 },
        },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        systemAudio: "include",
        selfBrowserSurface: "exclude",
      });
    } catch (err) {
      if (err && err.name !== "NotAllowedError" && err.name !== "AbortError") {
        console.warn("Desktop audio capture failed:", err);
        showToast("PC 오디오 공유를 시작할 수 없습니다.");
      }
      await recoverAfterFailure();
      return false;
    }

    const audioTracks = stream.getAudioTracks();
    if (!audioTracks || audioTracks.length === 0) {
      stream.getTracks().forEach((t) => t.stop());
      showToast(
        "⚠️ 오디오가 포함되지 않았습니다. 'Chrome 탭'(탭 오디오 공유 켜기) 또는 '전체 화면'(시스템 오디오 공유 켜기 - QuickTime 등)을 선택해 주세요."
      );
      await recoverAfterFailure();
      return false;
    }

    // New stream is valid: now release the previous one (without rebuilding the graph yet).
    stopDesktopAudioCapture(false);

    const audioTrack = audioTracks[0];
    state.desktopStream = stream;
    state.audioInputSource = "desktop";
    state.activeDesktopAudioLabel = audioTrack.label || "Desktop / Tab Audio";

    const handleStreamEnded = () => {
      if (state.desktopStream === stream) {
        stopDesktopAudioCapture(true);
        showToast(
          "💻 PC 오디오 공유가 종료되어 「🎙️ 주변 소리 (내장 마이크)」 모드로 전환되었습니다."
        );
      }
    };

    audioTrack.addEventListener("ended", handleStreamEnded);
    stream.getVideoTracks().forEach((vt) => {
      vt.addEventListener("ended", handleStreamEnded);
    });

    updateDesktopAudioBtnUI();

    // If session is currently active, switch capture pipeline exclusively to PC audio
    if (state.userWantsRecording || state.isRecording) {
      try {
        await startMicrophoneCapture();
      } catch (err) {
        console.warn("Failed to switch capture to PC audio:", err);
      }
    }

    showToast(
      `💻 오디오 입력 소스: PC 오디오(${state.activeDesktopAudioLabel}) 단독 수음 모드`
    );
    return true;
  }

  function stopDesktopAudioCapture(rebuildAudioGraph = false) {
    if (state.desktopCaptureSourceNode) {
      try {
        state.desktopCaptureSourceNode.disconnect();
      } catch (_) {}
      state.desktopCaptureSourceNode = null;
    }
    if (state.desktopStream) {
      try {
        state.desktopStream.getTracks().forEach((t) => t.stop());
      } catch (_) {}
      state.desktopStream = null;
    }
    state.activeDesktopAudioLabel = "";
    state.audioInputSource = "mic";
    updateDesktopAudioBtnUI();

    if (rebuildAudioGraph && (state.userWantsRecording || state.isRecording)) {
      startMicrophoneCapture().catch(() => {});
    }
  }

  function toggleSourcePanelCollapse() {
    state.isSourceCollapsed = !state.isSourceCollapsed;
    const collapsed = state.isSourceCollapsed;

    dom.splitStage.classList.toggle("is-source-collapsed", collapsed);
    dom.sourcePanel.classList.toggle("is-collapsed", collapsed);
    dom.btnToggleSourceCollapse.setAttribute(
      "aria-expanded",
      collapsed ? "false" : "true"
    );
    dom.sourceCollapseIcon.textContent = collapsed
      ? "unfold_more"
      : "unfold_less";
    dom.sourceCollapseLabel.textContent = collapsed ? "펼치기" : "접기";

    updateCollapsedSourcePreview();

    // Keep Target scrolled to latest after expanding/collapsing
    if (state.autoScrollTarget) {
      scrollToLatest(dom.targetScrollArea, true);
    }
    if (!collapsed && state.autoScrollSource) {
      scrollToLatest(dom.sourceScrollArea, true);
    }
  }

  function updateCollapsedSourcePreview(latestTextOverride) {
    if (!dom.sourceCollapsedPreview) return;
    if (!state.isSourceCollapsed) {
      dom.sourceCollapsedPreview.hidden = true;
      return;
    }
    const activeText = state.activeSourceCard
      ? (
          state.activeSourceCard.entry.text +
          (state.activeSourceCard.entry.interimText || "")
        ).trim()
      : "";
    const lastCommitted =
      state.sourceEntries.length > 0
        ? state.sourceEntries[state.sourceEntries.length - 1].text
        : "";
    const preview = latestTextOverride || activeText || lastCommitted;
    if (preview) {
      dom.sourceCollapsedPreview.textContent = `· ${preview}`;
      dom.sourceCollapsedPreview.hidden = false;
    } else {
      dom.sourceCollapsedPreview.hidden = true;
    }
  }

  async function handleAudioOutputToggleChange() {
    const enabled = Boolean(dom.toggleAudioOutput.checked);
    if (enabled === state.isAudioOutputEnabled) return; // coalesced rapid double-toggle
    state.isAudioOutputEnabled = enabled;
    updateAudioOutputToggleUI();

    if (!enabled) {
      stopTranslatedAudioPlayback(true);
    } else if (!isNativeIosAudioAvailable()) {
      // Always recreate a fresh playbackAudioCtx when turning ON so a previously
      // unplugged/re-plugged earphone gets a live CoreAudio output unit.
      stopTranslatedAudioPlayback(true);
      ensurePlaybackAudioContext();
      await refreshPlaybackOutputRouting(false);
    }

    notifyConfigChangeIfActive();

    const nextAEC = shouldEnableEchoCancellation();
    if (state.userWantsRecording || state.isRecording) {
      if (isNativeIosAudioAvailable()) {
        postNativeIosAudioMessage({
          action: "updateConfig",
          echoCancellation: nextAEC,
          audioOutputEnabled: state.isAudioOutputEnabled,
        });
      } else {
        const desktopExclusive =
          state.audioInputSource === "desktop" && hasLiveDesktopAudioStream();
        // Mobile web mic selection depends on the toggle (room mic vs headset), so restart there;
        // on desktop only restart when the getUserMedia AEC constraint actually changes.
        const needsRestart =
          !desktopExclusive &&
          (IS_MOBILE_BROWSER || nextAEC !== state.appliedEchoCancellation);
        if (needsRestart) {
          try {
            await startMicrophoneCapture();
          } catch (_) {}
        }
      }
    }

    if (state.isAudioOutputEnabled) {
      const sourceDesc =
        state.audioInputSource === "desktop" && hasLiveDesktopAudioStream()
          ? `💻 입력: ${state.activeDesktopAudioLabel}`
          : state.activeMicLabel
            ? `🎙️ 입력: ${state.activeMicLabel}`
            : "🎙️ 내장 마이크";
      showToast(
        `🎧 번역 음성 듣기 ON (${sourceDesc}, echoCancellation: ${nextAEC})`,
        { persist: true }
      );
    } else {
      clearPersistentStatus();
      showToast(
        `🔇 번역 음성 듣기 OFF — 자막 전용 모드 (echoCancellation: ${nextAEC})`
      );
    }
  }

  function bindEventListeners() {
    // Desktop Audio Input Source Selector: "🎙️ 주변 소리" (mic) vs "💻 PC 오디오" (desktop)
    if (dom.btnSourceMic) {
      dom.btnSourceMic.addEventListener("click", async () => {
        const hadDesktop =
          state.audioInputSource === "desktop" || hasLiveDesktopAudioStream();
        if (!hadDesktop) {
          // Already on the mic: avoid a pointless capture restart (audio gap).
          showToast(
            `🎙️ 주변 소리 (${state.activeMicLabel || "내장 마이크"}) 수음 중입니다.`
          );
          return;
        }
        stopDesktopAudioCapture(false);
        if (state.userWantsRecording || state.isRecording) {
          try {
            await startMicrophoneCapture();
          } catch (_) {}
        }
        showToast(
          "🎙️ 오디오 입력 소스: 주변 소리 (내장 마이크) 수음 모드로 전환되었습니다."
        );
      });
    }

    if (dom.btnSourceDesktop) {
      dom.btnSourceDesktop.addEventListener("click", async () => {
        await startDesktopAudioCapture();
      });
    }

    // Translated Audio Output ("번역 음성 듣기") Switch Toggle
    // echoCancellation policy is computed by shouldEnableEchoCancellation(); toggling only
    // restarts capture when that policy (or mobile mic selection) actually changes.
    // Handling is serialized so rapid clicks cannot interleave AudioContext close/create.
    if (dom.toggleAudioOutput) {
      dom.toggleAudioOutput.addEventListener("change", () => {
        state.toggleChain = state.toggleChain
          .catch(() => {})
          .then(() => handleAudioOutputToggleChange());
      });
    }

    // Primary Mic Start / Stop (also acts as "cancel" while connecting / reconnecting)
    dom.btnToggleMic.addEventListener("click", () => {
      if (state.isRecording || state.userWantsRecording) {
        stopTranslationSession(true, "user_ended_meeting");
      } else {
        startTranslationSession();
      }
    });

    // Collapse / Expand Source Panel
    if (dom.btnToggleSourceCollapse) {
      dom.btnToggleSourceCollapse.addEventListener(
        "click",
        toggleSourcePanelCollapse
      );
    }

    // Smart Auto-Scroll Tracking (pause auto-scroll when user scrolls up to read history)
    setupSmartScrollListener(
      dom.sourceScrollArea,
      "autoScrollSource",
      dom.btnJumpSourceLatest
    );
    setupSmartScrollListener(
      dom.targetScrollArea,
      "autoScrollTarget",
      dom.btnJumpTargetLatest
    );

    // Language Select Changes
    dom.sourceLangSelect.addEventListener("change", () => {
      const fixed = guardSameLanguage("source");
      updateLanguageTagsUI();
      notifyConfigChangeIfActive();
      if (fixed) {
        showToast(
          `Source와 Target이 같아 Target을 ${formatLanguageLabel(dom.targetLangSelect.value)}(으)로 변경했습니다.`
        );
      }
    });

    dom.targetLangSelect.addEventListener("change", () => {
      const fixed = guardSameLanguage("target");
      updateLanguageTagsUI();
      finalizeActiveCard("target");
      notifyConfigChangeIfActive();
      showToast(
        fixed
          ? `Source와 Target이 같아 Source를 ${formatLanguageLabel(dom.sourceLangSelect.value)}(으)로 변경했습니다.`
          : `Target 언어가 ${formatLanguageLabel(dom.targetLangSelect.value)}(으)로 설정되었습니다.`
      );
    });

    // Swap Source <-> Target Language
    dom.btnSwapLang.addEventListener("click", () => {
      const currentSource = dom.sourceLangSelect.value;
      const currentTarget = dom.targetLangSelect.value;

      let nextTarget = currentSource;
      if (nextTarget === "auto") {
        const detectedBase = state.lastDetectedSourceLang
          ? state.lastDetectedSourceLang.split("-")[0].toLowerCase()
          : "en";
        nextTarget = state.languagesMap.has(detectedBase) ? detectedBase : "en";
      }

      const nextSource = currentTarget;
      dom.sourceLangSelect.value = nextSource;
      dom.targetLangSelect.value = nextTarget;
      guardSameLanguage("source");

      updateLanguageTagsUI();
      finalizeActiveCard("source");
      finalizeActiveCard("target");
      notifyConfigChangeIfActive();
      showToast(
        `언어 전환: ${formatLanguageLabel(dom.sourceLangSelect.value)} → ${formatLanguageLabel(dom.targetLangSelect.value)}`
      );
    });

    // Copy Source / Target Buttons
    dom.btnCopySource.addEventListener("click", () => {
      const text = getPanelFullText("source");
      if (!text) {
        showToast("복사할 Source 텍스트가 없습니다.");
        return;
      }
      copyToClipboard(text, "Source 원문 전체가 클립보드에 복사되었습니다.");
    });

    dom.btnCopyTarget.addEventListener("click", () => {
      const text = getPanelFullText("target");
      if (!text) {
        showToast("복사할 Target 번역 텍스트가 없습니다.");
        return;
      }
      copyToClipboard(text, "Target 번역문 전체가 클립보드에 복사되었습니다.");
    });

    // Clear Transcript Button
    dom.btnClear.addEventListener("click", () => {
      if (
        state.sourceEntries.length === 0 &&
        state.targetEntries.length === 0 &&
        !state.activeSourceCard &&
        !state.activeTargetCard
      ) {
        showToast("초기화할 대화 기록이 없습니다.");
        return;
      }
      clearTranscriptHistory();
      showToast("대화 기록이 초기화되었습니다.");
    });

    // Direct Meeting Summary (.md) Generation & Save
    dom.btnSummary.addEventListener("click", () => {
      generateAndDownloadSummaryMd();
    });

    // Direct Source / Target Transcript (.md) Save
    dom.btnOpenDownload.addEventListener("click", () => {
      downloadTranscriptMd();
    });

    // Speech bubble tooltip for header buttons (especially useful when icon-only on mobile)
    setupHeaderSpeechBubbleTooltips();

    // Mobile & Tab visibility recovery (iOS Safari AudioContext interruption + Wake Lock + WS reconnect)
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && state.userWantsRecording) {
        resumeAudioContextIfNeeded();
        requestScreenWakeLock();
        const rs = state.ws ? state.ws.readyState : WebSocket.CLOSED;
        // Do not tear down a socket that is still CONNECTING (would cause reconnect churn).
        if (rs !== WebSocket.OPEN && rs !== WebSocket.CONNECTING) {
          scheduleWebSocketReconnect(100);
        }
      }
    });

    // Bluetooth headset / AirPods / Wired Earphones plug & unplug auto-recovery.
    if (navigator.mediaDevices?.addEventListener) {
      let deviceChangeTimer = null;
      navigator.mediaDevices.addEventListener("devicechange", () => {
        if (isNativeIosAudioAvailable()) return;
        if (deviceChangeTimer) clearTimeout(deviceChangeTimer);
        deviceChangeTimer = setTimeout(async () => {
          deviceChangeTimer = null;
          await handleAudioDeviceChange();
        }, 700);
      });
    }

    // Explicitly terminate Live API session when closing tab/window.
    // If the page enters the back/forward cache (e.persisted), release mic/socket without an
    // explicit "stop" so the server-side session can be resumed by session_id on return.
    window.addEventListener("pagehide", (e) => {
      if (!(state.isRecording || state.userWantsRecording || state.ws)) return;
      if (e && e.persisted) {
        state.resumeOnPageShow = true;
        stopTranslationSession(false, "page_hidden");
      } else {
        stopTranslationSession(true, "page_unload");
      }
    });
    window.addEventListener("pageshow", (e) => {
      if (e && e.persisted && state.resumeOnPageShow) {
        state.resumeOnPageShow = false;
        showToast("페이지로 돌아왔습니다. 「통역 시작」을 눌러 통역을 재개해 주세요.");
      }
    });
  }

  function setupSmartScrollListener(scrollEl, stateFlagKey, jumpBtn) {
    if (!scrollEl) return;
    scrollEl.addEventListener(
      "scroll",
      () => {
        const distFromBottom =
          scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
        const isAtBottom = distFromBottom < 48;
        state[stateFlagKey] = isAtBottom;
        if (jumpBtn) {
          jumpBtn.hidden = isAtBottom;
        }
      },
      { passive: true }
    );

    if (jumpBtn) {
      jumpBtn.addEventListener("click", () => {
        state[stateFlagKey] = true;
        jumpBtn.hidden = true;
        scrollToLatest(scrollEl, true);
      });
    }
  }

  function notifyConfigChangeIfActive() {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(
        JSON.stringify({
          type: "update_config",
          source_lang: dom.sourceLangSelect.value,
          target_lang: dom.targetLangSelect.value,
          echo_target_language: false,
          audio_output: Boolean(state.isAudioOutputEnabled),
        })
      );
    }
  }

  // =========================================================================
  // 3. WebSocket & Live Translation Session Lifecycle (with Mobile Auto-Reconnect)
  // =========================================================================

  async function startTranslationSession() {
    if (state.isRecording || state.userWantsRecording) return;

    // If accessed via http://0.0.0.0:8000, redirect to http://localhost:8000 so Secure Context is enabled
    if (window.location.hostname === "0.0.0.0") {
      const targetUrl = `${window.location.protocol}//localhost:${window.location.port || 8000}${window.location.pathname}${window.location.search}`;
      window.location.replace(targetUrl);
      return;
    }

    // Check Secure Context requirement for microphone on mobile/remote browsers (unless iOS Native Audio Bridge is active)
    if (
      !isNativeIosAudioAvailable() &&
      (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
    ) {
      setSessionStatus("error", "localhost 또는 HTTPS 필요");
      showToast(
        `현재 주소(${window.location.origin})는 브라우저 보안 정책상 마이크가 차단됩니다. http://localhost:${window.location.port || 8000} 또는 HTTPS 주소로 접속해 주세요.`
      );
      return;
    }

    state.userWantsRecording = true;
    state.reconnectAttempts = 0;
    resetLatencyTracker(true);
    startLatencyTicker();
    setSessionStatus("connecting", "마이크 및 세션 연결 중...");
    // Button stays enabled and acts as "cancel" while connecting.
    setMicButtonState("connecting");

    try {
      if (state.isAudioOutputEnabled && !isNativeIosAudioAvailable()) {
        ensurePlaybackAudioContext();
      }
      await startMicrophoneCapture();
      if (!state.userWantsRecording) return; // cancelled while acquiring the mic
      await requestScreenWakeLock();
      if (!state.userWantsRecording) {
        releaseScreenWakeLock();
        return;
      }
      openTranslationWebSocket(false);
    } catch (err) {
      if (!state.userWantsRecording) return; // user cancelled; stopTranslationSession already cleaned up
      console.error("Failed to start translation session:", err);
      state.userWantsRecording = false;
      stopMicrophoneCapture();
      resetLatencyTracker(true);
      setMicButtonState("idle");
      setSessionStatus("error", "마이크 권한 실패");
      showToast(
        `마이크를 시작할 수 없습니다: ${err.message || "브라우저 마이크 권한을 허용해 주세요."}`
      );
    }
  }

  /** Updates the primary Start/Stop button: "idle" | "connecting" (cancel) | "recording". */
  function setMicButtonState(mode) {
    const btn = dom.btnToggleMic;
    btn.disabled = false;
    if (mode === "connecting") {
      btn.setAttribute("data-recording", "true");
      dom.micIcon.textContent = "close";
      dom.micBtnText.textContent = "연결 취소";
      dom.audioBars.hidden = true;
    } else if (mode === "recording") {
      btn.setAttribute("data-recording", "true");
      dom.micIcon.textContent = "stop_circle";
      dom.micBtnText.textContent = "통역 종료";
      dom.audioBars.hidden = false;
    } else {
      btn.setAttribute("data-recording", "false");
      dom.micIcon.textContent = "mic";
      dom.micBtnText.textContent = "통역 시작";
      dom.audioBars.hidden = true;
      resetVisualizerBars();
    }
  }

  function clearReconnectStableTimer() {
    if (state.reconnectStableTimer) {
      clearTimeout(state.reconnectStableTimer);
      state.reconnectStableTimer = null;
    }
  }

  /** Detaches a socket from state (so its handlers become no-ops) and closes it. */
  function retireWebSocket(ws, code = 1000, reason = "superseded") {
    if (!ws) return;
    ws._superseded = true;
    if (state.ws === ws) state.ws = null;
    try {
      if (
        ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING
      ) {
        ws.close(code, reason);
      }
    } catch (_) {}
  }

  function openTranslationWebSocket(isReconnect = false) {
    if (!state.userWantsRecording) return;

    clearReconnectStableTimer();
    retireWebSocket(state.ws);

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const params = new URLSearchParams({
      session_id: CLIENT_SESSION_ID,
      source_lang: dom.sourceLangSelect.value,
      target_lang: dom.targetLangSelect.value,
      echo_target_language: "false",
      audio_output: state.isAudioOutputEnabled ? "true" : "false",
    });
    const wsUrl = `${protocol}//${window.location.host}/ws/translate?${params.toString()}`;

    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    state.ws = ws;

    ws.addEventListener("open", () => {
      if (state.ws !== ws) return;
      state.isRecording = true;
      state.lastActivityAt = Date.now();
      setMicButtonState("recording");
      if (!state.sessionTimerInterval) {
        startSessionTimer();
      }
      // Only consider the connection healthy after ~10s (or a server "connected" status);
      // a server that accepts then immediately closes must still exhaust the retry budget.
      clearReconnectStableTimer();
      state.reconnectStableTimer = setTimeout(() => {
        state.reconnectStableTimer = null;
        if (state.ws === ws && ws.readyState === WebSocket.OPEN) {
          state.reconnectAttempts = 0;
        }
      }, 10000);
      resumeAudioContextIfNeeded();
      sendClientAudioDiagnostics();
    });

    ws.addEventListener("message", (event) => {
      if (state.ws !== ws) return;
      handleServerWebSocketMessage(event.data);
    });

    ws.addEventListener("close", (event) => {
      if (state.ws !== ws || ws._superseded) return;
      clearReconnectStableTimer();
      const code = event ? event.code : 0;

      // 4401: server rejected the connection because the login session is missing/expired
      if (code === 4401) {
        stopTranslationSession(false, "auth_expired");
        showToast("로그인 세션이 만료되었습니다. 다시 로그인해 주세요.");
        setTimeout(() => window.location.replace("/login"), 800);
        return;
      }
      // 4400-4499: non-retryable client/policy errors (4400 bad request, 4403 origin rejected, ...)
      if (code >= 4400 && code <= 4499) {
        stopTranslationSession(false, `server_rejected_${code}`);
        const reasonText = (event && event.reason) || "";
        let message;
        if (code === 4403) {
          message = "허용되지 않은 접속 주소(Origin)입니다. 올바른 주소로 접속해 주세요.";
        } else if (code === 4400) {
          message = "잘못된 요청으로 통역 세션을 시작할 수 없습니다.";
        } else {
          message = "서버가 통역 세션 연결을 거부했습니다.";
        }
        setSessionStatus("error", "연결 거부됨");
        showToast(reasonText ? `${message} (${reasonText})` : message);
        return;
      }

      if (!state.userWantsRecording) return;
      state.isRecording = false;
      state.ws = null;
      scheduleWebSocketReconnect();
    });

    ws.addEventListener("error", () => {
      if (state.ws !== ws) return;
      if (!isReconnect) {
        console.warn("WebSocket connection error; will retry if session active.");
      }
    });
  }

  function scheduleWebSocketReconnect(customDelayMs) {
    if (!state.userWantsRecording) return;
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }

    state.reconnectAttempts += 1;
    if (state.reconnectAttempts > 8) {
      stopTranslationSession(false, "reconnect_exhausted");
      showToast("네트워크 연결이 끊어져 통역 세션이 종료되었습니다.");
      return;
    }

    const delay =
      typeof customDelayMs === "number"
        ? customDelayMs
        : Math.min(4000, 600 * Math.pow(1.5, state.reconnectAttempts - 1));

    setSessionStatus(
      "reconnecting",
      `연결 복구 중 (${state.reconnectAttempts})...`
    );

    state.reconnectTimer = setTimeout(async () => {
      state.reconnectTimer = null;
      if (!state.userWantsRecording) return;
      // Ensure mic or desktop track is still live (iOS may end track after backgrounding)
      const trackLive = isNativeIosAudioAvailable()
        ? state.nativeCaptureActive
        : Boolean(
            state.micStream
              ?.getAudioTracks()
              .some((t) => t.readyState === "live") ||
              hasLiveDesktopAudioStream()
          );
      if (!trackLive) {
        try {
          await startMicrophoneCapture();
        } catch (_) {}
      }
      if (!state.userWantsRecording) return;
      openTranslationWebSocket(true);
      if (
        !isNativeIosAudioAvailable() &&
        state.audioCtx &&
        state.audioCtx.state !== "running"
      ) {
        // Recreated outside a user gesture (iOS Safari keeps it suspended).
        showToast("🔈 오디오가 일시 정지되었습니다. 화면을 한 번 탭하면 통역이 재개됩니다.");
        document.addEventListener("pointerdown", resumeAudioContextIfNeeded, {
          once: true,
        });
      }
    }, delay);
  }

  function stopTranslationSession(
    sendStopSignal = true,
    reason = "user_ended_meeting"
  ) {
    state.userWantsRecording = false;
    state.isRecording = false;

    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
    clearReconnectStableTimer();

    setMicButtonState("idle");

    stopSessionTimer();
    releaseScreenWakeLock();
    stopTranslatedAudioPlayback();
    stopDesktopAudioCapture(false);
    stopMicrophoneCapture();
    resetLatencyTracker(false); // keep last measured values visible after stop
    clearPersistentStatus();

    finalizeActiveCard("source");
    finalizeActiveCard("target");

    const ws = state.ws;
    if (ws) {
      try {
        if (sendStopSignal && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "stop", reason }));
        }
      } catch (_) {}
      retireWebSocket(ws, 1000, reason.slice(0, 100));
    }
    state.ws = null;

    setSessionStatus("idle", "대기 중");
  }

  function handleServerWebSocketMessage(rawText) {
    let msg;
    try {
      msg = JSON.parse(rawText);
    } catch (_) {
      return;
    }

    switch (msg.type) {
      case "status": {
        if (msg.status === "connected") {
          state.reconnectAttempts = 0;
          clearReconnectStableTimer();
          setSessionStatus("connected", "실시간 통역 중");
        } else if (
          msg.status === "connecting" ||
          msg.status === "resuming" ||
          msg.status === "reconnecting"
        ) {
          setSessionStatus("connecting", "세션 연결 중...");
        }
        break;
      }

      case "go_away": {
        showToast("장시간 세션 자동 연장 중입니다.");
        break;
      }

      case "inactive_timeout": {
        stopTranslationSession(false, "inactive_timeout");
        showToast(
          msg.message ||
            "10분 이상 음성 입력이 없어 세션이 자동 종료되었습니다."
        );
        break;
      }

      case "session_closed": {
        if (state.isRecording || state.userWantsRecording) {
          stopTranslationSession(false, msg.reason || "explicit_stop");
        }
        break;
      }

      case "config_updated": {
        updateLanguageTagsUI();
        break;
      }

      case "input_transcription": {
        state.lastActivityAt = Date.now();
        if (msg.language_code) {
          updateDetectedLanguageBadge(msg.language_code);
        }
        if (msg.text) {
          appendStreamingTranscription(
            "source",
            msg.text,
            Boolean(msg.finished),
            msg.language_code || dom.sourceLangSelect.value,
            Boolean(msg.interim)
          );
          noteTextArrival("source");
        }
        break;
      }

      case "output_transcription": {
        state.lastActivityAt = Date.now();
        if (msg.text) {
          appendStreamingTranscription(
            "target",
            msg.text,
            Boolean(msg.finished),
            msg.language_code || dom.targetLangSelect.value,
            false
          );
          noteTextArrival("target");
        }
        break;
      }

      case "audio_output": {
        state.lastActivityAt = Date.now();
        if (state.isAudioOutputEnabled && msg.data) {
          playTranslatedAudioChunk(msg.data, msg.sample_rate || 24000);
        }
        break;
      }

      case "interrupted": {
        // In simultaneous translation mode, continuous incoming speech from a speaker
        // or QuickTime/Chrome video should NOT cut off the translated sentence currently
        // playing in the user's earphones.
        break;
      }

      case "turn_complete": {
        if (msg.turn_complete) {
          finalizeActiveCard("source");
          finalizeActiveCard("target");
        }
        break;
      }

      case "error": {
        if (msg.fatal) {
          // Non-retryable server error: stop before the server closes the socket so no
          // reconnect is scheduled.
          stopTranslationSession(false, "server_fatal_error");
          setSessionStatus("error", "연결 오류");
          showToast(msg.message || "서버 오류로 통역 세션이 종료되었습니다.");
          break;
        }
        setSessionStatus("error", "연결 오류");
        showToast(msg.message || "오류가 발생했습니다.");
        break;
      }

      default:
        break;
    }
  }

  function updateDetectedLanguageBadge(langCode) {
    state.lastDetectedSourceLang = langCode;
    dom.detectedLangChip.hidden = false;
    dom.detectedLangChip.textContent = `감지: ${formatLanguageLabel(langCode)}`;
  }

  // =========================================================================
  // 4. Streaming Sentence Lines & Smart Auto-Scroll
  // =========================================================================

  function appendStreamingTranscription(
    role,
    chunkText,
    isFinished,
    langCode,
    isInterim
  ) {
    const isSource = role === "source";
    const activeKey = isSource ? "activeSourceCard" : "activeTargetCard";
    const listEl = isSource ? dom.sourceUtteranceList : dom.targetUtteranceList;
    const emptyEl = isSource ? dom.sourceEmptyState : dom.targetEmptyState;
    const scrollEl = isSource ? dom.sourceScrollArea : dom.targetScrollArea;
    const shouldAutoScroll = isSource
      ? state.autoScrollSource
      : state.autoScrollTarget;

    if (!emptyEl.hidden) {
      emptyEl.hidden = true;
    }

    let lineObj = state[activeKey];
    const nowStr = formatTimeHHMMSS(new Date());

    if (!lineObj) {
      const entry = {
        id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        role,
        text: "",
        interimText: "",
        timestamp: nowStr,
        lang: langCode,
      };

      const lineEl = document.createElement("p");
      lineEl.className = "utterance-line is-streaming";
      listEl.appendChild(lineEl);

      lineObj = {
        entry,
        el: lineEl,
        textEl: lineEl,
        lastUpdatedAt: Date.now(),
        timerId: null,
      };
      state[activeKey] = lineObj;
    }

    if (langCode && langCode !== "auto") {
      lineObj.entry.lang = langCode;
    }

    if (isInterim) {
      lineObj.entry.interimText = chunkText;
    } else {
      lineObj.entry.interimText = "";
      lineObj.entry.text = mergeTranscriptChunk(lineObj.entry.text, chunkText);
    }

    const displayText = (
      lineObj.entry.text + (lineObj.entry.interimText || "")
    ).trim();
    lineObj.textEl.textContent = displayText;
    lineObj.lastUpdatedAt = Date.now();

    if (isSource && state.isSourceCollapsed) {
      updateCollapsedSourcePreview(displayText);
    }

    if (shouldAutoScroll) {
      scrollToLatest(scrollEl, false);
    }

    if (lineObj.timerId) {
      clearTimeout(lineObj.timerId);
      lineObj.timerId = null;
    }

    const endsWithSentencePunct = /[.?!。？！]\s*$/.test(displayText);
    if (isFinished || endsWithSentencePunct) {
      finalizeActiveCard(role);
    } else {
      lineObj.timerId = setTimeout(() => {
        finalizeActiveCard(role);
      }, 1600);
    }
  }

  function mergeTranscriptChunk(existing, incoming) {
    if (!existing) return incoming;
    if (!incoming) return existing;
    return existing + incoming;
  }

  function finalizeActiveCard(role) {
    const isSource = role === "source";
    const activeKey = isSource ? "activeSourceCard" : "activeTargetCard";
    const lineObj = state[activeKey];
    if (!lineObj) return;

    if (lineObj.timerId) {
      clearTimeout(lineObj.timerId);
      lineObj.timerId = null;
    }

    lineObj.el.classList.remove("is-streaming");
    const finalText = (
      lineObj.entry.text ||
      lineObj.entry.interimText ||
      ""
    ).trim();
    lineObj.entry.text = finalText;
    lineObj.textEl.textContent = finalText;

    state[activeKey] = null;

    if (!finalText) {
      lineObj.el.remove();
      return;
    }

    if (isSource) {
      state.sourceEntries.push(lineObj.entry);
      dom.sourceCountBadge.textContent = `${state.sourceEntries.length}문장`;
      updateCollapsedSourcePreview(finalText);
      trimUtteranceDom(dom.sourceUtteranceList);
      if (state.autoScrollSource) scrollToLatest(dom.sourceScrollArea, false);
    } else {
      state.targetEntries.push(lineObj.entry);
      dom.targetCountBadge.textContent = `${state.targetEntries.length}문장`;
      trimUtteranceDom(dom.targetUtteranceList);
      announceForScreenReader(finalText);
      if (state.autoScrollTarget) scrollToLatest(dom.targetScrollArea, false);
    }

    state.chronologicalEntries.push({
      role: lineObj.entry.role,
      text: lineObj.entry.text,
      timestamp: lineObj.entry.timestamp,
      lang: lineObj.entry.lang,
    });
  }

  // Keep the rendered transcript bounded for multi-hour meetings. Full history stays in
  // state.*Entries, so copy / download / summary are unaffected.
  const MAX_RENDERED_LINES = 1500;
  function trimUtteranceDom(listEl) {
    if (!listEl) return;
    const excess = listEl.childElementCount - MAX_RENDERED_LINES;
    for (let i = 0; i < excess; i++) {
      const first = listEl.firstElementChild;
      if (!first || first.classList.contains("is-streaming")) break;
      first.remove();
    }
  }

  // Streaming lines are NOT live regions (they would be re-announced on every chunk);
  // only finalized translation lines are announced through this polite region.
  function announceForScreenReader(text) {
    const region = dom.srAnnouncer;
    if (!region || !text) return;
    const p = document.createElement("p");
    p.textContent = text;
    region.appendChild(p);
    while (region.childElementCount > 3) {
      region.firstElementChild.remove();
    }
  }

  // One scroll write per container per animation frame (avoids layout thrash on chunk bursts).
  const pendingScrolls = new Map(); // containerEl -> force flag
  function scrollToLatest(containerEl, force) {
    if (!containerEl) return;
    if (pendingScrolls.has(containerEl)) {
      if (force) pendingScrolls.set(containerEl, true);
      return;
    }
    pendingScrolls.set(containerEl, Boolean(force));
    requestAnimationFrame(() => {
      const forced = pendingScrolls.get(containerEl);
      pendingScrolls.delete(containerEl);
      containerEl.scrollTop = containerEl.scrollHeight;
      if (forced) {
        if (containerEl === dom.sourceScrollArea && dom.btnJumpSourceLatest) {
          dom.btnJumpSourceLatest.hidden = true;
        }
        if (containerEl === dom.targetScrollArea && dom.btnJumpTargetLatest) {
          dom.btnJumpTargetLatest.hidden = true;
        }
      }
    });
  }

  function clearTranscriptHistory() {
    finalizeActiveCard("source");
    finalizeActiveCard("target");

    state.sourceEntries = [];
    state.targetEntries = [];
    state.chronologicalEntries = [];
    state.summaryMarkdown = "";
    state.summaryEntryCountAtGeneration = -1;
    state.autoScrollSource = true;
    state.autoScrollTarget = true;

    dom.sourceUtteranceList.innerHTML = "";
    dom.targetUtteranceList.innerHTML = "";
    if (dom.srAnnouncer) dom.srAnnouncer.innerHTML = "";
    dom.sourceEmptyState.hidden = false;
    dom.targetEmptyState.hidden = false;
    dom.sourceCountBadge.textContent = "0문장";
    dom.targetCountBadge.textContent = "0문장";
    resetLatencyTracker(true);
    // resetLatencyTracker stops the ticker; keep it running if a session is active.
    if (state.userWantsRecording) startLatencyTicker();
    if (dom.btnJumpSourceLatest) dom.btnJumpSourceLatest.hidden = true;
    if (dom.btnJumpTargetLatest) dom.btnJumpTargetLatest.hidden = true;
    updateCollapsedSourcePreview("");
  }

  function getPanelFullText(role) {
    const isSource = role === "source";
    const entries = isSource ? state.sourceEntries : state.targetEntries;
    const active = isSource ? state.activeSourceCard : state.activeTargetCard;

    const lines = entries.map((item) => item.text);
    if (active && active.entry.text.trim()) {
      lines.push(active.entry.text.trim());
    }
    return lines.join("\n");
  }

  function getAllCommittedAndActiveEntries() {
    const list = [...state.chronologicalEntries];
    if (state.activeSourceCard && state.activeSourceCard.entry.text.trim()) {
      list.push({
        role: "source",
        text: state.activeSourceCard.entry.text.trim(),
        timestamp: state.activeSourceCard.entry.timestamp,
        lang: state.activeSourceCard.entry.lang,
      });
    }
    if (state.activeTargetCard && state.activeTargetCard.entry.text.trim()) {
      list.push({
        role: "target",
        text: state.activeTargetCard.entry.text.trim(),
        timestamp: state.activeTargetCard.entry.timestamp,
        lang: state.activeTargetCard.entry.lang,
      });
    }
    return list;
  }

  // =========================================================================
  // 5. Smart Microphone Audio Engine & iOS Native AVAudioSession Split-Routing Bridge
  // =========================================================================

  /**
   * echoCancellation policy (single source of truth for getUserMedia, the iOS native bridge,
   * diagnostics and toasts):
   * - iOS Native App: keep the original native contract (AEC on in subtitle-only mode, off while
   *   "번역 음성 듣기" plays to earphones). state.earphoneConnected is never updated in native mode.
   * - PC 오디오 (getDisplayMedia): not applicable → false.
   * - Desktop web mic: raw capture (AEC off) so far-field / PC-speaker speech is not attenuated,
   *   UNLESS our own translated audio is being rendered to open speakers (no earphones), in which
   *   case AEC must be on to prevent a self-translation feedback loop.
   * - Mobile web: previous behaviour (AEC on unless listening on earphones).
   */
  function shouldEnableEchoCancellation() {
    if (isNativeIosAudioAvailable()) return !state.isAudioOutputEnabled;
    if (state.audioInputSource === "desktop" && hasLiveDesktopAudioStream()) {
      return false;
    }
    const playingToSpeaker =
      state.isAudioOutputEnabled && !state.earphoneConnected;
    if (IS_MOBILE_BROWSER) return !state.isAudioOutputEnabled || playingToSpeaker;
    return playingToSpeaker;
  }

  /**
   * Detect whether the web app is running inside the iOS Native App Wrapper (WKWebView)
   * with the NativeAudioBridge (`window.webkit.messageHandlers.nativeAudio`).
   * In this mode, WKWebView NEVER calls `navigator.mediaDevices.getUserMedia()` so WebKit
   * cannot override AVAudioSession back to Bluetooth HFP. Instead, Swift manages
   * AVAudioSession (.playAndRecord + .allowBluetoothA2DP + builtInMic) & AVAudioEngine.
   */
  function isNativeIosAudioAvailable() {
    return Boolean(
      window.webkit &&
        window.webkit.messageHandlers &&
        window.webkit.messageHandlers.nativeAudio
    );
  }

  function postNativeIosAudioMessage(payload) {
    if (!isNativeIosAudioAvailable()) return false;
    try {
      window.webkit.messageHandlers.nativeAudio.postMessage(payload);
      return true;
    } catch (err) {
      console.warn("Failed to post message to iOS nativeAudio bridge:", err);
      return false;
    }
  }

  function registerNativeIosAudioCallbacks() {
    if (window.__nativeAudioCallbacksRegistered) return;
    window.__nativeAudioCallbacksRegistered = true;

    // Invoked by Swift AVAudioEngine tap every ~100ms with 16kHz 16-bit mono PCM (base64) + RMS
    window.__onNativeMicPcm16 = (base64Pcm, rmsValue) => {
      if (
        !state.isRecording ||
        !state.ws ||
        state.ws.readyState !== WebSocket.OPEN ||
        !base64Pcm
      ) {
        return;
      }

      const rms = typeof rmsValue === "number" ? rmsValue : 0;
      nativeRestartAttempted = false; // capture is healthy again → re-arm one-shot restart
      noteCapturedLevel(rms);

      const binaryStr = window.atob(base64Pcm);
      const len = binaryStr.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      state.ws.send(bytes.buffer);
    };

    window.__onNativeAudioRouteChange = (info) => {
      if (info && info.reason === "oldDeviceUnavailable" && state.isAudioOutputEnabled) {
        state.isAudioOutputEnabled = false;
        state.earphoneConnected = false;
        updateAudioOutputToggleUI();
        stopTranslatedAudioPlayback(true);
        notifyConfigChangeIfActive();
        postNativeIosAudioMessage({
          action: "updateConfig",
          echoCancellation: shouldEnableEchoCancellation(),
          audioOutputEnabled: false,
        });
        clearPersistentStatus();
        showToast(
          "🔌 이어폰이 분리되어 「번역 음성 듣기」가 자동으로 꺼졌습니다 (자막 전용 모드 전환)."
        );
        return;
      }
      if (info && info.message) {
        showToast(info.message);
      }
    };

    window.__onNativeAudioError = (errMsg) => {
      console.error("iOS Native Audio Error:", errMsg);
      showToast(errMsg || "iOS 오디오 세션 오류가 발생했습니다.");
    };

    // Invoked by Swift on AVAudioSession / AVAudioEngine lifecycle changes.
    // state ∈ "interrupted" | "resumed" | "backgrounded" | "error" | "stopped"
    let nativeRestartAttempted = false;
    window.__onNativeCaptureState = (payload) => {
      const info = payload || {};
      const captureState = String(info.state || "");
      const message = info.message || "";

      switch (captureState) {
        case "interrupted":
        case "backgrounded": {
          if (state.userWantsRecording) {
            setSessionStatus(
              "reconnecting",
              captureState === "interrupted"
                ? "오디오 일시 중단됨"
                : "백그라운드 일시 정지"
            );
          }
          showToast(
            message ||
              (captureState === "interrupted"
                ? "⏸️ 전화/다른 앱에 의해 오디오가 일시 중단되었습니다."
                : "⏸️ 앱이 백그라운드로 전환되어 수음이 일시 정지되었습니다.")
          );
          break;
        }
        case "resumed": {
          nativeRestartAttempted = false;
          if (state.userWantsRecording) {
            if (state.ws && state.ws.readyState === WebSocket.OPEN) {
              setSessionStatus("connected", "실시간 통역 중");
            } else {
              setSessionStatus("connecting", "세션 연결 중...");
            }
          }
          showToast(message || "▶️ 오디오 수음이 재개되었습니다.");
          break;
        }
        case "error":
        case "stopped": {
          state.nativeCaptureActive = false;
          if (message || captureState === "error") {
            showToast(message || "iOS 오디오 수음이 중단되었습니다.");
          }
          if (state.userWantsRecording && !nativeRestartAttempted) {
            // Attempt exactly one automatic restart per failure episode.
            nativeRestartAttempted = true;
            startMicrophoneCapture().catch((err) => {
              console.warn("Native capture restart failed:", err);
            });
          }
          break;
        }
        default:
          if (message) showToast(message);
          break;
      }
    };
  }

  function ensureAudioContext() {
    if (!state.audioCtx || state.audioCtx.state === "closed") {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      // Open at native hardware sampleRate (important for iOS Safari & macOS)
      state.audioCtx = new AudioCtx();

      state.audioCtx.addEventListener("statechange", () => {
        if (
          state.userWantsRecording &&
          state.audioCtx &&
          (state.audioCtx.state === "suspended" ||
            state.audioCtx.state === "interrupted")
        ) {
          state.audioCtx.resume().catch(() => {});
        }
      });
    }
    resumeAudioContextIfNeeded();
    return state.audioCtx;
  }

  function ensurePlaybackAudioContext() {
    if (!state.playbackAudioCtx || state.playbackAudioCtx.state === "closed") {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      state.playbackAudioCtx = new AudioCtx();
      state.playbackNextTime = 0;

      state.playbackAudioCtx.addEventListener("statechange", () => {
        if (
          state.isAudioOutputEnabled &&
          state.playbackAudioCtx &&
          (state.playbackAudioCtx.state === "suspended" ||
            state.playbackAudioCtx.state === "interrupted")
        ) {
          state.playbackAudioCtx.resume().catch(() => {});
        }
      });
    }
    if (
      state.playbackAudioCtx &&
      (state.playbackAudioCtx.state === "suspended" ||
        state.playbackAudioCtx.state === "interrupted")
    ) {
      state.playbackAudioCtx.resume().catch(() => {});
    }
    return state.playbackAudioCtx;
  }

  function resumeAudioContextIfNeeded() {
    if (
      state.audioCtx &&
      (state.audioCtx.state === "suspended" ||
        state.audioCtx.state === "interrupted")
    ) {
      state.audioCtx.resume().catch(() => {});
    }
    if (
      state.isAudioOutputEnabled &&
      state.playbackAudioCtx &&
      (state.playbackAudioCtx.state === "suspended" ||
        state.playbackAudioCtx.state === "interrupted")
    ) {
      state.playbackAudioCtx.resume().catch(() => {});
    }
  }

  /**
   * Returns true if a microphone label belongs to earphones/headsets, the 3.5mm
   * "External Microphone" / "외장 마이크" jack (which Chrome on macOS labels with
   * "(Built-in)" because its CoreAudio transport is Built-in), or a remote Continuity
   * Camera iPhone/iPad microphone when running on a Desktop OS.
   */
  function isHeadsetOrExternalMicLabel(label) {
    const text = label || "";
    if (
      /AirPods|Beats|Powerbeats|Bose|WH-|WF-|Jabra|Poly|Plantronics|Sennheiser|Shokz|Soundcore|Bluetooth|Headset|Hands-Free|Earphone|Headphone|Buds|External Microphone|외장 마이크|이어폰|헤드셋|헤드폰/i.test(
        text
      )
    ) {
      return true;
    }
    // On Desktop macOS, Continuity Camera exposes "<Name>'s iPhone Microphone"
    if (!IS_MOBILE_BROWSER && /iPhone|iPad|Continuity|연속성/i.test(text)) {
      return true;
    }
    return false;
  }

  function findEarphoneOutputDevice(devices) {
    const audioOutputs = (devices || []).filter((d) => d && d.kind === "audiooutput");
    return (
      audioOutputs.find(
        (d) =>
          d.deviceId &&
          d.deviceId !== "default" &&
          d.deviceId !== "communications" &&
          /AirPods|Beats|Powerbeats|Bose|WH-|WF-|Jabra|Poly|Plantronics|Sennheiser|Shokz|Soundcore|Headphone|Headset|Earphone|Buds|External Headphones|외장 헤드폰|이어폰|헤드폰|헤드셋|Bluetooth/i.test(
            d.label || ""
          )
      ) || null
    );
  }

  function detectEarphonePresence(devices) {
    if (findEarphoneOutputDevice(devices)) return true;
    const audioInputs = (devices || []).filter((d) => d && d.kind === "audioinput");
    return audioInputs.some(
      (d) =>
        d.deviceId &&
        d.deviceId !== "default" &&
        d.deviceId !== "communications" &&
        /AirPods|Beats|Powerbeats|Bose|WH-|WF-|Jabra|Poly|Plantronics|Sennheiser|Shokz|Soundcore|Bluetooth|Headset|Hands-Free|Earphone|Headphone|Buds|External Microphone|외장 마이크|이어폰|헤드셋|헤드폰/i.test(
          d.label || ""
        )
    );
  }

  /**
   * Routes (or recreates) playbackAudioCtx so it points at the currently active earphone
   * output device. Recreating playbackAudioCtx when an earphone is re-plugged is essential
   * on macOS Chrome because unplugging a 3.5mm/Bluetooth sink invalidates the old
   * AudioContext's underlying CoreAudio output unit.
   */
  async function refreshPlaybackOutputRouting(
    forceRecreateContext = false,
    preloadedDevices = null
  ) {
    if (isNativeIosAudioAvailable()) return;
    if (
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.enumerateDevices !== "function"
    ) {
      return;
    }

    try {
      const devices =
        preloadedDevices || (await navigator.mediaDevices.enumerateDevices());
      const earphoneOut = findEarphoneOutputDevice(devices);
      state.earphoneConnected = detectEarphonePresence(devices);

      if (!state.isAudioOutputEnabled) return;

      const targetSinkId = earphoneOut ? earphoneOut.deviceId : "";
      const sinkChanged =
        Boolean(state.playbackAudioCtx) &&
        state.activeOutputSinkId !== targetSinkId;

      if (forceRecreateContext || sinkChanged) {
        stopTranslatedAudioPlayback(true);
      }

      const playbackCtx = ensurePlaybackAudioContext();
      if (typeof playbackCtx.setSinkId === "function") {
        await playbackCtx.setSinkId(targetSinkId).catch(() => {});
      }
      state.activeOutputSinkId = targetSinkId;

      if (earphoneOut) {
        state.activeOutputLabel = earphoneOut.label;
      } else {
        const defaultOut = devices.find(
          (d) => d.kind === "audiooutput" && d.deviceId === "default"
        );
        state.activeOutputLabel = defaultOut?.label || "System Default";
      }

      if (
        playbackCtx.state === "suspended" ||
        playbackCtx.state === "interrupted"
      ) {
        await playbackCtx.resume().catch(() => {});
      }
    } catch (err) {
      console.warn("refreshPlaybackOutputRouting error:", err);
    }
  }

  /**
   * Handles earphone plug/unplug events:
   * - When earphones are UNPLUGGED while "번역 음성 듣기" is ON: automatically turns OFF
   *   "번역 음성 듣기" (Option 2: conference room safety mode) and disposes the dead playbackAudioCtx.
   * - When earphones are PLUGGED BACK IN: recreates a fresh playbackAudioCtx bound to the
   *   newly connected earphone device and ensures input stays on the built-in room mic.
   */
  async function handleAudioDeviceChange() {
    if (
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.enumerateDevices !== "function"
    ) {
      return;
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const wasEarphoneConnected = state.earphoneConnected;
      const nowEarphoneConnected = detectEarphonePresence(devices);
      state.earphoneConnected = nowEarphoneConnected;

      // 1. Earphones UNPLUGGED while "번역 음성 듣기" was ON -> Auto-OFF (Option 2)
      if (wasEarphoneConnected && !nowEarphoneConnected) {
        stopTranslatedAudioPlayback(true);
        state.activeOutputSinkId = "";
        if (state.isAudioOutputEnabled) {
          state.isAudioOutputEnabled = false;
          updateAudioOutputToggleUI();
          notifyConfigChangeIfActive();
          if (state.userWantsRecording && !state.captureInFlight) {
            await startMicrophoneCapture().catch(() => {});
          }
          clearPersistentStatus();
          showToast(
            "🔌 이어폰이 분리되어 「번역 음성 듣기」가 자동으로 꺼졌습니다 (자막 전용 모드 전환)."
          );
          return;
        }
      }

      // 2. Earphones PLUGGED IN -> Recreate playbackAudioCtx and lock room mic
      if (!wasEarphoneConnected && nowEarphoneConnected) {
        stopTranslatedAudioPlayback(true);
        if (state.isAudioOutputEnabled) {
          await refreshPlaybackOutputRouting(true, devices);
          if (state.userWantsRecording && !state.captureInFlight) {
            await startMicrophoneCapture().catch(() => {});
          }
          showToast(
            `🎧 이어폰(${state.activeOutputLabel})이 연결되어 번역 음성 출력이 이어폰으로 전환되었습니다.`,
            { persist: true }
          );
          return;
        } else {
          if (state.userWantsRecording && !state.captureInFlight) {
            await startMicrophoneCapture().catch(() => {});
          }
          showToast(
            "🎧 이어폰이 연결되었습니다 — 「번역 음성 듣기」를 켜면 이어폰으로 통역 음성을 들을 수 있습니다."
          );
          return;
        }
      }

      // 3. Other device changes during active recording
      if (!state.userWantsRecording || state.captureInFlight) return;
      if (state.isAudioOutputEnabled) {
        await refreshPlaybackOutputRouting(false, devices);
      }
      if (state.audioInputSource === "desktop" && hasLiveDesktopAudioStream()) {
        return;
      }
      const activeTrack = state.micStream?.getAudioTracks()?.[0];
      const trackLive =
        activeTrack && activeTrack.readyState === "live" && !activeTrack.muted;
      const hijackedByHeadsetMic =
        trackLive &&
        state.isAudioOutputEnabled &&
        isHeadsetOrExternalMicLabel(activeTrack.label || "");
      if (trackLive && !hijackedByHeadsetMic) return;
      await startMicrophoneCapture().catch(() => {});
    } catch (err) {
      console.warn("handleAudioDeviceChange error:", err);
    }
  }

  /**
   * Finds the true built-in room microphone (e.g., "MacBook Pro Microphone" on Mac,
   * "iPhone 마이크" on iPhone) while excluding virtual aliases ("default", "communications"),
   * wired earphone jacks ("External Microphone (Built-in)" / "외장 마이크"), Bluetooth headsets,
   * and macOS Continuity Camera iPhone mics.
   */
  function findPreferredRoomMicrophone(audioInputs) {
    const realInputs = (audioInputs || []).filter(
      (d) =>
        d &&
        d.deviceId &&
        d.deviceId !== "default" &&
        d.deviceId !== "communications"
    );

    if (!IS_MOBILE_BROWSER) {
      // 1st priority on Desktop: explicit computer built-in microphone (MacBook, iMac, Internal, etc.)
      const computerBuiltIn = realInputs.find(
        (d) =>
          !isHeadsetOrExternalMicLabel(d.label) &&
          /MacBook|iMac|Mac Studio|Mac mini|Mac Pro|Internal Microphone|내장 마이크|Built-in Microphone|배열 마이크|Microphone Array/i.test(
            d.label || ""
          )
      );
      if (computerBuiltIn) return computerBuiltIn;

      // 2nd priority on Desktop: any non-headset/non-external Built-in mic
      const genericBuiltIn = realInputs.find(
        (d) =>
          !isHeadsetOrExternalMicLabel(d.label) &&
          /Built-in|내장|Internal/i.test(d.label || "")
      );
      if (genericBuiltIn) return genericBuiltIn;

      // 3rd priority on Desktop: USB / Webcam / Studio Display room microphone
      const usbRoomMic = realInputs.find(
        (d) =>
          !isHeadsetOrExternalMicLabel(d.label) &&
          /Webcam|Logitech|Studio Display|USB/i.test(d.label || "")
      );
      if (usbRoomMic) return usbRoomMic;

      return null;
    }

    // Mobile browser (iPhone / iPad / Android)
    return (
      realInputs.find(
        (d) =>
          !isHeadsetOrExternalMicLabel(d.label) &&
          /iPhone|iPad|Built-in|내장|Internal|Phone|기기의 마이크/i.test(
            d.label || ""
          )
      ) || null
    );
  }

  function sendClientAudioDiagnostics(availableInputs) {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    try {
      state.ws.send(
        JSON.stringify({
          type: "client_audio_info",
          audio_input_source: state.audioInputSource || "mic",
          input_label: state.activeMicLabel || "unknown",
          desktop_audio_label: state.activeDesktopAudioLabel || "none",
          output_label: state.activeOutputLabel || "default",
          echo_cancellation: shouldEnableEchoCancellation(),
          audio_output: Boolean(state.isAudioOutputEnabled),
          available_inputs: Array.isArray(availableInputs)
            ? availableInputs
            : undefined,
        })
      );
    } catch (_) {}
  }

  /**
   * Public entry point: serializes concurrent calls so that two capture pipelines
   * can never coexist. Without this, a `devicechange` event firing while the first
   * getUserMedia()/addModule() is still awaiting would create a second AudioWorklet,
   * and the first one (not yet stored in `state`) kept streaming -> exactly 2x audio
   * upstream (observed in Cloud Logging as 50 chunks / 2.5s instead of 5s).
   */
  function startMicrophoneCapture() {
    const chained = (state.captureInFlight || Promise.resolve())
      .catch(() => {})
      .then(() => startMicrophoneCaptureInternal());
    state.captureInFlight = chained;
    chained.finally(() => {
      if (state.captureInFlight === chained) state.captureInFlight = null;
    }).catch(() => {});
    return chained;
  }

  async function startMicrophoneCaptureInternal() {
    // A queued capture must not start after the user pressed Stop.
    if (!state.userWantsRecording && !state.isRecording) return;

    stopMicrophoneCapture(false); // also bumps state.captureGen
    const gen = state.captureGen;
    // True when Stop (or a newer capture) happened while we were awaiting.
    const isStale = () =>
      gen !== state.captureGen ||
      (!state.userWantsRecording && !state.isRecording);
    const stopLocalStream = (stream) => {
      if (stream && stream !== state.micStream) {
        try {
          stream.getTracks().forEach((t) => t.stop());
        } catch (_) {}
      }
    };

    const wantAEC = shouldEnableEchoCancellation();

    // 1. iOS Native Wrapper App Path (AVAudioSession .allowBluetoothA2DP + builtInMic)
    if (isNativeIosAudioAvailable()) {
      registerNativeIosAudioCallbacks();
      state.nativeCaptureActive = true;
      state.activeMicLabel = "iPhone Built-in Mic (Native)";
      state.activeOutputLabel = "AirPods / A2DP (Native)";
      postNativeIosAudioMessage({
        action: "startCapture",
        echoCancellation: wantAEC,
        audioOutputEnabled: Boolean(state.isAudioOutputEnabled),
      });
      state.appliedEchoCancellation = wantAEC;
      return;
    }

    // 2. Web Browser Path (Desktop Chrome / Mobile Safari)
    const audioCtx = ensureAudioContext();
    if (audioCtx.state === "suspended" || audioCtx.state === "interrupted") {
      await audioCtx.resume();
    }
    if (isStale()) return;

    // Check if Desktop Exclusive PC Audio mode is active
    const useDesktopExclusive =
      !IS_MOBILE_BROWSER &&
      state.audioInputSource === "desktop" &&
      hasLiveDesktopAudioStream();

    let micStream = null;
    let availableInputLabels = [];

    if (useDesktopExclusive) {
      // Exclusive PC Audio Mode: Do NOT open the physical microphone (getUserMedia is skipped).
      // Room noise / keyboard typing is 100% isolated.
      if (
        navigator.mediaDevices &&
        typeof navigator.mediaDevices.enumerateDevices === "function"
      ) {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          state.earphoneConnected = detectEarphonePresence(devices);
          if (state.isAudioOutputEnabled) {
            await refreshPlaybackOutputRouting(false, devices);
          }
        } catch (_) {}
      }
      if (isStale()) return;
      state.activeMicLabel = "none (PC Audio Exclusive)";
      state.micStream = null;
    } else {
      // Exclusive Built-in Microphone Mode (Always on iPhone/Mobile, or when "🎙️ 주변 소리" is selected on Desktop)
      if (state.audioInputSource === "desktop" && !hasLiveDesktopAudioStream()) {
        state.audioInputSource = "mic";
      }

      const baseAudioConstraints = {
        channelCount: 1,
        echoCancellation: wantAEC,
        // Disable WebRTC noiseSuppression so far-field / ambient speech ("🎙️ 주변 소리")
        // and external room/speaker audio are not suppressed by Chrome's WebRTC DSP.
        noiseSuppression: false,
        autoGainControl: true,
      };

      // Pre-enumerate devices BEFORE calling getUserMedia() so that when AirPods are connected
      // on Desktop (and permission is already granted), we request "MacBook Pro Microphone"
      // directly on the first getUserMedia() call without ever touching the AirPods Bluetooth HFP
      // microphone (avoiding macOS A2DP -> HFP codec downgrade/glitch).
      let preEnumeratedDevices = null;
      let preselectedRoomMic = null;
      if (
        navigator.mediaDevices &&
        typeof navigator.mediaDevices.enumerateDevices === "function"
      ) {
        try {
          preEnumeratedDevices = await navigator.mediaDevices.enumerateDevices();
          const labeledInputs = preEnumeratedDevices.filter(
            (d) => d.kind === "audioinput" && d.label
          );
          if (
            labeledInputs.length > 0 &&
            (state.isAudioOutputEnabled || !IS_MOBILE_BROWSER)
          ) {
            preselectedRoomMic = findPreferredRoomMicrophone(labeledInputs);
          }
        } catch (_) {}
      }
      if (isStale()) return;

      try {
        const initialConstraints =
          preselectedRoomMic && preselectedRoomMic.deviceId
            ? {
                ...baseAudioConstraints,
                deviceId: { exact: preselectedRoomMic.deviceId },
              }
            : baseAudioConstraints;

        micStream = await navigator.mediaDevices.getUserMedia({
          audio: initialConstraints,
          video: false,
        });
      } catch (firstErr) {
        if (isStale()) return;
        // Fallback to generic constraints if exact deviceId failed
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: baseAudioConstraints,
          video: false,
        });
      }
      if (isStale()) {
        // Stop pressed while getUserMedia was pending: never leave the mic live.
        stopLocalStream(micStream);
        return;
      }

      // Inspect audio devices after getUserMedia permission grant:
      // 1) If labels were not available before getUserMedia, switch to preferredRoomMic now.
      // 2) Route playbackAudioCtx to earphones/AirPods via setSinkId.
      if (
        navigator.mediaDevices &&
        typeof navigator.mediaDevices.enumerateDevices === "function"
      ) {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const audioInputs = devices.filter((d) => d.kind === "audioinput");
          availableInputLabels = audioInputs.map(
            (d) => `${d.label || "(unlabeled)"} [${d.deviceId.slice(0, 8)}]`
          );
          state.earphoneConnected = detectEarphonePresence(devices);

          if (micStream) {
            const preferredRoomMic = findPreferredRoomMicrophone(audioInputs);
            const currentTrack = micStream.getAudioTracks()[0];
            const currentLabel = currentTrack ? currentTrack.label || "" : "";
            const currentDeviceId =
              currentTrack?.getSettings?.().deviceId || "";

            const isContinuityMicOnDesktop =
              !IS_MOBILE_BROWSER &&
              /iPhone|iPad|Continuity|연속성/i.test(currentLabel);
            const shouldSwitchToRoomMic =
              preferredRoomMic &&
              preferredRoomMic.deviceId &&
              currentDeviceId !== preferredRoomMic.deviceId &&
              (isContinuityMicOnDesktop ||
                ((state.isAudioOutputEnabled || !IS_MOBILE_BROWSER) &&
                  (isHeadsetOrExternalMicLabel(currentLabel) ||
                    currentLabel !== preferredRoomMic.label)));

            if (shouldSwitchToRoomMic) {
              const replacementStream =
                await navigator.mediaDevices.getUserMedia({
                  audio: {
                    ...baseAudioConstraints,
                    deviceId: { exact: preferredRoomMic.deviceId },
                  },
                  video: false,
                });
              micStream.getTracks().forEach((t) => t.stop());
              micStream = replacementStream;
              if (isStale()) {
                stopLocalStream(micStream);
                return;
              }
            }
          }

          // Route playbackAudioCtx (NOT capture audioCtx!) to earphones on Desktop Chrome
          if (state.isAudioOutputEnabled) {
            await refreshPlaybackOutputRouting(false, devices);
          }
        } catch (enumErr) {
          console.warn("Audio device enumeration fallback:", enumErr);
        }
      }

      if (isStale()) {
        stopLocalStream(micStream);
        return;
      }
      const finalTrack = micStream ? micStream.getAudioTracks()[0] : null;
      state.activeMicLabel = finalTrack
        ? finalTrack.label || "Default Mic"
        : "none";
      state.micStream = micStream;
    }

    state.appliedEchoCancellation = wantAEC;
    updateDesktopAudioBtnUI();
    sendClientAudioDiagnostics(availableInputLabels);

    try {
      await buildCaptureGraph(audioCtx, useDesktopExclusive, micStream, isStale);
    } catch (graphErr) {
      // e.g. AudioContext closed mid-flight: release the mic instead of leaking a live track.
      console.warn("Capture graph build failed:", graphErr);
      if (gen === state.captureGen) stopMicrophoneCapture(false);
      else stopLocalStream(micStream);
      throw graphErr;
    }
  }

  async function buildCaptureGraph(audioCtx, useDesktopExclusive, micStream, isStale) {
    const actualSampleRate = audioCtx.sampleRate;

    // Pass-through gain node as unified capture source node (no attenuating Biquad filters,
    // matching the raw AVAudioEngine capture pipeline on the iPhone app)
    const capturePassNode = audioCtx.createGain();
    capturePassNode.gain.value = 1.0;

    // Connect ONLY the active exclusive audio source:
    if (useDesktopExclusive) {
      // Source Option B (Desktop only): PC Audio (Chrome tab, QuickTime Player, etc.) ONLY
      const desktopAudioOnlyStream = new MediaStream(
        state.desktopStream.getAudioTracks()
      );
      const desktopSource = audioCtx.createMediaStreamSource(
        desktopAudioOnlyStream
      );
      desktopSource.connect(capturePassNode);
      state.desktopCaptureSourceNode = desktopSource;
    } else if (micStream) {
      // Source Option A (Default on Desktop, Always on iPhone/Mobile): Built-in Microphone ONLY
      const micSource = audioCtx.createMediaStreamSource(micStream);
      micSource.connect(capturePassNode);
      state.micSourceNode = micSource;
    }

    state.captureSourceNode = capturePassNode;

    // Muted sink node so Web Audio engine pulls audio continuously without speaker feedback
    const muteSink = audioCtx.createGain();
    muteSink.gain.value = 0;
    muteSink.connect(audioCtx.destination);
    state.muteSinkNode = muteSink;

    // 100ms chunk size at native hardware sampleRate
    const targetChunkSamples = Math.max(
      1024,
      Math.round(actualSampleRate * 0.1)
    );

    if (audioCtx.audioWorklet) {
      try {
        if (!audioCtx._pcm16WorkletRegistered) {
          const workletCode = `
            class Pcm16CaptureProcessor extends AudioWorkletProcessor {
              constructor(options) {
                super();
                const opts = (options && options.processorOptions) || {};
                this.chunkSize = opts.chunkSize || 4800;
                this.buffer = new Float32Array(this.chunkSize);
                this.writeIndex = 0;
              }
              process(inputs) {
                const input = inputs[0];
                if (!input || !input[0]) return true;
                const channelData = input[0];
                for (let i = 0; i < channelData.length; i++) {
                  this.buffer[this.writeIndex++] = channelData[i];
                  if (this.writeIndex >= this.chunkSize) {
                    this.port.postMessage(this.buffer.slice(0));
                    this.writeIndex = 0;
                  }
                }
                return true;
              }
            }
            registerProcessor("pcm16-capture-processor", Pcm16CaptureProcessor);
          `;
          const blob = new Blob([workletCode], {
            type: "application/javascript",
          });
          const workletUrl = URL.createObjectURL(blob);
          await audioCtx.audioWorklet.addModule(workletUrl);
          URL.revokeObjectURL(workletUrl);
          audioCtx._pcm16WorkletRegistered = true;
          // Stop happened during addModule: stopMicrophoneCapture already disconnected the
          // nodes registered in state above, so just bail out.
          if (isStale()) return;
        }

        const workletNode = new AudioWorkletNode(
          audioCtx,
          "pcm16-capture-processor",
          {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [1],
            processorOptions: {
              chunkSize: targetChunkSamples,
            },
          }
        );
        workletNode.port.onmessage = (e) => {
          // Only the currently registered node may stream; stale nodes are ignored.
          if (state.captureWorkletNode !== workletNode) return;
          processCapturedFloatSamples(e.data, actualSampleRate);
        };

        capturePassNode.connect(workletNode);
        workletNode.connect(muteSink);
        state.captureWorkletNode = workletNode;
        return;
      } catch (workletErr) {
        console.warn(
          "AudioWorklet fallback to ScriptProcessorNode:",
          workletErr
        );
      }
    }

    // Fallback: ScriptProcessorNode
    const scriptNode = audioCtx.createScriptProcessor(4096, 1, 1);
    scriptNode.onaudioprocess = (event) => {
      if (!state.isRecording) return;
      if (state.captureScriptNode !== scriptNode) return;
      const inputData = event.inputBuffer.getChannelData(0);
      processCapturedFloatSamples(
        new Float32Array(inputData),
        actualSampleRate
      );
    };
    capturePassNode.connect(scriptNode);
    scriptNode.connect(muteSink);
    state.captureScriptNode = scriptNode;
  }

  // -------------------------------------------------------------------------
  // Adaptive noise floor. With noiseSuppression disabled (and AGC on) the room noise floor can
  // exceed fixed thresholds, which kept the 10-min inactivity timer alive forever and pushed
  // the latency badges to 9.9s on pure noise. noiseFloorRms is an asymmetric EMA of quiet
  // chunks: falls quickly, rises slowly, and creeps up very slowly during sustained "loud"
  // input so a persistently noisier room is eventually learned too.
  // -------------------------------------------------------------------------
  const NOISE_FLOOR_MIN = 0.0005;
  const NOISE_FLOOR_MAX = 0.05;
  const NOISE_FLOOR_VOICE_RATIO = 3; // voice must be ~10dB above the floor

  function updateNoiseFloor(rms) {
    let floor = state.noiseFloorRms;
    if (rms < floor) {
      floor += (rms - floor) * 0.2;
    } else if (rms < floor * NOISE_FLOOR_VOICE_RATIO) {
      floor += (rms - floor) * 0.05;
    } else {
      floor += (rms - floor) * 0.002;
    }
    state.noiseFloorRms = Math.min(NOISE_FLOOR_MAX, Math.max(NOISE_FLOOR_MIN, floor));
  }

  function voiceThreshold(base) {
    return Math.max(base, state.noiseFloorRms * NOISE_FLOOR_VOICE_RATIO);
  }

  /** Shared per-chunk level handling for both the Web and iOS Native capture paths. */
  function noteCapturedLevel(rms, activityBase = 0.008) {
    updateNoiseFloor(rms);
    updateVisualizerBars(rms);
    trackSpeechOnset(rms);

    // Reset 10m inactivity timer only when voice energy clearly exceeds the noise floor
    if (rms > voiceThreshold(activityBase)) {
      const now = Date.now();
      state.lastActivityAt = now;
      if (now - state.lastActivityPingAt > 10000) {
        state.lastActivityPingAt = now;
        try {
          state.ws.send(JSON.stringify({ type: "activity" }));
        } catch (_) {}
      }
    }
  }

  function processCapturedFloatSamples(float32Array, inputSampleRate) {
    if (
      !state.isRecording ||
      !state.ws ||
      state.ws.readyState !== WebSocket.OPEN
    ) {
      return;
    }

    // Compute RMS energy
    let sumSquares = 0;
    for (let i = 0; i < float32Array.length; i++) {
      sumSquares += float32Array[i] * float32Array[i];
    }
    const rms = Math.sqrt(sumSquares / float32Array.length);
    noteCapturedLevel(rms, 0.004);

    // For "🎙️ 주변 소리" (room/ambient microphone capture), apply a clean far-field
    // pre-gain boost for QUIET SPEECH so Gemini Live's VAD reliably detects it. Never boost
    // the noise floor itself (rms below ~0.01 or within ~10dB of the learned floor).
    let preGain = 1.0;
    if (
      state.audioInputSource !== "desktop" &&
      rms >= Math.max(0.01, state.noiseFloorRms * NOISE_FLOOR_VOICE_RATIO) &&
      rms < 0.06
    ) {
      preGain = Math.min(2.4, Math.max(1.2, 0.045 / rms));
    }

    // Resample from native hardware rate (e.g. 48000Hz) to 16000Hz required by Gemini Live API
    const samples16k =
      inputSampleRate === 16000
        ? float32Array
        : downsampleFloat32(float32Array, inputSampleRate, 16000);

    // Convert Float32 [-1.0, 1.0] to 16-bit signed little-endian PCM
    const pcm16Buffer = new ArrayBuffer(samples16k.length * 2);
    const dataView = new DataView(pcm16Buffer);
    for (let i = 0; i < samples16k.length; i++) {
      const boosted = samples16k[i] * preGain;
      const clamped = Math.max(-1, Math.min(1, boosted));
      const int16 = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      dataView.setInt16(i * 2, int16, true);
    }

    state.ws.send(pcm16Buffer);
  }

  function downsampleFloat32(buffer, sourceRate, targetRate) {
    if (sourceRate === targetRate) return buffer;
    const ratio = sourceRate / targetRate;
    const newLength = Math.round(buffer.length / ratio);
    const result = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;
    while (offsetResult < result.length) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
      let accum = 0;
      let count = 0;
      for (
        let i = offsetBuffer;
        i < nextOffsetBuffer && i < buffer.length;
        i++
      ) {
        accum += buffer[i];
        count++;
      }
      result[offsetResult] = count > 0 ? accum / count : 0;
      offsetResult++;
      offsetBuffer = nextOffsetBuffer;
    }
    return result;
  }

  function stopMicrophoneCapture(closeContext = true) {
    state.captureGen += 1; // invalidates any in-flight startMicrophoneCaptureInternal()
    if (state.nativeCaptureActive) {
      state.nativeCaptureActive = false;
      postNativeIosAudioMessage({ action: "stopCapture" });
    }
    if (state.captureWorkletNode) {
      try {
        state.captureWorkletNode.disconnect();
      } catch (_) {}
      state.captureWorkletNode = null;
    }
    if (state.captureScriptNode) {
      try {
        state.captureScriptNode.disconnect();
      } catch (_) {}
      state.captureScriptNode = null;
    }
    if (state.captureSourceNode) {
      try {
        state.captureSourceNode.disconnect();
      } catch (_) {}
      state.captureSourceNode = null;
    }
    if (state.desktopCaptureSourceNode) {
      try {
        state.desktopCaptureSourceNode.disconnect();
      } catch (_) {}
      state.desktopCaptureSourceNode = null;
    }
    if (state.micSourceNode) {
      try {
        state.micSourceNode.disconnect();
      } catch (_) {}
      state.micSourceNode = null;
    }
    if (state.muteSinkNode) {
      try {
        state.muteSinkNode.disconnect();
      } catch (_) {}
      state.muteSinkNode = null;
    }
    if (state.micStream) {
      state.micStream.getTracks().forEach((track) => track.stop());
      state.micStream = null;
    }
    if (closeContext) {
      if (state.audioCtx) {
        try {
          state.audioCtx.close();
        } catch (_) {}
        state.audioCtx = null;
      }
      if (state.playbackAudioCtx) {
        try {
          state.playbackAudioCtx.close();
        } catch (_) {}
        state.playbackAudioCtx = null;
        state.playbackNextTime = 0;
      }
    }
  }

  /**
   * Play translated PCM16 audio chunk arriving from Gemini Live API:
   * - In iOS Native App mode: forwards chunk to Swift AVAudioPlayerNode (routed to AirPods A2DP).
   * - In Web Browser mode: schedules gapless AudioBufferSourceNode playback on dedicated playbackAudioCtx.
   */
  const MAX_PLAYBACK_BACKLOG_SEC = 1.5;

  function playTranslatedAudioChunk(base64Pcm, sampleRate = 24000) {
    if (!state.isAudioOutputEnabled || !base64Pcm) return;

    if (isNativeIosAudioAvailable()) {
      postNativeIosAudioMessage({
        action: "playAudio",
        data: base64Pcm,
        sampleRate,
      });
      return;
    }

    try {
      const playbackCtx = ensurePlaybackAudioContext();
      const binaryStr = window.atob(base64Pcm);
      const byteLen = binaryStr.length;
      const sampleCount = Math.floor(byteLen / 2);
      if (sampleCount <= 0) return;

      const bytes = new Uint8Array(byteLen);
      for (let i = 0; i < byteLen; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      const view = new DataView(bytes.buffer);
      const float32 = new Float32Array(sampleCount);
      for (let i = 0; i < sampleCount; i++) {
        const int16 = view.getInt16(i * 2, true);
        float32[i] = int16 / 32768.0;
      }

      const audioBuffer = playbackCtx.createBuffer(1, sampleCount, sampleRate);
      audioBuffer.getChannelData(0).set(float32);

      const sourceNode = playbackCtx.createBufferSource();
      sourceNode.buffer = audioBuffer;
      sourceNode.connect(playbackCtx.destination);

      const now = playbackCtx.currentTime;
      // Cap the scheduled backlog: under network jitter / bursts the queue would otherwise
      // grow without bound and translated speech would drift seconds behind the subtitles.
      if (state.playbackNextTime && state.playbackNextTime - now > MAX_PLAYBACK_BACKLOG_SEC) {
        stopTranslatedAudioPlayback(false);
      }
      const startAt = Math.max(now + 0.015, state.playbackNextTime || 0);
      sourceNode.start(startAt);
      state.playbackNextTime = startAt + audioBuffer.duration;

      state.activePlaybackSources.add(sourceNode);
      sourceNode.onended = () => {
        state.activePlaybackSources.delete(sourceNode);
      };
    } catch (err) {
      console.warn("Translated audio playback error:", err);
    }
  }

  function stopTranslatedAudioPlayback(closePlaybackCtx = false) {
    if (isNativeIosAudioAvailable()) {
      postNativeIosAudioMessage({ action: "stopPlayback" });
    }
    state.playbackNextTime = 0;
    if (state.activePlaybackSources && state.activePlaybackSources.size > 0) {
      state.activePlaybackSources.forEach((src) => {
        try {
          src.stop();
          src.disconnect();
        } catch (_) {}
      });
      state.activePlaybackSources.clear();
    }
    if (closePlaybackCtx && state.playbackAudioCtx) {
      try {
        state.playbackAudioCtx.close();
      } catch (_) {}
      state.playbackAudioCtx = null;
      state.activeOutputSinkId = "";
    }
  }

  // Bars have a fixed 17px box in CSS and are scaled with transform (compositor-only,
  // no layout per 100ms chunk). Scale 4/17 ≈ resting height of 4px.
  const VISUALIZER_MAX_PX = 17;
  const VISUALIZER_MULTIPLIERS = [0.65, 1.0, 0.85, 0.55];
  function updateVisualizerBars(rms) {
    if (!dom.audioBars || dom.audioBars.hidden) return;
    const boost = Math.min(1, rms * 9);
    for (let idx = 0; idx < visualizerBars.length; idx++) {
      const heightPx = Math.max(4, 4 + boost * 13 * VISUALIZER_MULTIPLIERS[idx]);
      visualizerBars[idx].style.transform = `scaleY(${(heightPx / VISUALIZER_MAX_PX).toFixed(3)})`;
    }
  }

  // =========================================================================
  // Live latency indicator: "pending lag"
  //   = how long speech has been coming in WITHOUT corresponding text appearing.
  // While transcription keeps up with continuous speech this hovers near 0.0s;
  // when the model stalls (e.g. start of a sentence) it climbs until text lands,
  // then drops back. Target lag = how far the translation trails the source text.
  // =========================================================================
  const LATENCY_VOICE_RMS = 0.008; // base threshold; raised by the adaptive noise floor
  const LATENCY_SILENCE_GAP_MS = 350; // gap that marks the start of a new speech run
  const LATENCY_TICK_MS = 100;
  const LATENCY_SLOW_MS = 3000; // highlight badge in red above this

  /** Called for every captured mic chunk with its RMS energy. */
  function trackSpeechOnset(rms) {
    const lt = state.latency;
    if (rms <= voiceThreshold(LATENCY_VOICE_RMS)) return;
    const now = performance.now();
    if (now - lt.lastVoiceAt > LATENCY_SILENCE_GAP_MS) {
      lt.runStartAt = now; // new speech run begins
    }
    lt.lastVoiceAt = now;
  }

  /** Called whenever source/target text arrives from the server. */
  function noteTextArrival(role) {
    const lt = state.latency;
    const now = performance.now();
    if (role === "source") lt.lastSourceTextAt = now;
    else lt.lastTargetTextAt = now;
    updateLatencyBadges();
  }

  function computePendingLags() {
    const lt = state.latency;
    const now = performance.now();
    if (!lt.runStartAt) return null; // no speech yet

    // --- Source: audio has been spoken since max(last text, speech-run start) with no text yet
    let sourceLag = 0;
    if (lt.lastVoiceAt > lt.lastSourceTextAt) {
      sourceLag = now - Math.max(lt.lastSourceTextAt, lt.runStartAt);
      sourceLag = Math.min(sourceLag, 9900); // cap (e.g. background noise with no speech)
    }

    // --- Target: audio has been spoken since max(last translation, speech-run start)
    //     with no translation yet (end-to-end: audio in -> translated text out)
    let targetLag = 0;
    if (lt.lastVoiceAt > lt.lastTargetTextAt) {
      targetLag = now - Math.max(lt.lastTargetTextAt, lt.runStartAt);
      targetLag = Math.min(targetLag, 9900);
    }
    return { sourceLag, targetLag };
  }

  function formatLatencySec(ms) {
    return `${(ms / 1000).toFixed(1)}s`;
  }

  function setLatencyBadge(badge, valueEl, ms) {
    if (!badge || !valueEl) return;
    valueEl.textContent = formatLatencySec(ms);
    badge.hidden = false;
    badge.classList.toggle("latency-slow", ms >= LATENCY_SLOW_MS);
  }

  function updateLatencyBadges() {
    const lags = computePendingLags();
    if (!lags) return;
    const lt = state.latency;
    lt.sourceLagMs = lags.sourceLag;
    lt.targetLagMs = lags.targetLag;
    setLatencyBadge(dom.sourceLatencyBadge, dom.sourceLatencyValue, lags.sourceLag);
    setLatencyBadge(dom.targetLatencyBadge, dom.targetLatencyValue, lags.targetLag);
  }

  function startLatencyTicker() {
    stopLatencyTicker();
    state.latency.tickerId = setInterval(updateLatencyBadges, LATENCY_TICK_MS);
  }

  function stopLatencyTicker() {
    if (state.latency.tickerId) {
      clearInterval(state.latency.tickerId);
      state.latency.tickerId = null;
    }
  }

  function resetLatencyTracker(hideBadges = true) {
    const lt = state.latency;
    stopLatencyTicker();
    lt.lastVoiceAt = 0;
    lt.runStartAt = 0;
    lt.lastSourceTextAt = 0;
    lt.lastTargetTextAt = 0;
    if (hideBadges) {
      lt.sourceLagMs = null;
      lt.targetLagMs = null;
      if (dom.sourceLatencyBadge) dom.sourceLatencyBadge.hidden = true;
      if (dom.targetLatencyBadge) dom.targetLatencyBadge.hidden = true;
      if (dom.sourceLatencyValue) dom.sourceLatencyValue.textContent = "-";
      if (dom.targetLatencyValue) dom.targetLatencyValue.textContent = "-";
    }
  }

  function resetVisualizerBars() {
    visualizerBars.forEach((bar) => {
      bar.style.transform = "";
    });
  }

  // =========================================================================
  // 6. Screen Wake Lock (Prevents iPhone / Android screen from sleeping mid-session)
  // =========================================================================

  async function requestScreenWakeLock() {
    if (!("wakeLock" in navigator)) return;
    try {
      if (state.wakeLock) return;
      state.wakeLock = await navigator.wakeLock.request("screen");
      state.wakeLock.addEventListener("release", () => {
        state.wakeLock = null;
      });
    } catch (_) {}
  }

  function releaseScreenWakeLock() {
    if (state.wakeLock) {
      try {
        state.wakeLock.release();
      } catch (_) {}
      state.wakeLock = null;
    }
  }

  // =========================================================================
  // 8. Direct One-Click Markdown (.md) Exports (Meeting Summary & Source/Target Transcript)
  // =========================================================================

  function getTimestampFilenameSuffix() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(
      d.getHours()
    )}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }

  /**
   * "회의 요약" 버튼 클릭 시:
   * 대화 내용을 기반으로 AI 회의록(Meeting Minutes)을 생성하여 즉시 .md 파일로 저장합니다.
   */
  async function generateAndDownloadSummaryMd() {
    const entries = getAllCommittedAndActiveEntries();
    if (entries.length === 0) {
      showToast("요약할 대화 기록이 아직 없습니다. 먼저 통역을 진행해 주세요.");
      return;
    }

    if (state.isSummarizing) {
      showHeaderBubble(dom.btnSummary, "⏳ 회의록 생성중 입니다", 2200);
      showToast("⏳ 회의록 생성중 입니다");
      return;
    }
    state.isSummarizing = true;
    // aria-disabled (not disabled) keeps the button focusable so the "생성중" bubble still shows.
    dom.btnSummary.setAttribute("aria-busy", "true");
    dom.btnSummary.setAttribute("aria-disabled", "true");
    if (dom.summaryBtnIcon) dom.summaryBtnIcon.textContent = "hourglass_top";
    if (dom.summaryBtnLabel) dom.summaryBtnLabel.textContent = "회의록 생성중 입니다";
    showHeaderBubble(dom.btnSummary, "⏳ 회의록 생성중 입니다", 2500);
    showToast("⏳ 회의록 생성중 입니다");

    try {
      const res = await fetch("/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entries,
          source_lang: dom.sourceLangSelect.value,
          target_lang: dom.targetLangSelect.value,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `HTTP ${res.status}`);
      }

      const data = await res.json();
      state.summaryMarkdown = (data.summary || "").trim();
      state.summaryEntryCountAtGeneration = entries.length;

      const nowDisplay = new Date().toLocaleString("ko-KR");
      const srcLabel = formatLanguageLabel(dom.sourceLangSelect.value);
      const tgtLabel = formatLanguageLabel(dom.targetLangSelect.value);

      const mdContent = [
        `# 📋 Gemini Live Translate — AI 회의록 (Meeting Minutes)`,
        ``,
        `- **생성 일시**: ${nowDisplay}`,
        `- **Source 언어**: ${srcLabel}`,
        `- **Target 언어**: ${tgtLabel}`,
        ``,
        `---`,
        ``,
        state.summaryMarkdown,
        ``,
      ].join("\n");

      const filename = `live_translate_summary_${getTimestampFilenameSuffix()}.md`;
      triggerFileDownload(filename, mdContent, "text/markdown;charset=utf-8");
      showToast("AI 회의록(.md) 파일이 저장되었습니다.");
    } catch (err) {
      console.error("Meeting summary error:", err);
      showToast(`회의록 생성에 실패했습니다: ${err.message}`);
    } finally {
      state.isSummarizing = false;
      dom.btnSummary.removeAttribute("aria-busy");
      dom.btnSummary.removeAttribute("aria-disabled");
      if (dom.summaryBtnIcon) dom.summaryBtnIcon.textContent = "auto_awesome";
      if (dom.summaryBtnLabel) dom.summaryBtnLabel.textContent = "회의 요약";
    }
  }

  /**
   * "원문/번역문 저장" 버튼 클릭 시:
   * 원문(Source) 전체를 먼저 기록하고, 이후에 번역문(Target) 전체를 분리하여 기록한 마크다운(.md) 파일을 즉시 저장합니다.
   */
  function downloadTranscriptMd() {
    const srcText = getPanelFullText("source");
    const tgtText = getPanelFullText("target");
    if (!srcText && !tgtText) {
      showToast("저장할 원문/번역문 기록이 없습니다.");
      return;
    }

    const nowDisplay = new Date().toLocaleString("ko-KR");
    const srcLabel = formatLanguageLabel(dom.sourceLangSelect.value);
    const tgtLabel = formatLanguageLabel(dom.targetLangSelect.value);

    const mdLines = [
      `# 🌐 Gemini Live Translate — 원문 및 번역문 기록`,
      ``,
      `- **저장 일시**: ${nowDisplay}`,
      `- **Source 언어**: ${srcLabel}`,
      `- **Target 언어**: ${tgtLabel}`,
      ``,
      `---`,
      ``,
      `## 🎙️ 원문 (Source — ${srcLabel})`,
      ``,
      srcText ? srcText : "_기록된 원문이 없습니다._",
      ``,
      `---`,
      ``,
      `## 🌍 번역문 (Target — ${tgtLabel})`,
      ``,
      tgtText ? tgtText : "_기록된 번역문이 없습니다._",
      ``,
    ];

    const filename = `live_translate_transcript_${getTimestampFilenameSuffix()}.md`;
    triggerFileDownload(
      filename,
      mdLines.join("\n"),
      "text/markdown;charset=utf-8"
    );
    showToast("원문/번역문 마크다운(.md) 파일이 저장되었습니다.");
  }

  function triggerFileDownload(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // =========================================================================
  // 10. Utilities (Session Status, Timer, Clipboard, Floating Toast)
  // =========================================================================

  function setSessionStatus(stateCode, labelText) {
    dom.sessionStatusPill.setAttribute("data-state", stateCode);
    dom.sessionStatusText.textContent = labelText;
  }

  function startSessionTimer() {
    stopSessionTimer();
    state.sessionStartTime = Date.now();
    dom.sessionTimer.hidden = false;
    dom.sessionTimer.textContent = "00:00";

    state.sessionTimerInterval = setInterval(() => {
      const elapsedSec = Math.floor(
        (Date.now() - state.sessionStartTime) / 1000
      );
      const mins = String(Math.floor(elapsedSec / 60)).padStart(2, "0");
      const secs = String(elapsedSec % 60).padStart(2, "0");
      dom.sessionTimer.textContent = `${mins}:${secs}`;
    }, 1000);
  }

  function stopSessionTimer() {
    if (state.sessionTimerInterval) {
      clearInterval(state.sessionTimerInterval);
      state.sessionTimerInterval = null;
    }
    dom.sessionTimer.hidden = true;
  }

  function formatTimeHHMMSS(date) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
      date.getSeconds()
    )}`;
  }

  async function copyToClipboard(text, successMsg) {
    try {
      await navigator.clipboard.writeText(text);
      showToast(successMsg);
    } catch (_) {
      showToast("클립보드 복사에 실패했습니다.");
    }
  }

  /**
   * Shows a transient toast. With { persist: true } the message also becomes the footer's
   * persistent status line (restored after later toasts expire) until clearPersistentStatus()
   * is called (on Stop, "번역 음성 듣기" OFF, or earphone unplug).
   */
  function showToast(message, options = {}) {
    if (!dom.toastMessage) return;
    if (options.persist && typeof message === "string") {
      state.persistentStatusMessage = message;
    }
    dom.toastMessage.textContent = message;
    dom.toastMessage.hidden = false;
    if (toastTimeoutId) clearTimeout(toastTimeoutId);
    toastTimeoutId = setTimeout(() => {
      toastTimeoutId = null;
      if (state.persistentStatusMessage) {
        dom.toastMessage.textContent = state.persistentStatusMessage;
        dom.toastMessage.hidden = false;
      } else {
        dom.toastMessage.textContent = "";
        dom.toastMessage.hidden = true;
      }
    }, 3500);
  }

  function clearPersistentStatus() {
    if (!state.persistentStatusMessage) return;
    const wasShowing =
      dom.toastMessage &&
      dom.toastMessage.textContent === state.persistentStatusMessage;
    state.persistentStatusMessage = "";
    if (wasShowing && !toastTimeoutId) {
      dom.toastMessage.textContent = "";
      dom.toastMessage.hidden = true;
    }
  }

  // Header speech-bubble tooltip (module scope so other code can show custom messages).
  const HEADER_TOOLTIP_LABELS = {
    btnSummary: "✨ AI 회의 요약 (.md 저장)",
    btnOpenDownload: "📥 원문/번역문 저장 (.md)",
    btnClear: "🗑️ 대화 기록 초기화",
  };
  let headerBubble = null;
  let headerBubbleOwner = null;
  let hideBubbleTimer = null;

  function hideHeaderBubble() {
    if (!headerBubble) return;
    headerBubble.setAttribute("data-open", "false");
    headerBubble.setAttribute("aria-hidden", "true");
    if (headerBubbleOwner) {
      headerBubbleOwner.removeAttribute("aria-describedby");
      headerBubbleOwner = null;
    }
  }

  function scheduleHideHeaderBubble(delayMs) {
    if (hideBubbleTimer) clearTimeout(hideBubbleTimer);
    hideBubbleTimer = setTimeout(() => {
      hideBubbleTimer = null;
      hideHeaderBubble();
    }, delayMs);
  }

  function showHeaderBubble(btn, customText, autoHideMs) {
    if (!headerBubble || !btn || (!HEADER_TOOLTIP_LABELS[btn.id] && !customText)) {
      return;
    }
    if (hideBubbleTimer) {
      clearTimeout(hideBubbleTimer);
      hideBubbleTimer = null;
    }
    const labelText =
      customText ||
      (btn.id === "btnSummary" && state.isSummarizing
        ? "⏳ 회의록 생성중 입니다"
        : HEADER_TOOLTIP_LABELS[btn.id]);
    headerBubble.textContent = labelText;
    headerBubble.setAttribute("data-open", "true");
    headerBubble.setAttribute("aria-hidden", "false");
    if (headerBubbleOwner && headerBubbleOwner !== btn) {
      headerBubbleOwner.removeAttribute("aria-describedby");
    }
    headerBubbleOwner = btn;
    btn.setAttribute("aria-describedby", headerBubble.id);

    const rect = btn.getBoundingClientRect();
    const bubbleRect = headerBubble.getBoundingClientRect();
    const btnCenterX = rect.left + rect.width / 2;
    const minLeft = 8;
    const maxLeft = Math.max(minLeft, window.innerWidth - bubbleRect.width - 8);
    const clampedLeft = Math.min(
      maxLeft,
      Math.max(minLeft, btnCenterX - bubbleRect.width / 2)
    );
    const arrowX = Math.min(
      bubbleRect.width - 12,
      Math.max(12, btnCenterX - clampedLeft)
    );

    headerBubble.style.left = `${clampedLeft}px`;
    headerBubble.style.top = `${rect.bottom + 8}px`;
    headerBubble.style.setProperty("--arrow-x", `${arrowX}px`);

    if (autoHideMs) {
      scheduleHideHeaderBubble(autoHideMs);
    }
  }

  function setupHeaderSpeechBubbleTooltips() {
    let bubble = document.getElementById("headerSpeechBubble");
    if (!bubble) {
      bubble = document.createElement("div");
      bubble.id = "headerSpeechBubble";
      bubble.className = "header-speech-bubble";
      bubble.setAttribute("role", "tooltip");
      bubble.setAttribute("aria-hidden", "true");
      document.body.appendChild(bubble);
    }
    headerBubble = bubble;

    Object.keys(HEADER_TOOLTIP_LABELS).forEach((id) => {
      const btn = document.getElementById(id);
      if (!btn || btn.dataset.speechBubbleBound === "true") return;
      btn.dataset.speechBubbleBound = "true";
      // Pointer events only (mouseenter + pointerenter used to fire showHeaderBubble twice).
      btn.addEventListener("pointerenter", (e) => {
        if (e.pointerType !== "touch") showHeaderBubble(btn);
      });
      btn.addEventListener("pointerleave", (e) => {
        if (e.pointerType !== "touch") scheduleHideHeaderBubble(120);
      });
      btn.addEventListener("pointerdown", (e) => {
        if (e.pointerType === "touch") {
          showHeaderBubble(btn);
          scheduleHideHeaderBubble(1800);
        }
      });
      btn.addEventListener("focus", () => {
        if (btn.matches(":focus-visible")) showHeaderBubble(btn);
      });
      btn.addEventListener("blur", () => scheduleHideHeaderBubble(120));
    });

    bubble.addEventListener("pointerenter", () => {
      if (hideBubbleTimer) {
        clearTimeout(hideBubbleTimer);
        hideBubbleTimer = null;
      }
    });
    bubble.addEventListener("pointerleave", () => {
      scheduleHideHeaderBubble(120);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") hideHeaderBubble();
    });
  }

  // Boot application
  document.addEventListener("DOMContentLoaded", initApp);
})();
