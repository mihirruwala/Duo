import SafariServices
import UIKit
import WebKit

enum DUOLinks {
    static let site = URL(string: "https://duoforyou.cv")!
    static let home = URL(string: "https://duoforyou.cv/home")!
    static let hosts: Set<String> = ["duoforyou.cv", "www.duoforyou.cv"]

    static func isDUO(_ url: URL) -> Bool {
        url.scheme == "https" && hosts.contains(url.host?.lowercased() ?? "")
    }

    /// duo://r/abc#x → https://duoforyou.cv/r/abc#x; DUO's own https links pass through; anything else is refused.
    static func webURL(from url: URL) -> URL? {
        if isDUO(url) { return url }
        guard url.scheme?.lowercased() == "duo" else { return nil }
        var parts = URLComponents()
        parts.scheme = "https"
        parts.host = "duoforyou.cv"
        let path = ((url.host.map { "/" + $0 } ?? "") + url.path)
        parts.path = path.isEmpty ? "/home" : path
        parts.query = url.query
        parts.fragment = url.fragment
        return parts.url
    }
}

/**
 * DUO in a full-screen web view. The app is the website (same account, same calls); this adds what a
 * browser tab can't do well on iPhone: no address bar, camera and mic granted once for DUO only,
 * the screen kept awake in a room, and links to other sites opened in Safari.
 */
final class WebViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private let startURL: URL
    private var webView: WKWebView!
    private var urlObservation: NSKeyValueObservation?
    private let offline = OfflineView()

    init(startURL: URL) {
        self.startURL = startURL
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default() // stay signed in between launches
        config.allowsInlineMediaPlayback = true // calls play in the page, not fullscreen
        config.mediaTypesRequiringUserActionForPlayback = [] // the other person's audio starts on its own
        config.allowsPictureInPictureMediaPlayback = true
        config.allowsAirPlayForMediaPlayback = true
        // Look like Safari (some embeds check), plus a marker the site can use later.
        config.applicationNameForUserAgent = "Version/26.0 Mobile/15E148 Safari/604.1 DUOiOS/1.0"

        let background = UIColor(named: "LaunchBackground") ?? .black
        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.isOpaque = false
        webView.backgroundColor = background
        webView.scrollView.backgroundColor = background
        webView.underPageBackgroundColor = background
        #if DEBUG
        if #available(iOS 16.4, *) { webView.isInspectable = true } // Safari → Develop menu
        #endif

        let root = UIView()
        root.backgroundColor = background
        webView.translatesAutoresizingMaskIntoConstraints = false
        offline.translatesAutoresizingMaskIntoConstraints = false
        offline.isHidden = true
        offline.onRetry = { [weak self] in self?.retry() }
        root.addSubview(webView)
        root.addSubview(offline)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: root.topAnchor),
            webView.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            offline.topAnchor.constraint(equalTo: root.topAnchor),
            offline.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            offline.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            offline.trailingAnchor.constraint(equalTo: root.trailingAnchor),
        ])
        view = root
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        // In a room (pre-call or in a call), keep the screen on: calls and hang-out mode run for hours.
        urlObservation = webView.observe(\.url, options: [.new]) { webView, _ in
            let inRoom = webView.url.map { DUOLinks.isDUO($0) && $0.path.hasPrefix("/r/") } ?? false
            DispatchQueue.main.async { UIApplication.shared.isIdleTimerDisabled = inRoom }
        }
        webView.load(URLRequest(url: startURL))
    }

    func open(_ url: URL) {
        offline.isHidden = true
        webView.load(URLRequest(url: url))
    }

    private func retry() {
        offline.isHidden = true
        if webView.url == nil { webView.load(URLRequest(url: startURL)) } else { webView.reload() }
    }

    private func openOutside(_ url: URL) {
        if url.scheme == "http" || url.scheme == "https" {
            let safari = SFSafariViewController(url: url)
            safari.preferredControlTintColor = UIColor(red: 1, green: 0.54, blue: 0.43, alpha: 1)
            present(safari, animated: true)
        } else {
            UIApplication.shared.open(url)
        }
    }

    // MARK: Navigation

    func webView(
        _ webView: WKWebView,
        decidePolicyFor action: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = action.request.url, let scheme = url.scheme?.lowercased() else { return decisionHandler(.cancel) }
        // Frames inside a page (YouTube for Watch Together, GIFs) load as the page wants.
        if action.targetFrame?.isMainFrame == false { return decisionHandler(.allow) }
        if ["about", "blob", "data"].contains(scheme) || DUOLinks.isDUO(url) { return decisionHandler(.allow) }
        if let mapped = DUOLinks.webURL(from: url) {
            decisionHandler(.cancel)
            webView.load(URLRequest(url: mapped))
            return
        }
        // Everything else (other sites, mailto:, the App Store…) leaves the app's web view.
        decisionHandler(.cancel)
        openOutside(url)
    }

    /// target="_blank": DUO pages open here, anything else in Safari.
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for action: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = action.request.url {
            if DUOLinks.isDUO(url) { webView.load(URLRequest(url: url)) } else { openOutside(url) }
        }
        return nil
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showOfflineIfNeeded(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showOfflineIfNeeded(error)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        offline.isHidden = true
    }

    /// iOS can kill the page's process under memory pressure (e.g. after a long call in the background).
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    private func showOfflineIfNeeded(_ error: Error) {
        let e = error as NSError
        if e.domain == NSURLErrorDomain && e.code == NSURLErrorCancelled { return }
        if e.domain == "WebKitErrorDomain" && e.code == 102 { return } // navigation handed to Safari
        offline.isHidden = false
    }

    // MARK: Camera and microphone

    /// DUO's own pages get the camera and mic without a second, web-style prompt (iOS asks once for the app).
    func webView(
        _ webView: WKWebView,
        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        let ours = origin.protocol == "https" && DUOLinks.hosts.contains(origin.host.lowercased()) && frame.isMainFrame
        decisionHandler(ours ? .grant : .deny)
    }

    // MARK: JavaScript dialogs (the site uses confirm() for a couple of destructive actions)

    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping () -> Void
    ) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(alert, animated: true)
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (Bool) -> Void
    ) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(alert, animated: true)
    }
}

/// Shown when the site can't be reached.
private final class OfflineView: UIView {
    var onRetry: (() -> Void)?

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = UIColor(named: "LaunchBackground") ?? .black
        let title = UILabel()
        title.text = "Can't reach DUO"
        title.font = .systemFont(ofSize: 24, weight: .bold)
        title.textColor = .white
        let body = UILabel()
        body.text = "Check your connection, then try again."
        body.font = .systemFont(ofSize: 16)
        body.textColor = UIColor.white.withAlphaComponent(0.6)
        body.numberOfLines = 0
        body.textAlignment = .center
        var config = UIButton.Configuration.filled()
        config.title = "Try again"
        config.cornerStyle = .capsule
        config.baseBackgroundColor = UIColor(red: 1, green: 0.54, blue: 0.43, alpha: 1)
        config.baseForegroundColor = UIColor(red: 0.08, green: 0.06, blue: 0.1, alpha: 1)
        config.contentInsets = NSDirectionalEdgeInsets(top: 12, leading: 24, bottom: 12, trailing: 24)
        let button = UIButton(configuration: config, primaryAction: UIAction { [weak self] _ in self?.onRetry?() })
        let stack = UIStackView(arrangedSubviews: [title, body, button])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: centerYAnchor),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: leadingAnchor, constant: 32),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }
}
