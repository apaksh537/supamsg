import SwiftUI

struct QuickReplyView: View {
    let message: Message
    @EnvironmentObject var messageStore: MessageStore
    @EnvironmentObject var pairingService: PairingService
    @Environment(\.dismiss) var dismiss
    @State private var replyText = ""
    @State private var isSending = false
    @State private var showTemplates = false
    @FocusState private var isTextFieldFocused: Bool

    private let templates = [
        "Got it, thanks!",
        "I'll get back to you shortly.",
        "Can we discuss this later?",
        "Sure, sounds good!",
        "Let me check and confirm.",
        "On it!",
        "Will do.",
        "Thanks for letting me know."
    ]

    var conversationContext: [Message] {
        messageStore.getConversationContext(
            accountId: message.accountId,
            contactName: message.contactName,
            limit: 5
        )
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.smBackground.ignoresSafeArea()

                VStack(spacing: 0) {
                    // Contact header
                    contactHeader

                    Divider().background(Color.smSurfaceLight)

                    // Conversation context
                    ScrollView {
                        LazyVStack(spacing: 8) {
                            ForEach(conversationContext) { msg in
                                MessageBubble(message: msg)
                            }
                        }
                        .padding()
                    }

                    Divider().background(Color.smSurfaceLight)

                    // Template picker
                    if showTemplates {
                        templatePicker
                    }

                    // Input bar
                    inputBar
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                        .foregroundColor(.smTextSecondary)
                }
            }
        }
    }

    // MARK: - Contact Header

    private var contactHeader: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(Color.smSurfaceLight)
                    .frame(width: 40, height: 40)
                Text(message.contactName.prefix(1).uppercased())
                    .font(.headline)
                    .fontWeight(.bold)
                    .foregroundColor(.smAccent)
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(message.contactName)
                    .font(.headline)
                    .foregroundColor(.smText)
                HStack(spacing: 6) {
                    AccountDot(color: accountColor, size: 6)
                    Text(message.accountName)
                        .font(.caption)
                        .foregroundColor(.smTextSecondary)
                }
            }

            Spacer()
        }
        .padding()
        .background(Color.smSurface)
    }

    private var accountColor: String {
        messageStore.accounts.first { $0.id == message.accountId }?.color ?? "25D366"
    }

    // MARK: - Message Bubble

    struct MessageBubble: View {
        let message: Message

        var body: some View {
            HStack {
                if message.isOutgoing { Spacer(minLength: 60) }

                VStack(alignment: message.isOutgoing ? .trailing : .leading, spacing: 4) {
                    Text(message.text)
                        .font(.subheadline)
                        .foregroundColor(.white)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(message.isOutgoing ? Color.smAccentDim : Color.smSurfaceLight)
                        .cornerRadius(16, corners: message.isOutgoing
                            ? [.topLeft, .topRight, .bottomLeft]
                            : [.topLeft, .topRight, .bottomRight])

                    Text(message.timeFormatted)
                        .font(.caption2)
                        .foregroundColor(.smTextSecondary)
                }

                if !message.isOutgoing { Spacer(minLength: 60) }
            }
        }
    }

    // MARK: - Template Picker

    private var templatePicker: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(templates, id: \.self) { template in
                    Button {
                        replyText = template
                        showTemplates = false
                        isTextFieldFocused = true
                    } label: {
                        Text(template)
                            .font(.caption)
                            .foregroundColor(.smText)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(Color.smSurfaceLight)
                            .cornerRadius(16)
                    }
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
        }
        .background(Color.smSurface)
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }

    // MARK: - Input Bar

    private var inputBar: some View {
        HStack(spacing: 10) {
            // Template button
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    showTemplates.toggle()
                }
            } label: {
                Image(systemName: "text.badge.star")
                    .font(.title3)
                    .foregroundColor(showTemplates ? .smAccent : .smTextSecondary)
            }

            // Text field
            TextField("Type a message...", text: $replyText, axis: .vertical)
                .textFieldStyle(.plain)
                .foregroundColor(.smText)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(Color.smSurface)
                .cornerRadius(20)
                .overlay(
                    RoundedRectangle(cornerRadius: 20)
                        .stroke(Color.smSurfaceLight, lineWidth: 1)
                )
                .lineLimit(1...4)
                .focused($isTextFieldFocused)

            // Send button
            Button {
                sendReply()
            } label: {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.title2)
                    .foregroundColor(replyText.trimmingCharacters(in: .whitespaces).isEmpty ? .smTextSecondary : .smAccent)
            }
            .disabled(replyText.trimmingCharacters(in: .whitespaces).isEmpty || isSending)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Color.smBackground)
    }

    // MARK: - Actions

    private func sendReply() {
        let text = replyText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        isSending = true

        pairingService.sendReply(
            accountId: message.accountId,
            contactName: message.contactName,
            text: text
        )

        // Add outgoing message locally
        let outgoing = Message(
            id: UUID().uuidString,
            accountId: message.accountId,
            accountName: message.accountName,
            contactName: message.contactName,
            text: text,
            time: Date(),
            isOutgoing: true,
            isRead: true
        )
        messageStore.addMessage(outgoing)

        replyText = ""
        isSending = false

        // Haptic feedback
        let impact = UIImpactFeedbackGenerator(style: .medium)
        impact.impactOccurred()

        // Dismiss after a short delay
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            dismiss()
        }
    }
}

// MARK: - Corner Radius Extension

extension View {
    func cornerRadius(_ radius: CGFloat, corners: UIRectCorner) -> some View {
        clipShape(RoundedCorner(radius: radius, corners: corners))
    }
}

struct RoundedCorner: Shape {
    var radius: CGFloat = .infinity
    var corners: UIRectCorner = .allCorners

    func path(in rect: CGRect) -> Path {
        let path = UIBezierPath(
            roundedRect: rect,
            byRoundingCorners: corners,
            cornerRadii: CGSize(width: radius, height: radius)
        )
        return Path(path.cgPath)
    }
}
