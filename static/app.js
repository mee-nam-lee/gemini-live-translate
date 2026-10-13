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
    ws: null,
    reconnectTimer: null,
    reconnectAttempts: 0,
    wakeLock: null,

    // Audio Capture Context & Nodes
    audioCtx: null,
    micStream: null,
    captureWorkletNode: null,
    captureScriptNode: null,
    captureSourceNode: null,

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
  };

  let toastTimeoutId = null;

  // =========================================================================
  // 1. Initialization & Config Loading
  // =========================================================================

  async function initApp() {
    bindEventListeners();

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
      a.ko_name.localeCompare(b.ko_name, "ko")
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
      opt.textContent = `${lang.ko_name} (${lang.name} · ${lang.code})`;
      if (lang.code === defaultSource) opt.selected = true;
      dom.sourceLangSelect.appendChild(opt);
    });

    // Populate Target Select (all supported languages without optgroup headers)
    dom.targetLangSelect.innerHTML = "";
    orderedLanguages.forEach((lang) => {
      const opt = document.createElement("option");
      opt.value = lang.code;
      opt.textContent = `${lang.ko_name} (${lang.name} · ${lang.code})`;
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
      return `${entry.ko_name} (${entry.code})`;
    }
    return code;
  }

  function updateLanguageTagsUI() {
    const srcCode = dom.sourceLangSelect.value;
    const tgtCode = dom.targetLangSelect.value;
    dom.sourcePanelLangTag.textContent = formatLanguageLabel(srcCode);
    dom.targetPanelLangTag.textContent = formatLanguageLabel(tgtCode);

    if (srcCode !== "auto" && !state.lastDetectedSourceLang) {
      dom.detectedLangChip.hidden = true;
    }
  }

  // =========================================================================
  // 2. Dialog Fallbacks, Source Collapse & UI Event Listeners
  // =========================================================================

  function setupDialogFallbacks() {
    // Safari fallback for <dialog closedby="any">
    if (!("closedBy" in HTMLDialogElement.prototype)) {
      document.querySelectorAll('dialog[closedby="any"]').forEach((dialog) => {
        dialog.addEventListener("click", (e) => {
          if (e.target === dialog) dialog.close();
        });
      });
    }
  }

  function setupShareButtonVisibility() {
    if (dom.btnShareReport && typeof navigator.share === "function") {
      dom.btnShareReport.hidden = false;
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

  function bindEventListeners() {
    // Primary Mic Start / Stop
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
      updateLanguageTagsUI();
      notifyConfigChangeIfActive();
    });

    dom.targetLangSelect.addEventListener("change", () => {
      updateLanguageTagsUI();
      finalizeActiveCard("target");
      notifyConfigChangeIfActive();
      showToast(
        `Target 언어가 ${formatLanguageLabel(dom.targetLangSelect.value)}(으)로 설정되었습니다.`
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

      updateLanguageTagsUI();
      finalizeActiveCard("source");
      finalizeActiveCard("target");
      notifyConfigChangeIfActive();
      showToast(
        `언어 전환: ${formatLanguageLabel(nextSource)} → ${formatLanguageLabel(nextTarget)}`
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

    // Logout: end any active translation session, clear auth cookie, go to login page
    const btnLogout = document.getElementById("btnLogout");
    if (btnLogout) {
      btnLogout.addEventListener("click", async () => {
        if (!window.confirm("로그아웃하시겠습니까? 진행 중인 통역 세션은 종료됩니다.")) return;
        try {
          if (state.userWantsRecording || state.isRecording) {
            stopTranslationSession(true, "user_logout");
          }
        } catch (_) {}
        try {
          await fetch("/api/logout", { method: "POST", credentials: "same-origin" });
        } catch (_) {}
        window.location.replace("/login");
      });
    }

    // Mobile & Tab visibility recovery (iOS Safari AudioContext interruption + Wake Lock + WS reconnect)
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && state.userWantsRecording) {
        resumeAudioContextIfNeeded();
        requestScreenWakeLock();
        if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
          scheduleWebSocketReconnect(100);
        }
      }
    });

    // Bluetooth headset / AirPods / Galaxy Buds plug & unplug auto-recovery
    if (navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener("devicechange", async () => {
        if (state.userWantsRecording) {
          try {
            await startMicrophoneCapture();
          } catch (_) {}
        }
      });
    }

    // Explicitly terminate Live API session when closing tab/window
    const handlePageUnload = () => {
      if (state.isRecording || state.ws) {
        stopTranslationSession(true, "page_unload");
      }
    };
    window.addEventListener("pagehide", handlePageUnload);
    window.addEventListener("beforeunload", handlePageUnload);
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
          echo_target_language: true,
        })
      );
    }
  }

  // =========================================================================
  // 3. WebSocket & Live Translation Session Lifecycle (with Mobile Auto-Reconnect)
  // =========================================================================

  async function startTranslationSession() {
    if (state.isRecording) return;

    // If accessed via http://0.0.0.0:8000, redirect to http://localhost:8000 so Secure Context is enabled
    if (window.location.hostname === "0.0.0.0") {
      const targetUrl = `${window.location.protocol}//localhost:${window.location.port || 8000}${window.location.pathname}${window.location.search}`;
      window.location.replace(targetUrl);
      return;
    }

    // Check Secure Context requirement for microphone on mobile/remote browsers
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setSessionStatus("error", "localhost 또는 HTTPS 필요");
      showToast(
        `현재 주소(${window.location.origin})는 브라우저 보안 정책상 마이크가 차단됩니다. http://localhost:${window.location.port || 8000} 또는 HTTPS 주소로 접속해 주세요.`
      );
      return;
    }

    state.userWantsRecording = true;
    state.reconnectAttempts = 0;
    setSessionStatus("connecting", "마이크 및 세션 연결 중...");
    dom.btnToggleMic.disabled = true;

    try {
      await startMicrophoneCapture();
      await requestScreenWakeLock();
      openTranslationWebSocket(false);
    } catch (err) {
      console.error("Failed to start translation session:", err);
      state.userWantsRecording = false;
      dom.btnToggleMic.disabled = false;
      stopMicrophoneCapture();
      setSessionStatus("error", "마이크 권한 실패");
      showToast(
        `마이크를 시작할 수 없습니다: ${err.message || "브라우저 마이크 권한을 허용해 주세요."}`
      );
    }
  }

  function openTranslationWebSocket(isReconnect = false) {
    if (!state.userWantsRecording) return;

    if (state.ws) {
      try {
        state.ws.close();
      } catch (_) {}
      state.ws = null;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const params = new URLSearchParams({
      session_id: CLIENT_SESSION_ID,
      source_lang: dom.sourceLangSelect.value,
      target_lang: dom.targetLangSelect.value,
      echo_target_language: "true",
    });
    const wsUrl = `${protocol}//${window.location.host}/ws/translate?${params.toString()}`;

    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    state.ws = ws;

    ws.addEventListener("open", () => {
      state.isRecording = true;
      state.reconnectAttempts = 0;
      state.lastActivityAt = Date.now();
      dom.btnToggleMic.disabled = false;
      dom.btnToggleMic.setAttribute("data-recording", "true");
      dom.micIcon.textContent = "stop_circle";
      dom.micBtnText.textContent = "통역 종료";
      dom.audioBars.hidden = false;
      if (!state.sessionTimerInterval) {
        startSessionTimer();
      }
      resumeAudioContextIfNeeded();
    });

    ws.addEventListener("message", (event) => {
      handleServerWebSocketMessage(event.data);
    });

    ws.addEventListener("close", (event) => {
      // 4401: server rejected the connection because the login session is missing/expired
      if (event && event.code === 4401) {
        stopTranslationSession(false, "auth_expired");
        showToast("로그인 세션이 만료되었습니다. 다시 로그인해 주세요.");
        setTimeout(() => window.location.replace("/login"), 800);
        return;
      }
      if (!state.userWantsRecording) return;
      state.isRecording = false;
      scheduleWebSocketReconnect();
    });

    ws.addEventListener("error", () => {
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
      // Ensure mic track is still live (iOS may end track after backgrounding)
      const trackLive = state.micStream
        ?.getAudioTracks()
        .some((t) => t.readyState === "live");
      if (!trackLive) {
        try {
          await startMicrophoneCapture();
        } catch (_) {}
      }
      openTranslationWebSocket(true);
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

    dom.btnToggleMic.disabled = false;
    dom.btnToggleMic.setAttribute("data-recording", "false");
    dom.micIcon.textContent = "mic";
    dom.micBtnText.textContent = "통역 시작";
    dom.audioBars.hidden = true;
    resetVisualizerBars();

    stopSessionTimer();
    releaseScreenWakeLock();
    stopMicrophoneCapture();

    finalizeActiveCard("source");
    finalizeActiveCard("target");

    if (state.ws) {
      try {
        if (sendStopSignal && state.ws.readyState === WebSocket.OPEN) {
          state.ws.send(JSON.stringify({ type: "stop", reason }));
        }
        state.ws.close();
      } catch (_) {}
      state.ws = null;
    }

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
        }
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
      if (state.autoScrollSource) scrollToLatest(dom.sourceScrollArea, false);
    } else {
      state.targetEntries.push(lineObj.entry);
      dom.targetCountBadge.textContent = `${state.targetEntries.length}문장`;
      if (state.autoScrollTarget) scrollToLatest(dom.targetScrollArea, false);
    }

    state.chronologicalEntries.push({
      role: lineObj.entry.role,
      text: lineObj.entry.text,
      timestamp: lineObj.entry.timestamp,
      lang: lineObj.entry.lang,
    });
  }

  function scrollToLatest(containerEl, force) {
    if (!containerEl) return;
    requestAnimationFrame(() => {
      containerEl.scrollTop = containerEl.scrollHeight;
      if (force) {
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
    dom.sourceEmptyState.hidden = false;
    dom.targetEmptyState.hidden = false;
    dom.sourceCountBadge.textContent = "0문장";
    dom.targetCountBadge.textContent = "0문장";
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
  // 5. Smart Microphone Audio Engine (16kHz PCM + Voice Filter + Noise Gate)
  // =========================================================================

  /**
   * Determine whether browser echoCancellation should be enabled:
   * - On iPhone / Android: true (mobile hardware AEC/NS works best while still picking up external speakers/voices).
   * - On Desktop PC: false so the mic also picks up video conference audio coming out of the same PC's speakers.
   */
  function shouldEnableEchoCancellation() {
    return IS_MOBILE_BROWSER;
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

  function resumeAudioContextIfNeeded() {
    if (
      state.audioCtx &&
      (state.audioCtx.state === "suspended" ||
        state.audioCtx.state === "interrupted")
    ) {
      state.audioCtx.resume().catch(() => {});
    }
  }

  async function startMicrophoneCapture() {
    stopMicrophoneCapture(false);

    const audioCtx = ensureAudioContext();
    if (audioCtx.state === "suspended" || audioCtx.state === "interrupted") {
      await audioCtx.resume();
    }

    const wantAEC = shouldEnableEchoCancellation();
    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: wantAEC,
        // Always keep noiseSuppression & autoGainControl ON so background fan/keyboard/room noise
        // is suppressed while human speech (including PC speaker speech) stays crisp.
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    state.micStream = micStream;

    const actualSampleRate = audioCtx.sampleRate;
    const micSource = audioCtx.createMediaStreamSource(micStream);

    // Voice-band Biquad filters to strip low-frequency rumble (<85Hz) and high-frequency hiss (>7500Hz)
    const highpassFilter = audioCtx.createBiquadFilter();
    highpassFilter.type = "highpass";
    highpassFilter.frequency.value = 85;
    highpassFilter.Q.value = 0.707;

    const lowpassFilter = audioCtx.createBiquadFilter();
    lowpassFilter.type = "lowpass";
    lowpassFilter.frequency.value = 7500;
    lowpassFilter.Q.value = 0.707;

    micSource.connect(highpassFilter);
    highpassFilter.connect(lowpassFilter);
    state.captureSourceNode = lowpassFilter;

    // Muted sink node so Web Audio engine pulls audio continuously without speaker feedback
    const muteSink = audioCtx.createGain();
    muteSink.gain.value = 0;
    muteSink.connect(audioCtx.destination);

    // 100ms chunk size at native hardware sampleRate
    const targetChunkSamples = Math.max(
      1024,
      Math.round(actualSampleRate * 0.1)
    );

    if (audioCtx.audioWorklet) {
      try {
        const workletCode = `
          class Pcm16CaptureProcessor extends AudioWorkletProcessor {
            constructor() {
              super();
              this.chunkSize = ${targetChunkSamples};
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

        const workletNode = new AudioWorkletNode(
          audioCtx,
          "pcm16-capture-processor",
          {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [1],
          }
        );
        workletNode.port.onmessage = (e) => {
          processCapturedFloatSamples(e.data, actualSampleRate);
        };

        lowpassFilter.connect(workletNode);
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
      const inputData = event.inputBuffer.getChannelData(0);
      processCapturedFloatSamples(
        new Float32Array(inputData),
        actualSampleRate
      );
    };
    lowpassFilter.connect(scriptNode);
    scriptNode.connect(muteSink);
    state.captureScriptNode = scriptNode;
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
    updateVisualizerBars(rms);

    // Reset 10m inactivity timer when real voice energy is present
    if (rms > 0.008) {
      const now = Date.now();
      state.lastActivityAt = now;
      if (now - state.lastActivityPingAt > 10000) {
        state.lastActivityPingAt = now;
        try {
          state.ws.send(JSON.stringify({ type: "activity" }));
        } catch (_) {}
      }
    }

    // Soft noise gate: attenuate ultra-low background hiss (< 0.0025 RMS) so silent rooms stay clean
    const gateGain = rms < 0.0025 ? 0.15 : 1.0;

    // Resample from native hardware rate (e.g. 48000Hz) to 16000Hz required by Gemini Live API
    const samples16k =
      inputSampleRate === 16000
        ? float32Array
        : downsampleFloat32(float32Array, inputSampleRate, 16000);

    // Convert Float32 [-1.0, 1.0] to 16-bit signed little-endian PCM
    const pcm16Buffer = new ArrayBuffer(samples16k.length * 2);
    const dataView = new DataView(pcm16Buffer);
    for (let i = 0; i < samples16k.length; i++) {
      const gated = samples16k[i] * gateGain;
      const clamped = Math.max(-1, Math.min(1, gated));
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
    if (state.micStream) {
      state.micStream.getTracks().forEach((track) => track.stop());
      state.micStream = null;
    }
    if (closeContext && state.audioCtx) {
      try {
        state.audioCtx.close();
      } catch (_) {}
      state.audioCtx = null;
    }
  }

  function updateVisualizerBars(rms) {
    if (!dom.audioBars || dom.audioBars.hidden) return;
    const bars = dom.audioBars.querySelectorAll(".bar");
    const boost = Math.min(1, rms * 9);
    const multipliers = [0.65, 1.0, 0.85, 0.55];
    bars.forEach((bar, idx) => {
      const heightPx = Math.max(4, Math.round(4 + boost * 13 * multipliers[idx]));
      bar.style.height = `${heightPx}px`;
    });
  }

  function resetVisualizerBars() {
    if (!dom.audioBars) return;
    dom.audioBars.querySelectorAll(".bar").forEach((bar) => {
      bar.style.height = "4px";
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

    if (state.isSummarizing) return;
    state.isSummarizing = true;
    dom.btnSummary.disabled = true;
    if (dom.summaryBtnIcon) dom.summaryBtnIcon.textContent = "hourglass_top";
    if (dom.summaryBtnLabel) dom.summaryBtnLabel.textContent = "회의록 생성 중...";
    showToast("Gemini가 회의록을 생성하고 있습니다...");

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
      dom.btnSummary.disabled = false;
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

  function showToast(message) {
    if (!dom.toastMessage) return;
    dom.toastMessage.textContent = message;
    dom.toastMessage.hidden = false;
    if (toastTimeoutId) clearTimeout(toastTimeoutId);
    toastTimeoutId = setTimeout(() => {
      dom.toastMessage.textContent = "";
      dom.toastMessage.hidden = true;
    }, 3500);
  }

  // Boot application
  document.addEventListener("DOMContentLoaded", initApp);
})();
