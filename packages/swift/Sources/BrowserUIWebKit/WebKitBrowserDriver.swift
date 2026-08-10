import BrowserUI
import Foundation
import SwiftUI
#if canImport(UIKit) && canImport(WebKit)
import UIKit
import WebKit

// MARK: - Errors

public enum WebKitBrowserDriverError: LocalizedError {
    case transport(String)
    case evaluate(String)

    public var errorDescription: String? {
        switch self {
        case .transport(let msg): return "Browser error: \(msg)"
        case .evaluate(let msg): return "Page error: \(msg)"
        }
    }
}

public struct WebKitBrowserDriverConfiguration: Sendable {
    public enum DataStore: Sendable {
        case persistent
        /// Persistent WebKit storage isolated to one browser identity. Hosts
        /// can use a durable conversation UUID so cookies and site state
        /// survive relaunches without leaking into another agent's browser.
        case persistentSession(UUID)
        case nonPersistent
    }

    public var dataStore: DataStore
    public var desktopViewportSize: CGSize
    public var pageLoadTimeout: TimeInterval
    public var postLoadSettleDelay: TimeInterval
    /// Stable identity shown beside the agent pointer. Action details belong
    /// to `BrowserAgentActivity.label`, not the cursor label.
    public var agentCursorLabel: String?
    /// Optional idle fade for hosts that prefer it. `nil` keeps the pointer at
    /// its last position for the lifetime of the browser session.
    public var agentCursorIdleTimeout: TimeInterval?

    public init(
        dataStore: DataStore = .persistent,
        desktopViewportSize: CGSize = CGSize(width: 1440, height: 900),
        pageLoadTimeout: TimeInterval = 30,
        postLoadSettleDelay: TimeInterval = 0.35,
        agentCursorLabel: String? = nil,
        agentCursorIdleTimeout: TimeInterval? = nil
    ) {
        precondition(desktopViewportSize.width > 0 && desktopViewportSize.height > 0)
        precondition(pageLoadTimeout > 0)
        precondition(postLoadSettleDelay >= 0)
        if let agentCursorIdleTimeout {
            precondition(agentCursorIdleTimeout >= 0)
        }
        self.dataStore = dataStore
        self.desktopViewportSize = desktopViewportSize
        self.pageLoadTimeout = pageLoadTimeout
        self.postLoadSettleDelay = postLoadSettleDelay
        self.agentCursorLabel = agentCursorLabel
        self.agentCursorIdleTimeout = agentCursorIdleTimeout
    }
}

// MARK: - Browser session

/// The on-device agent browser. Backed by WebKit (the same engine as Safari),
/// so no external browser service or credentials are needed — the page runs on
/// the phone, the agent drives it, and the chat shows live frames.
///
/// The driver's `WKWebView` renders offscreen while the agent works; the chat's
/// browser card shows snapshots. Tapping the card presents the *same* web view
/// full-screen so the user can interact directly (scroll, click, log in), and
/// the agent keeps driving the identical session.
@MainActor
public final class WebKitBrowserDriver: NSObject, ObservableObject, BrowserSemanticAutomationDriver {
    public static let defaultDesktopViewportSize = CGSize(width: 1440, height: 900)

    public let configuration: WebKitBrowserDriverConfiguration
    public let descriptor: BrowserDriverDescriptor

    /// The conversation (cell) that currently owns the browser.
    @Published public var scope: String?
    /// Distinct lifecycle identity for this browser, independent of the
    /// conversation that owns it. A later browser in the same chat receives a
    /// new identity and therefore a separate terminal receipt.
    @Published public private(set) var lifecycleSessionId: String?
    @Published public var phase: BrowserDriverPhase = .idle
    @Published public var url: String = ""
    @Published public var title: String = ""
    @Published public var screenshot: UIImage?
    @Published public var operating = false
    @Published public var actionLabel: String?
    @Published public var lastActionLabel: String?
    @Published public var activity: BrowserAgentActivity?
    @Published public var cursor: BrowserAgentCursorState?
    @Published public var lastError: String?
    public private(set) var presentationMode: BrowserViewportPresentationMode = .preview
    /// Selects the one preview surface allowed to own WebKit while SwiftUI
    /// transitions between inline and picture-in-picture placements.
    public private(set) var displayMode: BrowserDisplayMode = .inline
    /// Forces SwiftUI browser containers to re-attach the shared WKWebView
    /// after it moves between the inline dock and fullscreen.
    @Published public var surfaceRevision = 0

    private var _webView: WKWebView?
    private weak var takeoverSurface: WebKitBrowserSurfaceHost?
    private weak var previewSurface: WebKitBrowserSurfaceHost?
    private var isSnapshotInFlight = false
    private var cursorHideTask: Task<Void, Never>?
    /// The action interrupted by human takeover. Its asynchronous WebKit work
    /// may still unwind after cancellation, but only that action is prevented
    /// from republishing the cursor. A later agent action receives a new ID and
    /// presents normally.
    private var suppressedAgentActivityID: String?

    public var isEngaged: Bool {
        phase == .connected && scope != nil
    }

    /// The shared on-device web view — rendered offscreen while the agent works
    /// and embedded interactively when the user opens the browser card.
    var webView: WKWebView {
        if let webView = _webView { return webView }
        let configuration = WKWebViewConfiguration()
        switch self.configuration.dataStore {
        case .persistent:
            break
        case .persistentSession(let identifier):
            configuration.websiteDataStore = WKWebsiteDataStore(forIdentifier: identifier)
        case .nonPersistent:
            configuration.websiteDataStore = .nonPersistent()
        }
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        // Keep the phone's native WebKit identity for the lifetime of the
        // page. The preview/takeover distinction is a viewport-size concern:
        // 1440×900 produces the desktop layout while the phone-sized takeover
        // produces the responsive mobile layout. Changing content mode after
        // navigation does not reliably replace the already-loaded document.
        configuration.defaultWebpagePreferences.preferredContentMode = .mobile
        let webView = WKWebView(
            frame: CGRect(origin: .zero, size: self.configuration.desktopViewportSize),
            configuration: configuration
        )
        webView.navigationDelegate = self
        webView.uiDelegate = self
        _webView = webView
        return webView
    }

    /// Existing browser surface without materializing a new session. SwiftUI
    /// updates can run while a terminal dismissal is in flight and must not
    /// accidentally recreate WebKit after `end()` released it.
    var existingWebView: WKWebView? { _webView }

    fileprivate func attachSurface(
        _ surface: WebKitBrowserSurfaceHost,
        presentationMode: BrowserViewportPresentationMode,
        displayMode: BrowserDisplayMode
    ) {
        if presentationMode == .takeover {
            takeoverSurface = surface
        } else {
            // SwiftUI can update the outgoing and incoming preview trees in
            // either order. Only the explicitly selected placement may claim
            // the single live WKWebView.
            guard displayMode == self.displayMode else { return }
            previewSurface = surface
        }
        if presentationMode != .takeover,
           let takeoverSurface,
           takeoverSurface !== surface {
            // A retained inline SwiftUI tree can update while fullscreen is
            // active. The native surface owner must not be stolen back from
            // the higher-priority takeover presentation.
            return
        }
        guard let existingWebView else {
            surface.detachWebView()
            return
        }
        surface.attach(existingWebView)
    }

    /// Select the preview placement before its SwiftUI tree is inserted. This
    /// makes WebKit re-parenting deterministic even when the outgoing surface
    /// receives a late update or dismantle callback.
    public func setDisplayMode(_ displayMode: BrowserDisplayMode) {
        guard displayMode != .fullscreen, self.displayMode != displayMode else { return }
        self.displayMode = displayMode
        surfaceRevision &+= 1
    }

    fileprivate func detachSurface(_ surface: WebKitBrowserSurfaceHost) {
        if takeoverSurface === surface {
            takeoverSurface = nil
        }
        if previewSurface === surface {
            previewSurface = nil
        }
        surface.detachWebView()
    }

    public init(configuration: WebKitBrowserDriverConfiguration = .init()) {
        self.configuration = configuration
        self.descriptor = try! BrowserDriverDescriptor(
            id: "webkit_native",
            kind: .webKit,
            capabilities: [
                .navigation,
                .history,
                .semanticSnapshot,
                .screenshot,
                .elementClick,
                .textInput,
                .keyboardInput,
                .scriptEvaluation,
                .viewport,
                .nativeSurface,
                .pointerInput,
                .wait,
                .scroll,
                .selection,
            ])
        super.init()
    }

    // MARK: - Lifecycle

    /// Bind a fresh browser session to a conversation (called by the agent's
    /// browser tools). The engine is already on-device, so this is instant.
    public func begin(scope: String) {
        guard self.scope != scope || !isEngaged else { return }
        disconnect()
        self.scope = scope
        lifecycleSessionId = UUID().uuidString
        phase = .connected
        operating = false
        actionLabel = nil
        lastActionLabel = nil
        activity = nil
        cursor = nil
        lastError = nil
        suppressedAgentActivityID = nil
        displayMode = .inline
        presentationMode = .preview
        _ = webView
    }

    public func disconnect() {
        if let webView = _webView {
            webView.stopLoading()
        }
        scope = nil
        lifecycleSessionId = nil
        url = ""
        title = ""
        screenshot = nil
        operating = false
        actionLabel = nil
        lastActionLabel = nil
        activity = nil
        cursor = nil
        cursorHideTask?.cancel()
        cursorHideTask = nil
        suppressedAgentActivityID = nil
        displayMode = .inline
        phase = .idle
        presentationMode = .preview
        surfaceRevision &+= 1
    }

    /// Terminal lifecycle action. Unlike detaching a viewer, this releases the
    /// WebKit instance so a later workflow begins with a distinct browser.
    public func end() {
        let existing = _webView
        disconnect()
        existing?.navigationDelegate = nil
        existing?.uiDelegate = nil
        existing?.removeFromSuperview()
        _webView = nil
        surfaceRevision &+= 1
    }

    public func makeEndRequest(
        clientInstanceId: String,
        reason: BrowserSessionEndReason = .userEnded
    ) throws -> BrowserSessionEndRequest {
        guard let lifecycleSessionId else {
            throw WebKitBrowserDriverError.transport("no active browsing session to end")
        }
        return try BrowserSessionEndRequest(
            sessionId: lifecycleSessionId,
            clientInstanceId: clientInstanceId,
            reason: reason)
    }

    /// Create a durable handoff artifact while preserving the live WebKit
    /// session for the user or a later agent turn.
    public func makeReleaseRequest(
        outcome: BrowserSessionReleaseOutcome,
        label: String? = nil
    ) throws -> BrowserSessionReleaseRequest {
        guard let lifecycleSessionId else {
            throw WebKitBrowserDriverError.transport("no active browsing session to release")
        }
        let safeURL = Self.redactedURLForModel(url)
        return try BrowserSessionReleaseRequest(
            releaseId: UUID().uuidString,
            sessionId: lifecycleSessionId,
            outcome: outcome,
            label: label,
            url: safeURL == "[invalid URL]" ? nil : safeURL,
            title: title)
    }

    /// Relinquish agent presentation without cancelling or terminating the
    /// browser. A later semantic action automatically resumes agent control.
    public func releaseAgentControl() {
        suppressedAgentActivityID = activity?.id
        operating = false
        actionLabel = nil
        lastActionLabel = nil
        activity = nil
        cursorHideTask?.cancel()
        cursorHideTask = nil
        cursor = nil
    }

    /// Transfer the visible browser to the human without ending its session.
    /// The next agent action opts back into activity presentation, while any
    /// late completion from the interrupted action stays visually suppressed.
    public func takeUserControl() {
        releaseAgentControl()
    }

    // MARK: - Agent tools

    public func navigate(_ target: String) async throws -> String {
        try await perform(action: "navigate", label: "Opening page") {
            guard let destination = URL(string: target),
                  let scheme = destination.scheme?.lowercased(),
                  ["http", "https"].contains(scheme) else {
                throw WebKitBrowserDriverError.transport(
                    "only full http:// or https:// URLs are allowed: \(Self.redactedURLForModel(target))")
            }
            phase = .connecting
            lastError = nil
            url = target
            webView.load(URLRequest(url: destination))
            try await waitForLoad(webView)
            syncPageMetadata(fallbackURL: target)
            phase = .connected
            try? await refreshSnapshot()
            let safeURL = Self.redactedURLForModel(url)
            if !title.isEmpty {
                return "Navigated to “\(title)” (\(safeURL)). Call browser_snapshot next to inspect interactive elements."
            }
            return "Navigated to \(safeURL). Call browser_snapshot next to inspect interactive elements."
        }
    }

    public func snapshot() async throws -> String {
        try await perform(action: "snapshot", label: "Reading page") {
            guard let currentURL = webView.url,
                  let scheme = currentURL.scheme?.lowercased(),
                  ["http", "https"].contains(scheme) else {
                throw WebKitBrowserDriverError.transport(
                    "no web page is open; call browser_navigate with a full URL first")
            }
            let value = try await evaluateWrapped(Self.semanticSnapshotScript)
            guard let payload = value as? [String: Any] else {
                throw WebKitBrowserDriverError.evaluate("could not read the page structure")
            }
            if let message = payload["__error"] as? String {
                throw WebKitBrowserDriverError.evaluate(message)
            }
            syncPageMetadata()
            try? await refreshSnapshot()
            return Self.formatSnapshot(payload, fallbackURL: url, fallbackTitle: title)
        }
    }

    public func captureScreenshot() async throws -> String {
        try await perform(action: "screenshot", label: "Capturing page") {
            try await refreshSnapshot()
            return "Screenshot refreshed for the user. This text-only model cannot inspect pixels; use browser_snapshot to read the page."
        }
    }

    /// Evaluates the model's JavaScript on the page. Multi-statement scripts
    /// are fine. A JS exception is returned as text ("JS error: …") so the
    /// model can recover — it never kills the tool call.
    public func evaluate(_ javascript: String) async throws -> String {
        try await perform(action: "evaluate", label: "Inspecting page") {
            let wrapped = "(function(){ try { return eval(" + Self.jsString(javascript) + "); } catch(e) { return {__error: String(e)}; } })()"
            let value = try await evaluateWrapped(wrapped)
            syncPageMetadata()
            try? await refreshSnapshot()
            if let dict = value as? [String: Any], let message = dict["__error"] as? String {
                return "JS error: \(message)"
            }
            return Self.serialize(value)
        }
    }

    /// Clicks an element by the stable ref returned from `snapshot` (preferred),
    /// with CSS selectors retained as an escape hatch.
    public func click(target: String) async throws -> String {
        try await perform(action: "click", label: "Clicking element") {
            try await scrollTargetIntoView(target)
            try await prepareCursor(target: target, action: "Clicking", pressed: true)
            defer { releaseCursorPress() }
            let q = Self.jsString(target)
            let script = """
            (function(){
              try {
                var state = window.__celldAgentBrowser;
                var el = state && state.elements ? state.elements[\(q)] : null;
                if (!el) el = document.querySelector(\(q));
                if (!el) return {__error: 'no element matches ref or selector ' + \(q)};
                if (el.disabled || el.getAttribute('aria-disabled') === 'true') return {__error: 'element is disabled'};
                if (el instanceof HTMLSelectElement) {
                  el.blur();
                  return {__error: 'select controls require the select action'};
                }
                var rect = el.getBoundingClientRect();
                var style = getComputedStyle(el);
                if (!rect.width || !rect.height || style.visibility === 'hidden' || style.display === 'none') {
                  return {__error: 'element exists but is not visible'};
                }
                var hitX = Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / 2));
                var hitY = Math.max(0, Math.min(innerHeight - 1, rect.top + rect.height / 2));
                var covering = document.elementFromPoint(hitX, hitY);
                function composedContains(ancestor, node) {
                  var current = node;
                  while (current) {
                    if (current === ancestor) return true;
                    if (current.parentNode) {
                      current = current.parentNode;
                    } else {
                      var root = current.getRootNode && current.getRootNode();
                      current = root && root.host ? root.host : null;
                    }
                  }
                  return false;
                }
                var inputType = (el.getAttribute('type') || '').toLowerCase();
                var semanticRole = (el.getAttribute('role') || '').toLowerCase();
                var isCheckable = inputType === 'radio' || inputType === 'checkbox' ||
                  semanticRole === 'radio' || semanticRole === 'checkbox' ||
                  semanticRole === 'switch';
                // Custom controls often put pointer events on a wrapper while
                // retaining a semantic input as its descendant. That wrapper
                // is part of the target. Checkable controls are also commonly
                // visually replaced by a sibling click layer; activating the
                // fresh semantic ref is the correct equivalent of its label.
                // Continue to reject unrelated overlays for ordinary elements.
                var targetOwnsHit = covering && composedContains(el, covering);
                var hitOwnsTarget = covering && composedContains(covering, el);
                if (covering && covering !== el && !targetOwnsHit && !hitOwnsTarget && !isCheckable) {
                  var coveringLabel = (covering.getAttribute('aria-label') || covering.id || covering.className || covering.tagName || 'element');
                  return {__error: 'element is covered by <' + String(coveringLabel).replace(/\\s+/g, ' ').slice(0, 80) + '>'};
                }
                var label = (el.getAttribute('aria-label') || el.innerText || el.value || el.tagName).trim().slice(0, 120);
                // HTMLElement.click() does not consistently transfer focus in
                // WebKit. Editable controls and comboboxes need focus for the
                // same state transitions as pointer activation. Focusing every
                // element is unsafe, however: a framework can synchronously
                // replace a button during its focus handler, leaving `el`
                // detached before click() and triggering only its stale native
                // default action. Keep non-editable activation atomic.
                var needsFocus = el.matches && el.matches(
                  'input, textarea, select, [contenteditable="true"], [role="combobox"]'
                );
                if (needsFocus && document.activeElement !== el && typeof el.focus === 'function') {
                  try { el.focus({preventScroll: true}); } catch (_) { el.focus(); }
                }
                el.click();
                return {clicked: \(q), label: label};
              } catch(e) { return {__error: String(e)}; }
            })()
            """
            let result = try await runAction(script)
            try await waitForPageToSettle()
            return result + "\nCall browser_snapshot to observe the result."
        }
    }

    /// Type text into the first matching input/textarea (sets the value and
    /// dispatches input/change events so React/Vue sites update).
    public func type(target: String, text: String) async throws -> String {
        try await perform(action: "type", label: "Typing") {
            try await prepareCursor(target: target, action: "Typing in", typing: true)
            defer { finishCursorTyping() }
            let q = Self.jsString(target)
            let v = Self.jsString(text)
            let script = """
            (function(){
              try {
                var state = window.__celldAgentBrowser;
                var el = state && state.elements ? state.elements[\(q)] : null;
                if (!el) el = document.querySelector(\(q));
                if (!el) return {__error: 'no element matches ref or selector ' + \(q)};
                if (el.disabled || el.readOnly) return {__error: 'element is not editable'};
                el.focus();
                if (el.isContentEditable) {
                  el.textContent = \(v);
                } else {
                  var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
                  var setter = Object.getOwnPropertyDescriptor(proto, 'value');
                  if (!setter || !setter.set) return {__error: 'element does not accept text'};
                  setter.set.call(el, \(v));
                }
                el.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'insertText', data: \(v)}));
                el.dispatchEvent(new Event('change', {bubbles: true}));
                return {typedInto: \(q), characters: \(text.count)};
              } catch(e) { return {__error: String(e)}; }
            })()
            """
            let result = try await runAction(script)
            try await waitForSemanticStateToStabilize()
            try? await refreshSnapshot()
            return result
        }
    }

    /// Sends a keyboard key to the focused or referenced element. Enter also
    /// submits the nearest form, matching normal browser behavior.
    public func press(key: String, target: String?) async throws -> String {
        try await perform(action: "press", label: "Pressing \(key)") {
            if let target {
                try await prepareCursor(target: target, action: "Pressing \(key) on")
            }
            let k = Self.jsString(key)
            let t = Self.jsString(target ?? "")
            let script = """
            (function(){
              try {
                var state = window.__celldAgentBrowser;
                var target = \(t);
                var el = target && state && state.elements ? state.elements[target] : null;
                if (!el && target) el = document.querySelector(target);
                if (!el) el = document.activeElement || document.body;
                if (el instanceof HTMLSelectElement) {
                  el.blur();
                  return {__error: 'select controls require the select action'};
                }
                el.focus && el.focus();
                var eventInit = {key: \(k), bubbles: true, cancelable: true};
                var keydownAllowed = el.dispatchEvent(new KeyboardEvent('keydown', eventInit));
                var keypressAllowed = true;
                if (\(k) === 'Enter' || String(\(k)).length === 1) {
                  keypressAllowed = el.dispatchEvent(new KeyboardEvent('keypress', eventInit));
                }
                el.dispatchEvent(new KeyboardEvent('keyup', eventInit));
                // Synthetic key events do not perform WebKit's native default
                // action. Fall back only when the page did not cancel either
                // event, and activate its submit control so framework click
                // handlers run before native form submission.
                if (\(k) === 'Enter' && el.form && keydownAllowed && keypressAllowed) {
                  var submitter = el.form.querySelector(
                    'button:not([type]),button[type="submit"],input[type="submit"],input[type="image"]'
                  );
                  if (submitter && !submitter.disabled) {
                    submitter.click();
                  } else if (el.form.requestSubmit) {
                    el.form.requestSubmit();
                  } else {
                    el.form.submit();
                  }
                }
                return {pressed: \(k), target: target || 'focused element'};
              } catch(e) { return {__error: String(e)}; }
            })()
            """
            let result = try await runAction(script)
            try await waitForPageToSettle()
            return result + "\nCall browser_snapshot to observe the result."
        }
    }

    public func goBack() async throws -> String {
        try await perform(action: "back", label: "Going back") {
            if webView.canGoBack {
                webView.goBack()
                try await waitForLoad(webView)
                syncPageMetadata()
                try? await refreshSnapshot()
            }
            return "Current page: \(Self.redactedURLForModel(url)). Call browser_snapshot to inspect it."
        }
    }

    public func goForward() async throws -> String {
        try await perform(action: "forward", label: "Going forward") {
            if webView.canGoForward {
                webView.goForward()
                try await waitForLoad(webView)
                syncPageMetadata()
                try? await refreshSnapshot()
            }
            return "Current page: \(Self.redactedURLForModel(url)). Call browser_snapshot to inspect it."
        }
    }

    public func reload() async throws -> String {
        try await perform(action: "reload", label: "Reloading page") {
            guard webView.url != nil else {
                throw WebKitBrowserDriverError.transport("no web page is open")
            }
            webView.reload()
            try await waitForLoad(webView)
            syncPageMetadata()
            try? await refreshSnapshot()
            return "Reloaded \(Self.redactedURLForModel(url)). Call browser_snapshot to inspect it."
        }
    }

    public func scroll(
        direction: BrowserDriverScrollDirection,
        amount: Double
    ) async throws -> String {
        try await perform(action: "scroll", label: "Scrolling \(direction.rawValue)") {
            let distance = min(max(amount, 1), 10_000)
            let deltaX: Double
            let deltaY: Double
            switch direction {
            case .up: (deltaX, deltaY) = (0, -distance)
            case .down: (deltaX, deltaY) = (0, distance)
            case .left: (deltaX, deltaY) = (-distance, 0)
            case .right: (deltaX, deltaY) = (distance, 0)
            }
            _ = try await evaluateWrapped(
                "window.scrollBy({left: \(deltaX), top: \(deltaY), behavior: 'instant'}); true")
            try? await Task.sleep(for: .milliseconds(300))
            try? await refreshSnapshot()
            return "Scrolled \(direction.rawValue) \(Int(distance)) pixels. Call browser_snapshot to inspect the page."
        }
    }

    public func select(target: String, values: [String]) async throws -> String {
        try await perform(action: "select", label: "Selecting option") {
            guard !values.isEmpty else {
                throw WebKitBrowserDriverError.evaluate("at least one option value is required")
            }
            let q = Self.jsString(target)
            let encodedValues = Self.jsArray(values)
            let result = try await runAction("""
            (function(){
              try {
                var state = window.__celldAgentBrowser;
                var el = state && state.elements ? state.elements[\(q)] : null;
                if (!el) el = document.querySelector(\(q));
                if (!el) return {__error: 'no element matches ref or selector ' + \(q)};
                if (!(el instanceof HTMLSelectElement)) return {__error: 'element is not a select control'};
                if (el.disabled) return {__error: 'element is disabled'};
                var requested = \(encodedValues);
                var matched = [];
                Array.from(el.options).forEach(function(option) {
                  var selected = requested.indexOf(option.value) !== -1 ||
                    requested.indexOf((option.textContent || '').trim()) !== -1;
                  option.selected = selected && (el.multiple || matched.length === 0);
                  if (option.selected) matched.push(option.value);
                });
                if (!matched.length) return {__error: 'no option matches the requested value'};
                el.dispatchEvent(new Event('input', {bubbles: true}));
                el.dispatchEvent(new Event('change', {bubbles: true}));
                el.blur();
                if (document.activeElement && document.activeElement !== document.body) {
                  document.activeElement.blur();
                }
                return {selected: matched};
              } catch(e) { return {__error: String(e)}; }
            })()
            """)
            try await waitForSemanticStateToStabilize()
            let verification = try await evaluateWrapped("""
            (function(){
              try {
                var state = window.__celldAgentBrowser;
                var el = state && state.elements ? state.elements[\(q)] : null;
                if (!el) el = document.querySelector(\(q));
                if (!(el instanceof HTMLSelectElement)) {
                  return {__error: 'select control disappeared after its change event'};
                }
                var requested = \(encodedValues);
                var selected = Array.from(el.selectedOptions).map(function(option) {
                  return {
                    value: option.value,
                    label: (option.textContent || '').replace(/\\s+/g, ' ').trim()
                  };
                });
                var persisted = selected.every(function(option) {
                  return requested.indexOf(option.value) !== -1 ||
                    requested.indexOf(option.label) !== -1;
                }) && selected.length > 0;
                var available = Array.from(el.options).slice(0, 40).map(function(option) {
                  return (option.textContent || option.value || '').replace(/\\s+/g, ' ').trim();
                }).filter(Boolean);
                return {persisted: persisted, selected: selected, available: available};
              } catch(e) { return {__error: String(e)}; }
            })()
            """)
            if let payload = verification as? [String: Any],
               let message = payload["__error"] as? String {
                throw WebKitBrowserDriverError.evaluate(message)
            }
            guard let payload = verification as? [String: Any],
                  (payload["persisted"] as? Bool) == true
            else {
                let detail = Self.serialize(verification)
                throw WebKitBrowserDriverError.evaluate(
                    "selection did not persist after the page updated: \(detail)")
            }
            return result + "\nCall browser_snapshot to observe the result."
        }
    }

    public func setChecked(target: String, checked: Bool) async throws -> String {
        try await perform(
            action: checked ? "check" : "uncheck",
            label: checked ? "Checking option" : "Unchecking option"
        ) {
            try await scrollTargetIntoView(target)
            try await prepareCursor(
                target: target,
                action: checked ? "Checking" : "Unchecking",
                pressed: true)
            defer { releaseCursorPress() }
            let q = Self.jsString(target)
            let result = try await runAction("""
            (function(){
              try {
                var state = window.__celldAgentBrowser;
                var el = state && state.elements ? state.elements[\(q)] : null;
                if (!el) el = document.querySelector(\(q));
                if (!el) return {__error: 'no element matches ref or selector ' + \(q)};
                if (el.disabled || el.getAttribute('aria-disabled') === 'true') return {__error: 'element is disabled'};
                var current = typeof el.checked === 'boolean'
                  ? el.checked
                  : el.getAttribute('aria-checked') === 'true';
                if (current !== \(checked ? "true" : "false")) el.click();
                return {checked: \(checked ? "true" : "false")};
              } catch(e) { return {__error: String(e)}; }
            })()
            """)
            try await waitForSemanticStateToStabilize()
            let verified = try await evaluateWrapped("""
            (function(){
              try {
                var state = window.__celldAgentBrowser;
                var el = state && state.elements ? state.elements[\(q)] : null;
                if (!el) el = document.querySelector(\(q));
                if (!el) return {__error: 'target disappeared after activation'};
                var actual = typeof el.checked === 'boolean'
                  ? el.checked
                  : el.getAttribute('aria-checked') === 'true';
                return actual === \(checked ? "true" : "false");
              } catch(e) { return {__error: String(e)}; }
            })()
            """)
            if let payload = verified as? [String: Any],
               let message = payload["__error"] as? String {
                throw WebKitBrowserDriverError.evaluate(message)
            }
            guard (verified as? Bool) == true else {
                throw WebKitBrowserDriverError.evaluate(
                    "control did not become \(checked ? "checked" : "unchecked")")
            }
            return result + "\nCall browser_snapshot to observe the result."
        }
    }

    public func wait(for condition: BrowserDriverWaitCondition) async throws -> String {
        try await perform(action: "wait", label: "Waiting for page") {
            switch condition {
            case .duration(let milliseconds):
                let bounded = min(max(milliseconds, 0), 30_000)
                try? await Task.sleep(for: .milliseconds(bounded))
            case .load:
                if webView.isLoading {
                    try await waitForLoad(webView)
                } else {
                    try await waitUntil("document.readyState === 'complete'")
                }
            case .text(let text):
                try await waitUntil(
                    "(document.body && document.body.innerText || '').includes(\(Self.jsString(text)))")
            case .urlContains(let text):
                try await waitUntil("location.href.includes(\(Self.jsString(text)))")
            case .javaScript(let expression):
                try await waitUntil("Boolean(\(expression))")
            }
            syncPageMetadata()
            try? await refreshSnapshot()
            return "Wait condition satisfied. Call browser_snapshot to inspect the page."
        }
    }

    private func perform<T>(
        action: String,
        label: String,
        operation: () async throws -> T
    ) async throws -> T {
        let activityID = UUID().uuidString
        let startedAt = Date()
        operating = true
        actionLabel = label
        lastActionLabel = label
        activity = BrowserAgentActivity(
            id: activityID,
            action: action,
            label: label,
            phase: .started,
            timestamp: startedAt.timeIntervalSince1970 * 1_000,
            agentCursor: cursor)
        lastError = nil
        defer {
            operating = false
            actionLabel = nil
        }
        do {
            let value = try await operation()
            completeActivity(id: activityID, success: true, startedAt: startedAt)
            return value
        } catch {
            completeActivity(id: activityID, success: false, startedAt: startedAt)
            let message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            lastError = message
            if phase == .connecting {
                phase = .failed(message)
            }
            throw error
        }
    }

    private func completeActivity(id: String, success: Bool, startedAt: Date) {
        guard activity?.id == id else { return }
        activity?.phase = .completed
        activity?.success = success
        activity?.durationMs = Date().timeIntervalSince(startedAt) * 1_000
    }

    private func scrollTargetIntoView(_ target: String) async throws {
        let q = Self.jsString(target)
        let value = try await evaluateWrapped("""
        (function(){
          try {
            var state = window.__celldAgentBrowser;
            var el = state && state.elements ? state.elements[\(q)] : null;
            if (!el) el = document.querySelector(\(q));
            if (!el) return {__error: 'no element matches ref or selector ' + \(q)};
            el.scrollIntoView({block: 'center', inline: 'center'});
            return true;
          } catch(e) { return {__error: String(e)}; }
        })()
        """)
        if let payload = value as? [String: Any],
           let message = payload["__error"] as? String {
            throw WebKitBrowserDriverError.evaluate(message)
        }
        // WebKit applies scrollIntoView synchronously, but sticky containers
        // and layout can settle on the following frame. Resolve cursor and hit
        // geometry only after the target reaches its final viewport position.
        try? await Task.sleep(for: .milliseconds(50))
    }

    private func prepareCursor(
        target: String,
        action: String,
        pressed: Bool = false,
        typing: Bool = false
    ) async throws {
        let q = Self.jsString(target)
        let value = try await evaluateWrapped("""
        (function(){
          try {
            var state = window.__celldAgentBrowser;
            var el = state && state.elements ? state.elements[\(q)] : null;
            if (!el) el = document.querySelector(\(q));
            if (!el) return {__error: 'no element matches ref or selector ' + \(q)};
            var rect = el.getBoundingClientRect();
            var sensitive = (el.getAttribute('type') || '').toLowerCase() === 'password';
            var label = (sensitive ? 'password field' :
              (el.getAttribute('aria-label') || el.innerText || el.value || el.tagName))
              .replace(/\\s+/g, ' ').trim().slice(0, 64);
            return {
              x: Math.max(0, Math.min(1, (rect.left + rect.width / 2) / Math.max(innerWidth, 1))),
              y: Math.max(0, Math.min(1, (rect.top + rect.height / 2) / Math.max(innerHeight, 1))),
              label: label
            };
          } catch(e) { return {__error: String(e)}; }
        })()
        """)
        guard let payload = value as? [String: Any] else {
            throw WebKitBrowserDriverError.evaluate("could not locate the target")
        }
        if let message = payload["__error"] as? String {
            throw WebKitBrowserDriverError.evaluate(message)
        }
        guard let x = (payload["x"] as? NSNumber)?.doubleValue,
              let y = (payload["y"] as? NSNumber)?.doubleValue else {
            throw WebKitBrowserDriverError.evaluate("target has no viewport coordinates")
        }
        let elementLabel = (payload["label"] as? String)?.trimmingCharacters(
            in: .whitespacesAndNewlines)
        let resolvedLabel = elementLabel?.isEmpty == false ? elementLabel! : "element"
        let activityLabel = "\(action) \(resolvedLabel)"
        actionLabel = activityLabel
        lastActionLabel = activityLabel

        let resting = BrowserAgentCursorState(
            x: x,
            y: y,
            label: configuration.agentCursorLabel,
            pressed: false,
            typing: typing)
        publishCursor(resting)
        activity?.label = activityLabel
        activity?.agentCursor = resting
        try? await Task.sleep(for: .milliseconds(280))
        if pressed {
            var down = resting
            down.pressed = true
            publishCursor(down)
            activity?.agentCursor = down
            try? await Task.sleep(for: .milliseconds(110))
        }
    }

    private func publishCursor(_ state: BrowserAgentCursorState) {
        if let suppressedAgentActivityID,
           activity?.id == suppressedAgentActivityID {
            return
        }
        cursorHideTask?.cancel()
        cursor = state
        guard let timeout = configuration.agentCursorIdleTimeout else {
            cursorHideTask = nil
            return
        }
        cursorHideTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(timeout))
            guard !Task.isCancelled else { return }
            cursor?.visible = false
        }
    }

    private func releaseCursorPress() {
        guard var next = cursor else { return }
        next.pressed = false
        publishCursor(next)
        activity?.agentCursor = next
    }

    private func finishCursorTyping() {
        guard var next = cursor else { return }
        next.typing = false
        publishCursor(next)
        activity?.agentCursor = next
    }

    private func runAction(_ script: String) async throws -> String {
        let value = try await evaluateWrapped(script)
        syncPageMetadata()
        try? await refreshSnapshot()
        if let dict = value as? [String: Any], let message = dict["__error"] as? String {
            throw WebKitBrowserDriverError.evaluate(message)
        }
        return Self.serialize(value)
    }

    // MARK: - Frames

    private func refreshSnapshot() async throws {
        _ = await captureTransitionFrame()
    }

    /// Capture a settled frame for masking the physical WebView handoff. If a
    /// tool is already capturing, reuse the last complete frame instead of
    /// allowing concurrent WebKit snapshot requests.
    public func captureTransitionFrame() async -> UIImage? {
        guard !isSnapshotInFlight else { return screenshot }
        isSnapshotInFlight = true
        defer { isSnapshotInFlight = false }
        let configuration = WKSnapshotConfiguration()
        configuration.snapshotWidth = 1280
        let image: UIImage? = await withCheckedContinuation { continuation in
            webView.takeSnapshot(with: configuration) { image, _ in
                continuation.resume(returning: image)
            }
        }
        if let image {
            screenshot = image
        }
        return image ?? screenshot
    }

    /// Full-screen takeover uses the phone's live bounds while retaining the
    /// same WebKit instance, history, cookies, and page state.
    public func enterTakeoverViewport() async {
        presentationMode = .takeover
        await waitForSurfaceLayout(.takeover)
        dispatchViewportChange()
        await waitForRenderCommit()
    }

    /// The inline host restores the fixed desktop canvas when it re-attaches.
    public func restoreDesktopViewport() async {
        presentationMode = .preview
        guard _webView != nil else { return }
        // Publishing the revision lets the inline host reclaim and lay out the
        // shared WebView at 1440x900. Keep the frozen frame visible until two
        // browser paint frames have completed at that size.
        surfaceRevision &+= 1
        await waitForSurfaceLayout(.preview)
        dispatchViewportChange()
        await waitForRenderCommit()
        try? await refreshSnapshot()
    }

    /// Wait for the correct native host to own and size the shared WebView.
    /// SwiftUI fullscreen presentation and representable attachment happen on
    /// separate update passes; a fixed delay can therefore race and leave the
    /// previous desktop canvas in takeover. Completion here acknowledges the
    /// actual native geometry instead.
    private func waitForSurfaceLayout(_ mode: BrowserViewportPresentationMode) async {
        while !Task.isCancelled {
            let surface = mode == .takeover ? takeoverSurface : previewSurface
            if let surface, surface.window != nil {
                surface.setNeedsLayout()
                surface.layoutIfNeeded()
                let expected = mode == .takeover
                    ? surface.bounds.size
                    : configuration.desktopViewportSize
                let actual = webView.bounds.size
                if expected.width > 0,
                   expected.height > 0,
                   abs(actual.width - expected.width) < 1,
                   abs(actual.height - expected.height) < 1,
                   webView.superview != nil {
                    return
                }
            }
            await Task.yield()
            try? await Task.sleep(for: .milliseconds(16))
        }
    }

    private func dispatchViewportChange() {
        guard let webView = _webView else { return }
        webView.setNeedsLayout()
        webView.layoutIfNeeded()
        webView.evaluateJavaScript(
            "window.dispatchEvent(new Event('resize'))",
            completionHandler: nil)
    }

    private func waitForRenderCommit() async {
        let script = """
        new Promise(resolve => requestAnimationFrame(() =>
          requestAnimationFrame(() => resolve(true))))
        """
        _ = try? await webView.evaluateJavaScript(script)
    }

    // MARK: - WebKit plumbing

    private func waitForLoad(_ webView: WKWebView) async throws {
        var waited = 0
        var observedLoading = webView.isLoading
        let timeoutMilliseconds = Int(configuration.pageLoadTimeout * 1_000)
        while waited < timeoutMilliseconds {
            if let lastError {
                throw WebKitBrowserDriverError.transport(lastError)
            }
            if webView.isLoading {
                observedLoading = true
            } else {
                let currentURL = webView.url?.absoluteString
                let hasRealPage = currentURL != nil && currentURL != "about:blank"
                let readyState = try? await evaluateWrapped("document.readyState") as? String
                if hasRealPage && (observedLoading || readyState == "interactive" || readyState == "complete") {
                    break
                }
            }
            try? await Task.sleep(for: .milliseconds(100))
            waited += 100
        }
        if waited >= timeoutMilliseconds {
            webView.stopLoading()
            throw WebKitBrowserDriverError.transport(
                "page load timed out after \(configuration.pageLoadTimeout.formatted()) seconds")
        }
        // Let late-arriving async content settle so the frame isn't blank.
        try? await Task.sleep(for: .seconds(configuration.postLoadSettleDelay))
    }

    private func waitForPageToSettle() async throws {
        // Give event handlers enough time to start a navigation before checking
        // `isLoading`. Client-rendered pages can update dependent controls well
        // after a click, so wait for their semantic state to become stable.
        try? await Task.sleep(for: .milliseconds(250))
        if webView.isLoading {
            try await waitForLoad(webView)
        } else {
            try await waitForSemanticStateToStabilize()
        }
        syncPageMetadata()
        try? await refreshSnapshot()
    }

    /// Waits for generic interactive state—not a site-specific selector—to be
    /// unchanged across several samples. This catches delayed framework updates
    /// to checked, selected, disabled, expanded, and input state without baking
    /// knowledge of any website into the browser runtime.
    private func waitForSemanticStateToStabilize() async throws {
        try? await Task.sleep(for: .milliseconds(900))
        var previous: String?
        var stableSamples = 0

        for _ in 0..<9 {
            if webView.isLoading {
                try await waitForLoad(webView)
                return
            }

            let value = try await evaluateWrapped(#"""
            (function(){
              var roots = [document];
              function collectShadowRoots(root) {
                Array.from(root.querySelectorAll('*')).forEach(function(el) {
                  if (el.shadowRoot) {
                    roots.push(el.shadowRoot);
                    collectShadowRoots(el.shadowRoot);
                  }
                });
              }
              collectShadowRoots(document);
              var selector = 'input,textarea,select,option,button,[role],[aria-checked],[aria-selected],[aria-expanded],[aria-disabled]';
              var nodes = [];
              roots.forEach(function(root) {
                nodes = nodes.concat(Array.from(root.querySelectorAll(selector)));
              });
              var parts = [location.href, document.title, String(nodes.length)];
              for (var i = 0; i < nodes.length; i++) {
                var el = nodes[i];
                parts.push([
                  el.tagName,
                  el.getAttribute('role') || '',
                  el.checked ? '1' : '0',
                  el.selected ? '1' : '0',
                  el.disabled ? '1' : '0',
                  el.getAttribute('aria-checked') || '',
                  el.getAttribute('aria-selected') || '',
                  el.getAttribute('aria-expanded') || '',
                  el.getAttribute('aria-disabled') || '',
                  String(el.value || '').slice(0, 80),
                  String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120)
                ].join('|'));
              }
              return parts.join('\n');
            })()
            """#)
            let signature = value as? String ?? String(describing: value)
            if signature == previous {
                stableSamples += 1
                if stableSamples >= 2 { return }
            } else {
                previous = signature
                stableSamples = 0
            }
            try? await Task.sleep(for: .milliseconds(250))
        }
    }

    private func waitUntil(_ expression: String) async throws {
        let timeoutMilliseconds = Int(configuration.pageLoadTimeout * 1_000)
        var waited = 0
        while waited < timeoutMilliseconds {
            let value = try await evaluateWrapped("""
            (function(){
              try { return Boolean(\(expression)); }
              catch (_) { return false; }
            })()
            """)
            if (value as? Bool) == true || (value as? NSNumber)?.boolValue == true {
                return
            }
            try? await Task.sleep(for: .milliseconds(100))
            waited += 100
        }
        throw WebKitBrowserDriverError.transport(
            "wait condition timed out after \(configuration.pageLoadTimeout.formatted()) seconds")
    }

    private func syncPageMetadata(fallbackURL: String? = nil) {
        title = webView.title ?? title
        url = webView.url?.absoluteString ?? fallbackURL ?? url
    }

    /// A compact, agent-browser-style semantic snapshot. Each interactive
    /// element gets a stable ref (`e1`, `e2`, …) that survives DOM updates for
    /// as long as that element exists. The model can act on refs directly,
    /// which is substantially more reliable than inventing CSS selectors.
    private static let semanticSnapshotScript = #"""
    (function(){
      var state = window.__celldAgentBrowser;
      if (!state) {
        state = {next: 1, elements: {}, reverse: new WeakMap()};
        window.__celldAgentBrowser = state;
      }
      state.elements = {};

      function clean(value, limit) {
        return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
      }
      function collectRoots(root, destination) {
        destination.push(root);
        Array.from(root.querySelectorAll('*')).forEach(function(el) {
          if (el.shadowRoot) collectRoots(el.shadowRoot, destination);
        });
        return destination;
      }
      function queryAll(roots, selector) {
        var matches = [];
        roots.forEach(function(root) {
          matches = matches.concat(Array.from(root.querySelectorAll(selector)));
        });
        return matches;
      }
      function excludedByAncestor(el) {
        var current = el;
        while (current) {
          if (current.matches && current.matches('[hidden],[aria-hidden="true"],[inert]')) {
            return true;
          }
          if (current.parentElement) {
            current = current.parentElement;
          } else {
            var root = current.getRootNode && current.getRootNode();
            current = root && root.host ? root.host : null;
          }
        }
        return false;
      }
      function rendered(el) {
        var rect = el.getBoundingClientRect();
        var style = getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 &&
          style.visibility !== 'hidden' && style.display !== 'none' &&
          !excludedByAncestor(el);
      }
      function intersectsViewport(el) {
        var rect = el.getBoundingClientRect();
        return rect.bottom > 0 && rect.right > 0 &&
          rect.top < innerHeight && rect.left < innerWidth;
      }
      function role(el) {
        var explicit = el.getAttribute('role');
        if (explicit) return explicit;
        var tag = el.tagName.toLowerCase();
        if (tag === 'a') return 'link';
        if (tag === 'button' || tag === 'summary') return 'button';
        if (tag === 'textarea') return 'textbox';
        if (tag === 'select') return el.multiple ? 'listbox' : 'combobox';
        if (tag === 'input') {
          var inputType = (el.type || 'text').toLowerCase();
          if (inputType === 'submit' || inputType === 'button') return 'button';
          if (inputType === 'radio') return 'radio';
          if (inputType === 'checkbox') return 'checkbox';
          if (inputType === 'search') return 'searchbox';
          if (inputType === 'range') return 'slider';
          if (inputType === 'number') return 'spinbutton';
          return 'textbox';
        }
        return tag;
      }

      function labelText(el, sensitive) {
        if (sensitive) return 'password field';
        if (el.labels && el.labels.length) {
          var labelled = clean(Array.from(el.labels).map(function(label) { return label.innerText; }).join(' '), 180);
          if (labelled) return labelled;
        }
        var labelledBy = el.getAttribute('aria-labelledby');
        if (labelledBy) {
          var root = el.getRootNode ? el.getRootNode() : document;
          var resolved = clean(labelledBy.split(/\s+/).map(function(id) {
            var node = root.getElementById ? root.getElementById(id) : null;
            if (!node && el.ownerDocument) node = el.ownerDocument.getElementById(id);
            return node ? node.innerText : '';
          }).join(' '), 180);
          if (resolved) return resolved;
        }
        var described = el.getAttribute('aria-describedby');
        var description = '';
        if (described) {
          var descriptionRoot = el.getRootNode ? el.getRootNode() : document;
          description = clean(described.split(/\s+/).map(function(id) {
            var node = descriptionRoot.getElementById ? descriptionRoot.getElementById(id) : null;
            if (!node && el.ownerDocument) node = el.ownerDocument.getElementById(id);
            return node ? node.innerText : '';
          }).join(' '), 120);
        }
        var primary = clean(
          el.getAttribute('aria-label') || el.getAttribute('alt') ||
          el.getAttribute('title') || el.innerText || el.textContent ||
          el.getAttribute('placeholder') || el.value || el.name || el.id,
          180
        );
        return clean(primary + (description ? ' ' + description : ''), 220);
      }

      var allRoots = collectRoots(document, []);
      var selector = [
        'a[href]', 'button', 'input', 'textarea', 'select', 'summary',
        '[contenteditable="true"]', '[tabindex]',
        '[role="button"]', '[role="link"]', '[role="textbox"]',
        '[role="searchbox"]', '[role="checkbox"]', '[role="radio"]',
        '[role="combobox"]', '[role="listbox"]', '[role="option"]',
        '[role="menuitem"]', '[role="menuitemcheckbox"]',
        '[role="menuitemradio"]', '[role="slider"]', '[role="spinbutton"]',
        '[role="switch"]', '[role="tab"]', '[role="treeitem"]'
      ].join(',');
      var main = document.querySelector('main,[role="main"]') || document.body;
      // Global search and navigation controls commonly live outside <main>
      // on long client-rendered pages. Inspect the entire document, then
      // keep editable/action controls ahead of repetitive content links so a
      // large results grid cannot crowd the search surface out of the cap.
      function actionPriority(el) {
        var tag = el.tagName.toLowerCase();
        var explicitRole = (el.getAttribute('role') || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return 0;
        if (tag === 'button' || explicitRole === 'button' ||
            explicitRole === 'checkbox' || explicitRole === 'menuitem') return 1;
        if (tag === 'summary' || el.isContentEditable) return 2;
        if (tag === 'a' || explicitRole === 'link') return 3;
        return 4;
      }
      var activeDialogs = queryAll(
        allRoots,
        '[aria-modal="true"],dialog[open]'
      ).filter(function(el) {
        return rendered(el) && intersectsViewport(el);
      });
      // A modal establishes the browser's current interaction boundary. Do not
      // expose controls behind it: JavaScript click() could otherwise activate
      // elements that a real pointer cannot reach through the modal backdrop.
      // The last visible dialog is the topmost one for nested dialog flows.
      var activeDialog = activeDialogs.length
        ? activeDialogs[activeDialogs.length - 1]
        : null;
      function contextPriority(el) {
        return activeDialogs.some(function(dialog) { return dialog.contains(el); }) ? 0 : 1;
      }
      function viewportPriority(el) {
        return intersectsViewport(el) ? 0 : 1;
      }
      var interactionRoots = activeDialog ? collectRoots(activeDialog, []) : allRoots;
      var selectedNodes = new Set(queryAll(interactionRoots, selector));
      // Match agent-browser's accessibility fallback for custom controls that
      // expose pointer, onclick, or focus semantics without a native tag/role.
      // Avoid descendants that merely inherit cursor:pointer from a parent so
      // a product card becomes one useful ref rather than dozens of duplicates.
      queryAll(interactionRoots, '*').forEach(function(el) {
        if (selectedNodes.has(el) || !rendered(el)) return;
        var style = getComputedStyle(el);
        var pointer = style.cursor === 'pointer';
        var onclick = el.hasAttribute('onclick') || el.onclick !== null;
        var tabindex = el.hasAttribute('tabindex') && el.getAttribute('tabindex') !== '-1';
        var editable = el.getAttribute('contenteditable') === '' ||
          el.getAttribute('contenteditable') === 'true';
        if (!pointer && !onclick && !tabindex && !editable) return;
        if (pointer && !onclick && !tabindex && !editable &&
            el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer') return;
        if (!clean(el.textContent, 100) && !el.getAttribute('aria-label')) return;
        selectedNodes.add(el);
      });
      var nodes = Array.from(selectedNodes)
        .map(function(el, index) {
          return {
            el: el,
            index: index,
            context: contextPriority(el),
            viewport: viewportPriority(el),
            action: actionPriority(el)
          };
        })
        .sort(function(a, b) {
          return a.context - b.context ||
            a.viewport - b.viewport ||
            a.action - b.action ||
            a.index - b.index;
        })
        .map(function(item) { return item.el; });
      var elements = [];
      // Large configurators routinely exceed 80 controls before their final
      // add-on and submit actions. Keep enough semantic elements to expose the
      // whole workflow; the agent loop separately compacts model-facing text.
      for (var i = 0; i < nodes.length && elements.length < 240; i++) {
        var el = nodes[i];
        if (!rendered(el)) continue;
        var ref = state.reverse.get(el);
        if (!ref) {
          ref = 'e' + state.next++;
          state.reverse.set(el, ref);
        }
        state.elements[ref] = el;
        var type = (el.getAttribute('type') || '').toLowerCase();
        var sensitive = type === 'password';
        var name = labelText(el, sensitive);
        var item = {ref: ref, role: role(el), name: name};
        if (el.disabled || el.getAttribute('aria-disabled') === 'true') item.disabled = true;
        if (el.checked) item.checked = true;
        if (el.selected) item.selected = true;
        if (!sensitive && el.value && type !== 'password') item.value = clean(el.value, 100);
        if (el instanceof HTMLSelectElement) {
          var selectedOption = el.selectedOptions && el.selectedOptions[0];
          if (selectedOption) item.selectedLabel = clean(selectedOption.textContent, 100);
          item.options = Array.from(el.options).slice(0, 40).map(function(option) {
            return clean(option.textContent || option.value, 80);
          }).filter(Boolean);
        }
        if (el.getAttribute('placeholder')) item.placeholder = clean(el.getAttribute('placeholder'), 80);
        elements.push(item);
      }

      var shadowText = interactionRoots.slice(1).map(function(root) {
        return root.textContent || '';
      }).join(' ');
      var primaryText = activeDialog
        ? activeDialog.innerText
        : (main ? main.innerText : '');
      return {
        url: location.origin + location.pathname,
        title: document.title,
        text: clean(primaryText + ' ' + shadowText, 3200),
        elements: elements
      };
    })()
    """#

    private static func formatSnapshot(
        _ payload: [String: Any],
        fallbackURL: String,
        fallbackTitle: String
    ) -> String {
        let pageURL = redactedURLForModel(payload["url"] as? String ?? fallbackURL)
        let pageTitle = payload["title"] as? String ?? fallbackTitle
        let pageText = normalize(payload["text"] as? String ?? "")
        let rawElements = payload["elements"] as? [[String: Any]] ?? []

        let elements = rawElements.compactMap { item -> String? in
            guard let ref = item["ref"] as? String,
                  let role = item["role"] as? String else { return nil }
            let name = normalize(item["name"] as? String ?? "")
            var flags: [String] = []
            if item["disabled"] as? Bool == true { flags.append("disabled") }
            if item["checked"] as? Bool == true { flags.append("checked") }
            if item["selected"] as? Bool == true { flags.append("selected") }
            if let value = item["value"] as? String, !value.isEmpty {
                flags.append("value=\"\(value)\"")
            }
            if let selectedLabel = item["selectedLabel"] as? String,
               !selectedLabel.isEmpty,
               selectedLabel != item["value"] as? String {
                flags.append("selection=\"\(selectedLabel)\"")
            }
            if let options = item["options"] as? [String], !options.isEmpty {
                flags.append("options=[\(options.map { "\"\($0)\"" }.joined(separator: ", "))]")
            }
            if let placeholder = item["placeholder"] as? String, !placeholder.isEmpty {
                flags.append("placeholder=\"\(placeholder)\"")
            }
            let suffix = flags.isEmpty ? "" : " (\(flags.joined(separator: ", ")))"
            return "[\(ref)] \(role) \"\(name)\"\(suffix)"
        }

        var sections = ["URL: \(pageURL)", "Title: \(pageTitle)"]
        // Put a compact reading window before the potentially long control
        // list. AgentLoop keeps the head and tail of large observations, so
        // this preserves the page's lead content for readback tasks without
        // removing the full text or the actionable refs used for automation.
        if !pageText.isEmpty, !elements.isEmpty {
            sections.append("Page text preview:\n\(String(pageText.prefix(900)))")
        }
        if !elements.isEmpty {
            sections.append("Interactive elements (use these refs with the matching browser action):\n" + elements.joined(separator: "\n"))
        }
        if !pageText.isEmpty {
            sections.append("Page text:\n\(pageText)")
        }
        return sections.joined(separator: "\n\n")
    }

    /// URLs are part of the agent's model context, so never expose user info,
    /// query parameters, or fragments. OAuth redirects routinely carry codes
    /// and state in those components. The full URL remains visible to the user
    /// in the browser UI, but built-in tool output only includes origin + path.
    public nonisolated static func redactedURLForModel(_ raw: String) -> String {
        guard var components = URLComponents(string: raw),
              let scheme = components.scheme?.lowercased(),
              ["http", "https"].contains(scheme),
              components.host != nil else {
            return "[invalid URL]"
        }
        components.user = nil
        components.password = nil
        components.query = nil
        components.fragment = nil
        return components.string ?? "[redacted URL]"
    }

    /// Collapse runs of blank lines and strip line-edge whitespace so page
    /// text stays compact for the model.
    private static func normalize(_ text: String) -> String {
        let lines = text.components(separatedBy: .newlines).map {
            $0.trimmingCharacters(in: .whitespaces)
        }.filter { !$0.isEmpty }
        return lines.joined(separator: "\n")
    }

    /// Runs a wrapped script, serializing whatever it returns. Page-level JS
    /// exceptions are returned (not thrown).
    private func evaluateWrapped(_ wrapped: String) async throws -> Any? {
        do {
            return try await webView.evaluateJavaScript(wrapped)
        } catch {
            // Page-level failures are observations the agent can recover from,
            // not transport failures that should collapse the whole turn.
            return ["__error": error.localizedDescription]
        }
    }

    /// Safely embed a Swift string as a JavaScript string literal.
    private static func jsString(_ value: String) -> String {
        // Strings are valid JSON values but not JSON *objects*. Without
        // fragmentsAllowed, Foundation raises an Objective-C exception here
        // (rather than a catchable Swift error) on the first click/type action.
        (try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "\"\""
    }

    private static func jsArray(_ values: [String]) -> String {
        guard JSONSerialization.isValidJSONObject(values),
              let data = try? JSONSerialization.data(withJSONObject: values),
              let string = String(data: data, encoding: .utf8) else {
            return "[]"
        }
        return string
    }

    /// Box a JS result into a plain string for the model.
    private static func serialize(_ value: Any?) -> String {
        guard let value else { return "undefined" }
        if value is NSNull { return "null" }
        if let string = value as? String { return string }
        if let number = value as? NSNumber {
            if CFGetTypeID(number) == CFBooleanGetTypeID() {
                return number.boolValue ? "true" : "false"
            }
            return number.stringValue
        }
        if JSONSerialization.isValidJSONObject(value),
           let data = try? JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys]),
           let text = String(data: data, encoding: .utf8) {
            return text
        }
        return "\(value)"
    }
}

// MARK: - Navigation + UI delegates

extension WebKitBrowserDriver: WKNavigationDelegate {
    public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        url = webView.url?.absoluteString ?? url
        title = webView.title ?? title
    }

    public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        lastError = error.localizedDescription
        phase = .failed(error.localizedDescription)
    }

    public func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        lastError = error.localizedDescription
        phase = .failed(error.localizedDescription)
    }
}

extension WebKitBrowserDriver: WKUIDelegate {
    public func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        // Keep target=_blank links in the agent-owned session instead of
        // spawning an untracked Safari/WebKit window.
        if navigationAction.targetFrame == nil, let requestURL = navigationAction.request.url {
            webView.load(URLRequest(url: requestURL))
        }
        return nil
    }

    public func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping @MainActor @Sendable () -> Void
    ) {
        completionHandler()
    }

    public func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping @MainActor @Sendable (Bool) -> Void
    ) {
        completionHandler(true)
    }

    public func webView(
        _ webView: WKWebView,
        runJavaScriptTextInputPanelWithPrompt prompt: String,
        defaultText: String?,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping @MainActor @Sendable (String?) -> Void
    ) {
        completionHandler(defaultText)
    }
}

/// A stable host used to re-parent the one shared WKWebView between the pinned
/// dock and fullscreen. Returning the WKWebView itself from UIViewRepresentable
/// leaves the inline surface blank after a fullscreen transition.
@MainActor
final class WebKitBrowserSurfaceHost: UIView {
    weak var driver: WebKitBrowserDriver?
    weak var hostedWebView: WKWebView?
    private lazy var viewportContainer: UIView = {
        let view = UIView(frame: .zero)
        view.backgroundColor = .black
        view.clipsToBounds = true
        addSubview(view)
        return view
    }()
    var presentationMode: BrowserViewportPresentationMode = .preview {
        didSet {
            guard oldValue != presentationMode else { return }
            applyInteractionMode()
            setNeedsLayout()
        }
    }
    var desktopViewportSize = WebKitBrowserDriver.defaultDesktopViewportSize

    func attach(_ webView: WKWebView) {
        guard webView.superview !== viewportContainer else {
            setNeedsLayout()
            return
        }
        webView.removeFromSuperview()
        viewportContainer.addSubview(webView)
        hostedWebView = webView
        webView.autoresizingMask = []
        applyInteractionMode()
        setNeedsLayout()
    }

    private func applyInteractionMode() {
        guard let webView = hostedWebView else { return }
        let isTakeover = presentationMode == .takeover
        webView.isUserInteractionEnabled = isTakeover
        if !isTakeover {
            // Embedded previews are agent-driven. Releasing WebKit's first
            // responder prevents native form pickers from escaping the clipped
            // browser surface. Takeover mode restores normal Safari controls.
            webView.endEditing(true)
            webView.resignFirstResponder()
            webView.window?.endEditing(true)
        }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        guard let webView = hostedWebView else { return }
        viewportContainer.transform = .identity
        if presentationMode == .preview {
            let viewport = desktopViewportSize
            let scale = min(
                bounds.width / max(viewport.width, 1),
                bounds.height / max(viewport.height, 1))
            // Keep WebKit itself at a stable desktop size and scale only its
            // outer container. Transforming WKWebView directly can leave its
            // internal scroll view at the phone width, which compresses sites
            // into the left edge of the landscape card.
            viewportContainer.bounds = CGRect(origin: .zero, size: viewport)
            viewportContainer.center = CGPoint(x: bounds.midX, y: bounds.midY)
            webView.frame = viewportContainer.bounds
            viewportContainer.transform = CGAffineTransform(scaleX: scale, y: scale)
        } else {
            viewportContainer.frame = bounds
            webView.frame = viewportContainer.bounds
        }
    }

    func detachWebView() {
        guard hostedWebView?.superview === viewportContainer else { return }
        hostedWebView?.removeFromSuperview()
    }
}

/// Embeds the actual shared, agent-driven web view—not a screenshot—so video,
/// carousels, CSS animation, and user interaction remain live in the dock.
@MainActor
public struct WebKitBrowserView: View {
    @ObservedObject private var driver: WebKitBrowserDriver
    private let revision: Int
    private let presentationMode: BrowserViewportPresentationMode
    private let displayMode: BrowserDisplayMode

    public init(
        driver: WebKitBrowserDriver,
        revision: Int = 0,
        presentationMode: BrowserViewportPresentationMode = .preview,
        displayMode: BrowserDisplayMode = .inline
    ) {
        self.driver = driver
        self.revision = revision
        self.presentationMode = presentationMode
        self.displayMode = displayMode
    }

    public var body: some View {
        WebKitBrowserRepresentable(
            driver: driver,
            revision: revision,
            presentationMode: presentationMode,
            displayMode: displayMode)
    }
}

private struct WebKitBrowserRepresentable: UIViewRepresentable {
    private let driver: WebKitBrowserDriver
    let revision: Int
    let presentationMode: BrowserViewportPresentationMode
    let displayMode: BrowserDisplayMode

    init(
        driver: WebKitBrowserDriver,
        revision: Int = 0,
        presentationMode: BrowserViewportPresentationMode = .preview,
        displayMode: BrowserDisplayMode = .inline
    ) {
        self.driver = driver
        self.revision = revision
        self.presentationMode = presentationMode
        self.displayMode = displayMode
    }

    func makeUIView(context: Context) -> WebKitBrowserSurfaceHost {
        let host = WebKitBrowserSurfaceHost()
        host.backgroundColor = .black
        host.clipsToBounds = true
        host.presentationMode = presentationMode
        host.desktopViewportSize = driver.configuration.desktopViewportSize
        host.driver = driver
        driver.attachSurface(
            host,
            presentationMode: presentationMode,
            displayMode: displayMode)
        return host
    }

    func updateUIView(_ uiView: WebKitBrowserSurfaceHost, context: Context) {
        _ = revision
        uiView.presentationMode = presentationMode
        uiView.desktopViewportSize = driver.configuration.desktopViewportSize
        driver.attachSurface(
            uiView,
            presentationMode: presentationMode,
            displayMode: displayMode)
    }

    static func dismantleUIView(_ uiView: WebKitBrowserSurfaceHost, coordinator: Void) {
        uiView.driver?.detachSurface(uiView)
    }
}
#endif
