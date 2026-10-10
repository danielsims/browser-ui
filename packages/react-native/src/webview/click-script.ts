/**
 * The activation core injected into the WebView.
 *
 * Mobile WebKit often ignores a bare `HTMLElement.click()`: a control may listen
 * on `pointerdown`/`touchstart`, sit behind a sibling hit layer, or require the
 * full pointer sequence to reach a framework's delegated listener. This script
 * resolves a tagged ref, scrolls it into view, checks it is actually reachable,
 * then dispatches a realistic pointer/touch/mouse/click sequence at the point a
 * finger would land. The driver confirms afterwards that the page reacted.
 *
 * Resolution is composed-DOM aware and fingerprint based. If the tagged node is
 * gone, a virtualised list re-rendered, or the control lives inside a shadow
 * root, the live node is re-found by matching the fingerprint captured at
 * snapshot time, before ever reporting `ref-not-found`.
 *
 * Three scripts share one helper block so they agree on what "the element",
 * "visible", and "changed" mean:
 *   resolve  - find, scroll, measure, and reject unreachable targets
 *   dispatch - re-measure and fire the sequence, returning a before-signature
 *   verify   - compare a fresh signature with the one captured at dispatch
 *
 * Output is plain data the driver validates; no exceptions cross `postMessage`.
 */

const HELPERS = String.raw`
  function clean(value, limit) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, limit);
  }
  // Canonical composed-DOM traversal. \`deepRoots\` visits the document, then each
  // open shadow root in document order; \`deepQueryAll\` concatenates their matches
  // so refs and fingerprints are indexed the same way the snapshot indexed them.
  function deepRoots(root, out) {
    out.push(root);
    var all = root.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      if (all[i].shadowRoot) deepRoots(all[i].shadowRoot, out);
    }
    return out;
  }
  function scopedQueryAll(root, selector) {
    var list = deepRoots(root, []);
    var matches = [];
    for (var i = 0; i < list.length; i++) {
      var found = list[i].querySelectorAll(selector);
      for (var j = 0; j < found.length; j++) matches.push(found[j]);
    }
    return matches;
  }
  function deepQueryAll(selector) {
    return scopedQueryAll(document, selector);
  }
  function parentOf(el) {
    if (el.parentElement) return el.parentElement;
    var root = el.getRootNode && el.getRootNode();
    return root && root.host ? root.host : null;
  }
  // Mirrors the snapshot's contextText: the nearest composed ancestor whose only
  // interactive descendant is this element, with this element's name removed.
  function contextOf(el, name, limit) {
    var own = clean(name, 160);
    var node = parentOf(el);
    var depth = 0;
    while (node && depth < 6) {
      var interactive = scopedQueryAll(node,
        'a[href],button,input,select,textarea,[role="button"],[role="link"],[role="checkbox"],[role="radio"],[onclick]');
      if (interactive.length <= 1) {
        var stripped = clean((node.innerText || '').split(own).join(' '), limit);
        if (stripped.length > own.length) return stripped;
      }
      node = parentOf(node);
      depth++;
    }
    return '';
  }
  function findRef(ref) {
    var sel = '[data-browser-ui-ref="' + String(ref).replace(/"/g, '\\"') + '"]';
    return deepQueryAll(sel)[0] || null;
  }
  function roleOf(el) {
    var explicit = el.getAttribute && el.getAttribute('role');
    if (explicit) return explicit;
    var tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (tag === 'a') return 'link';
    if (tag === 'button' || tag === 'summary') return 'button';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'select') return el.multiple ? 'listbox' : 'combobox';
    if (tag === 'input') {
      var type = (el.type || 'text').toLowerCase();
      if (type === 'submit' || type === 'button') return 'button';
      if (type === 'radio') return 'radio';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'search') return 'searchbox';
      if (type === 'number') return 'spinbutton';
      return 'textbox';
    }
    return tag;
  }
  // Mirrors the snapshot's labelText so a name captured at snapshot time can be
  // compared to a live node's name exactly.
  function labelOf(el) {
    if (el.labels && el.labels.length) {
      var labelled = clean(Array.from(el.labels).map(function(label) {
        return label.innerText;
      }).join(' '), 180);
      if (labelled) return labelled;
    }
    var labelledBy = el.getAttribute && el.getAttribute('aria-labelledby');
    if (labelledBy) {
      var resolved = clean(labelledBy.split(/\s+/).map(function(id) {
        var node = el.ownerDocument ? el.ownerDocument.getElementById(id) : null;
        return node ? node.innerText : '';
      }).join(' '), 180);
      if (resolved) return resolved;
    }
    return clean(
      (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('title'))) ||
      el.innerText || el.textContent ||
      (el.getAttribute && el.getAttribute('placeholder')) ||
      el.value || el.name || el.id,
      220
    );
  }
  var INTERACTIVE_SELECTOR = [
    'a[href]', 'button', 'input', 'textarea', 'select', 'summary',
    '[contenteditable="true"]', '[tabindex]',
    '[role="button"]', '[role="link"]', '[role="textbox"]',
    '[role="searchbox"]', '[role="checkbox"]', '[role="radio"]',
    '[role="combobox"]', '[role="listbox"]', '[role="option"]',
    '[role="menuitem"]', '[role="slider"]', '[role="spinbutton"]',
    '[role="switch"]', '[role="tab"]'
  ].join(',');
  function describe(el) {
    var r = el.getBoundingClientRect();
    return {
      ref: (el.getAttribute && el.getAttribute('data-browser-ui-ref')) || '',
      role: roleOf(el),
      name: labelOf(el),
      rect: {x: r.left, y: r.top, width: r.width, height: r.height},
      excerpt: clean(el.innerText || el.textContent || labelOf(el), 160)
    };
  }
  function isHidden(el) {
    var style = getComputedStyle(el);
    return style.visibility === 'hidden' || style.display === 'none';
  }
  function isVisible(el, rect) {
    return rect.width > 0 && rect.height > 0 && !isHidden(el);
  }
  function normPoint(px, py) {
    return {
      x: Math.max(0, Math.min(1, px / Math.max(window.innerWidth, 1))),
      y: Math.max(0, Math.min(1, py / Math.max(window.innerHeight, 1)))
    };
  }
  function pointOf(rect) {
    return {
      x: Math.max(0, Math.min(window.innerWidth - 1, rect.left + rect.width / 2)),
      y: Math.max(0, Math.min(window.innerHeight - 1, rect.top + rect.height / 2))
    };
  }
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
  // elementFromPoint stops at the shadow host; descend until the innermost open
  // shadow root reports the node that would actually receive the touch.
  function deepElementFromPoint(x, y) {
    var el = document.elementFromPoint(x, y);
    var guard = 0;
    while (el && el.shadowRoot && guard < 10) {
      var inner = el.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === el) break;
      el = inner;
      guard++;
    }
    return el;
  }
  // The live node with this role and name, counting matches in the same composed
  // order the snapshot used, then corroborating with tag/href/text/context.
  // Index is clamped so a shorter or reordered list still resolves.
  function matchFingerprint(fp) {
    if (!fp || !fp.role) return {el: null, roleNameMatches: 0, narrowedMatches: 0};
    var all = deepQueryAll(INTERACTIVE_SELECTOR);
    var roleName = [];
    var i;
    for (i = 0; i < all.length; i++) {
      if (roleOf(all[i]) === fp.role && labelOf(all[i]) === fp.name) roleName.push(all[i]);
    }
    // Snapshot also tags pointer/onclick-only nodes that the selector misses;
    // widen once before giving up.
    if (!roleName.length) {
      var every = deepQueryAll('*');
      for (i = 0; i < every.length; i++) {
        if (roleOf(every[i]) === fp.role && labelOf(every[i]) === fp.name) roleName.push(every[i]);
      }
    }
    var narrowed = roleName.filter(function(el) {
      var tag = el.tagName ? el.tagName.toLowerCase() : '';
      if (fp.tag && tag !== fp.tag) return false;
      if (fp.href && (el.getAttribute('href') || '') !== fp.href) return false;
      if (fp.context && contextOf(el, fp.name, 160) !== fp.context) return false;
      return true;
    });
    var pool = narrowed.length ? narrowed : roleName;
    var index = typeof fp.index === 'number' && fp.index >= 0 ? fp.index : 0;
    var el = pool.length ? pool[Math.min(index, pool.length - 1)] : null;
    return {el: el, roleNameMatches: roleName.length, narrowedMatches: narrowed.length};
  }
  function resolveTarget(ref, fp) {
    var el = findRef(ref);
    if (el) return {el: el, via: 'ref'};
    var found = matchFingerprint(fp);
    return {
      el: found.el,
      via: found.el ? 'fingerprint' : 'none',
      roleNameMatches: found.roleNameMatches,
      narrowedMatches: found.narrowedMatches
    };
  }
  function refInventory(ref) {
    var attrs = deepQueryAll('[data-browser-ui-ref]');
    var exact = false;
    for (var i = 0; i < attrs.length; i++) {
      if (attrs[i].getAttribute('data-browser-ui-ref') === ref) { exact = true; break; }
    }
    return {attributes: attrs.length, exact: exact};
  }
  // Failure-only diagnostics: enough to diagnose a stale ref from a pasted log.
  function diagnoseFailure(ref, fp) {
    var tagged = refInventory(ref);
    var before = matchFingerprint(fp);
    var scrolled = false;
    var x = window.scrollX;
    var y = window.scrollY;
    try {
      var scrollables = deepQueryAll('*').filter(function(el) {
        return el.scrollHeight > el.clientHeight + 24;
      }).slice(0, 40);
      for (var i = 0; i < scrollables.length; i++) {
        scrollables[i].scrollTop = scrollables[i].scrollTop + scrollables[i].clientHeight;
        scrolled = true;
      }
      window.scrollBy(0, Math.round(window.innerHeight * 0.6));
    } catch (e) {}
    var after = matchFingerprint(fp);
    try { window.scrollTo(x, y); } catch (e) {}
    var excerpt = clean(document.body && document.body.innerText, 200);
    var wanted = fp
      ? 'role=' + fp.role + ' name=' + JSON.stringify(fp.name) + ' tag=' + fp.tag + ' index=' + fp.index
      : 'none';
    return [
      'ref ' + ref + (tagged.exact ? ' is still tagged' : ' is not tagged'),
      'refAttrsOnPage=' + tagged.attributes,
      'fingerprint ' + wanted,
      'roleNameMatches before=' + before.roleNameMatches + ' after=' + after.roleNameMatches,
      'narrowedMatches before=' + before.narrowedMatches + ' after=' + after.narrowedMatches,
      'scrolled=' + scrolled,
      'text="' + excerpt + '"'
    ].join('; ');
  }
  // A compact fingerprint of what the page looks like around the target, used to
  // tell whether an activation had any effect at all.
  function signature(el) {
    var parts = [];
    try { parts.push(location.href); } catch (e) {}
    try { parts.push(document.title); } catch (e) {}
    try {
      parts.push(String((document.body && document.body.innerText || '').replace(/\s+/g, ' ').length));
    } catch (e) {}
    try {
      parts.push(String(deepQueryAll('a[href],button,input,select,textarea,[role="button"],[role="checkbox"],[role="radio"]').length));
    } catch (e) {}
    try {
      var active = document.activeElement;
      parts.push(active ? active.tagName + ':' + ((active.getAttribute && active.getAttribute('data-browser-ui-ref')) || '') : '');
    } catch (e) {}
    try { parts.push(String(el ? el.outerHTML.length : -1)); } catch (e) {}
    return parts.join('|');
  }
`;

function fingerprintLiteral(fingerprint: unknown): string {
  return JSON.stringify(fingerprint ?? null);
}

/** Find the ref (or its live fingerprint match), scroll it to centre, and reject unreachable targets. */
export function buildResolveClickScript(
  ref: string,
  fingerprint?: unknown,
): string {
  return `(function(){${HELPERS}
    var REF = ${JSON.stringify(ref)};
    var FP = ${fingerprintLiteral(fingerprint)};
    var resolved = resolveTarget(REF, FP);
    var el = resolved.el;
    if (!el) {
      return {status: 'ref-not-found', ref: REF, element: null, message: diagnoseFailure(REF, FP)};
    }
    try {
      el.scrollIntoView({block: 'center', inline: 'center'});
    } catch (e) {
      try { el.scrollIntoView(); } catch (ignored) {}
    }
    var info = describe(el);
    var rect = el.getBoundingClientRect();
    var note = resolved.via === 'fingerprint' ? 're-resolved by fingerprint' : '';
    if (!isVisible(el, rect)) return {status: 'not-visible', ref: REF, element: info, message: note};
    if (el.disabled || (el.getAttribute && el.getAttribute('aria-disabled') === 'true')) {
      return {status: 'element-disabled', ref: REF, element: info, message: note};
    }
    var point = pointOf(rect);
    var hit = deepElementFromPoint(point.x, point.y);
    if (hit && hit !== el && !composedContains(el, hit) && !composedContains(hit, el)) {
      return {
        status: 'covered',
        ref: REF,
        element: info,
        point: normPoint(point.x, point.y),
        message: 'covered by <' + clean(hit.tagName + '.' + (hit.className || ''), 80) + '>'
      };
    }
    return {status: 'ok', ref: REF, element: info, point: normPoint(point.x, point.y), message: note};
  })()`;
}

/**
 * Re-measure the ref (or its fingerprint match) and dispatch the
 * pointer/touch/mouse/click sequence at the element's centre, preferring
 * whatever `elementFromPoint` actually exposes.
 */
export function buildDispatchClickScript(
  ref: string,
  fingerprint?: unknown,
): string {
  return `(function(){${HELPERS}
    var REF = ${JSON.stringify(ref)};
    var FP = ${fingerprintLiteral(fingerprint)};
    var resolved = resolveTarget(REF, FP);
    var el = resolved.el;
    if (!el) return {status: 'ref-not-found', ref: REF, element: null, sequence: [], message: diagnoseFailure(REF, FP)};
    var rect = el.getBoundingClientRect();
    var info = describe(el);
    var note = resolved.via === 'fingerprint' ? 're-resolved by fingerprint' : '';
    if (!isVisible(el, rect)) return {status: 'not-visible', ref: REF, element: info, sequence: [], message: note};
    if (el.disabled || (el.getAttribute && el.getAttribute('aria-disabled') === 'true')) {
      return {status: 'element-disabled', ref: REF, element: info, sequence: [], message: note};
    }
    var point = pointOf(rect);
    var hit = deepElementFromPoint(point.x, point.y);
    var node = hit && (composedContains(el, hit) || composedContains(hit, el)) ? hit : el;
    var before = signature(el);
    var wasChecked = node.checked;
    var sequence = [];
    function fire(type, Ctor, init) {
      try {
        node.dispatchEvent(new Ctor(type, init));
        sequence.push(type);
        return true;
      } catch (e) {
        sequence.push(type + '!');
        return false;
      }
    }
    var mx = point.x;
    var my = point.y;
    var down = {
      bubbles: true, cancelable: true, composed: true, view: window,
      clientX: mx, clientY: my, screenX: mx, screenY: my, button: 0, buttons: 1, detail: 1
    };
    var up = {
      bubbles: true, cancelable: true, composed: true, view: window,
      clientX: mx, clientY: my, screenX: mx, screenY: my, button: 0, buttons: 0, detail: 1
    };
    fire('pointerover', PointerEvent, down);
    fire('pointerdown', PointerEvent, down);
    fire('mousedown', MouseEvent, down);
    try {
      if (typeof Touch !== 'undefined' && typeof TouchEvent !== 'undefined') {
        var touch = new Touch({
          identifier: 1, target: node, clientX: mx, clientY: my,
          screenX: mx, screenY: my, pageX: mx, pageY: my,
          radiusX: 1, radiusY: 1, force: 1
        });
        node.dispatchEvent(new TouchEvent('touchstart', {
          bubbles: true, cancelable: true, composed: true,
          touches: [touch], targetTouches: [touch], changedTouches: [touch]
        }));
        sequence.push('touchstart');
      }
    } catch (e) {
      sequence.push('touchstart!');
    }
    var editable = node.matches && node.matches('input,textarea,[contenteditable="true"],[role="combobox"]');
    if (editable && document.activeElement !== node) {
      try {
        node.focus({preventScroll: true});
        sequence.push('focus');
      } catch (e) {}
    }
    fire('pointerup', PointerEvent, up);
    fire('mouseup', MouseEvent, up);
    try {
      if (typeof TouchEvent !== 'undefined') {
        node.dispatchEvent(new TouchEvent('touchend', {
          bubbles: true, cancelable: true, composed: true,
          touches: [], targetTouches: [], changedTouches: []
        }));
        sequence.push('touchend');
      }
    } catch (e) {
      sequence.push('touchend!');
    }
    fire('click', MouseEvent, up);
    // Untrusted click events do not run a checkbox/radio's default toggle, so
    // fall back to the native activation when the control did not change.
    var type = ((node.getAttribute && node.getAttribute('type')) || '').toLowerCase();
    var checkable = type === 'radio' || type === 'checkbox' ||
      (node.getAttribute && ['radio', 'checkbox', 'switch'].indexOf((node.getAttribute('role') || '').toLowerCase()) !== -1);
    if (checkable && node.checked === wasChecked && typeof node.click === 'function') {
      try { node.click(); sequence.push('native-click'); } catch (e) {}
    }
    return {
      status: 'dispatched',
      ref: REF,
      element: info,
      point: normPoint(mx, my),
      before: before,
      sequence: sequence,
      message: note
    };
  })()`;
}

/** Did the page react to the activation? Returns the pre/post signatures. */
export function buildVerifyClickScript(
  ref: string,
  before: string,
  fingerprint?: unknown,
): string {
  return `(function(){${HELPERS}
    var REF = ${JSON.stringify(ref)};
    var FP = ${fingerprintLiteral(fingerprint)};
    var before = ${JSON.stringify(before)};
    var el = resolveTarget(REF, FP).el;
    var after = signature(el);
    return {
      status: after === before ? 'dispatched-but-unconfirmed' : 'clicked',
      ref: REF,
      element: el ? describe(el) : null,
      before: before,
      after: after
    };
  })()`;
}

/** Focus a ref (or its fingerprint match) and set its value with input/change events. */
export function buildTypeScript(
  ref: string,
  text: string,
  fingerprint?: unknown,
): string {
  return `(function(){${HELPERS}
    var REF = ${JSON.stringify(ref)};
    var FP = ${fingerprintLiteral(fingerprint)};
    var VALUE = ${JSON.stringify(text)};
    var resolved = resolveTarget(REF, FP);
    var el = resolved.el;
    if (!el) return {status: 'ref-not-found', ref: REF, message: 'No element matches ref ' + REF + ' (' + diagnoseFailure(REF, FP) + ')'};
    try { el.scrollIntoView({block: 'center'}); } catch (e) {}
    var rect = el.getBoundingClientRect();
    el.focus();
    var proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    var descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && descriptor.set) { descriptor.set.call(el, VALUE); } else { el.value = VALUE; }
    el.dispatchEvent(new Event('input', {bubbles: true}));
    el.dispatchEvent(new Event('change', {bubbles: true}));
    return {
      status: 'ok',
      ref: REF,
      point: {
        x: (rect.left + rect.width / 2) / Math.max(window.innerWidth, 1),
        y: (rect.top + rect.height / 2) / Math.max(window.innerHeight, 1)
      }
    };
  })()`;
}
