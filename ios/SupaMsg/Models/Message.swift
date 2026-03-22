import Foundation

struct Message: Identifiable, Codable, Equatable {
    let id: String
    let accountId: String
    let accountName: String
    let contactName: String
    let text: String
    let time: Date
    let isOutgoing: Bool
    var isRead: Bool

    enum CodingKeys: String, CodingKey {
        case id, accountId, accountName, contactName, text, time, isOutgoing, isRead
    }

    init(
        id: String = UUID().uuidString,
        accountId: String,
        accountName: String,
        contactName: String,
        text: String,
        time: Date = Date(),
        isOutgoing: Bool = false,
        isRead: Bool = false
    ) {
        self.id = id
        self.accountId = accountId
        self.accountName = accountName
        self.contactName = contactName
        self.text = text
        self.time = time
        self.isOutgoing = isOutgoing
        self.isRead = isRead
    }

    static func == (lhs: Message, rhs: Message) -> Bool {
        lhs.id == rhs.id
    }
}

// MARK: - Message Payload (from WebSocket)

struct MessagePayload: Codable {
    let type: String
    let accountId: String?
    let accountName: String?
    let contactName: String?
    let text: String?
    let timestamp: TimeInterval?
    let messages: [MessagePayload]?
    let accounts: [AccountPayload]?

    // Pairing
    let code: String?
    let status: String?
    let host: String?
}

struct AccountPayload: Codable {
    let id: String
    let name: String
    let color: String?
    let isConnected: Bool?
    let unreadCount: Int?
}
