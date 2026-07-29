import 'dart:convert';
import 'dart:typed_data';

/// Base type for messages received from an agent-browser stream.
sealed class AgentBrowserMessage {
  const AgentBrowserMessage();
}

/// Browser viewport metadata attached to a JPEG frame.
final class AgentBrowserFrameMetadata {
  const AgentBrowserFrameMetadata({
    required this.deviceWidth,
    required this.deviceHeight,
    required this.pageScaleFactor,
    required this.offsetTop,
    required this.scrollOffsetX,
    required this.scrollOffsetY,
  });

  final double deviceWidth;
  final double deviceHeight;
  final double pageScaleFactor;
  final double offsetTop;
  final double scrollOffsetX;
  final double scrollOffsetY;
}

/// A base64-encoded JPEG frame from agent-browser.
final class AgentBrowserFrameMessage extends AgentBrowserMessage {
  const AgentBrowserFrameMessage({required this.data, required this.metadata});

  final String data;
  final AgentBrowserFrameMetadata metadata;
}

/// A binary gateway frame with a small JSON header followed by raw JPEG bytes.
final class BrowserSessionBinaryFrameMessage extends AgentBrowserMessage {
  const BrowserSessionBinaryFrameMessage({
    required this.data,
    required this.metadata,
    required this.capturedAt,
    required this.sourceEpoch,
    required this.frameSequence,
    required this.viewportRevision,
  });

  final Uint8List data;
  final AgentBrowserFrameMetadata metadata;
  final int capturedAt;
  final String sourceEpoch;
  final int frameSequence;
  final int viewportRevision;
}

/// Agent-browser's status for the browser and screencast behind the socket.
final class AgentBrowserStreamStatusMessage extends AgentBrowserMessage {
  const AgentBrowserStreamStatusMessage({
    required this.connected,
    required this.screencasting,
    required this.viewportWidth,
    required this.viewportHeight,
  });

  final bool connected;
  final bool screencasting;
  final double viewportWidth;
  final double viewportHeight;
}

/// The current page URL reported by agent-browser.
final class AgentBrowserUrlMessage extends AgentBrowserMessage {
  const AgentBrowserUrlMessage(this.url);

  final String url;
}

/// The browser cursor name reported by agent-browser.
///
/// This remains a string so new cursor names can be added by the protocol
/// without breaking older clients.
final class AgentBrowserCursorMessage extends AgentBrowserMessage {
  const AgentBrowserCursorMessage(this.cursor);

  final String cursor;
}

/// A valid message type not understood by this package version.
final class AgentBrowserUnknownMessage extends AgentBrowserMessage {
  AgentBrowserUnknownMessage({
    required this.type,
    required Map<String, Object?> payload,
  }) : payload = Map<String, Object?>.unmodifiable(payload);

  final String type;
  final Map<String, Object?> payload;
}

/// Parses the additive agent-browser stream protocol.
///
/// Extra keys on known messages are ignored. Unknown message types are
/// represented by [AgentBrowserUnknownMessage], allowing a newer server to be
/// used safely by an older client.
abstract final class AgentBrowserProtocol {
  static AgentBrowserMessage parse(Object? data) {
    if (data is List<int> && _isBinaryFrame(data)) {
      return _parseBinaryFrame(data);
    }
    final payload = _decodePayload(data);
    final type = _requiredString(payload, 'type');

    return switch (type) {
      'frame' => AgentBrowserFrameMessage(
        data: _requiredString(payload, 'data'),
        metadata: _frameMetadata(payload['metadata']),
      ),
      'status' => AgentBrowserStreamStatusMessage(
        connected: _requiredBool(payload, 'connected'),
        screencasting: _requiredBool(payload, 'screencasting'),
        viewportWidth: _requiredFiniteNumber(payload, 'viewportWidth'),
        viewportHeight: _requiredFiniteNumber(payload, 'viewportHeight'),
      ),
      'url' => AgentBrowserUrlMessage(_requiredString(payload, 'url')),
      'cursor' => AgentBrowserCursorMessage(_requiredString(payload, 'cursor')),
      _ => AgentBrowserUnknownMessage(type: type, payload: payload),
    };
  }

  static bool _isBinaryFrame(List<int> data) {
    return data.length >= 12 &&
        data[0] == 0x42 &&
        data[1] == 0x55 &&
        data[2] == 0x49 &&
        data[3] == 0x46;
  }

  static BrowserSessionBinaryFrameMessage _parseBinaryFrame(List<int> data) {
    final bytes = data is Uint8List ? data : Uint8List.fromList(data);
    if (bytes.length < 13 || bytes[4] != 1 || bytes[5] != 1) {
      throw const FormatException('Unsupported binary browser frame.');
    }
    final headerLength = ByteData.sublistView(bytes).getUint32(8);
    const prefixLength = 12;
    final jpegOffset = prefixLength + headerLength;
    if (headerLength < 2 ||
        headerLength > 64 * 1024 ||
        jpegOffset >= bytes.length) {
      throw const FormatException('Invalid binary browser frame header.');
    }
    final Object? decoded;
    try {
      decoded = jsonDecode(
        utf8.decode(
          bytes.sublist(prefixLength, jpegOffset),
          allowMalformed: false,
        ),
      );
    } on Object catch (error) {
      throw FormatException('Invalid binary browser frame header: $error');
    }
    if (decoded is! Map<Object?, Object?>) {
      throw const FormatException(
        'Binary browser frame header must be an object.',
      );
    }
    final header = <String, Object?>{};
    for (final entry in decoded.entries) {
      final key = entry.key;
      if (key is! String) {
        throw const FormatException(
          'Binary browser frame header keys must be strings.',
        );
      }
      header[key] = entry.value;
    }
    if (header['v'] != 1 ||
        header['type'] != 'frame' ||
        header['codec'] != 'image/jpeg') {
      throw const FormatException('Unsupported binary browser frame type.');
    }
    final jpeg = Uint8List.sublistView(bytes, jpegOffset);
    if (jpeg.length < 4 ||
        jpeg[0] != 0xff ||
        jpeg[1] != 0xd8 ||
        jpeg[jpeg.length - 2] != 0xff ||
        jpeg[jpeg.length - 1] != 0xd9) {
      throw const FormatException(
        'Binary browser frame does not contain a JPEG.',
      );
    }
    final metadata = _frameMetadata(header['metadata']);
    final width = _requiredFiniteNumber(header, 'width');
    final height = _requiredFiniteNumber(header, 'height');
    if (width != metadata.deviceWidth || height != metadata.deviceHeight) {
      throw const FormatException(
        'Binary frame dimensions do not match metadata.',
      );
    }
    return BrowserSessionBinaryFrameMessage(
      data: jpeg,
      metadata: metadata,
      capturedAt: _requiredNonNegativeInteger(header, 'capturedAt'),
      sourceEpoch: _requiredString(header, 'sourceEpoch'),
      frameSequence: _requiredNonNegativeInteger(header, 'frameSequence'),
      viewportRevision: _requiredNonNegativeInteger(header, 'viewportRevision'),
    );
  }

  static AgentBrowserMessage? tryParse(Object? data) {
    try {
      return parse(data);
    } on FormatException {
      return null;
    } on TypeError {
      return null;
    }
  }

  static Map<String, Object?> _decodePayload(Object? data) {
    Object? decoded = data;
    if (data is String) {
      try {
        decoded = jsonDecode(data);
      } on FormatException catch (error) {
        throw FormatException('Invalid JSON: ${error.message}');
      }
    } else if (data is List<int>) {
      try {
        decoded = jsonDecode(utf8.decode(data));
      } on FormatException catch (error) {
        throw FormatException('Invalid UTF-8 JSON: ${error.message}');
      }
    }

    if (decoded is! Map<Object?, Object?>) {
      throw const FormatException('Protocol message must be a JSON object.');
    }

    final payload = <String, Object?>{};
    for (final entry in decoded.entries) {
      final key = entry.key;
      if (key is! String) {
        throw const FormatException('Protocol keys must be strings.');
      }
      payload[key] = entry.value;
    }
    return payload;
  }

  static AgentBrowserFrameMetadata _frameMetadata(Object? value) {
    if (value is! Map<Object?, Object?>) {
      throw const FormatException('Frame metadata must be an object.');
    }

    final metadata = <String, Object?>{};
    for (final entry in value.entries) {
      final key = entry.key;
      if (key is! String) {
        throw const FormatException('Frame metadata keys must be strings.');
      }
      metadata[key] = entry.value;
    }

    final deviceWidth = _requiredFiniteNumber(metadata, 'deviceWidth');
    final deviceHeight = _requiredFiniteNumber(metadata, 'deviceHeight');
    if (deviceWidth <= 0 || deviceHeight <= 0) {
      throw const FormatException('Frame dimensions must be positive.');
    }

    return AgentBrowserFrameMetadata(
      deviceWidth: deviceWidth,
      deviceHeight: deviceHeight,
      pageScaleFactor: _optionalFiniteNumber(
        metadata,
        'pageScaleFactor',
        fallback: 1,
      ),
      offsetTop: _optionalFiniteNumber(metadata, 'offsetTop', fallback: 0),
      scrollOffsetX: _optionalFiniteNumber(
        metadata,
        'scrollOffsetX',
        fallback: 0,
      ),
      scrollOffsetY: _optionalFiniteNumber(
        metadata,
        'scrollOffsetY',
        fallback: 0,
      ),
    );
  }

  static String _requiredString(Map<String, Object?> map, String key) {
    final value = map[key];
    if (value is! String || value.isEmpty) {
      throw FormatException('$key must be a non-empty string.');
    }
    return value;
  }

  static bool _requiredBool(Map<String, Object?> map, String key) {
    final value = map[key];
    if (value is! bool) {
      throw FormatException('$key must be a boolean.');
    }
    return value;
  }

  static double _requiredFiniteNumber(Map<String, Object?> map, String key) {
    final value = map[key];
    if (value is! num || !value.isFinite) {
      throw FormatException('$key must be a finite number.');
    }
    final result = value.toDouble();
    if (!result.isFinite) {
      throw FormatException('$key is outside the supported numeric range.');
    }
    return result;
  }

  static int _requiredNonNegativeInteger(Map<String, Object?> map, String key) {
    final value = map[key];
    if (value is! int || value < 0) {
      throw FormatException('$key must be a non-negative integer.');
    }
    return value;
  }

  static double _optionalFiniteNumber(
    Map<String, Object?> map,
    String key, {
    required double fallback,
  }) {
    if (!map.containsKey(key)) {
      return fallback;
    }
    return _requiredFiniteNumber(map, key);
  }
}
