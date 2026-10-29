import AVFoundation
import SwiftUI
import UIKit
import WebKit

struct ContentView: View {
    @AppStorage("live_translate_server_url")
    private var serverURLString: String = ""

    @State private var showQRScannerSheet = false
    @State private var showManualInput = false
    @State private var draftURLString = ""
    @State private var scanErrorMessage: String?
    @State private var reloadTrigger = UUID()
    /// Server URL awaiting user confirmation (non-*.run.app host from QR / deep link / manual input).
    @State private var pendingServerURL: String?
    @State private var scannerResetToken = UUID()

    var body: some View {
        ZStack(alignment: .topTrailing) {
            if serverURLString.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                // Initial state when no server URL has been scanned yet
                VStack(spacing: 20) {
                    Image(systemName: "qrcode.viewfinder")
                        .font(.system(size: 64, weight: .regular))
                        .foregroundColor(.blue)

                    Text("Live Translate 서버 연결")
                        .font(.title2.bold())

                    Text("백엔드 서버 주소(https://...run.app)가 담긴\nQR 코드를 카메라로 스캔하면 즉시 연결됩니다.")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 28)

                    Button {
                        scanErrorMessage = nil
                        draftURLString = serverURLString
                        showQRScannerSheet = true
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "camera.viewfinder")
                            Text("QR 코드 스캔하여 연결")
                                .fontWeight(.semibold)
                        }
                        .padding(.horizontal, 24)
                        .padding(.vertical, 14)
                        .background(Color.blue)
                        .foregroundColor(.white)
                        .clipShape(Capsule())
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color(.systemGroupedBackground))
            } else {
                LiveTranslateWebView(urlString: serverURLString, reloadTrigger: reloadTrigger)
                    .ignoresSafeArea(.container, edges: .bottom)
            }

            // Top-right QR button aligned with the header title row so it never covers content
            Button {
                scanErrorMessage = nil
                draftURLString = serverURLString
                showQRScannerSheet = true
            } label: {
                Image(systemName: "qrcode.viewfinder")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(.primary)
                    .padding(9)
                    .background(.ultraThinMaterial)
                    .clipShape(Circle())
                    .shadow(color: .black.opacity(0.12), radius: 3, x: 0, y: 1)
            }
            .padding(.trailing, 12)
            .padding(.top, 8)
            .accessibilityLabel("QR 코드로 서버 연결 설정")
        }
        .onAppear {
            if serverURLString.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                showQRScannerSheet = true
            }
        }
        .onOpenURL { incomingURL in
            if let extracted = Self.extractServerURL(from: incomingURL.absoluteString) {
                requestServerURLChange(extracted)
            }
        }
        .sheet(isPresented: $showQRScannerSheet) {
            NavigationView {
                VStack(spacing: 16) {
                    // Live Camera QR Scanner
                    ZStack {
                        QRCodeScannerRepresentable(resetToken: scannerResetToken) { rawCode in
                            if let validURL = Self.extractServerURL(from: rawCode) {
                                requestServerURLChange(validURL)
                                return true
                            }
                            scanErrorMessage = "유효한 서버 URL QR 코드가 아닙니다 (https:// 주소만 허용): \(rawCode)"
                            return false
                        }
                        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))

                        // Viewfinder frame overlay
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .strokeBorder(Color.white.opacity(0.85), style: StrokeStyle(lineWidth: 2.5, dash: [14, 8]))
                            .frame(width: 220, height: 220)
                    }
                    .frame(height: 320)
                    .padding(.horizontal, 16)
                    .padding(.top, 8)

                    Text("연결할 백엔드 서버 URL QR 코드를 사각형 안에 맞춰주세요.")
                        .font(.footnote)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 20)

                    if let errorMsg = scanErrorMessage {
                        Text(errorMsg)
                            .font(.caption)
                            .foregroundColor(.red)
                            .padding(.horizontal, 20)
                    }

                    if !serverURLString.isEmpty {
                        HStack(spacing: 6) {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundColor(.green)
                                .font(.caption)
                            Text("현재 연결됨: \(serverURLString)")
                                .font(.caption)
                                .foregroundColor(.secondary)
                                .lineLimit(1)
                                .truncationMode(.middle)
                        }
                        .padding(.horizontal, 20)
                    }

                    Divider()
                        .padding(.top, 4)

                    // Optional manual fallback (useful on Xcode Simulator without camera)
                    DisclosureGroup("직접 URL 입력 (시뮬레이터/수동 설정)", isExpanded: $showManualInput) {
                        VStack(spacing: 10) {
                            TextField("https://live-translate-xxx.run.app", text: $draftURLString)
                                .keyboardType(.URL)
                                .textInputAutocapitalization(.never)
                                .disableAutocorrection(true)
                                .textFieldStyle(.roundedBorder)
                                .padding(.top, 6)

                            Button {
                                if let validURL = Self.extractServerURL(from: draftURLString) {
                                    requestServerURLChange(validURL)
                                } else {
                                    scanErrorMessage = "https://로 시작하는 올바른 주소를 입력해주세요."
                                }
                            } label: {
                                Text("주소 저장 및 연결")
                                    .font(.subheadline.weight(.semibold))
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 10)
                                    .background(Color.blue)
                                    .foregroundColor(.white)
                                    .clipShape(RoundedRectangle(cornerRadius: 10))
                            }
                        }
                    }
                    .font(.footnote)
                    .padding(.horizontal, 20)

                    Spacer()
                }
                .navigationTitle("QR 코드로 서버 연결")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("닫기") {
                            showQRScannerSheet = false
                        }
                    }
                }
            }
            .alert(
                "이 서버에 연결할까요?",
                isPresented: confirmationBinding(whenSheetVisible: true),
                presenting: pendingServerURL
            ) { url in
                confirmationButtons(for: url)
            } message: { url in
                confirmationMessage(for: url)
            }
        }
        .alert(
            "이 서버에 연결할까요?",
            isPresented: confirmationBinding(whenSheetVisible: false),
            presenting: pendingServerURL
        ) { url in
            confirmationButtons(for: url)
        } message: { url in
            confirmationMessage(for: url)
        }
    }

    // MARK: - Server URL change (with confirmation for non-Cloud Run hosts)

    private func confirmationBinding(whenSheetVisible: Bool) -> Binding<Bool> {
        Binding(
            get: { pendingServerURL != nil && showQRScannerSheet == whenSheetVisible },
            set: { presented in
                if !presented && pendingServerURL != nil && showQRScannerSheet == whenSheetVisible {
                    pendingServerURL = nil
                    scannerResetToken = UUID()
                }
            }
        )
    }

    @ViewBuilder
    private func confirmationButtons(for url: String) -> some View {
        Button("연결") {
            pendingServerURL = nil
            applyScannedServerURL(url)
        }
        Button("취소", role: .cancel) {
            pendingServerURL = nil
            scannerResetToken = UUID()
        }
    }

    private func confirmationMessage(for url: String) -> Text {
        Text("\(url)\n\nCloud Run(*.run.app) 주소가 아닙니다. 이 서버는 마이크 음성을 받게 됩니다. 신뢰할 수 있는 서버인 경우에만 연결하세요.")
    }

    /// Applies immediately for trusted Cloud Run hosts; otherwise asks for confirmation first.
    private func requestServerURLChange(_ validURL: String) {
        if Self.isTrustedServerHost(validURL) {
            applyScannedServerURL(validURL)
        } else {
            pendingServerURL = validURL
        }
    }

    static func isTrustedServerHost(_ urlString: String) -> Bool {
        guard let host = URL(string: urlString)?.host?.lowercased() else { return false }
        return host.hasSuffix(".run.app")
    }

    private func applyScannedServerURL(_ validURL: String) {
        let generator = UINotificationFeedbackGenerator()
        generator.notificationOccurred(.success)
        serverURLString = validURL
        draftURLString = validURL
        scanErrorMessage = nil
        reloadTrigger = UUID()
        showQRScannerSheet = false
    }

    /// Parses either a direct `https://...` URL or a `livetranslate://connect?url=...` deep link.
    /// Plain `http://` is accepted only in DEBUG builds (local development servers).
    static func extractServerURL(from raw: String) -> String? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        if trimmed.lowercased().hasPrefix("livetranslate://") {
            guard let components = URLComponents(string: trimmed),
                  let targetParam = components.queryItems?.first(where: { $0.name == "url" })?.value,
                  !targetParam.lowercased().hasPrefix("livetranslate://") else {
                return nil
            }
            return extractServerURL(from: targetParam)
        }

        guard let url = URL(string: trimmed),
              let scheme = url.scheme?.lowercased(),
              let host = url.host, !host.isEmpty else {
            return nil
        }
        #if DEBUG
        guard scheme == "https" || scheme == "http" else { return nil }
        #else
        guard scheme == "https" else { return nil }
        #endif
        return trimmed
    }
}

// MARK: - Native AVFoundation QR Code Scanner

struct QRCodeScannerRepresentable: UIViewControllerRepresentable {
    /// Changing this re-arms the scanner (e.g. after a cancelled confirmation alert).
    var resetToken: UUID
    /// Return `true` if the code was accepted (scanner stops delivering), `false` to keep scanning.
    var onCodeScanned: (String) -> Bool

    func makeUIViewController(context: Context) -> QRScannerViewController {
        let controller = QRScannerViewController()
        controller.onCodeScanned = onCodeScanned
        controller.resetToken = resetToken
        return controller
    }

    func updateUIViewController(_ uiViewController: QRScannerViewController, context: Context) {
        uiViewController.onCodeScanned = onCodeScanned
        if uiViewController.resetToken != resetToken {
            uiViewController.resetToken = resetToken
            uiViewController.rearm()
        }
    }
}

final class QRScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    var onCodeScanned: ((String) -> Bool)?
    var resetToken = UUID()

    private let captureSession = AVCaptureSession()
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private let sessionQueue = DispatchQueue(label: "com.livetranslate.qrscanner")
    private var isSessionConfigured = false  // sessionQueue only
    private var hasDeliveredCode = false
    private var lastRejectedCode: String?
    private let statusLabel = UILabel()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        setupStatusLabel()
        checkPermissionAndConfigure()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        rearm()
        sessionQueue.async { [weak self] in
            guard let self = self, self.isSessionConfigured, !self.captureSession.isRunning else { return }
            self.captureSession.startRunning()
        }
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        sessionQueue.async { [weak self] in
            guard let self = self, self.captureSession.isRunning else { return }
            self.captureSession.stopRunning()
        }
    }

    func rearm() {
        hasDeliveredCode = false
        lastRejectedCode = nil
    }

    private func setupStatusLabel() {
        statusLabel.textColor = .white
        statusLabel.font = .systemFont(ofSize: 14, weight: .medium)
        statusLabel.textAlignment = .center
        statusLabel.numberOfLines = 0
        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(statusLabel)
        NSLayoutConstraint.activate([
            statusLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            statusLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            statusLabel.centerYAnchor.constraint(equalTo: view.centerYAnchor)
        ])
    }

    private func checkPermissionAndConfigure() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            configureSession()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                DispatchQueue.main.async {
                    if granted {
                        self?.configureSession()
                    } else {
                        self?.statusLabel.text = "설정 > Live Translate에서 카메라 접근 권한을 허용해주세요."
                    }
                }
            }
        default:
            statusLabel.text = "설정 > Live Translate에서 카메라 접근 권한을 허용해주세요."
        }
    }

    private func configureSession() {
        let preview = AVCaptureVideoPreviewLayer(session: captureSession)
        preview.frame = view.layer.bounds
        preview.videoGravity = .resizeAspectFill
        view.layer.insertSublayer(preview, at: 0)
        previewLayer = preview

        sessionQueue.async { [weak self] in
            guard let self = self, !self.isSessionConfigured else { return }
            let session = self.captureSession
            session.beginConfiguration()
            guard let videoDevice = AVCaptureDevice.default(for: .video),
                  let videoInput = try? AVCaptureDeviceInput(device: videoDevice),
                  session.canAddInput(videoInput) else {
                session.commitConfiguration()
                DispatchQueue.main.async {
                    self.statusLabel.text = "카메라를 사용할 수 없는 기기입니다.\n아래 '직접 URL 입력'을 사용해주세요."
                }
                return
            }
            session.addInput(videoInput)

            let metadataOutput = AVCaptureMetadataOutput()
            guard session.canAddOutput(metadataOutput) else {
                session.commitConfiguration()
                return
            }
            session.addOutput(metadataOutput)
            metadataOutput.setMetadataObjectsDelegate(self, queue: DispatchQueue.main)
            if metadataOutput.availableMetadataObjectTypes.contains(.qr) {
                metadataOutput.metadataObjectTypes = [.qr]
            }
            session.commitConfiguration()
            self.isSessionConfigured = true
            session.startRunning()
        }
    }

    func metadataOutput(
        _ output: AVCaptureMetadataOutput,
        didOutput metadataObjects: [AVMetadataObject],
        from connection: AVCaptureConnection
    ) {
        guard !hasDeliveredCode,
              let readableObject = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
              readableObject.type == .qr,
              let stringValue = readableObject.stringValue,
              stringValue != lastRejectedCode else {
            return
        }
        hasDeliveredCode = true
        let accepted = onCodeScanned?(stringValue) ?? false
        if !accepted {
            // Keep scanning for another code; ignore the same invalid code while it stays in frame.
            lastRejectedCode = stringValue
            hasDeliveredCode = false
        }
    }
}

struct LiveTranslateWebView: UIViewRepresentable {
    let urlString: String
    let reloadTrigger: UUID

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> WKWebView {
        let contentController = WKUserContentController()
        contentController.add(WeakScriptMessageHandler(context.coordinator.audioBridge), name: "nativeAudio")

        let antiRepetitionScript = """
        (function() {
          const OrigWebSocket = window.WebSocket;
          function norm(s) {
            return (s || '').toLowerCase().replace(/[^a-z0-9가-힣\\u3040-\\u30ff\\u4e00-\\u9fff]+/g, ' ').trim();
          }
          function isRepeatingSequence(chunks, candidateText, accText) {
            const c = norm(candidateText);
            if (!c) return false;
            const next = chunks.concat([c]);
            const n = next.length;
            // Match consecutive n-gram phrase/sentence loops across turns (k=1..6 chunks)
            for (let k = 1; k <= 6; k++) {
              if (n >= k * 2) {
                let match = true;
                let totalLen = 0;
                for (let i = 0; i < k; i++) {
                  totalLen += next[n - 1 - i].length;
                  if (next[n - 1 - i] !== next[n - 1 - k - i]) {
                    match = false;
                    break;
                  }
                }
                if (match && ((k >= 2 && totalLen >= 8) || totalLen >= 10)) {
                  return true;
                }
              }
            }
            if (c.length >= 12) {
              const tail = norm(accText.slice(-160));
              if (tail.endsWith(c)) {
                return true;
              }
            }
            return false;
          }

          function stopEchoPlayback() {
            try {
              if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.nativeAudio) {
                window.webkit.messageHandlers.nativeAudio.postMessage({ action: 'stopPlayback' });
              }
            } catch (_) {}
          }

          window.WebSocket = function(url, protocols) {
            let finalUrl = url;
            if (typeof finalUrl === 'string' && finalUrl.includes('/ws/translate')) {
              finalUrl = finalUrl.replace('echo_target_language=true', 'echo_target_language=false');
            }
            const ws = protocols ? new OrigWebSocket(finalUrl, protocols) : new OrigWebSocket(finalUrl);
            if (typeof finalUrl === 'string' && finalUrl.includes('/ws/translate')) {
              let inChunks = [];
              let outChunks = [];
              let accIn = '';
              let accOut = '';
              let dropAudioUntil = 0;

              ws.addEventListener('message', function(ev) {
                if (typeof ev.data !== 'string') return;
                try {
                  const msg = JSON.parse(ev.data);
                  if (msg.type === 'turn_complete') {
                    // CRITICAL: Do NOT clear inChunks/outChunks on turn_complete so cross-turn
                    // speaker echoes are immediately detected on the next turn!
                    dropAudioUntil = 0;
                    return;
                  }
                  if (msg.type === 'input_transcription' && !msg.interim && msg.text) {
                    if (isRepeatingSequence(inChunks, msg.text, accIn)) {
                      ev.stopImmediatePropagation();
                      dropAudioUntil = Date.now() + 2500;
                      stopEchoPlayback();
                      return;
                    }
                    const c = norm(msg.text);
                    if (c) {
                      inChunks.push(c);
                      if (inChunks.length > 16) inChunks.shift();
                    }
                    accIn = (accIn + ' ' + msg.text).slice(-300);
                  } else if (msg.type === 'output_transcription' && msg.text) {
                    if (isRepeatingSequence(outChunks, msg.text, accOut)) {
                      ev.stopImmediatePropagation();
                      dropAudioUntil = Date.now() + 2500;
                      stopEchoPlayback();
                      return;
                    }
                    const c = norm(msg.text);
                    if (c) {
                      outChunks.push(c);
                      if (outChunks.length > 16) outChunks.shift();
                    }
                    accOut = (accOut + ' ' + msg.text).slice(-300);
                  } else if (msg.type === 'audio_output') {
                    if (Date.now() < dropAudioUntil) {
                      ev.stopImmediatePropagation();
                      return;
                    }
                  }
                } catch (_) {}
              }, true);
            }
            return ws;
          };
          window.WebSocket.prototype = OrigWebSocket.prototype;
          window.WebSocket.CONNECTING = OrigWebSocket.CONNECTING;
          window.WebSocket.OPEN = OrigWebSocket.OPEN;
          window.WebSocket.CLOSING = OrigWebSocket.CLOSING;
          window.WebSocket.CLOSED = OrigWebSocket.CLOSED;
        })();
        """
        contentController.addUserScript(
            WKUserScript(
                source: antiRepetitionScript,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
        )

        let footerLayoutScript = """
        (function() {
          const style = document.createElement('style');
          style.textContent = `
            .app-shell {
              grid-template-rows: auto auto minmax(0, 1fr) auto !important;
            }
            .app-footer {
              display: flex;
              align-items: center;
              justify-content: center;
              min-block-size: 1.15rem;
              padding-block: 0.2rem 0;
            }
            #toastMessage, .toast-snackbar {
              position: static !important;
              inset: auto !important;
              transform: none !important;
              max-inline-size: 100% !important;
              padding: 0.1rem 0.25rem !important;
              border-radius: 0 !important;
              background: transparent !important;
              color: #80868b !important;
              font-size: 0.72rem !important;
              font-weight: 400 !important;
              line-height: 1.3 !important;
              text-align: center !important;
              box-shadow: none !important;
              pointer-events: none !important;
              white-space: nowrap !important;
              overflow: hidden !important;
              text-overflow: ellipsis !important;
            }
            #audioOutputToggleLabel[data-earphone-connected="false"] {
              opacity: 0.55;
            }
            #btnLogout, .btn-logout {
              display: none !important;
            }
            .lang-label {
              position: relative !important;
              display: flex !important;
              align-items: center !important;
              block-size: 1.15rem !important;
              min-block-size: 1.15rem !important;
              max-block-size: 1.15rem !important;
              line-height: 1 !important;
              white-space: nowrap !important;
              overflow: hidden !important;
            }
            .detected-chip {
              position: absolute !important;
              inset-inline-end: 0 !important;
              inset-block-start: 50% !important;
              transform: translateY(-50%) !important;
              margin-inline-start: 0 !important;
              font-size: 0.64rem !important;
              line-height: 1 !important;
              padding: 0.12rem 0.38rem !important;
              box-shadow: -6px 0 4px 2px var(--bg-white, #ffffff) !important;
              white-space: nowrap !important;
            }
            .detected-chip[hidden] {
              display: none !important;
            }
            @media (max-width: 640px) {
              .source-lang-box:has(#detectedLangChip:not([hidden])) .lang-word-optional {
                display: none !important;
              }
            }
            .header-speech-bubble {
              position: fixed;
              inset: auto;
              z-index: 9999;
              padding: 0.38rem 0.68rem;
              border-radius: 8px;
              background: rgba(32, 33, 36, 0.94);
              color: #ffffff;
              font-size: 0.74rem;
              font-weight: 600;
              line-height: 1.3;
              white-space: nowrap;
              box-shadow: 0 4px 14px rgba(0, 0, 0, 0.22);
              opacity: 0;
              visibility: hidden;
              transform: translateY(-3px);
              transition: opacity 0.14s ease, transform 0.14s ease, visibility 0.14s ease;
              pointer-events: auto;
            }
            .header-speech-bubble[data-open="true"] {
              opacity: 1;
              visibility: visible;
              transform: translateY(0);
            }
            .header-speech-bubble::before {
              content: '';
              position: absolute;
              top: -5px;
              left: var(--arrow-x, 50%);
              transform: translateX(-50%);
              border-left: 6px solid transparent;
              border-right: 6px solid transparent;
              border-bottom: 6px solid rgba(32, 33, 36, 0.94);
            }
          `;
          document.head.appendChild(style);

          const btnLogout = document.getElementById('btnLogout');
          if (btnLogout) {
            btnLogout.remove();
          }

          // Speech bubble tooltip for icon-only header action buttons
          let bubble = document.getElementById('headerSpeechBubble');
          if (!bubble) {
            bubble = document.createElement('div');
            bubble.id = 'headerSpeechBubble';
            bubble.className = 'header-speech-bubble';
            document.body.appendChild(bubble);
          }

          const tooltipLabels = {
            btnSummary: '✨ AI 회의 요약 (.md 저장)',
            btnOpenDownload: '📥 원문/번역문 저장 (.md)',
            btnClear: '🗑️ 대화 기록 초기화'
          };

          function isSummaryInProgress() {
            const icon = document.getElementById('summaryBtnIcon');
            return Boolean(window.__isSummarizing || (icon && icon.textContent === 'hourglass_top'));
          }

          let hideBubbleTimer = null;
          function showHeaderBubble(btn, customText, autoHideMs) {
            if (!btn || (!tooltipLabels[btn.id] && !customText)) return;
            if (hideBubbleTimer) {
              clearTimeout(hideBubbleTimer);
              hideBubbleTimer = null;
            }
            const labelText =
              customText ||
              (btn.id === 'btnSummary' && isSummaryInProgress()
                ? '⏳ 회의록 생성중 입니다'
                : tooltipLabels[btn.id]);
            bubble.textContent = labelText;
            bubble.setAttribute('data-open', 'true');

            const rect = btn.getBoundingClientRect();
            const bubbleRect = bubble.getBoundingClientRect();
            const btnCenterX = rect.left + rect.width / 2;
            const minLeft = 8;
            const maxLeft = Math.max(minLeft, window.innerWidth - bubbleRect.width - 8);
            const clampedLeft = Math.min(maxLeft, Math.max(minLeft, btnCenterX - bubbleRect.width / 2));
            const arrowX = Math.min(bubbleRect.width - 12, Math.max(12, btnCenterX - clampedLeft));

            bubble.style.left = clampedLeft + 'px';
            bubble.style.top = (rect.bottom + 8) + 'px';
            bubble.style.setProperty('--arrow-x', arrowX + 'px');

            if (autoHideMs) {
              scheduleHideHeaderBubble(autoHideMs);
            }
          }
          window.__showHeaderBubbleFor = showHeaderBubble;

          function scheduleHideHeaderBubble(delayMs) {
            if (hideBubbleTimer) clearTimeout(hideBubbleTimer);
            hideBubbleTimer = setTimeout(function() {
              bubble.setAttribute('data-open', 'false');
            }, delayMs);
          }

          // Keep #btnSummary interactive (never disabled) while summarizing so re-pressing it shows "⏳ 회의록 생성중 입니다"
          const origFetch = window.fetch;
          window.fetch = function(input, init) {
            const urlStr = typeof input === 'string' ? input : (input && input.url ? input.url : '');
            if (urlStr.includes('/api/summarize')) {
              window.__isSummarizing = true;
              const btnSummary = document.getElementById('btnSummary');
              if (btnSummary) {
                btnSummary.disabled = false;
                showHeaderBubble(btnSummary, '⏳ 회의록 생성중 입니다', 2500);
              }
              return origFetch.apply(this, arguments).finally(function() {
                window.__isSummarizing = false;
              });
            }
            return origFetch.apply(this, arguments);
          };

          document.addEventListener('click', function(e) {
            const target = e.target;
            if (!target || typeof target.closest !== 'function') return;
            const btnSummary = target.closest('#btnSummary');
            if (btnSummary && isSummaryInProgress()) {
              btnSummary.disabled = false;
              e.preventDefault();
              e.stopImmediatePropagation();
              showHeaderBubble(btnSummary, '⏳ 회의록 생성중 입니다', 2200);
              const t = document.getElementById('toastMessage');
              if (t) {
                t.textContent = '⏳ 회의록 생성중 입니다';
                t.hidden = false;
              }
            }
          }, true);

          ['btnSummary', 'btnOpenDownload', 'btnClear'].forEach(function(id) {
            const btn = document.getElementById(id);
            if (!btn) return;
            btn.addEventListener('mouseenter', function() { showHeaderBubble(btn); });
            btn.addEventListener('pointerenter', function() { showHeaderBubble(btn); });
            btn.addEventListener('focus', function() { showHeaderBubble(btn); });
            btn.addEventListener('mouseleave', function() { scheduleHideHeaderBubble(120); });
            btn.addEventListener('pointerleave', function() { scheduleHideHeaderBubble(120); });
            btn.addEventListener('blur', function() { scheduleHideHeaderBubble(120); });
            btn.addEventListener('touchstart', function() {
              showHeaderBubble(btn);
              scheduleHideHeaderBubble(1800);
            }, { passive: true });
          });

          bubble.addEventListener('mouseenter', function() {
            if (hideBubbleTimer) {
              clearTimeout(hideBubbleTimer);
              hideBubbleTimer = null;
            }
          });
          bubble.addEventListener('mouseleave', function() {
            scheduleHideHeaderBubble(120);
          });
          document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
              bubble.setAttribute('data-open', 'false');
            }
          });

          const srcLabel = document.querySelector('.source-lang-box .lang-label');
          if (srcLabel && !srcLabel.querySelector('.lang-word-optional')) {
            for (const node of Array.from(srcLabel.childNodes)) {
              if (node.nodeType === Node.TEXT_NODE && node.textContent.includes('Source')) {
                const span = document.createElement('span');
                span.className = 'lang-label-text';
                span.innerHTML = 'Source <span class="lang-word-optional">Language</span>';
                srcLabel.replaceChild(span, node);
                break;
              }
            }
          }

          const shell = document.querySelector('.app-shell');
          const toast = document.getElementById('toastMessage');
          if (shell && toast && !toast.closest('.app-footer')) {
            let footer = shell.querySelector('.app-footer');
            if (!footer) {
              footer = document.createElement('footer');
              footer.className = 'app-footer';
              footer.id = 'appFooter';
              shell.appendChild(footer);
            }
            footer.appendChild(toast);
          }

          // Bridge <a href="blob:..." download="..."> clicks to native iOS Share / Save to Files sheet
          const origAnchorClick = HTMLAnchorElement.prototype.click;
          HTMLAnchorElement.prototype.click = function() {
            const href = this.getAttribute('href') || this.href || '';
            const downloadName = this.getAttribute('download') || this.download || '';
            if (
              downloadName &&
              href.startsWith('blob:') &&
              window.webkit &&
              window.webkit.messageHandlers &&
              window.webkit.messageHandlers.nativeAudio
            ) {
              fetch(href)
                .then(function(res) { return res.text(); })
                .then(function(text) {
                  window.webkit.messageHandlers.nativeAudio.postMessage({
                    action: 'downloadFile',
                    filename: downloadName,
                    content: text
                  });
                })
                .catch(function() {});
              return;
            }
            return origAnchorClick.apply(this, arguments);
          };

          window.__nativeEarphoneConnected = false;

          window.__syncNativeEarphoneUI = function(connected, blockedAttempt, msg) {
            window.__nativeEarphoneConnected = Boolean(connected);
            const toggle = document.getElementById('toggleAudioOutput');
            const label = document.getElementById('audioOutputToggleLabel');
            const icon = document.getElementById('audioOutputIcon');
            if (label) {
              label.setAttribute('data-earphone-connected', connected ? 'true' : 'false');
            }
            if (!connected && toggle && toggle.checked) {
              toggle.checked = false;
              toggle.dispatchEvent(new Event('change', { bubbles: true }));
              if (label) label.setAttribute('data-active', 'false');
              if (icon) icon.textContent = 'volume_off';
            }
            const t = document.getElementById('toastMessage');
            if (t && msg) {
              t.textContent = msg;
              t.hidden = false;
              t.classList.add('show');
            }
          };

          document.addEventListener('click', function(e) {
            const target = e.target;
            if (!target || typeof target.closest !== 'function') return;
            const label = target.closest('#audioOutputToggleLabel');
            const isToggle = target.id === 'toggleAudioOutput' || Boolean(label);
            if (!isToggle) return;
            if (!window.__nativeEarphoneConnected) {
              const toggle = document.getElementById('toggleAudioOutput');
              const icon = document.getElementById('audioOutputIcon');
              e.preventDefault();
              e.stopImmediatePropagation();
              if (toggle) toggle.checked = false;
              if (label) label.setAttribute('data-active', 'false');
              if (icon) icon.textContent = 'volume_off';
              if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.nativeAudio) {
                window.webkit.messageHandlers.nativeAudio.postMessage({
                  action: 'checkRoute',
                  blockedAttempt: true
                });
              }
            }
          }, true);

          document.addEventListener('change', function(e) {
            const target = e.target;
            if (!target || target.id !== 'toggleAudioOutput') return;
            if (!window.__nativeEarphoneConnected && target.checked) {
              const label = document.getElementById('audioOutputToggleLabel');
              const icon = document.getElementById('audioOutputIcon');
              target.checked = false;
              e.preventDefault();
              e.stopImmediatePropagation();
              if (label) label.setAttribute('data-active', 'false');
              if (icon) icon.textContent = 'volume_off';
              if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.nativeAudio) {
                window.webkit.messageHandlers.nativeAudio.postMessage({
                  action: 'checkRoute',
                  blockedAttempt: true
                });
              }
            }
          }, true);

          function requestInitialRouteCheck() {
            if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.nativeAudio) {
              window.webkit.messageHandlers.nativeAudio.postMessage({
                action: 'checkRoute',
                blockedAttempt: false
              });
            }
          }
          requestInitialRouteCheck();
          setTimeout(requestInitialRouteCheck, 300);
        })();
        """
        contentController.addUserScript(
            WKUserScript(
                source: footerLayoutScript,
                injectionTime: .atDocumentEnd,
                forMainFrameOnly: true
            )
        )

        let config = WKWebViewConfiguration()
        config.userContentController = contentController
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.scrollView.bounces = false
        webView.allowsBackForwardNavigationGestures = false
        webView.navigationDelegate = context.coordinator
        context.coordinator.audioBridge.webView = webView
        context.coordinator.loadIfNeeded(webView: webView, urlString: urlString, trigger: reloadTrigger)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.loadIfNeeded(webView: webView, urlString: urlString, trigger: reloadTrigger)
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "nativeAudio")
        webView.navigationDelegate = nil
        webView.stopLoading()
        coordinator.audioBridge.shutdown()
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        let audioBridge = NativeAudioBridge()
        private var lastLoadedURL: String?
        private var lastTrigger: UUID?
        private var serverURL: URL?

        func loadIfNeeded(webView: WKWebView, urlString: String, trigger: UUID) {
            guard lastLoadedURL != urlString || lastTrigger != trigger else { return }
            lastLoadedURL = urlString
            lastTrigger = trigger
            guard let url = URL(string: urlString) else { return }
            serverURL = url
            // Pin the bridge to the configured server origin before any page script can run.
            audioBridge.allowedOrigin = url
            webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData))
        }

        private func isServerOrigin(_ url: URL) -> Bool {
            guard let server = serverURL, let scheme = url.scheme, let host = url.host else { return false }
            return NativeAudioBridge.originMatches(scheme: scheme, host: host, port: url.port ?? 0, allowed: server)
        }

        // MARK: WKNavigationDelegate

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url, let scheme = url.scheme?.lowercased() else {
                decisionHandler(.cancel)
                return
            }
            // In-page resources / sub-frames: the bridge itself rejects non-main-frame messages.
            if ["about", "blob", "data"].contains(scheme) {
                decisionHandler(.allow)
                return
            }
            let isMainFrame = navigationAction.targetFrame?.isMainFrame
            if isMainFrame == false {
                decisionHandler(.allow)
                return
            }
            if isMainFrame == true && isServerOrigin(url) {
                decisionHandler(.allow)
                return
            }
            // Cross-origin top-level navigation, target=_blank / window.open, mailto:, tel:, ... → system handler.
            if navigationAction.navigationType == .linkActivated || isMainFrame == nil
                || scheme == "http" || scheme == "https" || scheme == "mailto" || scheme == "tel" {
                UIApplication.shared.open(url)
            }
            decisionHandler(.cancel)
        }

        func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
            // A new document replaced the page that owned the capture session (reload / same-origin navigation).
            audioBridge.handlePageReset(notify: false)
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            audioBridge.handlePageReset(notify: true)
            if webView.url != nil {
                webView.reload()
            } else if let url = serverURL {
                webView.load(URLRequest(url: url))
            }
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            showLoadError(in: webView, error: error)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            showLoadError(in: webView, error: error)
        }

        private func showLoadError(in webView: WKWebView, error: Error) {
            let nsError = error as NSError
            if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled { return }
            if nsError.domain == "WebKitErrorDomain" && nsError.code == 102 { return }  // frame load interrupted
            guard let server = serverURL else { return }

            func escapeHTML(_ s: String) -> String {
                s.replacingOccurrences(of: "&", with: "&amp;")
                    .replacingOccurrences(of: "<", with: "&lt;")
                    .replacingOccurrences(of: ">", with: "&gt;")
                    .replacingOccurrences(of: "\"", with: "&quot;")
            }
            let html = """
            <!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
            <style>body{font-family:-apple-system,sans-serif;padding:48px 24px;text-align:center;color:#3c4043}
            a{display:inline-block;margin-top:20px;padding:12px 24px;border-radius:24px;background:#1a73e8;color:#fff;text-decoration:none}</style>
            </head><body><h3>서버에 연결할 수 없습니다</h3>
            <p>\(escapeHTML(nsError.localizedDescription))</p>
            <p style="font-size:12px;color:#80868b">\(escapeHTML(server.absoluteString))</p>
            <a href="\(escapeHTML(server.absoluteString))">다시 시도</a></body></html>
            """
            webView.loadHTMLString(html, baseURL: nil)
        }
    }
}
