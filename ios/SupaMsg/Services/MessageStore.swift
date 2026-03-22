import Foundation
import Combine

final class MessageStore: ObservableObject {
    @Published var messages: [Message] = []
    @Published var accounts: [Account] = []

    private let messagesKey = "stored_messages"
    private let accountsKey = "stored_accounts"
    private let notifPrefPrefix = "notifications_"
    private let maxStoredMessages = 500

    init() {
        loadFromStorage()
    }

    // MARK: - Computed Properties

    var recentMessages: [Message] {
        messages.sorted { $0.time > $1.time }
    }

    var totalUnreadCount: Int {
        messages.filter { !$0.isRead && !$0.isOutgoing }.count
    }

    // MARK: - Message Operations

    func addMessage(_ message: Message) {
        // Avoid duplicates
        guard !messages.contains(where: { $0.id == message.id }) else { return }

        messages.append(message)

        // Update account unread count
        if !message.isOutgoing && !message.isRead {
            if let idx = accounts.firstIndex(where: { $0.id == message.accountId }) {
                accounts[idx].unreadCount += 1
            }
        }

        // Trim old messages
        if messages.count > maxStoredMessages {
            let sorted = messages.sorted { $0.time > $1.time }
            messages = Array(sorted.prefix(maxStoredMessages))
        }

        saveToStorage()
    }

    func markAsRead(messageId: String) {
        guard let idx = messages.firstIndex(where: { $0.id == messageId }) else { return }
        guard !messages[idx].isRead else { return }

        messages[idx].isRead = true

        // Update account unread count
        let accountId = messages[idx].accountId
        if let accIdx = accounts.firstIndex(where: { $0.id == accountId }) {
            accounts[accIdx].unreadCount = max(0, accounts[accIdx].unreadCount - 1)
        }

        saveToStorage()
        updateBadge()
    }

    func markConversationAsRead(accountId: String, contactName: String) {
        var changed = false
        for i in messages.indices {
            if messages[i].accountId == accountId &&
               messages[i].contactName == contactName &&
               !messages[i].isRead {
                messages[i].isRead = true
                changed = true
            }
        }

        if changed {
            // Recalculate account unread
            recalculateUnreadCounts()
            saveToStorage()
            updateBadge()
        }
    }

    func getUnreadCount(for accountId: String) -> Int {
        messages.filter { $0.accountId == accountId && !$0.isRead && !$0.isOutgoing }.count
    }

    func getRecentMessages(for accountId: String, limit: Int = 50) -> [Message] {
        messages
            .filter { $0.accountId == accountId }
            .sorted { $0.time > $1.time }
            .prefix(limit)
            .reversed()
            .map { $0 }
    }

    func getConversationContext(accountId: String, contactName: String, limit: Int = 5) -> [Message] {
        messages
            .filter { $0.accountId == accountId && $0.contactName == contactName }
            .sorted { $0.time > $1.time }
            .prefix(limit)
            .reversed()
            .map { $0 }
    }

    // MARK: - Account Operations

    func upsertAccount(_ account: Account) {
        if let idx = accounts.firstIndex(where: { $0.id == account.id }) {
            accounts[idx] = account
        } else {
            accounts.append(account)
        }
        saveToStorage()
    }

    func removeAccount(accountId: String) {
        accounts.removeAll { $0.id == accountId }
        messages.removeAll { $0.accountId == accountId }
        UserDefaults.standard.removeObject(forKey: "\(notifPrefPrefix)\(accountId)")
        saveToStorage()
    }

    // MARK: - Notification Preferences

    func isNotificationEnabled(for accountId: String) -> Bool {
        let key = "\(notifPrefPrefix)\(accountId)"
        if UserDefaults.standard.object(forKey: key) == nil {
            return true // Default: enabled
        }
        return UserDefaults.standard.bool(forKey: key)
    }

    func setNotificationEnabled(_ enabled: Bool, for accountId: String) {
        UserDefaults.standard.set(enabled, forKey: "\(notifPrefPrefix)\(accountId)")
    }

    // MARK: - Clear Data

    func clearAllData() {
        messages.removeAll()
        accounts.removeAll()
        saveToStorage()
        updateBadge()
    }

    // MARK: - Persistence

    private func saveToStorage() {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .secondsSince1970

        if let messagesData = try? encoder.encode(messages) {
            UserDefaults.standard.set(messagesData, forKey: messagesKey)
        }
        if let accountsData = try? encoder.encode(accounts) {
            UserDefaults.standard.set(accountsData, forKey: accountsKey)
        }
    }

    private func loadFromStorage() {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .secondsSince1970

        if let messagesData = UserDefaults.standard.data(forKey: messagesKey),
           let decoded = try? decoder.decode([Message].self, from: messagesData) {
            messages = decoded
        }
        if let accountsData = UserDefaults.standard.data(forKey: accountsKey),
           let decoded = try? decoder.decode([Account].self, from: accountsData) {
            accounts = decoded
        }
    }

    static func loadUnreadCount() -> Int {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .secondsSince1970

        guard let data = UserDefaults.standard.data(forKey: "stored_messages"),
              let messages = try? decoder.decode([Message].self, from: data) else {
            return 0
        }
        return messages.filter { !$0.isRead && !$0.isOutgoing }.count
    }

    // MARK: - Helpers

    private func recalculateUnreadCounts() {
        for i in accounts.indices {
            accounts[i].unreadCount = getUnreadCount(for: accounts[i].id)
        }
    }

    private func updateBadge() {
        let count = totalUnreadCount
        UNUserNotificationCenter.current().setBadgeCount(count)
    }
}

import UserNotifications
