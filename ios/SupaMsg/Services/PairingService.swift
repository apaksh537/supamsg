import Foundation
import Combine
import UIKit

final class PairingService: ObservableObject {
    @Published var isConnected = false
    @Published var isPaired = false
    @Published var pairingCode: String?
    @Published var connectedHost: String?
    @Published var connectionLost = false

    weak var messageStore: MessageStore?

    private var webSocketTask: URLSessionWebSocketTask?
    private var session: URLSession?
    private var reconnectTimer: Timer?
    private var reconnectAttempts = 0
    private let maxReconnectAttempts = 10
    private let baseReconnectDelay: TimeInterval = 2.0
    private var cancellables = Set<AnyCancellable>()

    private let pairedHostKey = "pairedHost"
    private let pairedCodeKey = "pairedCode"
    private let pairedDevicesKey = "pairedDevices"

    init() {
        loadPairingState()
        setupNotificationObservers()
    }

    deinit {
        disconnect()
    }

    // MARK: - Pairing State

    private func loadPairingState() {
        if let host = UserDefaults.standard.string(forKey: pairedHostKey) {
            connectedHost = host
            isPaired = true
        }
    }

    private func savePairingState(host: String, code: String) {
        UserDefaults.standard.set(host, forKey: pairedHostKey)
        UserDefaults.standard.set(code, forKey: pairedCodeKey)
        connectedHost = host
        isPaired = true
    }

    func unpair() {
        disconnect()
        UserDefaults.standard.removeObject(forKey: pairedHostKey)
        UserDefaults.standard.removeObject(forKey: pairedCodeKey)
        connectedHost = nil
        isPaired = false
        pairingCode = nil
    }

    // MARK: - Pairing Code

    func generatePairingCode() {
        let code = String(format: "%06d", Int.random(in: 0...999999))
        pairingCode = code
    }

    // MARK: - Connection

    func connectIfPaired() {
        guard let host = UserDefaults.standard.string(forKey: pairedHostKey) else { return }
        let code = UserDefaults.standard.string(forKey: pairedCodeKey) ?? ""
        connect(to: host, code: code)
    }

    func connectManually(host: String, code: String) {
        savePairingState(host: host, code: code)
        connect(to: host, code: code)
    }

    private func connect(to host: String, code: String) {
        disconnect()

        let urlString = "ws://\(host):8765"
        guard let url = URL(string: urlString) else {
            #if DEBUG
            print("[SupaMsg] Invalid WebSocket URL: \(urlString)")
            #endif
            return
        }

        session = URLSession(configuration: .default)
        webSocketTask = session?.webSocketTask(with: url)
        webSocketTask?.resume()

        // Send pairing handshake
        let handshake: [String: Any] = [
            "type": "pair",
            "code": code,
            "platform": "ios",
            "deviceName": UIDevice.current.name,
            "deviceToken": NotificationService.shared.deviceToken ?? ""
        ]

        sendJSON(handshake)
        receiveMessage()

        DispatchQueue.main.async {
            self.isConnected = true
            self.connectedHost = host
            self.reconnectAttempts = 0
            self.connectionLost = false
        }

        #if DEBUG
        print("[SupaMsg] Connected to \(urlString)")
        #endif
    }

    func disconnect() {
        reconnectTimer?.invalidate()
        reconnectTimer = nil
        webSocketTask?.cancel(with: .normalClosure, reason: nil)
        webSocketTask = nil
        session?.invalidateAndCancel()
        session = nil

        DispatchQueue.main.async {
            self.isConnected = false
        }
    }

    // MARK: - Auto Reconnect

    private func scheduleReconnect() {
        guard isPaired, reconnectAttempts < maxReconnectAttempts else {
            if reconnectAttempts >= maxReconnectAttempts {
                DispatchQueue.main.async {
                    self.connectionLost = true
                }
            }
            return
        }

        reconnectAttempts += 1
        let delay = baseReconnectDelay * pow(1.5, Double(reconnectAttempts - 1))
        let clampedDelay = min(delay, 30.0)

        #if DEBUG
        print("[SupaMsg] Scheduling reconnect in \(clampedDelay)s (attempt \(reconnectAttempts))")
        #endif

        reconnectTimer?.invalidate()
        reconnectTimer = Timer.scheduledTimer(withTimeInterval: clampedDelay, repeats: false) { [weak self] _ in
            self?.connectIfPaired()
        }
    }

    // MARK: - WebSocket Messaging

    private func receiveMessage() {
        webSocketTask?.receive { [weak self] result in
            switch result {
            case .success(let message):
                switch message {
                case .string(let text):
                    self?.handleIncomingMessage(text)
                case .data(let data):
                    if let text = String(data: data, encoding: .utf8) {
                        self?.handleIncomingMessage(text)
                    }
                @unknown default:
                    break
                }
                // Continue listening
                self?.receiveMessage()

            case .failure(let error):
                #if DEBUG
                print("[SupaMsg] WebSocket receive error: \(error.localizedDescription)")
                #endif
                DispatchQueue.main.async {
                    self?.isConnected = false
                }
                self?.scheduleReconnect()
            }
        }
    }

    private func handleIncomingMessage(_ text: String) {
        guard let data = text.data(using: .utf8) else { return }

        do {
            let payload = try JSONDecoder().decode(MessagePayload.self, from: data)

            DispatchQueue.main.async { [weak self] in
                self?.processPayload(payload)
            }
        } catch {
            #if DEBUG
            print("[SupaMsg] Failed to decode message: \(error.localizedDescription)")
            #endif
        }
    }

    private func processPayload(_ payload: MessagePayload) {
        switch payload.type {
        case "message":
            // New incoming message
            guard let accountId = payload.accountId,
                  let accountName = payload.accountName,
                  let contactName = payload.contactName,
                  let text = payload.text else { return }

            let message = Message(
                accountId: accountId,
                accountName: accountName,
                contactName: contactName,
                text: text,
                time: payload.timestamp.map { Date(timeIntervalSince1970: $0) } ?? Date(),
                isOutgoing: false,
                isRead: false
            )
            messageStore?.addMessage(message)

            // Show notification
            NotificationService.shared.showNotification(
                accountId: accountId,
                accountName: accountName,
                contactName: contactName,
                messageText: text
            )

        case "sync":
            // Full sync of messages and accounts
            if let accounts = payload.accounts {
                for ap in accounts {
                    let account = Account(
                        id: ap.id,
                        name: ap.name,
                        color: ap.color ?? Account.nextColor(existingCount: messageStore?.accounts.count ?? 0),
                        isConnected: ap.isConnected ?? false,
                        unreadCount: ap.unreadCount ?? 0
                    )
                    messageStore?.upsertAccount(account)
                }
            }

        case "account_update":
            if let accounts = payload.accounts {
                for ap in accounts {
                    let account = Account(
                        id: ap.id,
                        name: ap.name,
                        color: ap.color ?? "25D366",
                        isConnected: ap.isConnected ?? false,
                        unreadCount: ap.unreadCount ?? 0
                    )
                    messageStore?.upsertAccount(account)
                }
            }

        case "pair_ack":
            // Pairing acknowledged by desktop
            #if DEBUG
            print("[SupaMsg] Pairing acknowledged by desktop")
            #endif
            isPaired = true
            if let host = payload.host {
                savePairingState(host: host, code: payload.code ?? "")
            }
            // Request a sync to get accounts
            requestSync()

        case "pong":
            break // Keep-alive response

        default:
            #if DEBUG
            print("[SupaMsg] Unknown message type: \(payload.type)")
            #endif
        }
    }

    private func sendJSON(_ dict: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: dict),
              let text = String(data: data, encoding: .utf8) else { return }

        webSocketTask?.send(.string(text)) { error in
            if let error = error {
                #if DEBUG
                print("[SupaMsg] Send error: \(error.localizedDescription)")
                #endif
            }
        }
    }

    // MARK: - Send Reply

    func sendReply(accountId: String, contactName: String, text: String) {
        let payload: [String: Any] = [
            "type": "reply",
            "accountId": accountId,
            "contactName": contactName,
            "text": text,
            "timestamp": Date().timeIntervalSince1970
        ]
        sendJSON(payload)
    }

    // MARK: - Request Sync

    func requestSync() {
        sendJSON(["type": "sync_request"])
    }

    // MARK: - Keep Alive

    func startKeepAlive() {
        Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            self?.sendJSON(["type": "ping"])
        }
    }

    // MARK: - Notification Observers

    private func setupNotificationObservers() {
        NotificationCenter.default.publisher(for: .quickReplyFromNotification)
            .sink { [weak self] notification in
                guard let userInfo = notification.userInfo,
                      let accountId = userInfo["accountId"] as? String,
                      let contactName = userInfo["contactName"] as? String,
                      let text = userInfo["text"] as? String else { return }
                self?.sendReply(accountId: accountId, contactName: contactName, text: text)
            }
            .store(in: &cancellables)

        NotificationCenter.default.publisher(for: .markReadFromNotification)
            .sink { [weak self] notification in
                guard let userInfo = notification.userInfo,
                      let accountId = userInfo["accountId"] as? String,
                      let contactName = userInfo["contactName"] as? String else { return }
                self?.messageStore?.markConversationAsRead(accountId: accountId, contactName: contactName)
                self?.sendJSON([
                    "type": "mark_read",
                    "accountId": accountId,
                    "contactName": contactName
                ])
            }
            .store(in: &cancellables)
    }
}
