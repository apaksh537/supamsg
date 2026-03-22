import Foundation

struct Account: Identifiable, Codable, Equatable {
    let id: String
    var name: String
    var color: String
    var isConnected: Bool
    var unreadCount: Int

    init(
        id: String = UUID().uuidString,
        name: String,
        color: String = "25D366",
        isConnected: Bool = false,
        unreadCount: Int = 0
    ) {
        self.id = id
        self.name = name
        self.color = color
        self.isConnected = isConnected
        self.unreadCount = unreadCount
    }

    static func == (lhs: Account, rhs: Account) -> Bool {
        lhs.id == rhs.id
    }
}

// MARK: - Predefined Account Colors

extension Account {
    static let availableColors: [String] = [
        "25D366", // WhatsApp green
        "3498db", // Blue
        "e74c3c", // Red
        "f39c12", // Orange
        "9b59b6", // Purple
        "1abc9c", // Teal
        "e91e63", // Pink
        "00bcd4", // Cyan
    ]

    static func nextColor(existingCount: Int) -> String {
        availableColors[existingCount % availableColors.count]
    }
}
