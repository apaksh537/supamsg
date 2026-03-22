import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var messageStore: MessageStore
    @EnvironmentObject var pairingService: PairingService
    @AppStorage("dndEnabled") private var dndEnabled = false
    @AppStorage("dndStartHour") private var dndStartHour = 22
    @AppStorage("dndEndHour") private var dndEndHour = 7
    @AppStorage("licenseKey") private var licenseKey = ""
    @AppStorage("licenseActivated") private var licenseActivated = false
    @State private var showingLicenseAlert = false
    @State private var licenseInput = ""
    @State private var showingPairSheet = false
    @State private var showingClearDataAlert = false

    var body: some View {
        NavigationStack {
            ZStack {
                Color.smBackground.ignoresSafeArea()

                List {
                    // Connection status
                    connectionSection

                    // Notification preferences
                    notificationSection

                    // DND schedule
                    dndSection

                    // License
                    licenseSection

                    // Data & storage
                    dataSection

                    // About
                    aboutSection
                }
                .listStyle(.insetGrouped)
                .scrollContentBackground(.hidden)
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.large)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .sheet(isPresented: $showingPairSheet) {
                PairingSheet()
                    .environmentObject(pairingService)
            }
            .alert("Activate License", isPresented: $showingLicenseAlert) {
                TextField("Enter license key", text: $licenseInput)
                    .autocorrectionDisabled()
                Button("Cancel", role: .cancel) {}
                Button("Activate") {
                    activateLicense()
                }
            } message: {
                Text("Enter your SupaMsg Pro license key to unlock all features.")
            }
            .alert("Clear All Data", isPresented: $showingClearDataAlert) {
                Button("Cancel", role: .cancel) {}
                Button("Clear", role: .destructive) {
                    messageStore.clearAllData()
                    pairingService.unpair()
                }
            } message: {
                Text("This will remove all messages, accounts, and pairing data from this device. This cannot be undone.")
            }
        }
    }

    // MARK: - Connection

    private var connectionSection: some View {
        Section {
            HStack(spacing: 12) {
                Image(systemName: pairingService.isConnected ? "wifi" : "wifi.slash")
                    .foregroundColor(pairingService.isConnected ? .smAccent : .smDanger)
                    .font(.title3)

                VStack(alignment: .leading, spacing: 2) {
                    Text(pairingService.isConnected ? "Connected to Desktop" : "Not Connected")
                        .font(.subheadline)
                        .fontWeight(.medium)
                        .foregroundColor(.smText)
                    if let host = pairingService.connectedHost {
                        Text(host)
                            .font(.caption)
                            .foregroundColor(.smTextSecondary)
                    }
                }

                Spacer()

                if pairingService.isPaired {
                    Button(pairingService.isConnected ? "Reconnect" : "Connect") {
                        pairingService.connectIfPaired()
                    }
                    .font(.caption)
                    .foregroundColor(.smAccent)
                }
            }
            .listRowBackground(Color.smSurface)

            if pairingService.isPaired {
                Button(role: .destructive) {
                    pairingService.unpair()
                    messageStore.clearAllData()
                } label: {
                    Label("Disconnect from Desktop", systemImage: "wifi.slash")
                        .foregroundColor(.smDanger)
                }
                .listRowBackground(Color.smSurface)
            } else {
                Button {
                    showingPairSheet = true
                } label: {
                    Label("Pair with Desktop App", systemImage: "qrcode")
                        .foregroundColor(.smAccent)
                }
                .listRowBackground(Color.smSurface)
            }
        } header: {
            Text("Connection")
                .foregroundColor(.smTextSecondary)
        } footer: {
            if pairingService.isPaired {
                Text("Disconnecting will remove all synced data from this device. You can reconnect anytime.")
                    .foregroundColor(.smTextSecondary)
            }
        }
    }

    // MARK: - Notifications

    private var notificationSection: some View {
        Section {
            ForEach(messageStore.accounts) { account in
                Toggle(isOn: Binding(
                    get: { messageStore.isNotificationEnabled(for: account.id) },
                    set: { messageStore.setNotificationEnabled($0, for: account.id) }
                )) {
                    HStack(spacing: 10) {
                        AccountDot(color: account.color)
                        Text(account.name)
                            .font(.subheadline)
                            .foregroundColor(.smText)
                    }
                }
                .tint(.smAccent)
                .listRowBackground(Color.smSurface)
            }

            if messageStore.accounts.isEmpty {
                Text("No accounts linked yet")
                    .font(.subheadline)
                    .foregroundColor(.smTextSecondary)
                    .listRowBackground(Color.smSurface)
            }
        } header: {
            Text("Notifications")
                .foregroundColor(.smTextSecondary)
        } footer: {
            Text("Disable notifications for specific accounts without removing them.")
                .foregroundColor(.smTextSecondary)
        }
    }

    // MARK: - DND

    private var dndSection: some View {
        Section {
            Toggle("Do Not Disturb", isOn: $dndEnabled)
                .tint(.smAccent)
                .listRowBackground(Color.smSurface)

            if dndEnabled {
                HStack {
                    Text("From")
                        .foregroundColor(.smText)
                    Spacer()
                    Picker("Start", selection: $dndStartHour) {
                        ForEach(0..<24, id: \.self) { hour in
                            Text(formatHour(hour)).tag(hour)
                        }
                    }
                    .pickerStyle(.menu)
                    .tint(.smAccent)
                }
                .listRowBackground(Color.smSurface)

                HStack {
                    Text("To")
                        .foregroundColor(.smText)
                    Spacer()
                    Picker("End", selection: $dndEndHour) {
                        ForEach(0..<24, id: \.self) { hour in
                            Text(formatHour(hour)).tag(hour)
                        }
                    }
                    .pickerStyle(.menu)
                    .tint(.smAccent)
                }
                .listRowBackground(Color.smSurface)
            }
        } header: {
            Text("Do Not Disturb")
                .foregroundColor(.smTextSecondary)
        } footer: {
            if dndEnabled {
                Text("Notifications will be silenced from \(formatHour(dndStartHour)) to \(formatHour(dndEndHour)).")
                    .foregroundColor(.smTextSecondary)
            }
        }
    }

    // MARK: - License

    private var licenseSection: some View {
        Section {
            if licenseActivated {
                HStack(spacing: 12) {
                    Image(systemName: "checkmark.seal.fill")
                        .foregroundColor(.smAccent)
                        .font(.title3)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("SupaMsg Pro")
                            .font(.subheadline)
                            .fontWeight(.semibold)
                            .foregroundColor(.smText)
                        Text("License active")
                            .font(.caption)
                            .foregroundColor(.smAccent)
                    }
                    Spacer()
                }
                .listRowBackground(Color.smSurface)
            } else {
                Button {
                    showingLicenseAlert = true
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: "key.fill")
                            .foregroundColor(.smWarning)
                        Text("Activate License")
                            .foregroundColor(.smText)
                        Spacer()
                        Text("Free Plan")
                            .font(.caption)
                            .foregroundColor(.smTextSecondary)
                    }
                }
                .listRowBackground(Color.smSurface)
            }
        } header: {
            Text("License")
                .foregroundColor(.smTextSecondary)
        }
    }

    // MARK: - Data

    private var dataSection: some View {
        Section {
            HStack {
                Text("Messages stored")
                    .foregroundColor(.smText)
                Spacer()
                Text("\(messageStore.recentMessages.count)")
                    .foregroundColor(.smTextSecondary)
            }
            .listRowBackground(Color.smSurface)

            Button(role: .destructive) {
                showingClearDataAlert = true
            } label: {
                Label("Clear All Data", systemImage: "trash")
                    .foregroundColor(.smDanger)
            }
            .listRowBackground(Color.smSurface)
        } header: {
            Text("Data & Storage")
                .foregroundColor(.smTextSecondary)
        }
    }

    // MARK: - About

    private var aboutSection: some View {
        Section {
            HStack {
                Text("Version")
                    .foregroundColor(.smText)
                Spacer()
                Text("1.0.0")
                    .foregroundColor(.smTextSecondary)
            }
            .listRowBackground(Color.smSurface)

            Link(destination: URL(string: "https://supamsg.com/support")!) {
                HStack {
                    Text("Support")
                        .foregroundColor(.smText)
                    Spacer()
                    Image(systemName: "arrow.up.right")
                        .font(.caption)
                        .foregroundColor(.smTextSecondary)
                }
            }
            .listRowBackground(Color.smSurface)

            Link(destination: URL(string: "https://supamsg.com/privacy")!) {
                HStack {
                    Text("Privacy Policy")
                        .foregroundColor(.smText)
                    Spacer()
                    Image(systemName: "arrow.up.right")
                        .font(.caption)
                        .foregroundColor(.smTextSecondary)
                }
            }
            .listRowBackground(Color.smSurface)
        } header: {
            Text("About")
                .foregroundColor(.smTextSecondary)
        } footer: {
            Text("SupaMsg Notification Hub\nCompanion app for SupaMsg Desktop")
                .foregroundColor(.smTextSecondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
                .padding(.top, 8)
        }
    }

    // MARK: - Helpers

    private func formatHour(_ hour: Int) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "h:mm a"
        let calendar = Calendar.current
        let date = calendar.date(from: DateComponents(hour: hour)) ?? Date()
        return formatter.string(from: date)
    }

    private func activateLicense() {
        let trimmed = licenseInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        licenseKey = trimmed
        licenseActivated = true
        // In production, validate against a server
    }
}
