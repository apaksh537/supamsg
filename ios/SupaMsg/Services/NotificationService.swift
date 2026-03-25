import Foundation
import UserNotifications

final class NotificationService: NSObject {
    static let shared = NotificationService()

    var deviceToken: String?
    var onNotificationTapped: ((String, String) -> Void)? // (accountId, contactName)

    private let replyActionId = "REPLY_ACTION"
    private let markReadActionId = "MARK_READ_ACTION"
    private let messageCategoryId = "MESSAGE_CATEGORY"

    private override init() {
        super.init()
    }

    // MARK: - Authorization

    func requestAuthorization() {
        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert, .badge, .sound]) { granted, error in
            if let error = error {
                #if DEBUG
                print("[SupaMsg] Notification auth error: \(error.localizedDescription)")
                #endif
                return
            }
            #if DEBUG
            print("[SupaMsg] Notification permission granted: \(granted)")
            #endif
        }
    }

    // MARK: - Notification Actions

    func registerNotificationActions() {
        let replyAction = UNTextInputNotificationAction(
            identifier: replyActionId,
            title: "Reply",
            options: [],
            textInputButtonTitle: "Send",
            textInputPlaceholder: "Type a message..."
        )

        let markReadAction = UNNotificationAction(
            identifier: markReadActionId,
            title: "Mark as Read",
            options: []
        )

        let category = UNNotificationCategory(
            identifier: messageCategoryId,
            actions: [replyAction, markReadAction],
            intentIdentifiers: [],
            options: [.customDismissAction]
        )

        UNUserNotificationCenter.current().setNotificationCategories([category])
    }

    // MARK: - Show Local Notification

    func showNotification(
        accountId: String,
        accountName: String,
        contactName: String,
        messageText: String
    ) {
        // Check DND
        if isDNDActive() { return }

        // Check per-account notification preference
        let key = "notifications_\(accountId)"
        if UserDefaults.standard.object(forKey: key) != nil && !UserDefaults.standard.bool(forKey: key) {
            return
        }

        let content = UNMutableNotificationContent()
        content.title = "\(accountName) - \(contactName)"
        content.body = messageText
        content.sound = .default
        content.categoryIdentifier = messageCategoryId
        content.threadIdentifier = "\(accountId)_\(contactName)"
        content.userInfo = [
            "accountId": accountId,
            "accountName": accountName,
            "contactName": contactName
        ]

        // Badge count
        let store = MessageStore.loadUnreadCount()
        content.badge = NSNumber(value: store + 1)

        let request = UNNotificationRequest(
            identifier: UUID().uuidString,
            content: content,
            trigger: nil // Deliver immediately
        )

        UNUserNotificationCenter.current().add(request) { error in
            if let error = error {
                #if DEBUG
                print("[SupaMsg] Failed to show notification: \(error.localizedDescription)")
                #endif
            }
        }
    }

    // MARK: - Handle Notification Response

    func handleNotificationResponse(_ response: UNNotificationResponse) {
        let userInfo = response.notification.request.content.userInfo
        let accountId = userInfo["accountId"] as? String ?? ""
        let contactName = userInfo["contactName"] as? String ?? ""

        switch response.actionIdentifier {
        case replyActionId:
            if let textResponse = response as? UNTextInputNotificationResponse {
                let replyText = textResponse.userText
                // Send reply through pairing service
                NotificationCenter.default.post(
                    name: .quickReplyFromNotification,
                    object: nil,
                    userInfo: [
                        "accountId": accountId,
                        "contactName": contactName,
                        "text": replyText
                    ]
                )
            }

        case markReadActionId:
            NotificationCenter.default.post(
                name: .markReadFromNotification,
                object: nil,
                userInfo: ["accountId": accountId, "contactName": contactName]
            )

        case UNNotificationDefaultActionIdentifier:
            // Tapped notification — open the chat
            onNotificationTapped?(accountId, contactName)

        default:
            break
        }
    }

    // MARK: - DND Check

    private func isDNDActive() -> Bool {
        let defaults = UserDefaults.standard
        guard defaults.bool(forKey: "dndEnabled") else { return false }

        let startHour = defaults.integer(forKey: "dndStartHour")
        let endHour = defaults.integer(forKey: "dndEndHour")
        let currentHour = Calendar.current.component(.hour, from: Date())

        if startHour < endHour {
            return currentHour >= startHour && currentHour < endHour
        } else {
            // Overnight DND (e.g., 22:00 - 07:00)
            return currentHour >= startHour || currentHour < endHour
        }
    }

    // MARK: - Clear Badge

    func clearBadge() {
        UNUserNotificationCenter.current().setBadgeCount(0)
    }
}

// MARK: - Notification Names

extension Notification.Name {
    static let quickReplyFromNotification = Notification.Name("quickReplyFromNotification")
    static let markReadFromNotification = Notification.Name("markReadFromNotification")
}
