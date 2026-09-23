import Capacitor
import os
import StoreKit

private let appleIapLogger = Logger(subsystem: "com.gemcardshow.gemgrade", category: "apple-iap")

/// StoreKit 2 bridge for GemGrade consumable credit packs.
/// Product ids must match lib/appleIap.js. Credit amounts are granted only
/// after the server verifies the signed transaction.
@objc(AppleIAPPlugin)
public class AppleIAPPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppleIAPPlugin"
    public let jsName = "AppleIAP"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getProducts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finishTransaction", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getUnfinishedTransactions", returnType: CAPPluginReturnPromise),
    ]

    /// Keep in sync with APPLE_IAP_PRODUCTS in lib/appleIap.js.
    private let productIds = [
        "com.gemcardshow.gemgrade.credits20",
        "com.gemcardshow.gemgrade.credits50",
        "com.gemcardshow.gemgrade.credits100",
        "com.gemcardshow.gemgrade.credits200",
    ]

    private var productsById: [String: Product] = [:]
    private var transactionsById: [UInt64: Transaction] = [:]
    private var updatesTask: Task<Void, Never>?

    @objc override public func load() {
        updatesTask = Task { [weak self] in
            await self?.observeTransactions()
        }
    }

    deinit {
        updatesTask?.cancel()
    }

    @objc func getProducts(_ call: CAPPluginCall) {
        Task { @MainActor in
            do {
                let payload = try await self.loadProducts()
                call.resolve(payload)
            } catch {
                self.log("products_failed error=\(error.localizedDescription)")
                call.reject("Unable to load App Store products.", "products_failed", error)
            }
        }
    }

    @objc func purchase(_ call: CAPPluginCall) {
        guard let productId = call.getString("productId"), !productId.isEmpty else {
            call.reject("Missing productId.", "missing_product")
            return
        }

        guard let token = call.getString("appAccountToken"), let accountId = UUID(uuidString: token) else {
            call.reject("Sign in before purchasing credits.", "missing_account")
            return
        }

        Task { @MainActor in
            do {
                let payload = try await self.performPurchase(productId: productId, accountToken: accountId)
                call.resolve(payload)
            } catch {
                self.log("purchase_failed product=\(productId) error=\(error.localizedDescription)")
                call.reject(error.localizedDescription, "purchase_failed", error)
            }
        }
    }

    @objc func finishTransaction(_ call: CAPPluginCall) {
        guard let transactionId = call.getString("transactionId"), !transactionId.isEmpty else {
            call.reject("Missing transactionId.", "missing_transaction")
            return
        }

        Task { @MainActor in
            let finished = await self.finish(transactionId: transactionId)
            call.resolve(["finished": finished, "transactionId": transactionId])
        }
    }

    @objc func getUnfinishedTransactions(_ call: CAPPluginCall) {
        Task { @MainActor in
            var items: [[String: String]] = []

            for await result in Transaction.unfinished {
                switch result {
                case .verified(let transaction):
                    self.remember(transaction)
                    items.append([
                        "signedTransaction": result.jwsRepresentation,
                        "transactionId": String(transaction.id),
                        "productId": transaction.productID,
                    ])
                case .unverified(let transaction, let error):
                    self.log("unfinished_unverified transaction=\(transaction.id) error=\(error.localizedDescription)")
                }
            }

            self.log("unfinished_count=\(items.count)")
            call.resolve(["transactions": items])
        }
    }

    @MainActor
    private func loadProducts() async throws -> [String: Any] {
        let loaded = try await Product.products(for: Set(productIds))
        productsById = Dictionary(uniqueKeysWithValues: loaded.map { ($0.id, $0) })

        let ordered = productIds.compactMap { productsById[$0] }
        let missing = productIds.filter { productsById[$0] == nil }
        log("products_loaded count=\(ordered.count) missing=\(missing.joined(separator: ","))")

        return [
            "products": ordered.map { product in
                [
                    "productId": product.id,
                    "displayName": product.displayName,
                    "displayPrice": product.displayPrice,
                    "description": product.description,
                ]
            },
            "missingProductIds": missing,
        ]
    }

    @MainActor
    private func performPurchase(productId: String, accountToken: UUID) async throws -> [String: Any] {
        if productsById[productId] == nil {
            _ = try await loadProducts()
        }

        guard let product = productsById[productId] else {
            throw AppleIapPluginError.productUnavailable(productId)
        }

        log("purchase_start product=\(productId)")
        let result = try await product.purchase(options: [.appAccountToken(accountToken)])

        switch result {
        case .success(let verification):
            let transaction = try unwrap(verification)
            remember(transaction)
            log("purchase_success transaction=\(transaction.id) product=\(transaction.productID)")
            return [
                "status": "purchased",
                "signedTransaction": verification.jwsRepresentation,
                "transactionId": String(transaction.id),
                "productId": transaction.productID,
            ]
        case .userCancelled:
            log("purchase_cancelled product=\(productId)")
            return [
                "status": "cancelled",
                "productId": productId,
            ]
        case .pending:
            log("purchase_pending product=\(productId)")
            return [
                "status": "pending",
                "productId": productId,
            ]
        @unknown default:
            throw AppleIapPluginError.unknownResult
        }
    }

    @MainActor
    private func finish(transactionId: String) async -> Bool {
        guard let id = UInt64(transactionId) else {
            log("finish_invalid transaction=\(transactionId)")
            return false
        }

        if let transaction = transactionsById[id] {
            await transaction.finish()
            transactionsById.removeValue(forKey: id)
            log("finished transaction=\(transactionId)")
            return true
        }

        for await result in Transaction.unfinished {
            guard case .verified(let transaction) = result else {
                continue
            }

            remember(transaction)
            if transaction.id == id {
                await transaction.finish()
                transactionsById.removeValue(forKey: id)
                log("finished_unfinished transaction=\(transactionId)")
                return true
            }
        }

        log("finish_not_found transaction=\(transactionId)")
        return false
    }

    private func observeTransactions() async {
        for await result in Transaction.updates {
            switch result {
            case .verified(let transaction):
                let payload = [
                    "signedTransaction": result.jwsRepresentation,
                    "transactionId": String(transaction.id),
                    "productId": transaction.productID,
                ]
                await MainActor.run {
                    self.remember(transaction)
                    self.log("transaction_update transaction=\(transaction.id) product=\(transaction.productID)")
                    self.notifyListeners("transactionUpdated", data: payload)
                }
            case .unverified(let transaction, let error):
                await MainActor.run {
                    self.log("transaction_update_unverified transaction=\(transaction.id) error=\(error.localizedDescription)")
                }
            }
        }
    }

    @MainActor
    private func remember(_ transaction: Transaction) {
        transactionsById[transaction.id] = transaction
    }

    private func unwrap(_ result: VerificationResult<Transaction>) throws -> Transaction {
        switch result {
        case .verified(let transaction):
            return transaction
        case .unverified(_, let error):
            throw AppleIapPluginError.unverified(error.localizedDescription)
        }
    }

    private func log(_ message: String) {
        appleIapLogger.info("\(message, privacy: .public)")
        print("[apple-iap] \(message)")
    }
}

private enum AppleIapPluginError: LocalizedError {
    case productUnavailable(String)
    case unverified(String)
    case unknownResult

    var errorDescription: String? {
        switch self {
        case .productUnavailable(let productId):
            return "App Store product \(productId) is not available."
        case .unverified(let message):
            return "App Store could not verify the purchase. \(message)"
        case .unknownResult:
            return "App Store returned an unknown purchase result."
        }
    }
}
