enum BrowserSessionEndReason {
  completed('completed'),
  userEnded('user-ended'),
  replaced('replaced'),
  unavailable('unavailable');

  const BrowserSessionEndReason(this.wireValue);
  final String wireValue;

  static BrowserSessionEndReason parse(Object? value) => values.firstWhere(
    (reason) => reason.wireValue == value,
    orElse: () =>
        throw const FormatException('Invalid browser session end reason.'),
  );
}

enum BrowserSessionReleaseOutcome {
  completed('completed'),
  waiting('waiting');

  const BrowserSessionReleaseOutcome(this.wireValue);
  final String wireValue;

  static BrowserSessionReleaseOutcome parse(Object? value) => values.firstWhere(
    (outcome) => outcome.wireValue == value,
    orElse: () =>
        throw const FormatException('Invalid browser session release outcome.'),
  );
}

const int browserSessionLifecycleVersion = 1;

enum BrowserViewportPresentationMode { preview, takeover }

final class BrowserSessionReleaseRequest {
  BrowserSessionReleaseRequest({
    required this.releaseId,
    required this.sessionId,
    required this.outcome,
    this.label,
    this.url,
    this.title,
  }) {
    _validateIdentifier(releaseId, 'releaseId');
    _validateIdentifier(sessionId, 'sessionId');
    _validateOptionalText(label, 'label', 160);
    _validateOptionalText(title, 'title', 256);
    _validateOptionalUrl(url);
  }

  factory BrowserSessionReleaseRequest.fromJson(Map<String, Object?> json) {
    if (json['version'] != browserSessionLifecycleVersion) {
      throw const FormatException('Invalid browser session lifecycle version.');
    }
    final releaseId = json['releaseId'];
    final sessionId = json['sessionId'];
    final label = json['label'];
    final url = json['url'];
    final title = json['title'];
    if (releaseId is! String ||
        sessionId is! String ||
        label != null && label is! String ||
        url != null && url is! String ||
        title != null && title is! String) {
      throw const FormatException('Invalid browser session release request.');
    }
    return BrowserSessionReleaseRequest(
      releaseId: releaseId,
      sessionId: sessionId,
      outcome: BrowserSessionReleaseOutcome.parse(json['outcome']),
      label: label as String?,
      url: url as String?,
      title: title as String?,
    );
  }

  final String releaseId;
  final String sessionId;
  final BrowserSessionReleaseOutcome outcome;
  final String? label;
  final String? url;
  final String? title;

  Map<String, Object?> toJson() => <String, Object?>{
    'version': browserSessionLifecycleVersion,
    'releaseId': releaseId,
    'sessionId': sessionId,
    'outcome': outcome.wireValue,
    if (label != null) 'label': label,
    if (url != null) 'url': url,
    if (title != null) 'title': title,
  };
}

final class BrowserSessionReleaseReceipt {
  BrowserSessionReleaseReceipt({
    required this.request,
    required this.releasedAt,
  });

  factory BrowserSessionReleaseReceipt.fromJson(Map<String, Object?> json) {
    if (json['status'] != 'released') {
      throw const FormatException('Invalid browser session release receipt.');
    }
    final releasedAt = json['releasedAt'];
    if (releasedAt is! String) {
      throw const FormatException('Invalid browser session release receipt.');
    }
    final parsedDate = DateTime.tryParse(releasedAt);
    if (parsedDate == null) {
      throw const FormatException('Invalid browser session release timestamp.');
    }
    return BrowserSessionReleaseReceipt(
      request: BrowserSessionReleaseRequest.fromJson(json),
      releasedAt: parsedDate,
    );
  }

  final BrowserSessionReleaseRequest request;
  final DateTime releasedAt;

  Map<String, Object?> toJson() => <String, Object?>{
    ...request.toJson(),
    'status': 'released',
    'releasedAt': releasedAt.toUtc().toIso8601String(),
  };
}

final class BrowserSessionEndRequest {
  BrowserSessionEndRequest({
    required this.sessionId,
    required this.clientInstanceId,
    this.reason = BrowserSessionEndReason.userEnded,
  }) {
    _validateIdentifier(sessionId, 'sessionId');
    _validateIdentifier(clientInstanceId, 'clientInstanceId');
  }

  factory BrowserSessionEndRequest.fromJson(Map<String, Object?> json) {
    if (json['version'] != browserSessionLifecycleVersion) {
      throw const FormatException('Invalid browser session lifecycle version.');
    }
    final sessionId = json['sessionId'];
    final clientInstanceId = json['clientInstanceId'];
    if (sessionId is! String || clientInstanceId is! String) {
      throw const FormatException('Invalid browser session identifiers.');
    }
    return BrowserSessionEndRequest(
      sessionId: sessionId,
      clientInstanceId: clientInstanceId,
      reason: BrowserSessionEndReason.parse(json['reason']),
    );
  }

  final String sessionId;
  final String clientInstanceId;
  final BrowserSessionEndReason reason;

  Map<String, Object?> toJson() => <String, Object?>{
    'version': browserSessionLifecycleVersion,
    'sessionId': sessionId,
    'clientInstanceId': clientInstanceId,
    'reason': reason.wireValue,
  };
}

final class BrowserSessionEndReceipt {
  BrowserSessionEndReceipt({
    required this.sessionId,
    required this.reason,
    required this.endedAt,
  }) {
    _validateIdentifier(sessionId, 'sessionId');
  }

  factory BrowserSessionEndReceipt.fromJson(Map<String, Object?> json) {
    if (json['version'] != browserSessionLifecycleVersion ||
        json['status'] != 'ended') {
      throw const FormatException('Invalid browser session end receipt.');
    }
    final sessionId = json['sessionId'];
    final endedAt = json['endedAt'];
    if (sessionId is! String || endedAt is! String) {
      throw const FormatException('Invalid browser session end receipt.');
    }
    final parsedDate = DateTime.tryParse(endedAt);
    if (parsedDate == null) {
      throw const FormatException('Invalid browser session end timestamp.');
    }
    return BrowserSessionEndReceipt(
      sessionId: sessionId,
      reason: BrowserSessionEndReason.parse(json['reason']),
      endedAt: parsedDate,
    );
  }

  final String sessionId;
  final BrowserSessionEndReason reason;
  final DateTime endedAt;

  Map<String, Object?> toJson() => <String, Object?>{
    'version': browserSessionLifecycleVersion,
    'sessionId': sessionId,
    'status': 'ended',
    'reason': reason.wireValue,
    'endedAt': endedAt.toUtc().toIso8601String(),
  };
}

void _validateIdentifier(String value, String field) {
  if (value.isEmpty ||
      value.length > 160 ||
      !RegExp(r'^[A-Za-z0-9_-]+$').hasMatch(value)) {
    throw FormatException('Invalid browser session $field.');
  }
}

void _validateOptionalText(String? value, String field, int maximumLength) {
  if (value != null && value.length > maximumLength) {
    throw FormatException('Invalid browser session $field.');
  }
}

void _validateOptionalUrl(String? value) {
  if (value == null) return;
  final parsed = Uri.tryParse(value);
  if (value.length > 2048 ||
      parsed == null ||
      !const <String>{'http', 'https'}.contains(parsed.scheme.toLowerCase()) ||
      parsed.host.isEmpty ||
      parsed.userInfo.isNotEmpty) {
    throw const FormatException('Invalid browser session URL.');
  }
}
