import SwiftUI

struct InboxView: View {
    @EnvironmentObject var messageStore: MessageStore
    @EnvironmentObject var pairingService: PairingService
    @Binding var deepLinkAccountId: String?
    @Binding var deepLinkContactName: String?
    @State private var expandedMessageId: String?
    @State private var showingQuickReply = false
    @State private var quickReplyMessage: Message?
    @State private var searchText = ""

    var filteredMessages: [Message] {
        let messages = messageStore.recentMessages
        if searchText.isEmpty { return messages }
        return messages.filter {
            $0.contactName.localizedCaseInsensitiveContains(searchText) ||
            $0.text.localizedCaseInsensitiveContains(searchText) ||
            $0.accountName.localizedCaseInsensitiveContains(searchText)
        }
    }

    var groupedMessages: [(String, [Message])] {
        let grouped = Dictionary(grouping: filteredMessages) { $0.accountName }
        return grouped.sorted { lhs, rhs in
            let lhsTime = lhs.value.first?.time ?? Date.distantPast
            let rhsTime = rhs.value.first?.time ?? Date.distantPast
            return lhsTime > rhsTime
        }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.smBackground.ignoresSafeArea()

                VStack(spacing: 0) {
                    ConnectionStatusBanner()

                    if messageStore.recentMessages.isEmpty {
                        emptyStateView
                    } else {
                        messageListView
                    }
                }
            }
            .navigationTitle("Inbox")
            .navigationBarTitleDisplayMode(.large)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .searchable(text: $searchText, prompt: "Search messages...")
            .sheet(isPresented: $showingQuickReply) {
                if let message = quickReplyMessage {
                    QuickReplyView(message: message)
                        .environmentObject(messageStore)
                        .environmentObject(pairingService)
                }
            }
            .onChange(of: deepLinkAccountId) { newValue in
                if newValue != nil {
                    // Scroll to / highlight the account section
                    deepLinkAccountId = nil
                }
            }
        }
    }

    // MARK: - Empty State

    private var emptyStateView: some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "tray")
                .font(.system(size: 56))
                .foregroundColor(.smTextSecondary)
            Text("No messages yet")
                .font(.title2)
                .fontWeight(.semibold)
                .foregroundColor(.smText)
            Text("Messages from your WhatsApp accounts\nwill appear here")
                .font(.subheadline)
                .foregroundColor(.smTextSecondary)
                .multilineTextAlignment(.center)
            if !pairingService.isPaired {
                Button(action: {}) {
                    Label("Pair with Desktop", systemImage: "qrcode")
                        .font(.headline)
                        .foregroundColor(.smBackground)
                        .padding(.horizontal, 24)
                        .padding(.vertical, 12)
                        .background(Color.smAccent)
                        .cornerRadius(12)
                }
                .padding(.top, 8)
            }
            Spacer()
        }
    }

    // MARK: - Message List

    private var messageListView: some View {
        List {
            ForEach(groupedMessages, id: \.0) { accountName, messages in
                Section {
                    ForEach(messages) { message in
                        MessageRow(
                            message: message,
                            isExpanded: expandedMessageId == message.id,
                            onTap: {
                                withAnimation(.easeInOut(duration: 0.2)) {
                                    expandedMessageId = expandedMessageId == message.id ? nil : message.id
                                }
                                if !message.isRead {
                                    messageStore.markAsRead(messageId: message.id)
                                }
                            },
                            onReply: {
                                quickReplyMessage = message
                                showingQuickReply = true
                            }
                        )
                        .listRowBackground(Color.smSurface)
                        .listRowSeparatorTint(Color.smSurfaceLight)
                    }
                } header: {
                    accountSectionHeader(accountName: accountName, messages: messages)
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .refreshable {
            pairingService.requestSync()
        }
    }

    private func accountSectionHeader(accountName: String, messages: [Message]) -> some View {
        let account = messageStore.accounts.first { $0.name == accountName }
        let unreadCount = messages.filter { !$0.isRead }.count

        return HStack(spacing: 8) {
            AccountDot(color: account?.color ?? "25D366", size: 8)
            Text(accountName)
                .font(.caption)
                .fontWeight(.semibold)
                .foregroundColor(.smTextSecondary)
                .textCase(.uppercase)
            Spacer()
            if unreadCount > 0 {
                Text("\(unreadCount) unread")
                    .font(.caption2)
                    .foregroundColor(.smAccent)
            }
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Message Row

struct MessageRow: View {
    let message: Message
    let isExpanded: Bool
    let onTap: () -> Void
    let onReply: () -> Void
    @EnvironmentObject var messageStore: MessageStore

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Main row
            Button(action: onTap) {
                HStack(alignment: .top, spacing: 12) {
                    // Avatar
                    ZStack {
                        Circle()
                            .fill(Color.smSurfaceLight)
                            .frame(width: 44, height: 44)
                        Text(message.contactName.prefix(1).uppercased())
                            .font(.headline)
                            .fontWeight(.bold)
                            .foregroundColor(.smAccent)
                    }

                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(message.contactName)
                                .font(.subheadline)
                                .fontWeight(message.isRead ? .regular : .bold)
                                .foregroundColor(.smText)
                            Spacer()
                            Text(message.timeFormatted)
                                .font(.caption2)
                                .foregroundColor(.smTextSecondary)
                        }

                        Text(message.text)
                            .font(.subheadline)
                            .foregroundColor(message.isRead ? .smTextSecondary : .smText)
                            .lineLimit(isExpanded ? nil : 2)
                    }

                    if !message.isRead {
                        Circle()
                            .fill(Color.smAccent)
                            .frame(width: 8, height: 8)
                            .padding(.top, 6)
                    }
                }
                .padding(.vertical, 4)
            }
            .buttonStyle(.plain)

            // Expanded actions
            if isExpanded {
                Divider()
                    .background(Color.smSurfaceLight)
                    .padding(.vertical, 8)

                HStack(spacing: 12) {
                    Button(action: onReply) {
                        Label("Reply", systemImage: "arrowshape.turn.up.left.fill")
                            .font(.caption)
                            .fontWeight(.medium)
                            .foregroundColor(.smBackground)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 8)
                            .background(Color.smAccent)
                            .cornerRadius(8)
                    }

                    if !message.isRead {
                        Button {
                            messageStore.markAsRead(messageId: message.id)
                        } label: {
                            Label("Mark Read", systemImage: "checkmark.circle")
                                .font(.caption)
                                .fontWeight(.medium)
                                .foregroundColor(.smAccent)
                                .padding(.horizontal, 16)
                                .padding(.vertical, 8)
                                .background(Color.smAccent.opacity(0.15))
                                .cornerRadius(8)
                        }
                    }

                    Spacer()
                }
                .padding(.bottom, 4)
            }
        }
    }
}

// MARK: - Message Time Formatting

extension Message {
    var timeFormatted: String {
        let calendar = Calendar.current
        let formatter = DateFormatter()

        if calendar.isDateInToday(time) {
            formatter.dateFormat = "h:mm a"
        } else if calendar.isDateInYesterday(time) {
            return "Yesterday"
        } else {
            formatter.dateFormat = "MMM d"
        }
        return formatter.string(from: time)
    }
}
