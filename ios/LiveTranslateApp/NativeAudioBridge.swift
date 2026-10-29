import AVFoundation
import AVKit
import Foundation
import UIKit
import WebKit

/// Native iOS Audio Engine & AVAudioSession Split-Routing Controller.
///
/// Solves the iOS WebKit Bluetooth HFP lock-in issue by:
/// 1. Configuring `AVAudioSession` with `.playAndRecord` + `.allowBluetoothA2DP` (WITHOUT `.allowBluetooth` HFP),
///    so AirPods remain in high-quality stereo A2DP output-only mode and the AirPods mic is never activated.
/// 2. Leaving `preferredInput = nil` (mode `.default`, no voice processing). Because HFP is not allowed, iOS
///    automatically picks the iPhone built-in mic for input while output stays on AirPods (A2DP) or the speaker.
/// 3. Capturing audio natively via `AVAudioEngine`, resampling to 16kHz mono with a persistent `AVAudioConverter`
///    and streaming 100ms Int16 PCM chunks to JS (`window.__onNativeMicPcm16`), while playing translated PCM
///    audio out to AirPods via `AVAudioPlayerNode` (only when external headphones are connected).
///
/// Threading: all mutable audio state is owned by `audioQueue`. `WKScriptMessageHandler` callbacks and every
/// Swift → JS call run on the main thread. JS strings are always passed through `callAsyncJavaScript(arguments:)`
/// so device names / error messages can never break or inject into the page script.
final class NativeAudioBridge: NSObject, WKScriptMessageHandler {
    /// Main-thread only.
    weak var webView: WKWebView?
    /// Main-thread only. Origin (scheme + host + port) that is allowed to talk to the bridge.
    var allowedOrigin: URL?

    private let audioQueue = DispatchQueue(label: "com.livetranslate.nativeaudio", qos: .userInteractive)

    // MARK: audioQueue-owned state
    private var captureEngine: AVAudioEngine?
    private var playbackEngine: AVAudioEngine?
    private var playerNode: AVAudioPlayerNode?
    private var playerFormat: AVAudioFormat?
    private var engineObservers: [NSObjectProtocol] = []

    /// User intent from JS (startCapture → true, stopCapture → false).
    private var wantsCapture = false
    /// Incremented on every JS start/stop request; a pending permission callback bails out if it changed.
    private var captureIntentID = 0
    /// Incremented whenever engines are (re)built or torn down; stale tap callbacks are dropped.
    private var engineGeneration = 0
    private var isPermissionPending = false
    private var isInterrupted = false
    private var isAppActive = true
    private var pendingRestartToken = 0
    private var didReportPlaybackError = false

    private var audioOutputEnabled = false
    private var isUsingExternalHeadphones = false
    private var lastRouteSignature = ""
    /// Set when the user tapped "번역 음성 듣기" without earphones and the system route picker was shown.
    /// If AirPods / earphones become the output before this deadline, the toggle is switched ON automatically.
    private var pendingOutputEnableDeadline: Date?

    // 100ms chunks (1600 samples @ 16kHz) before dispatching to WKWebView
    private let targetSampleRate: Double = 16000.0
    private let chunkSampleCount = 1600
    private var pcmRing = FloatRingBuffer(capacity: 16000)
    private var chunkScratch = [Float](repeating: 0, count: 1600)
    /// Adaptive gain + soft limiter applied to every outgoing 100ms chunk.
    private var micGain = MicGainProcessor()

    // MARK: main-thread state
    /// Number of mic chunks posted to JS whose evaluation has not completed yet (back-pressure).
    private var pendingMicEvaluations = 0
    private let maxPendingMicEvaluations = 10
    /// Hidden system output picker used to connect AirPods to this iPhone.
    private var routePickerView: AVRoutePickerView?

    private static let shareRootDirectory = FileManager.default.temporaryDirectory
        .appendingPathComponent("share", isDirectory: true)

    override init() {
        super.init()
        setupNotifications()
        try? FileManager.default.removeItem(at: Self.shareRootDirectory)
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    /// Tears down capture synchronously. Call from `dismantleUIView` before the web view goes away.
    func shutdown() {
        audioQueue.sync {
            self.wantsCapture = false
            self.captureIntentID += 1
            self.stopCaptureInternal(deactivateSession: true)
        }
        setIdleTimerDisabled(false)
    }

    /// The page that owned the capture is gone (new document committed, or WebContent process crashed).
    func handlePageReset(notify: Bool) {
        audioQueue.async { [weak self] in
            guard let self = self, self.wantsCapture || self.captureEngine != nil else { return }
            self.wantsCapture = false
            self.captureIntentID += 1
            self.stopCaptureInternal(deactivateSession: true)
            if notify {
                self.notifyCaptureState("stopped", "웹 페이지가 다시 로드되어 통역 수음이 중지되었습니다. 다시 시작해 주세요.")
            }
        }
    }

    // MARK: - WKScriptMessageHandler

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard message.name == "nativeAudio",
              isTrustedFrame(message.frameInfo),
              let body = message.body as? [String: Any],
              let action = body["action"] as? String else {
            return
        }

        switch action {
        case "startCapture":
            // `echoCancellation` is accepted for backward compatibility but intentionally ignored:
            // translated audio is only ever played to in-ear headphones (A2DP), so there is no speaker echo path.
            let wantOutput = (body["audioOutputEnabled"] as? Bool) ?? false
            audioQueue.async { [weak self] in
                self?.startCaptureRequested(audioOutputEnabled: wantOutput)
            }

        case "updateConfig":
            let wantOutput = body["audioOutputEnabled"] as? Bool
            audioQueue.async { [weak self] in
                guard let self = self else { return }
                self.updateConfigInternal(audioOutputEnabled: wantOutput ?? self.audioOutputEnabled)
            }

        case "stopCapture":
            audioQueue.async { [weak self] in
                guard let self = self else { return }
                self.wantsCapture = false
                self.captureIntentID += 1
                self.stopCaptureInternal(deactivateSession: true)
            }

        case "playAudio":
            guard let base64Data = body["data"] as? String else { return }
            let sampleRate = (body["sampleRate"] as? Double) ?? 24000.0
            audioQueue.async { [weak self] in
                self?.scheduleTranslatedPcmPlayback(base64Pcm: base64Data, sampleRate: sampleRate)
            }

        case "stopPlayback":
            audioQueue.async { [weak self] in
                self?.stopPlaybackInternal()
            }

        case "checkRoute":
            let blockedAttempt = (body["blockedAttempt"] as? Bool) ?? false
            audioQueue.async { [weak self] in
                guard let self = self else { return }
                // Only set the category (no activation) so opening the app never interrupts other audio.
                if self.captureEngine == nil {
                    try? self.configureSessionCategory()
                }
                let needsPicker = blockedAttempt
                    && !self.hasExternalHeadphones(in: AVAudioSession.sharedInstance())
                if needsPicker {
                    self.pendingOutputEnableDeadline = Date().addingTimeInterval(90)
                    DispatchQueue.main.async { [weak self] in
                        self?.presentRoutePicker()
                    }
                }
                self.updateFooterRouteStatus(blockedAttempt: blockedAttempt, announce: blockedAttempt)
            }

        case "downloadFile":
            let rawName = (body["filename"] as? String) ?? "live_translate.md"
            let content = (body["content"] as? String) ?? ""
            presentNativeFileShareSheet(filename: rawName, content: content)

        default:
            break
        }
    }

    /// Only the top-level document of the configured server origin may drive the native bridge.
    private func isTrustedFrame(_ frameInfo: WKFrameInfo) -> Bool {
        guard frameInfo.isMainFrame, let allowed = allowedOrigin else { return false }
        let origin = frameInfo.securityOrigin
        return Self.originMatches(
            scheme: origin.protocol, host: origin.host, port: origin.port, allowed: allowed
        )
    }

    static func originMatches(scheme: String, host: String, port: Int, allowed: URL) -> Bool {
        guard let allowedScheme = allowed.scheme?.lowercased(),
              let allowedHost = allowed.host?.lowercased() else {
            return false
        }
        let defaultPort: (String) -> Int = { $0 == "https" ? 443 : ($0 == "http" ? 80 : 0) }
        let normalizedPort = port == 0 ? defaultPort(scheme.lowercased()) : port
        let allowedPort = allowed.port ?? defaultPort(allowedScheme)
        return scheme.lowercased() == allowedScheme
            && host.lowercased() == allowedHost
            && normalizedPort == allowedPort
    }

    // MARK: - Share sheet (main thread)

    private func presentNativeFileShareSheet(filename: String, content: String) {
        var safeName = URL(fileURLWithPath: filename).lastPathComponent
            .replacingOccurrences(of: ":", with: "_")
        while safeName.hasPrefix(".") { safeName.removeFirst() }
        if safeName.isEmpty || safeName == "/" { safeName = "live_translate.md" }

        let shareDir = Self.shareRootDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let fileURL = shareDir.appendingPathComponent(safeName)

        do {
            try FileManager.default.createDirectory(at: shareDir, withIntermediateDirectories: true)
            try content.write(to: fileURL, atomically: true, encoding: .utf8)
        } catch {
            dispatchErrorToJS("파일 생성에 실패했습니다: \(error.localizedDescription)")
            return
        }

        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        guard let scene = scenes.first(where: { $0.activationState == .foregroundActive }) ?? scenes.first,
              let rootVC = scene.windows.first(where: { $0.isKeyWindow })?.rootViewController
                ?? scene.windows.first?.rootViewController else {
            try? FileManager.default.removeItem(at: shareDir)
            return
        }

        var topVC = rootVC
        while let presented = topVC.presentedViewController {
            topVC = presented
        }

        let activityVC = UIActivityViewController(activityItems: [fileURL], applicationActivities: nil)
        activityVC.completionWithItemsHandler = { _, _, _, _ in
            try? FileManager.default.removeItem(at: shareDir)
        }
        if let popover = activityVC.popoverPresentationController {
            popover.sourceView = topVC.view
            popover.sourceRect = CGRect(x: topVC.view.bounds.midX, y: 60, width: 1, height: 1)
        }
        topVC.present(activityVC, animated: true)
    }

    // MARK: - AVAudioSession Split Routing (Input = iPhone Built-In Mic, Output = AirPods A2DP)

    private func hasExternalHeadphones(in session: AVAudioSession) -> Bool {
        for port in session.currentRoute.outputs {
            switch port.portType {
            case .bluetoothA2DP, .bluetoothLE, .bluetoothHFP, .headphones, .usbAudio, .airPlay:
                return true
            default:
                break
            }
        }
        return false
    }

    /// Sets the category only. Does NOT activate the session (activation would stop other apps' audio).
    private func configureSessionCategory() throws {
        // `.allowBluetooth` (HFP) is intentionally omitted so the AirPods mic is never used.
        let options: AVAudioSession.CategoryOptions = [.allowBluetoothA2DP, .allowAirPlay, .defaultToSpeaker]
        let session = AVAudioSession.sharedInstance()
        if session.category != .playAndRecord || session.mode != .default || session.categoryOptions != options {
            try session.setCategory(.playAndRecord, mode: .default, options: options)
        }
    }

    /// Configures and activates the session. Only called when capture actually starts.
    private func activateCaptureSession() throws {
        let session = AVAudioSession.sharedInstance()
        try configureSessionCategory()
        // Do NOT call `setPreferredInput(builtInMic)`: it pulls the whole route (incl. output) to the iPhone
        // hardware and drops AirPods A2DP output. With HFP disallowed, `nil` already yields the built-in mic.
        try? session.setPreferredInput(nil)
        try? session.overrideOutputAudioPort(.none)
        try? session.setPreferredSampleRate(48000.0)
        try? session.setPreferredIOBufferDuration(0.02)
        try session.setActive(true, options: [])
        isUsingExternalHeadphones = hasExternalHeadphones(in: session)
    }

    // MARK: - Capture lifecycle (audioQueue)

    private func startCaptureRequested(audioOutputEnabled: Bool) {
        wantsCapture = true
        captureIntentID += 1
        self.audioOutputEnabled = audioOutputEnabled
        let intent = captureIntentID

        switch AVAudioApplication.shared.recordPermission {
        case .granted:
            startInitialPipeline()
        case .denied:
            wantsCapture = false
            reportPermissionDenied()
        default:
            isPermissionPending = true
            AVAudioApplication.requestRecordPermission { [weak self] granted in
                self?.audioQueue.async {
                    guard let self = self else { return }
                    self.isPermissionPending = false
                    // The user may have pressed Stop (or started again) while the dialog was up.
                    guard self.wantsCapture, intent == self.captureIntentID else { return }
                    if granted {
                        self.startInitialPipeline()
                    } else {
                        self.wantsCapture = false
                        self.reportPermissionDenied()
                    }
                }
            }
        }
    }

    private func startInitialPipeline() {
        if !startEnginePipeline(reportErrors: true) {
            wantsCapture = false
            notifyCaptureState("error", "iOS 오디오 엔진을 시작하지 못했습니다.")
        }
    }

    private func reportPermissionDenied() {
        let msg = "아이폰 마이크 권한이 거부되었습니다. 설정 > 개인정보 보호 및 보안 > 마이크에서 허용해 주세요."
        dispatchErrorToJS(msg)
        notifyCaptureState("error", msg)
    }

    @discardableResult
    private func startEnginePipeline(reportErrors: Bool = true) -> Bool {
        stopEngineNodesOnly()
        guard wantsCapture else { return false }
        engineGeneration += 1
        let generation = engineGeneration

        do {
            try activateCaptureSession()

            // Enforce: "번역 음성 듣기" is only allowed when external earphones (AirPods) are connected
            var blockedSpeakerOutput = false
            if audioOutputEnabled && !isUsingExternalHeadphones {
                audioOutputEnabled = false
                blockedSpeakerOutput = true
            }

            // 1. Dedicated capture engine (input only, so output route changes never stall mic capture)
            let capEngine = AVAudioEngine()
            let inputNode = capEngine.inputNode
            let tapFormat = inputNode.outputFormat(forBus: 0)
            guard tapFormat.sampleRate > 0, tapFormat.channelCount > 0,
                  let outFormat = AVAudioFormat(
                    commonFormat: .pcmFormatFloat32, sampleRate: targetSampleRate, channels: 1, interleaved: false
                  ),
                  let converter = AVAudioConverter(from: tapFormat, to: outFormat) else {
                throw NSError(
                    domain: "NativeAudioBridge", code: 1,
                    userInfo: [NSLocalizedDescriptionKey: "유효한 오디오 입력 포맷을 찾을 수 없습니다."]
                )
            }
            if tapFormat.channelCount > 1 {
                converter.downmix = true
            }

            pcmRing.removeAll()
            micGain.reset()

            // The tap block runs serially on one AVAudioEngine thread, so the converter (captured locally,
            // never shared) keeps its filter state across buffers without locking.
            inputNode.installTap(onBus: 0, bufferSize: 4800, format: tapFormat) { [weak self] buffer, _ in
                guard let samples = Self.resample(buffer, with: converter, to: outFormat) else { return }
                self?.audioQueue.async {
                    self?.appendCapturedSamples(samples, generation: generation)
                }
            }

            capEngine.prepare()
            try capEngine.start()

            // 2. Dedicated playback engine (output only, never touches inputNode)
            let playEngine = AVAudioEngine()
            let player = AVAudioPlayerNode()
            let playbackFmt = AVAudioFormat(standardFormatWithSampleRate: 24000.0, channels: 1)!
            playEngine.attach(player)
            playEngine.connect(player, to: playEngine.mainMixerNode, format: playbackFmt)
            playEngine.prepare()
            do {
                try playEngine.start()
            } catch {
                reportPlaybackError(error)
            }

            captureEngine = capEngine
            playbackEngine = playEngine
            playerNode = player
            playerFormat = playbackFmt
            observeEngineConfigurationChanges(capEngine, playEngine)
            setIdleTimerDisabled(true)

            updateFooterRouteStatus(blockedAttempt: blockedSpeakerOutput, announce: true)
            return true
        } catch {
            stopEngineNodesOnly()
            if reportErrors {
                dispatchErrorToJS("iOS 오디오 엔진 시작 실패: \(error.localizedDescription)")
            }
            return false
        }
    }

    /// Converts one tap buffer to 16kHz mono Float32 using the persistent converter.
    private static func resample(
        _ buffer: AVAudioPCMBuffer, with converter: AVAudioConverter, to outFormat: AVAudioFormat
    ) -> [Float]? {
        guard buffer.frameLength > 0, buffer.format.sampleRate > 0 else { return nil }
        let ratio = outFormat.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount((Double(buffer.frameLength) * ratio).rounded(.up)) + 64
        guard let outBuffer = AVAudioPCMBuffer(pcmFormat: outFormat, frameCapacity: capacity) else { return nil }

        var consumed = false
        var conversionError: NSError?
        let status = converter.convert(to: outBuffer, error: &conversionError) { _, inputStatus in
            if consumed {
                inputStatus.pointee = .noDataNow
                return nil
            }
            consumed = true
            inputStatus.pointee = .haveData
            return buffer
        }
        guard status != .error, outBuffer.frameLength > 0,
              let channel = outBuffer.floatChannelData?[0] else {
            return nil
        }
        return Array(UnsafeBufferPointer(start: channel, count: Int(outBuffer.frameLength)))
    }

    private func appendCapturedSamples(_ samples: [Float], generation: Int) {
        guard generation == engineGeneration, captureEngine != nil else { return }
        pcmRing.append(contentsOf: samples)
        while pcmRing.count >= chunkSampleCount {
            pcmRing.pop(into: &chunkScratch, count: chunkSampleCount)
            emit16kPcmChunk(chunkScratch)
        }
    }

    private func updateConfigInternal(audioOutputEnabled wantOutput: Bool) {
        let headphonesConnected = hasExternalHeadphones(in: AVAudioSession.sharedInstance())
        isUsingExternalHeadphones = headphonesConnected

        // Block enabling "번역 음성 듣기" when earphones are not connected
        if wantOutput && !headphonesConnected {
            audioOutputEnabled = false
            stopPlaybackInternal()
            updateFooterRouteStatus(blockedAttempt: true, announce: true)
            return
        }

        // Never reconfigure the session or touch `captureEngine` here (keeps mic capture glitch-free).
        audioOutputEnabled = wantOutput
        if !wantOutput {
            stopPlaybackInternal()
        }
        updateFooterRouteStatus(blockedAttempt: false, announce: false)
    }

    private func stopEngineNodesOnly() {
        for observer in engineObservers {
            NotificationCenter.default.removeObserver(observer)
        }
        engineObservers.removeAll()

        if let capEngine = captureEngine {
            if capEngine.isRunning {
                capEngine.stop()
            }
            capEngine.inputNode.removeTap(onBus: 0)
            capEngine.reset()
        }
        if let playEngine = playbackEngine {
            playerNode?.stop()
            if playEngine.isRunning {
                playEngine.stop()
            }
            playEngine.reset()
        }
        playerNode = nil
        playbackEngine = nil
        captureEngine = nil
        playerFormat = nil
        pcmRing.removeAll()
        // Any in-flight tap callbacks of the old engine are dropped by the generation check.
        engineGeneration += 1
    }

    private func stopCaptureInternal(deactivateSession: Bool) {
        stopEngineNodesOnly()
        isInterrupted = false
        setIdleTimerDisabled(false)
        if deactivateSession {
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }
    }

    private func stopPlaybackInternal() {
        if let player = playerNode, player.isPlaying {
            player.stop()
        }
    }

    // MARK: - 16kHz Int16 PCM upstream dispatch

    private func emit16kPcmChunk(_ samples: [Float]) {
        // Raw iOS mic levels are low (no voice processing / AGC): quiet speech is still boosted up to 2.5x, but loud
        // speech is no longer clipped (never mute mic during simultaneous translation). See MicGainProcessor.
        let (pcm, meterRms) = micGain.process(samples)
        let base64Str = pcm.withUnsafeBytes { Data($0) }.base64EncodedString()
        let rmsValue = Double(meterRms)

        DispatchQueue.main.async { [weak self] in
            guard let self = self, let webView = self.webView else { return }
            // Back-pressure: if the page is not draining (suspended / busy), drop chunks instead of queueing.
            guard self.pendingMicEvaluations < self.maxPendingMicEvaluations else { return }
            self.pendingMicEvaluations += 1
            webView.callAsyncJavaScript(
                "if (window.__onNativeMicPcm16) { window.__onNativeMicPcm16(b, r); }",
                arguments: ["b": base64Str, "r": rmsValue],
                in: nil,
                in: .page
            ) { [weak self] _ in
                self?.pendingMicEvaluations -= 1
            }
        }
    }

    // MARK: - Translated PCM playback (routed to AirPods A2DP only)

    private func scheduleTranslatedPcmPlayback(base64Pcm: String, sampleRate: Double) {
        // Hard guard: never play translated TTS audio if earphones are not connected!
        guard audioOutputEnabled,
              isUsingExternalHeadphones,
              (8000.0...48000.0).contains(sampleRate),
              let playEngine = playbackEngine,
              let player = playerNode,
              let rawData = Data(base64Encoded: base64Pcm) else {
            return
        }

        if playerFormat?.sampleRate != sampleRate {
            guard let newFormat = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1) else { return }
            player.stop()
            playEngine.disconnectNodeOutput(player)
            playEngine.connect(player, to: playEngine.mainMixerNode, format: newFormat)
            playerFormat = newFormat
        }
        guard let fmt = playerFormat else { return }

        let sampleCount = rawData.count / 2
        guard sampleCount > 0,
              let pcmBuffer = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: AVAudioFrameCount(sampleCount)),
              let floatChannel = pcmBuffer.floatChannelData?[0] else {
            return
        }
        pcmBuffer.frameLength = AVAudioFrameCount(sampleCount)

        rawData.withUnsafeBytes { raw in
            for i in 0..<sampleCount {
                let sample = Int16(littleEndian: raw.loadUnaligned(fromByteOffset: i * 2, as: Int16.self))
                floatChannel[i] = Float(sample) / 32768.0
            }
        }

        if !playEngine.isRunning {
            do {
                try playEngine.start()
                didReportPlaybackError = false
            } catch {
                reportPlaybackError(error)
                return
            }
        }
        player.scheduleBuffer(pcmBuffer, completionHandler: nil)
        if !player.isPlaying {
            player.play()
        }
    }

    private func reportPlaybackError(_ error: Error) {
        guard !didReportPlaybackError else { return }
        didReportPlaybackError = true
        dispatchErrorToJS("번역 음성 재생 엔진 시작 실패: \(error.localizedDescription)")
    }

    // MARK: - Route status → JS

    /// - Parameter announce: show a toast message. When false only the earphone-connected state is synced.
    private func updateFooterRouteStatus(blockedAttempt: Bool, announce: Bool) {
        let session = AVAudioSession.sharedInstance()
        let headphonesConnected = hasExternalHeadphones(in: session)
        isUsingExternalHeadphones = headphonesConnected

        if !headphonesConnected && audioOutputEnabled {
            audioOutputEnabled = false
            stopPlaybackInternal()
        }

        let inName = session.currentRoute.inputs.first?.portName ?? "iPhone 마이크"
        let outName = session.currentRoute.outputs.first?.portName ?? "스피커"
        let signature = "\(inName)|\(outName)"
        let routeChanged = signature != lastRouteSignature
        lastRouteSignature = signature

        let blocked = blockedAttempt && !headphonesConnected
        let msg: String
        if blocked {
            msg = "🎧 목록에서 AirPods를 선택하면 iPhone으로 연결되고 「번역 음성 듣기」가 자동으로 켜집니다 (현재 출력: \(outName))"
        } else if announce && routeChanged {
            msg = "오디오 경로 — 입력: \(inName) / 출력: \(outName)"
        } else {
            msg = ""
        }

        callJS(
            """
            window.__nativeEarphoneConnected = c;
            if (window.__syncNativeEarphoneUI) {
              window.__syncNativeEarphoneUI(c, b, m);
            } else if (m) {
              const el = document.getElementById('toastMessage');
              if (el) { el.textContent = m; el.hidden = false; }
            }
            """,
            ["c": headphonesConnected, "b": blocked, "m": msg]
        )
    }

    // MARK: - Notifications: route, interruption, media reset, engine config, app lifecycle

    private func setupNotifications() {
        let center = NotificationCenter.default
        let session = AVAudioSession.sharedInstance()

        center.addObserver(self, selector: #selector(handleRouteChange(_:)),
                           name: AVAudioSession.routeChangeNotification, object: session)
        center.addObserver(self, selector: #selector(handleInterruption(_:)),
                           name: AVAudioSession.interruptionNotification, object: session)
        center.addObserver(self, selector: #selector(handleMediaServicesReset(_:)),
                           name: AVAudioSession.mediaServicesWereResetNotification, object: session)
        center.addObserver(self, selector: #selector(handleDidEnterBackground(_:)),
                           name: UIApplication.didEnterBackgroundNotification, object: nil)
        center.addObserver(self, selector: #selector(handleDidBecomeActive(_:)),
                           name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    private func observeEngineConfigurationChanges(_ engines: AVAudioEngine...) {
        for engine in engines {
            let token = NotificationCenter.default.addObserver(
                forName: .AVAudioEngineConfigurationChange, object: engine, queue: nil
            ) { [weak self] _ in
                self?.audioQueue.async {
                    self?.scheduleRestart(reason: "engineConfigurationChange")
                }
            }
            engineObservers.append(token)
        }
    }

    /// Coalesces bursts of route / configuration notifications into a single pipeline restart.
    private func scheduleRestart(reason: String) {
        guard wantsCapture, captureEngine != nil, !isInterrupted, isAppActive else { return }
        pendingRestartToken += 1
        let token = pendingRestartToken
        audioQueue.asyncAfter(deadline: .now() + 0.3) { [weak self] in
            guard let self = self, token == self.pendingRestartToken,
                  self.wantsCapture, !self.isInterrupted, self.isAppActive else { return }
            if !self.startEnginePipeline(reportErrors: false) {
                self.retryResumeLater()
            }
        }
    }

    /// One delayed final attempt (reports errors, then gives up).
    private func retryResumeLater() {
        let intent = captureIntentID
        audioQueue.asyncAfter(deadline: .now() + 1.0) { [weak self] in
            guard let self = self, intent == self.captureIntentID else { return }
            self.resumeCaptureIfNeeded(attempt: 1)
        }
    }

    private func giveUpCapture() {
        wantsCapture = false
        stopCaptureInternal(deactivateSession: true)
        notifyCaptureState("stopped", "오디오 장치를 다시 시작하지 못해 통역 수음이 중지되었습니다. 다시 시작해 주세요.")
    }

    @objc private func handleRouteChange(_ notification: Notification) {
        let reasonVal = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt
        let reason = reasonVal.flatMap { AVAudioSession.RouteChangeReason(rawValue: $0) }

        // AirPods picked in the system route picker may arrive as .override / .routeConfigurationChange,
        // so the pending auto-enable check runs for every route change reason.
        audioQueue.async { [weak self] in
            self?.completePendingOutputEnableIfReady()
        }

        // Physical device plug/unplug only. Other reasons are covered by AVAudioEngineConfigurationChange.
        guard reason == .newDeviceAvailable || reason == .oldDeviceUnavailable else { return }

        audioQueue.async { [weak self] in
            guard let self = self else { return }

            if reason == .oldDeviceUnavailable {
                self.audioOutputEnabled = false
                self.stopPlaybackInternal()
            }

            if self.captureEngine != nil {
                self.scheduleRestart(reason: "routeChange")
            }
            self.updateFooterRouteStatus(blockedAttempt: false, announce: false)

            let session = AVAudioSession.sharedInstance()
            let inName = session.currentRoute.inputs.first?.portName ?? "iPhone 마이크"
            let outName = session.currentRoute.outputs.first?.portName ?? "스피커"
            let msg = "오디오 경로 변경 — 입력: \(inName) / 출력: \(outName)"
            let reasonStr = (reason == .oldDeviceUnavailable) ? "oldDeviceUnavailable" : "routeChange"
            self.callJS(
                "if (window.__onNativeAudioRouteChange) { window.__onNativeAudioRouteChange({ reason: r, message: m }); }",
                ["r": reasonStr, "m": msg]
            )
        }
    }

    @objc private func handleInterruption(_ notification: Notification) {
        guard let info = notification.userInfo,
              let typeVal = info[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: typeVal) else {
            return
        }
        let optionsVal = info[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
        let shouldResume = AVAudioSession.InterruptionOptions(rawValue: optionsVal).contains(.shouldResume)

        audioQueue.async { [weak self] in
            guard let self = self, self.wantsCapture else { return }
            switch type {
            case .began:
                self.isInterrupted = true
                self.pendingRestartToken += 1
                self.stopEngineNodesOnly()
                self.setIdleTimerDisabled(false)
                self.notifyCaptureState("interrupted", "전화·Siri 등으로 오디오가 중단되어 통역 수음을 일시정지했습니다.")
            case .ended:
                self.isInterrupted = false
                if shouldResume && self.isAppActive {
                    self.resumeCaptureIfNeeded()
                }
                // Otherwise `didBecomeActive` restarts capture when the user returns to the app.
            @unknown default:
                break
            }
        }
    }

    @objc private func handleMediaServicesReset(_ notification: Notification) {
        audioQueue.async { [weak self] in
            guard let self = self else { return }
            // All audio objects are invalid after a media services reset: drop them and rebuild.
            for observer in self.engineObservers {
                NotificationCenter.default.removeObserver(observer)
            }
            self.engineObservers.removeAll()
            self.captureEngine = nil
            self.playbackEngine = nil
            self.playerNode = nil
            self.playerFormat = nil
            self.engineGeneration += 1
            self.resumeCaptureIfNeeded()
        }
    }

    @objc private func handleDidEnterBackground(_ notification: Notification) {
        audioQueue.async { [weak self] in
            guard let self = self else { return }
            self.isAppActive = false
            self.pendingRestartToken += 1
            guard self.wantsCapture, self.captureEngine != nil || self.isInterrupted else { return }
            self.stopCaptureInternal(deactivateSession: true)
            self.notifyCaptureState("backgrounded", "앱이 백그라운드로 전환되어 통역 수음을 일시정지했습니다. 앱으로 돌아오면 자동으로 다시 시작합니다.")
        }
    }

    @objc private func handleDidBecomeActive(_ notification: Notification) {
        audioQueue.async { [weak self] in
            guard let self = self else { return }
            self.isAppActive = true
            if self.captureEngine == nil {
                self.isInterrupted = false
            }
            self.resumeCaptureIfNeeded()
            // The user may have connected AirPods via Control Center / Settings instead of the picker.
            self.completePendingOutputEnableIfReady()
        }
    }

    // MARK: - AirPods connect flow (system route picker → auto-enable "번역 음성 듣기")

    /// Main thread. Opens the iOS system audio output picker. AirPods paired to the same Apple ID
    /// are listed even while attached to a Mac / iPad, and selecting them pulls the connection to this iPhone.
    private func presentRoutePicker() {
        guard let webView = webView else { return }
        let picker: AVRoutePickerView
        if let existing = routePickerView {
            picker = existing
        } else {
            picker = AVRoutePickerView(frame: CGRect(x: 0, y: 0, width: 1, height: 1))
            picker.prioritizesVideoDevices = false
            picker.alpha = 0.011
            picker.isAccessibilityElement = false
            routePickerView = picker
        }
        if picker.superview !== webView {
            picker.removeFromSuperview()
            webView.addSubview(picker)
        }
        picker.frame = CGRect(x: webView.bounds.midX, y: webView.safeAreaInsets.top + 8, width: 1, height: 1)
        picker.layoutIfNeeded()
        guard let button = Self.findButton(in: picker) else { return }
        button.sendActions(for: .touchUpInside)
    }

    private static func findButton(in view: UIView) -> UIButton? {
        if let button = view as? UIButton { return button }
        for sub in view.subviews {
            if let found = findButton(in: sub) { return found }
        }
        return nil
    }

    /// audioQueue. If the user asked for "번역 음성 듣기" and earphones are now the output, switch the toggle ON.
    private func completePendingOutputEnableIfReady() {
        guard let deadline = pendingOutputEnableDeadline else { return }
        if Date() > deadline {
            pendingOutputEnableDeadline = nil
            return
        }
        let session = AVAudioSession.sharedInstance()
        guard hasExternalHeadphones(in: session) else { return }
        pendingOutputEnableDeadline = nil
        isUsingExternalHeadphones = true
        let outName = session.currentRoute.outputs.first?.portName ?? "이어폰"
        callJS(
            """
            window.__nativeEarphoneConnected = true;
            if (window.__syncNativeEarphoneUI) { window.__syncNativeEarphoneUI(true, false, ''); }
            const t = document.getElementById('toggleAudioOutput');
            if (t && !t.checked) {
              t.checked = true;
              t.dispatchEvent(new Event('change', { bubbles: true }));
            }
            const el = document.getElementById('toastMessage');
            if (el) { el.textContent = m; el.hidden = false; el.classList.add('show'); }
            """,
            ["m": "🎧 \(outName) 연결됨 — 「번역 음성 듣기」를 켰습니다"]
        )
    }

    /// Restarts capture if the user still wants it but the engine is not running.
    /// Right after a call ends the session can still be busy, so one delayed retry is made before giving up.
    private func resumeCaptureIfNeeded(attempt: Int = 0) {
        guard wantsCapture, !isPermissionPending, !isInterrupted, isAppActive else { return }
        if let engine = captureEngine, engine.isRunning { return }
        let isLastAttempt = attempt >= 1
        if startEnginePipeline(reportErrors: isLastAttempt) {
            notifyCaptureState("resumed", "통역 수음을 다시 시작했습니다.")
        } else if !isLastAttempt {
            retryResumeLater()
        } else {
            giveUpCapture()
        }
    }

    // MARK: - Swift → JS helpers (all strings passed as arguments, never interpolated)

    private func callJS(_ body: String, _ arguments: [String: Any]) {
        DispatchQueue.main.async { [weak self] in
            self?.webView?.callAsyncJavaScript(body, arguments: arguments, in: nil, in: .page, completionHandler: nil)
        }
    }

    private func notifyCaptureState(_ state: String, _ message: String) {
        callJS(
            "if (window.__onNativeCaptureState) { window.__onNativeCaptureState({ state: s, message: m }); }",
            ["s": state, "m": message]
        )
    }

    private func dispatchErrorToJS(_ message: String) {
        callJS("if (window.__onNativeAudioError) { window.__onNativeAudioError(m); }", ["m": message])
    }

    private func setIdleTimerDisabled(_ disabled: Bool) {
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = disabled
        }
    }
}

/// Level stage for outgoing native mic chunks (audioQueue only). Replaces the former fixed 2.5x gain + hard clip,
/// which flattened loud / close-talk speech (up to 31% of sampled chunks hit full scale).
///
/// 1. Adaptive gain: boosts by up to `maxGain` (the former fixed 2.5x, so quiet far-field input is boosted exactly
///    as before) and backs off only as far as needed to keep the chunk peak under `peakCeiling`, down to 1x (no
///    boost) for loud speech. A whole 100ms chunk is buffered before sending, so this is look-ahead without extra
///    latency. The gain drops at once (short ramp, no click) and rises back slowly so the level does not pump.
/// 2. Soft limiter: anything still above `limiterKnee` is tanh-compressed instead of hard-clipped, so samples
///    never hit full scale.
///
/// `meterRms` keeps the legacy scale (input x 2.5, clamped): app.js uses it for the level meter, adaptive noise
/// floor, activity ping and latency thresholds, which must not shift.
private struct MicGainProcessor {
    static let maxGain: Float = 2.5
    static let minGain: Float = 1.0
    static let peakCeiling: Float = 0.9
    static let limiterKnee: Float = 0.8
    /// Fraction of the remaining distance covered per 100ms chunk when the gain rises (~0.5s time constant).
    static let releasePerChunk: Float = 0.2
    /// 2ms @ 16kHz ramp when the gain drops.
    static let attackRampSamples = 32

    private(set) var gain: Float = maxGain

    mutating func reset() {
        gain = Self.maxGain
    }

    mutating func process(_ samples: [Float]) -> (pcm: [Int16], meterRms: Float) {
        let n = samples.count
        guard n > 0 else { return ([], 0) }

        var meterSumSquares: Float = 0
        var peak: Float = 0
        for s in samples {
            let legacy = max(-1.0, min(1.0, s * Self.maxGain))
            meterSumSquares += legacy * legacy
            peak = max(peak, abs(s))
        }
        let meterRms = sqrt(meterSumSquares / Float(n))

        // 1. Adaptive gain: as much boost as fits under the ceiling (quiet -> 2.5x, loud -> 1x).
        let target = peak > 0 ? min(Self.maxGain, max(Self.minGain, Self.peakCeiling / peak)) : Self.maxGain

        let startGain = gain
        let rampLength: Int
        if target < startGain {
            gain = target  // fast attack
            rampLength = min(Self.attackRampSamples, n)
        } else {
            gain = startGain + (target - startGain) * Self.releasePerChunk  // slow release
            rampLength = n
        }

        // Near-silence gate kept from the original implementation (same threshold, same legacy scale).
        let gateGain: Float = meterRms < 0.0008 ? 0.2 : 1.0

        var pcm = [Int16](repeating: 0, count: n)
        for i in 0..<n {
            let g = i < rampLength
                ? startGain + (gain - startGain) * Float(i + 1) / Float(rampLength)
                : gain
            // 2. Soft limiter.
            let v = Self.softLimit(samples[i] * g * gateGain)
            pcm[i] = Int16(v < 0 ? v * 32768.0 : v * 32767.0).littleEndian
        }
        return (pcm, meterRms)
    }

    /// Identity up to the knee; above it, tanh-compresses toward (never reaching) full scale.
    static func softLimit(_ x: Float) -> Float {
        let magnitude = abs(x)
        guard magnitude > limiterKnee else { return x }
        let headroom = 1 - limiterKnee
        let limited = limiterKnee + headroom * tanh((magnitude - limiterKnee) / headroom)
        return x < 0 ? -limited : limited
    }
}

/// Fixed-capacity FIFO of Float samples (overwrites the oldest samples when full).
private struct FloatRingBuffer {
    private var storage: [Float]
    private var head = 0
    private(set) var count = 0

    init(capacity: Int) {
        storage = [Float](repeating: 0, count: max(1, capacity))
    }

    mutating func append(contentsOf samples: [Float]) {
        let capacity = storage.count
        for sample in samples {
            if count == capacity {
                head = (head + 1) % capacity
                count -= 1
            }
            storage[(head + count) % capacity] = sample
            count += 1
        }
    }

    /// Pops `count` samples into `out[0..<count]`. Caller guarantees `self.count >= count` and `out.count >= count`.
    mutating func pop(into out: inout [Float], count n: Int) {
        let capacity = storage.count
        for i in 0..<n {
            out[i] = storage[(head + i) % capacity]
        }
        head = (head + n) % capacity
        count -= n
    }

    mutating func removeAll() {
        head = 0
        count = 0
    }
}

/// Breaks the WKUserContentController → handler strong reference.
final class WeakScriptMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?

    init(_ target: WKScriptMessageHandler) {
        self.target = target
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}
