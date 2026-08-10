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

const int browserSessionLifecycleVersion = 1;

enum BrowserViewportPresentationMode { preview, takeover }

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
