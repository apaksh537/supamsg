import SwiftUI
import UserNotifications

@main
struct SupaMsgApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @StateObject private var messageStore = MessageStore()
    @StateObject private var pairingService = PairingService()
    @State private var selectedTab = 0
    @State private var deepLinkAccountId: String?
    @State private var deepLinkContactName: String?

    var body: some Scene {
        WindowGroup {
            ContentView(
                selectedTab: $selectedTab,
                deepLinkAccountId: $deepLinkAccountId,
                deepLinkContactName: $deepLinkContactName
            )
            .environmentObject(messageStore)
            .environmentObject(pairingService)
            .onAppear {
                pairingService.messageStore = messageStore
                pairingService.connectIfPaired()
            }
            .onOpenURL { url in
                handleDeepLink(url)
            }
        }
    }

    private func handleDeepLink(_ url: URL) {
        // supamsg://chat?accountId=xxx&contact=yyy
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return }
        let paramPairs: [(String, String)] = (components.queryItems ?? []).compactMap {
            guard let value = $0.value else { return nil }
            return ($0.name, value)
        }
        let params = Dictionary(uniqueKeysWithValues: paramPairs)
        if let accountId = params["accountId"] {
            deepLinkAccountId = accountId
            deepLinkContactName = params["contact"]
            selectedTab = 0 // Switch to inbox
        }
    }
}

// MARK: - App Delegate for Push Notifications

class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        NotificationService.shared.requestAuthorization()
        NotificationService.shared.registerNotificationActions()
        UNUserNotificationCenter.current().delegate = self
        application.registerForRemoteNotifications()
        return true
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        let token = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
        print("[SupaMsg] APNs device token: \(token)")
        NotificationService.shared.deviceToken = token
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        print("[SupaMsg] Failed to register for remote notifications: \(error.localizedDescription)")
    }

    // Foreground notification
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .badge, .sound])
    }

    // Notification tap / action
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        NotificationService.shared.handleNotificationResponse(response)
        completionHandler()
    }
}
