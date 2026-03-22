import SwiftUI

// MARK: - Theme Colors

extension Color {
    // Approved Notion-style light theme
    static let smBackground = Color(hex: "FFFFFF")
    static let smSurface = Color(hex: "F5F5F5")
    static let smSurfaceLight = Color(hex: "F0F2F5")
    static let smAccent = Color(hex: "25D366")
    static let smAccentDim = Color(hex: "1FAA59")
    static let smText = Color(hex: "111B21")
    static let smTextSecondary = Color(hex: "667781")
    static let smDanger = Color(hex: "EF4444")
    static let smWarning = Color(hex: "F5A623")
    static let smBorder = Color(hex: "E8E8E8")
    static let smNavBg = Color(hex: "FAFAFA")
    static let smActiveItem = Color(hex: "F0FFF4")
}

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 6:
            (a, r, g, b) = (255, (int >> 16) & 0xFF, (int >> 8) & 0xFF, int & 0xFF)
        case 8:
            (a, r, g, b) = ((int >> 24) & 0xFF, (int >> 16) & 0xFF, (int >> 8) & 0xFF, int & 0xFF)
        default:
            (a, r, g, b) = (255, 0, 0, 0)
        }
        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue: Double(b) / 255,
            opacity: Double(a) / 255
        )
    }
}

// MARK: - Content View

struct ContentView: View {
    @Binding var selectedTab: Int
    @Binding var deepLinkAccountId: String?
    @Binding var deepLinkContactName: String?
    @EnvironmentObject var messageStore: MessageStore
    @EnvironmentObject var pairingService: PairingService

    var body: some View {
        ZStack {
            Color.smBackground.ignoresSafeArea()

            TabView(selection: $selectedTab) {
                InboxView(
                    deepLinkAccountId: $deepLinkAccountId,
                    deepLinkContactName: $deepLinkContactName
                )
                .tabItem {
                    Label("Inbox", systemImage: "tray.fill")
                }
                .badge(messageStore.totalUnreadCount)
                .tag(0)

                AccountsView()
                    .tabItem {
                        Label("Accounts", systemImage: "person.2.fill")
                    }
                    .tag(1)

                SettingsView()
                    .tabItem {
                        Label("Settings", systemImage: "gearshape.fill")
                    }
                    .tag(2)
            }
            .tint(.smAccent)
        }
        .preferredColorScheme(.light)
    }
}

// MARK: - Shared UI Components

struct AccountDot: View {
    let color: String
    var size: CGFloat = 10

    var body: some View {
        Circle()
            .fill(Color(hex: color))
            .frame(width: size, height: size)
    }
}

struct BadgeView: View {
    let count: Int

    var body: some View {
        if count > 0 {
            Text("\(count)")
                .font(.caption2)
                .fontWeight(.bold)
                .foregroundColor(.white)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(Color.smAccent)
                .clipShape(Capsule())
        }
    }
}

struct ConnectionStatusBanner: View {
    @EnvironmentObject var pairingService: PairingService

    var body: some View {
        if !pairingService.isConnected && pairingService.isPaired {
            HStack(spacing: 8) {
                ProgressView()
                    .tint(.white)
                    .scaleEffect(0.8)
                Text("Reconnecting to desktop...")
                    .font(.caption)
                    .foregroundColor(.white)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity)
            .background(Color.smWarning.opacity(0.85))
            .cornerRadius(8)
            .padding(.horizontal)
        }
    }
}
