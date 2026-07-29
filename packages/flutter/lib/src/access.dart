enum BrowserPrincipalKind { user, agent, service }

final class BrowserPrincipal {
  const BrowserPrincipal({
    required this.id,
    required this.displayName,
    required this.kind,
    this.avatarUrl,
  });

  final String id;
  final String displayName;
  final BrowserPrincipalKind kind;
  final Uri? avatarUrl;
}

enum BrowserSessionCapability { observe, control, manage, terminate }

enum BrowserSessionVisibility { ownerOnly, channel, explicit }

enum BrowserSensitiveMode { ownerOnly, explicit }

final class BrowserAudienceRule {
  const BrowserAudienceRule({
    required this.scope,
    this.principalIds = const [],
  });

  final BrowserSessionVisibility scope;
  final List<String> principalIds;
}

final class BrowserSessionPolicy {
  const BrowserSessionPolicy({
    required this.observe,
    required this.control,
    required this.allowControlRequests,
    required this.sensitiveMode,
  });

  final BrowserAudienceRule observe;
  final BrowserAudienceRule control;
  final bool allowControlRequests;
  final BrowserSensitiveMode sensitiveMode;
}

final class BrowserControlLease {
  const BrowserControlLease({
    required this.id,
    required this.holder,
    required this.expiresAt,
    required this.renewable,
  });

  final String id;
  final BrowserPrincipal holder;
  final DateTime expiresAt;
  final bool renewable;
}

/// Host-projected access state. It contains no authentication implementation.
final class BrowserSessionAccess {
  const BrowserSessionAccess({
    required this.owner,
    required this.viewer,
    required this.visibility,
    required this.capabilities,
    this.observers = const <BrowserPrincipal>[],
    this.controller,
    this.lease,
    this.sensitive = false,
    this.policy,
  });

  final BrowserPrincipal owner;
  final BrowserPrincipal viewer;
  final BrowserSessionVisibility visibility;
  final Set<BrowserSessionCapability> capabilities;
  final List<BrowserPrincipal> observers;
  final BrowserPrincipal? controller;
  final BrowserControlLease? lease;
  final bool sensitive;
  final BrowserSessionPolicy? policy;
}

/// Client-side input gate. The session gateway must enforce this independently.
bool canSendBrowserInput(BrowserSessionAccess access) {
  final lease = access.lease;
  return !access.sensitive &&
      access.capabilities.contains(BrowserSessionCapability.control) &&
      access.controller?.id == access.viewer.id &&
      lease != null &&
      lease.holder.id == access.viewer.id &&
      lease.expiresAt.isAfter(DateTime.now());
}
