import SwiftUI

struct AccountsView: View {
    @EnvironmentObject var messageStore: MessageStore
    @EnvironmentObject var pairingService: PairingService
    @State private var showingPairSheet = false
    @State private var showingRemoveAlert = false
    @State private var accountToRemove: Account?

    var body: some View {
        NavigationStack {
            ZStack {
                Color.smBackground.ignoresSafeArea()

                VStack(spacing: 0) {
                    ConnectionStatusBanner()

                    if messageStore.accounts.isEmpty {
                        emptyAccountsView
                    } else {
                        accountListView
                    }
                }
            }
            .navigationTitle("Accounts")
            .navigationBarTitleDisplayMode(.large)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showingPairSheet = true
                    } label: {
                        Image(systemName: "plus.circle.fill")
                            .foregroundColor(.smAccent)
                            .font(.title3)
                    }
                }
            }
            .sheet(isPresented: $showingPairSheet) {
                PairingSheet()
                    .environmentObject(pairingService)
            }
            .alert("Remove Account", isPresented: $showingRemoveAlert) {
                Button("Cancel", role: .cancel) {}
                Button("Remove", role: .destructive) {
                    if let account = accountToRemove {
                        messageStore.removeAccount(accountId: account.id)
                    }
                }
            } message: {
                Text("This will remove \(accountToRemove?.name ?? "this account") and all its messages from this device. The account will still be active on your desktop.")
            }
        }
    }

    // MARK: - Empty State

    private var emptyAccountsView: some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "person.crop.circle.badge.plus")
                .font(.system(size: 56))
                .foregroundColor(.smTextSecondary)
            Text("No accounts linked")
                .font(.title2)
                .fontWeight(.semibold)
                .foregroundColor(.smText)
            Text("Pair with your SupaMsg desktop app\nto receive notifications here")
                .font(.subheadline)
                .foregroundColor(.smTextSecondary)
                .multilineTextAlignment(.center)
            Button {
                showingPairSheet = true
            } label: {
                Label("Pair with Desktop", systemImage: "link.circle.fill")
                    .font(.headline)
                    .foregroundColor(.smBackground)
                    .padding(.horizontal, 24)
                    .padding(.vertical, 12)
                    .background(Color.smAccent)
                    .cornerRadius(12)
            }
            .padding(.top, 8)
            Spacer()
        }
    }

    // MARK: - Account List

    private var accountListView: some View {
        List {
            ForEach(messageStore.accounts) { account in
                AccountRow(account: account)
                    .listRowBackground(Color.smSurface)
                    .listRowSeparatorTint(Color.smSurfaceLight)
                    .swipeActions(edge: .trailing) {
                        Button(role: .destructive) {
                            accountToRemove = account
                            showingRemoveAlert = true
                        } label: {
                            Label("Remove", systemImage: "trash")
                        }
                    }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
    }
}

// MARK: - Account Row

struct AccountRow: View {
    let account: Account
    @EnvironmentObject var messageStore: MessageStore

    var body: some View {
        HStack(spacing: 14) {
            // Colored avatar
            ZStack {
                Circle()
                    .fill(Color(hex: account.color).opacity(0.2))
                    .frame(width: 48, height: 48)
                Circle()
                    .fill(Color(hex: account.color))
                    .frame(width: 44, height: 44)
                Text(account.name.prefix(1).uppercased())
                    .font(.title3)
                    .fontWeight(.bold)
                    .foregroundColor(.white)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(account.name)
                    .font(.body)
                    .fontWeight(.semibold)
                    .foregroundColor(.smText)

                HStack(spacing: 6) {
                    Circle()
                        .fill(account.isConnected ? Color.smAccent : Color.smDanger)
                        .frame(width: 6, height: 6)
                    Text(account.isConnected ? "Connected" : "Disconnected")
                        .font(.caption)
                        .foregroundColor(account.isConnected ? .smAccent : .smDanger)
                }
            }

            Spacer()

            if account.unreadCount > 0 {
                Text("\(account.unreadCount)")
                    .font(.caption)
                    .fontWeight(.bold)
                    .foregroundColor(.white)
                    .frame(minWidth: 24, minHeight: 24)
                    .background(Color.smAccent)
                    .clipShape(Circle())
            }

            Image(systemName: "chevron.right")
                .font(.caption)
                .foregroundColor(.smTextSecondary)
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Pairing Sheet

struct PairingSheet: View {
    @EnvironmentObject var pairingService: PairingService
    @Environment(\.dismiss) var dismiss
    @State private var codeInput = ""
    @State private var ipInput = ""
    @State private var showAdvanced = false

    var body: some View {
        NavigationStack {
            ZStack {
                Color.smBackground.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 24) {
                        // Header
                        VStack(spacing: 8) {
                            Image("Logo")
                                .resizable()
                                .frame(width: 64, height: 64)
                                .clipShape(RoundedRectangle(cornerRadius: 14))

                            Text("Connect to Desktop")
                                .font(.title2)
                                .fontWeight(.bold)
                                .foregroundColor(.smText)

                            Text("Get all your WhatsApp notifications\non this phone")
                                .font(.subheadline)
                                .foregroundColor(.smTextSecondary)
                                .multilineTextAlignment(.center)
                        }
                        .padding(.top, 24)

                        // Simple steps
                        VStack(alignment: .leading, spacing: 16) {
                            PairingStep(number: 1, text: "Open SupaMsg on your Mac or PC")
                            PairingStep(number: 2, text: "Click Settings → Connect Phone")
                            PairingStep(number: 3, text: "Enter the 6-digit code below")
                        }
                        .padding(.horizontal)

                        // Code input — just the code, nice and big
                        VStack(spacing: 8) {
                            Text("Enter code from desktop")
                                .font(.caption)
                                .foregroundColor(.smTextSecondary)
                                .textCase(.uppercase)
                                .tracking(1)

                            TextField("000 000", text: $codeInput)
                                .font(.system(size: 32, weight: .bold, design: .monospaced))
                                .multilineTextAlignment(.center)
                                .keyboardType(.numberPad)
                                .padding(.horizontal, 24)
                                .padding(.vertical, 16)
                                .background(Color.smSurface)
                                .cornerRadius(12)
                                .foregroundColor(.smText)
                        }

                        // Connect button
                        Button {
                            // Auto-detect IP or use manual
                            let ip = ipInput.isEmpty ? "192.168.1.1" : ipInput
                            pairingService.connectManually(host: ip, code: codeInput)
                            dismiss()
                        } label: {
                            Text("Connect")
                                .font(.headline)
                                .foregroundColor(.white)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 14)
                                .background(codeInput.count >= 6 ? Color.smAccent : Color.smTextSecondary.opacity(0.3))
                                .cornerRadius(12)
                        }
                        .disabled(codeInput.count < 6)
                        .padding(.horizontal)

                        // Advanced: IP entry (hidden by default)
                        Button {
                            withAnimation { showAdvanced.toggle() }
                        } label: {
                            Text(showAdvanced ? "Hide advanced options" : "Having trouble connecting?")
                                .font(.caption)
                                .foregroundColor(.smAccent)
                        }

                        if showAdvanced {
                            VStack(spacing: 8) {
                                Text("Desktop IP address (found in desktop Settings)")
                                    .font(.caption)
                                    .foregroundColor(.smTextSecondary)
                                TextField("e.g. 192.168.1.34", text: $ipInput)
                                    .textFieldStyle(SMTextFieldStyle())
                                    .keyboardType(.decimalPad)
                                    .autocorrectionDisabled()
                            }
                            .padding(.horizontal)
                        }

                        Spacer(minLength: 40)
                    }
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .foregroundColor(.smAccent)
                }
            }
            .onAppear {
                pairingService.generatePairingCode()
            }
        }
    }
}

struct PairingStep: View {
    let number: Int
    let text: String

    var body: some View {
        HStack(spacing: 12) {
            Text("\(number)")
                .font(.caption)
                .fontWeight(.bold)
                .foregroundColor(.smBackground)
                .frame(width: 24, height: 24)
                .background(Color.smAccent)
                .clipShape(Circle())
            Text(text)
                .font(.subheadline)
                .foregroundColor(.smText)
        }
    }
}

// MARK: - Custom Text Field Style

struct SMTextFieldStyle: TextFieldStyle {
    func _body(configuration: TextField<Self._Label>) -> some View {
        configuration
            .padding(14)
            .background(Color.smSurface)
            .foregroundColor(.smText)
            .cornerRadius(10)
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(Color.smSurfaceLight, lineWidth: 1)
            )
    }
}
