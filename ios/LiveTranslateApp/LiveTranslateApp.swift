import SwiftUI
import UIKit

@main
struct LiveTranslateApp: App {
    // The idle timer is disabled only while native mic capture is running (see NativeAudioBridge).

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
