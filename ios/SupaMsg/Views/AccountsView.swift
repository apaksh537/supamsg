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
    @State private var manualCode = ""
    @State private var serverIP = ""
    @State private var showManualEntry = false

    var body: some View {
        NavigationStack {
            ZStack {
                Color.smBackground.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 24) {
                        // Header
                        VStack(spacing: 8) {
                            Image(systemName: "link.circle.fill")
                                .font(.system(size: 64))
                                .foregroundColor(.smAccent)

                            Text("Pair with Desktop")
                                .font(.title2)
                                .fontWeight(.bold)
                                .foregroundColor(.smText)

                            Text("Connect to your SupaMsg desktop app\nto receive notifications on this device")
                                .font(.subheadline)
                                .foregroundColor(.smTextSecondary)
                                .multilineTextAlignment(.center)
                        }
                        .padding(.top, 24)

                        // Steps
                        VStack(alignment: .leading, spacing: 16) {
                            PairingStep(number: 1, text: "Open SupaMsg on your computer")
                            PairingStep(number: 2, text: "Go to Settings > Mobile Notifications")
                            PairingStep(number: 3, text: "Enter the pairing code shown below")
                        }
                        .padding(.horizontal)

                        // Pairing code display
                        if let code = pairingService.pairingCode {
                            VStack(spacing: 8) {
                                Text("Your Pairing Code")
                                    .font(.caption)
                                    .foregroundColor(.smTextSecondary)
                                    .textCase(.uppercase)
                                    .tracking(1)

                                Text(code)
                                    .font(.system(size: 36, weight: .bold, design: .monospaced))
                                    .foregroundColor(.smAccent)
                                    .tracking(8)
                                    .padding(.horizontal, 24)
                                    .padding(.vertical, 16)
                                    .background(Color.smSurface)
                                    .cornerRadius(12)
                            }
                        }

                        Divider()
                            .background(Color.smSurfaceLight)
                            .padding(.horizontal, 32)

                        // Manual connection
                        Button {
                            withAnimation { showManualEntry.toggle() }
                        } label: {
                            HStack {
                                Text("Connect manually")
                                    .font(.subheadline)
                                    .foregroundColor(.smAccent)
                                Image(systemName: showManualEntry ? "chevron.up" : "chevron.down")
                                    .font(.caption)
                                    .foregroundColor(.smAccent)
                            }
                        }

                        if showManualEntry {
                            VStack(spacing: 12) {
                                TextField("Desktop IP address", text: $serverIP)
                                    .textFieldStyle(SMTextFieldStyle())
                                    .keyboardType(.decimalPad)
                                    .autocorrectionDisabled()

                                TextField("Pairing code", text: $manualCode)
                                    .textFieldStyle(SMTextFieldStyle())
                                    .keyboardType(.numberPad)

                                Button {
                                    pairingService.connectManually(host: serverIP, code: manualCode)
                                    dismiss()
                                } label: {
                                    Text("Connect")
                                        .font(.headline)
                                        .foregroundColor(.smBackground)
                                        .frame(maxWidth: .infinity)
                                        .padding(.vertical, 14)
                                        .background(Color.smAccent)
                                        .cornerRadius(12)
                                }
                                .disabled(serverIP.isEmpty || manualCode.isEmpty)
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
