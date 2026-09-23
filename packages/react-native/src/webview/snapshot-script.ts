/**
 * The observation core injected into the WebView.
 *
 * Turns a live page into the structured snapshot the agent reasons over. The
 * element shape mirrors the on-device WebKit driver so decisions transfer
 * unchanged. Refs are written to a stable `data-browser-ui-ref` attribute so a
 * later injected script can act on the same node.
 *
 * Tagging and traversal pierce open shadow roots, and every element also gets a
 * locator fingerprint (`role`, `name`, `tag`, `href`, `text`, `context`,
 * `index`) so a click can re-find the live node if the framework re-renders or
 * virtualises the list and discards the tagged node.
 *
 * Output shape: { url, title, text, elements: WebViewBrowserElement[] }
 */
export const SNAPSHOT_SCRIPT = String.raw`
(function(){
  var state = window.__browserUiWebView;
  if (!state) {
    state = {next: 1};
    window.__browserUiWebView = state;
  }

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
  // Composed parent: steps out of a shadow root to its host.
  function parentOf(el) {
    if (el.parentElement) return el.parentElement;
    var root = el.getRootNode && el.getRootNode();
    return root && root.host ? root.host : null;
  }
  function excludedByAncestor(el) {
    var current = el;
    while (current) {
      if (current.matches && current.matches('[hidden],[aria-hidden="true"],[inert]')) {
        return true;
      }
      current = parentOf(current);
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
      if (inputType === 'number') return 'spinbutton';
      return 'textbox';
    }
    return tag;
  }
  function labelText(el, sensitive) {
    if (sensitive) return 'password field';
    if (el.labels && el.labels.length) {
      var labelled = clean(Array.from(el.labels).map(function(label) {
        return label.innerText;
      }).join(' '), 180);
      if (labelled) return labelled;
    }
    var labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      var resolved = clean(labelledBy.split(/\s+/).map(function(id) {
        var node = el.ownerDocument ? el.ownerDocument.getElementById(id) : null;
        return node ? node.innerText : '';
      }).join(' '), 180);
      if (resolved) return resolved;
    }
    return clean(
      el.getAttribute('aria-label') || el.getAttribute('alt') ||
      el.getAttribute('title') || el.innerText || el.textContent ||
      el.getAttribute('placeholder') || el.value || el.name || el.id,
      220
    );
  }
  // The nearest composed ancestor whose only interactive descendant is this
  // element, with the element's own name removed. This is what tells two
  // identical "Add to cart" buttons apart by the product around them.
  function contextText(el, name, limit) {
    var own = clean(name, 160);
    var node = parentOf(el);
    var depth = 0;
    while (node && depth < 6) {
      var interactive = queryAll(collectRoots(node, []),
        'a[href],button,input,select,textarea,[role="button"],[role="link"],[role="checkbox"],[role="radio"],[onclick]');
      if (interactive.length <= 1) {
        var stripped = clean(node.innerText.split(own).join(' '), limit);
        if (stripped.length > own.length) return stripped;
      }
      node = parentOf(node);
      depth++;
    }
    return '';
  }

  var allRoots = collectRoots(document, []);
  var INTERACTIVE_SELECTOR = [
    'a[href]', 'button', 'input', 'textarea', 'select', 'summary',
    '[contenteditable="true"]', '[tabindex]',
    '[role="button"]', '[role="link"]', '[role="textbox"]',
    '[role="searchbox"]', '[role="checkbox"]', '[role="radio"]',
    '[role="combobox"]', '[role="listbox"]', '[role="option"]',
    '[role="menuitem"]', '[role="slider"]', '[role="spinbutton"]',
    '[role="switch"]', '[role="tab"]'
  ].join(',');
  var main = document.querySelector('main,[role="main"]') || document.body;

  // Count same role+name matches in canonical composed order so the click
  // script can recompute the identical index when it re-finds a live node.
  var fingerprintCounts = {};
  var fingerprintIndex = new Map();
  queryAll(allRoots, INTERACTIVE_SELECTOR).forEach(function(el) {
    var key = role(el) + '::' + labelText(el, false);
    var seen = fingerprintCounts[key] || 0;
    fingerprintCounts[key] = seen + 1;
    fingerprintIndex.set(el, seen);
  });

  function actionPriority(el) {
    var tag = el.tagName.toLowerCase();
    var explicitRole = (el.getAttribute('role') || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return 0;
    if (tag === 'button' || explicitRole === 'button' || explicitRole === 'checkbox') return 1;
    if (tag === 'summary' || el.isContentEditable) return 2;
    if (tag === 'a' || explicitRole === 'link') return 3;
    return 4;
  }
  var activeDialogs = queryAll(allRoots, '[aria-modal="true"],dialog[open]')
    .filter(function(el) { return rendered(el) && intersectsViewport(el); });
  var activeDialog = activeDialogs.length ? activeDialogs[activeDialogs.length - 1] : null;
  function contextPriority(el) {
    return activeDialogs.some(function(dialog) { return dialog.contains(el); }) ? 0 : 1;
  }
  function viewportPriority(el) {
    return intersectsViewport(el) ? 0 : 1;
  }

  var interactionRoots = activeDialog ? collectRoots(activeDialog, []) : allRoots;
  var selectedNodes = new Set(queryAll(interactionRoots, INTERACTIVE_SELECTOR));
  queryAll(interactionRoots, '*').forEach(function(el) {
    if (selectedNodes.has(el) || !rendered(el)) return;
    var style = getComputedStyle(el);
    var pointer = style.cursor === 'pointer';
    var onclick = el.hasAttribute('onclick') || el.onclick !== null;
    var tabindex = el.hasAttribute('tabindex') && el.getAttribute('tabindex') !== '-1';
    if (!pointer && !onclick && !tabindex) return;
    if (pointer && !onclick && !tabindex &&
        el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer') return;
    if (!clean(el.textContent, 100) && !el.getAttribute('aria-label')) return;
    selectedNodes.add(el);
  });

  var nodes = Array.from(selectedNodes)
    .map(function(el, index) {
      return {el: el, index: index, context: contextPriority(el), viewport: viewportPriority(el), action: actionPriority(el)};
    })
    .sort(function(a, b) {
      return a.context - b.context || a.viewport - b.viewport || a.action - b.action || a.index - b.index;
    })
    .map(function(item) { return item.el; });

  var elements = [];
  for (var i = 0; i < nodes.length && elements.length < 240; i++) {
    var el = nodes[i];
    if (!rendered(el)) continue;
    var ref = el.getAttribute('data-browser-ui-ref');
    if (!ref) {
      ref = 'e' + state.next++;
      el.setAttribute('data-browser-ui-ref', ref);
    }
    var type = (el.getAttribute('type') || '').toLowerCase();
    var sensitive = type === 'password';
    var name = labelText(el, sensitive);
    var context = contextText(el, name, 200);
    var fingerprint = {
      role: role(el),
      name: name,
      tag: el.tagName.toLowerCase(),
      index: fingerprintIndex.has(el) ? fingerprintIndex.get(el) : 0
    };
    var href = el.getAttribute('href');
    if (href) fingerprint.href = href;
    var text = clean(el.textContent, 160);
    if (text) fingerprint.text = text;
    var contextShort = clean(context, 160);
    if (contextShort) fingerprint.context = contextShort;
    var item = {ref: ref, role: role(el), name: name, fingerprint: fingerprint};
    if (context) item.context = context;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') item.disabled = true;
    if (el.checked) item.checked = true;
    if (!sensitive && el.value && type !== 'password') item.value = clean(el.value, 100);
    if (el.getAttribute('placeholder')) item.placeholder = clean(el.getAttribute('placeholder'), 80);
    elements.push(item);
  }

  var shadowText = interactionRoots.slice(1).map(function(root) {
    return root.textContent || '';
  }).join(' ');
  var primaryText = activeDialog ? activeDialog.innerText : (main ? main.innerText : '');
  return {
    url: location.origin + location.pathname,
    title: document.title,
    text: clean(primaryText + ' ' + shadowText, 3200),
    elements: elements
  };
})()
`;
