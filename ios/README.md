# Gemini Live Translate — iOS Native Wrapper App (`AVAudioSession` 입·출력 분리)

아이폰에 **AirPods(블루투스 이어폰)**을 착용한 상태에서도 **마이크 입력(Audio Input)은 아이폰 본체 내장 마이크(회의실 수음)**로 고정하고, **번역 음성 출력(Audio Output)은 AirPods(고음질 A2DP 스테레오)**으로 분리하는 iOS 네이티브 하이브리드 앱입니다.

---

## 🏗️ 아키텍처 구조

```text
[아이폰 본체 내장 마이크 (.builtInMic)]
       │ (AVAudioSession: .playAndRecord + .allowBluetoothA2DP, HFP 비활성화)
       ▼
[Swift: NativeAudioBridge (AVAudioEngine)]
  ├─ Input Tap (48kHz -> 16kHz 16-bit PCM 다운샘플링)
  │    └──► WKWebView JS (`window.__onNativeMicPcm16`) ──► WebSocket (`/ws/translate`)
  │
  └─ Output Player (`AVAudioPlayerNode`, 24kHz PCM)
       ▲── WKWebView JS (`nativeAudio.postMessage({ action: "playAudio" })`) ◄── WebSocket (`audio_output`)
       │
       ▼
[AirPods / 이어폰 (.bluetoothA2DP 고음질 출력)]
```

### 왜 이 아키텍처인가?
1. **`WKWebView` 내부 `getUserMedia()` 미사용**:
   - 웹뷰 안에서 `navigator.mediaDevices.getUserMedia()`를 직접 호출하면 iOS WebKit 프로세스가 `AVAudioSession`을 통화용 **HFP(양방향 프로파일)**로 덮어써서 입·출력이 모두 AirPods으로 묶입니다.
   - 따라서 웹뷰([`static/app.js`](../static/app.js))가 `window.webkit.messageHandlers.nativeAudio`를 감지하면 자동으로 웹 `getUserMedia`를 건너뛰고 네이티브 Swift 오디오 엔진(`NativeAudioBridge.swift`)을 사용합니다.
2. **`.allowBluetooth` 제외 + `.allowBluetoothA2DP` 활성화 + `preferredInput = nil`**:
   - 카테고리 `.playAndRecord`, 모드 `.default`, 옵션 `[.allowBluetoothA2DP, .allowAirPlay, .defaultToSpeaker]`.
   - HFP를 허용하지 않으므로 iOS는 AirPods 마이크를 깨우지 않고, 입력은 **아이폰 본체 마이크**, 출력은 **AirPods(A2DP)**(미연결 시 스피커)로 자동 선택합니다.
   - `setPreferredInput(builtInMic)`은 호출하지 않습니다 (출력까지 아이폰 본체로 끌려와 AirPods 출력이 끊기기 때문).
   - Voice Processing(AEC)은 사용하지 않습니다. JS가 보내는 `echoCancellation` 값은 하위 호환을 위해 받기만 하고 무시합니다. 번역 음성은 이어폰(A2DP)으로만 재생되고 스피커 재생은 네이티브에서 차단되므로 스피커→마이크 에코 경로가 없습니다.
3. **`"번역 음성 듣기"` 토글**:
   - **ON**: 이어폰(AirPods/유선/USB/AirPlay)이 연결된 경우에만 허용. 번역 음성(기본 24kHz, JS가 보낸 `sampleRate` 반영)을 `AVAudioPlayerNode`로 재생합니다.
   - **OFF** 또는 이어폰 미연결: 자막만 표시. 이어폰이 분리되면 자동으로 OFF 처리됩니다.
4. **수음 파이프라인**: 입력 탭 → 지속형 `AVAudioConverter`(하드웨어 레이트 → 16kHz mono) → 링 버퍼 → 100ms(1600 샘플) → 가변 증폭 + 소프트 리미터(`MicGainProcessor`: 작은 소리는 기존처럼 최대 2.5배, 잘릴 만큼 크면 최저 1배까지 낮추고 남은 피크는 부드럽게 눌러 클리핑 방지) → Int16 PCM → `window.__onNativeMicPcm16(base64, rms)`. `rms`는 웹 UI 미터·무음 판정용으로 기존 기준(입력×2.5)을 그대로 유지합니다. 페이지가 처리하지 못하면(미완료 호출 10개 초과) 청크를 버려 메모리 누적을 막습니다.

### 오디오 세션 수명주기
- 앱 실행/페이지 로드 시에는 카테고리만 설정하고 **세션을 활성화하지 않습니다** (다른 앱 음악을 끊지 않음). `startCapture` 시점에만 `setActive(true)`.
- **전화·Siri 인터럽션**: 시작 시 엔진 정지 + `interrupted` 알림, 종료 시 `shouldResume`이면 자동 재시작(`resumed`). 종료 알림이 오지 않으면 앱이 다시 활성화될 때 재시작합니다.
- **경로/엔진 구성 변경**(`AVAudioEngineConfigurationChange`, 이어폰 연결/분리), **미디어 서비스 리셋**: 엔진을 재구성해 수음을 이어갑니다. 재시작 실패 시 1회 재시도 후 `stopped`.
- **백그라운드**: `UIBackgroundModes`에 `audio`를 넣지 않습니다. 백그라운드 전환 시 수음을 일시정지하고(`backgrounded`), 포그라운드 복귀 시 사용자가 여전히 수음 중이었다면 자동 재시작(`resumed`)합니다.
- 화면 꺼짐 방지(`isIdleTimerDisabled`)는 수음 중에만 켭니다.

### Swift → JS 콜백 계약
| 콜백 | 인자 |
| --- | --- |
| `window.__onNativeMicPcm16(base64, rms)` | 16kHz Int16 LE mono PCM (base64), RMS(Number) |
| `window.__onNativeAudioRouteChange({reason, message})` | `reason`: `"oldDeviceUnavailable"` \| `"routeChange"` |
| `window.__onNativeAudioError(message)` | 사용자 표시용 한국어 메시지 |
| `window.__onNativeCaptureState({state, message})` | `state`: `"interrupted"` \| `"resumed"` \| `"backgrounded"` \| `"error"` \| `"stopped"` |
| `window.__syncNativeEarphoneUI(connected, blockedAttempt, message)` | 래퍼가 주입한 스크립트에서 정의 (message가 빈 문자열이면 토스트 없음) |

모든 문자열은 `callAsyncJavaScript(arguments:)`로 전달되어 기기 이름 등에 따옴표가 있어도 안전합니다.

### 보안
- 네이티브 브리지는 **메인 프레임 + 설정된 서버 origin(scheme/host/port 일치)** 에서 온 메시지만 처리합니다.
- 같은 origin 내비게이션만 웹뷰에서 허용하고, 외부 origin 링크/새 창은 Safari 등 시스템 앱으로 엽니다.
- 서버 주소는 `https://`만 허용합니다 (DEBUG 빌드에서만 `http://` 허용). `*.run.app`이 아닌 호스트는 QR/딥링크/직접 입력 모두 확인 알림 후 전환합니다.
- ATS 전역 예외(`NSAllowsArbitraryLoads`)는 없습니다 (`NSAllowsLocalNetworking`만 허용).
- `PrivacyInfo.xcprivacy` 포함 (UserDefaults `CA92.1`, 오디오 데이터: 앱 기능 목적). iPhone 전용 타깃(`TARGETED_DEVICE_FAMILY = 1`).

---

## 🚀 아이폰 빌드 및 설치 방법 (Xcode)

1. Mac에서 Xcode 프로젝트를 엽니다 (macOS 26에서 Xcode 16 실행 시 직접 바이너리 호출, 저장소 루트에서 실행):
   ```bash
   /Applications/Xcode.app/Contents/MacOS/Xcode ios/LiveTranslateApp.xcodeproj &
   ```
2. Xcode 좌측 프로젝트 네비게이터에서 **`LiveTranslateApp`** 타겟을 선택하고 **Signing & Capabilities** 탭으로 이동합니다.
3. **Team**에서 본인 Apple ID(Personal Team 또는 Developer Team)를 선택하고, 필요 시 **Bundle Identifier**를 고유한 이름으로 변경합니다.
4. 아이폰을 Mac에 연결한 뒤 상단 기기 목록에서 내 아이폰을 선택하고 **Run (`⌘ + R`)**을 누릅니다.
5. **QR 코드 스캔으로 백엔드 서버 URL 설정 (URL 직접 입력 불필요)**:
   - 아이폰 앱을 처음 실행하면 자동으로 열리는 **카메라 QR 코드 스캐너**로 백엔드 서버 주소(`https://live-translate-xxx.asia-northeast3.run.app` 등)가 담긴 QR 코드를 스캔하면 진동 피드백과 함께 서버 주소가 자동 저장 및 연결됩니다.
   - 이후 서버 주소를 변경할 때도 앱 우측 상단 **`[QR]` 아이콘 버튼**을 눌러 다른 QR 코드를 스캔하면 즉시 전환됩니다 (`*.run.app`이 아닌 주소는 확인 알림 후 전환).


