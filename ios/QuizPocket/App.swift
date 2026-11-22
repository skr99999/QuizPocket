import UIKit
import WebKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let scene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: scene)
        let controller = QuizViewController()
        window.rootViewController = controller
        self.window = window
        window.makeKeyAndVisible()
        for context in options.urlContexts {
            controller.open(context.url)
        }
    }

    func scene(_ scene: UIScene, openURLContexts contexts: Set<UIOpenURLContext>) {
        guard let controller = window?.rootViewController as? QuizViewController else { return }
        for context in contexts {
            controller.open(context.url)
        }
    }
}

final class QuizViewController: UIViewController, WKNavigationDelegate {
    private let web = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
    private var server: LoopbackServer?
    private var ready = false
    private var importing = false
    private var pending: [URL] = []

    override func viewDidLoad() {
        super.viewDidLoad()
        let background = UIColor(red: 238 / 255, green: 243 / 255, blue: 247 / 255, alpha: 1)
        view.backgroundColor = background
        web.underPageBackgroundColor = background
        web.navigationDelegate = self
        web.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(web)
        let safe = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            web.topAnchor.constraint(equalTo: safe.topAnchor),
            web.leadingAnchor.constraint(equalTo: safe.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: safe.trailingAnchor),
            web.bottomAnchor.constraint(equalTo: safe.bottomAnchor),
        ])
        startServer()
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .darkContent }

    private func startServer() {
        do {
            let server = try LoopbackServer()
            self.server = server
            server.start { [weak self] state in
                DispatchQueue.main.async {
                    switch state {
                    case .ready:
                        self?.web.load(URLRequest(url: LoopbackServer.home))
                    case .waiting(let error), .failed(let error):
                        self?.server = nil
                        self?.showError("无法启动离线题库。\n\(error)")
                    default: break
                    }
                }
            }
        } catch {
            showError("无法读取应用内的题库页面。\n\(error)")
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(action.request.url == LoopbackServer.home && action.targetFrame?.isMainFrame == true ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        ready = webView.url == LoopbackServer.home
        importNext()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        ready = false
        showError("无法打开离线题库页面。\n\(error.localizedDescription)")
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        ready = false
        if server != nil {
            webView.load(URLRequest(url: LoopbackServer.home))
        }
    }

    func open(_ url: URL) {
        guard url.isFileURL else { return }
        pending.append(url)
        importNext()
    }

    private func importNext() {
        guard ready, !importing, !pending.isEmpty, presentedViewController == nil else { return }
        importing = true
        let url = pending.removeFirst()
        Task { @MainActor in
            defer {
                importing = false
                importNext()
            }
            do {
                let contents = try await Task.detached(priority: .userInitiated) {
                    try Self.readDocument(url)
                }.value
                // Keep file bytes inside the app and bridge them in bounded chunks.
                _ = try await web.callAsyncJavaScript(
                    "window.quizPocketFileParts = [];", arguments: [:], in: nil, contentWorld: .page
                )
                defer { web.evaluateJavaScript("delete window.quizPocketFileParts", completionHandler: nil) }
                let chunkSize = 512 * 1024
                for offset in stride(from: 0, to: contents.count, by: chunkSize) {
                    let chunk = contents[offset..<min(offset + chunkSize, contents.count)].base64EncodedString()
                    _ = try await web.callAsyncJavaScript(
                        "window.quizPocketFileParts.push(Uint8Array.from(atob(chunk), byte => byte.charCodeAt(0)));",
                        arguments: ["chunk": chunk], in: nil, contentWorld: .page
                    )
                }
                _ = try await web.callAsyncJavaScript(
                    "await window.importSharedFile(new File(window.quizPocketFileParts, name));",
                    arguments: ["name": url.lastPathComponent], in: nil, contentWorld: .page
                )
            } catch {
                _ = try? await web.callAsyncJavaScript(
                    "notice(message, true);",
                    arguments: ["message": "无法打开共享的题库文件。请确认文件可用、大小介于 1 字节和 32 MB 之间。"],
                    in: nil, contentWorld: .page
                )
            }
        }
    }

    nonisolated private static func readDocument(_ url: URL) throws -> Data {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let maximum = 32 * 1024 * 1024
        let coordinator = NSFileCoordinator()
        var coordinationError: NSError?
        var result: Result<Data, Error>?
        coordinator.coordinate(readingItemAt: url, options: [], error: &coordinationError) { file in
            result = Result {
                let reader = try FileHandle(forReadingFrom: file)
                defer { try? reader.close() }
                var contents = Data()
                while let chunk = try reader.read(upToCount: min(1024 * 1024, maximum + 1 - contents.count)) {
                    if chunk.isEmpty { break }
                    contents.append(chunk)
                    if contents.count > maximum { break }
                }
                guard !contents.isEmpty, contents.count <= maximum else {
                    throw CocoaError(.fileReadTooLarge)
                }
                return contents
            }
        }
        if let coordinationError { throw coordinationError }
        guard let result else { throw CocoaError(.fileReadUnknown) }
        return try result.get()
    }

    private func showError(_ message: String) {
        guard presentedViewController == nil else { return }
        let alert = UIAlertController(title: "掌上题库", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "重试", style: .default) { [weak self] _ in
            guard let self else { return }
            if self.server == nil { self.startServer() }
            else { self.web.load(URLRequest(url: LoopbackServer.home)) }
        })
        present(alert, animated: true)
    }
}
