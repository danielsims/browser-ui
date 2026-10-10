import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import 'protocol.dart';

typedef AgentBrowserChannelConnector = WebSocketChannel Function(
  Uri uri, {
  Iterable<String>? protocols,
});

/// A fresh, short-lived browser session connection resolved before each retry.
final class AgentBrowserResolvedConnection {
  const AgentBrowserResolvedConnection({
    required this.streamUri,
    this.protocols = const <String>[],
  });

  final Uri streamUri;
  final List<String> protocols;
}

typedef AgentBrowserConnectionResolver =
    Future<AgentBrowserResolvedConnection> Function();

WebSocketChannel _connectWebSocket(Uri uri, {Iterable<String>? protocols}) {
  return WebSocketChannel.connect(uri, protocols: protocols);
}

enum AgentBrowserConnectionStatus {
  disconnected,
  connecting,
  connected,
  reconnecting,
  paused,
  failed,
}

/// Capped exponential reconnect behavior.
final class AgentBrowserReconnectPolicy {
  const AgentBrowserReconnectPolicy({
    this.initialDelay = const Duration(milliseconds: 250),
    this.maximumDelay = const Duration(seconds: 8),
    this.multiplier = 2,
    this.randomizationFactor = 0.2,
    this.maximumAttempts,
  }) : assert(multiplier >= 1),
       assert(randomizationFactor >= 0 && randomizationFactor <= 1),
       assert(maximumAttempts == null || maximumAttempts >= 0);

  final Duration initialDelay;
  final Duration maximumDelay;
  final double multiplier;

  /// Jitter applied below and above the exponential delay before capping.
  final double randomizationFactor;

  /// The number of automatic retries, or `null` to retry indefinitely.
  final int? maximumAttempts;

  Duration delayForAttempt(int attempt, {math.Random? random}) {
    assert(attempt >= 0);
    final exponential =
        initialDelay.inMicroseconds * math.pow(multiplier, attempt);
    final capped = math.min(exponential, maximumDelay.inMicroseconds);
    final generator = random ?? math.Random();
    final jitter = randomizationFactor == 0
        ? 1.0
        : 1 -
              randomizationFactor +
              generator.nextDouble() * randomizationFactor * 2;
    final microseconds = (capped * jitter)
        .round()
        .clamp(0, maximumDelay.inMicroseconds)
        .toInt();
    return Duration(microseconds: microseconds);
  }
}

/// A decoded, controller-owned JPEG frame.
///
/// The image remains valid until the controller presents a newer frame or is
/// disposed. Consumers must not dispose [image].
final class AgentBrowserFrame {
  const AgentBrowserFrame({
    required this.image,
    required this.metadata,
    required this.sequence,
    required this.byteLength,
  });

  final ui.Image image;
  final AgentBrowserFrameMetadata metadata;
  final int sequence;
  final int byteLength;

  Size get pixelSize => Size(image.width.toDouble(), image.height.toDouble());
}

final class AgentBrowserTransportClosed implements Exception {
  const AgentBrowserTransportClosed({this.code, this.reason});

  final int? code;
  final String? reason;

  @override
  String toString() {
    final details = <String>[
      if (code != null) 'code $code',
      if (reason != null && reason!.isNotEmpty) reason!,
    ];
    return details.isEmpty
        ? 'The browser stream closed.'
        : 'The browser stream closed (${details.join(', ')}).';
  }
}

/// Owns one agent-browser WebSocket transport and its observable state.
///
/// Construction does not connect. The host explicitly calls [connect] and
/// [disconnect], and remains responsible for creating and ending the remote
/// browser session.
final class AgentBrowserController extends ChangeNotifier
    with WidgetsBindingObserver {
  AgentBrowserController({
    this.streamUri,
    Iterable<String> protocols = const <String>[],
    this.connectionResolver,
    this.reconnectPolicy = const AgentBrowserReconnectPolicy(),
    this.connectionTimeout = const Duration(seconds: 10),
    this.maximumEncodedFrameLength = 24 * 1024 * 1024,
    this.allowInsecureRemote = false,
    AgentBrowserChannelConnector connector = _connectWebSocket,
  }) : assert(!connectionTimeout.isNegative),
       assert(maximumEncodedFrameLength > 0),
       protocols = List<String>.unmodifiable(protocols),
       _connector = connector,
       _random = math.Random() {
    if (streamUri == null && connectionResolver == null) {
      throw ArgumentError('streamUri or connectionResolver is required.');
    }
    if (streamUri != null) {
      validateAgentBrowserStreamUri(
        streamUri!,
        allowInsecureRemote: allowInsecureRemote,
      );
    }
  }

  final Uri? streamUri;
  final List<String> protocols;
  final AgentBrowserConnectionResolver? connectionResolver;
  final AgentBrowserReconnectPolicy reconnectPolicy;
  final Duration connectionTimeout;
  final int maximumEncodedFrameLength;

  /// Permits a public `ws://` endpoint. Leave false outside exceptional,
  /// explicitly risk-accepted development environments.
  final bool allowInsecureRemote;

  final AgentBrowserChannelConnector _connector;
  final math.Random _random;
  WidgetsBinding? _binding;

  AgentBrowserConnectionStatus _connectionStatus =
      AgentBrowserConnectionStatus.disconnected;
  AgentBrowserFrame? _frame;
  AgentBrowserStreamStatusMessage? _streamStatus;
  String? _currentUrl;
  String? _cursor;
  Object? _lastError;
  StackTrace? _lastStackTrace;
  Object? _lastFrameError;
  Object? _lastProtocolError;
  int _protocolErrorCount = 0;
  int _reconnectAttempt = 0;
  DateTime? _nextReconnectAt;

  WebSocketChannel? _channel;
  // The subscription is cancelled by _closeTransport and dispose.
  // ignore: cancel_subscriptions
  StreamSubscription<Object?>? _subscription;
  Timer? _reconnectTimer;
  Timer? _heartbeatTimer;
  ({
    int generation,
    String? encodedData,
    Uint8List? binaryData,
    AgentBrowserFrameMetadata metadata,
    int version,
  })?
  _pendingFrame;
  bool _decodingFrame = false;
  bool _wantsConnection = false;
  bool _suspendedByLifecycle = false;
  bool _disposed = false;
  int _generation = 0;
  int _frameVersion = 0;
  String? _sourceEpoch;
  int _lastRemoteFrameSequence = -1;

  AgentBrowserConnectionStatus get connectionStatus => _connectionStatus;
  AgentBrowserFrame? get frame => _frame;
  AgentBrowserStreamStatusMessage? get streamStatus => _streamStatus;
  String? get currentUrl => _currentUrl;
  String? get cursor => _cursor;
  Object? get lastError => _lastError;
  StackTrace? get lastStackTrace => _lastStackTrace;
  Object? get lastFrameError => _lastFrameError;
  Object? get lastProtocolError => _lastProtocolError;
  int get protocolErrorCount => _protocolErrorCount;
  int get reconnectAttempt => _reconnectAttempt;
  DateTime? get nextReconnectAt => _nextReconnectAt;
  bool get wantsConnection => _wantsConnection;
  bool get isConnected =>
      _connectionStatus == AgentBrowserConnectionStatus.connected;

  /// Starts or resumes this transport. Calling it repeatedly is harmless.
  void connect() {
    _ensureNotDisposed();
    _observeAppLifecycle();
    _wantsConnection = true;
    _reconnectAttempt = 0;
    _lastError = null;
    _lastStackTrace = null;
    _cancelReconnect();

    if (_suspendedByLifecycle) {
      _setConnectionStatus(AgentBrowserConnectionStatus.paused);
      return;
    }
    if (_channel != null ||
        _connectionStatus == AgentBrowserConnectionStatus.connecting ||
        _connectionStatus == AgentBrowserConnectionStatus.connected) {
      return;
    }
    unawaited(_open(reconnecting: false));
  }

  /// Closes only the transport. It does not end the host's browser session.
  void disconnect() {
    if (_disposed) {
      return;
    }
    _wantsConnection = false;
    _cancelReconnect();
    _invalidateFramesInFlight();
    _generation += 1;
    _closeTransport(code: 1000, reason: 'Client disconnect');
    _setConnectionStatus(AgentBrowserConnectionStatus.disconnected);
  }

  /// Sends a protocol input message if the socket is open.
  ///
  /// Input must use an `input_*` type. Returns false while disconnected or if
  /// the socket rejects the write.
  bool sendInput(Map<String, Object?> input) {
    _ensureNotDisposed();
    final type = input['type'];
    if (type is! String || !type.startsWith('input_')) {
      throw ArgumentError.value(
        type,
        'input[type]',
        'Agent-browser input types must start with input_.',
      );
    }

    final channel = _channel;
    if (channel == null || !isConnected) {
      return false;
    }

    late final String encoded;
    try {
      encoded = jsonEncode(input);
    } on Object catch (error) {
      throw ArgumentError.value(
        input,
        'input',
        'Input must be JSON-encodable: $error',
      );
    }

    try {
      channel.sink.add(encoded);
      return true;
    } on Object catch (error, stackTrace) {
      _failConnection(_generation, error, stackTrace);
      return false;
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (_disposed) {
      return;
    }
    if (state == AppLifecycleState.resumed) {
      if (!_suspendedByLifecycle) {
        return;
      }
      _suspendedByLifecycle = false;
      if (_wantsConnection) {
        unawaited(_open(reconnecting: true));
      } else {
        _setConnectionStatus(AgentBrowserConnectionStatus.disconnected);
      }
      return;
    }

    _suspendedByLifecycle = true;
    _cancelReconnect();
    _invalidateFramesInFlight();
    _generation += 1;
    _closeTransport(code: 1001, reason: 'Application backgrounded');
    if (_wantsConnection) {
      _setConnectionStatus(AgentBrowserConnectionStatus.paused);
    }
  }

  Future<void> _open({required bool reconnecting}) async {
    if (_disposed ||
        !_wantsConnection ||
        _suspendedByLifecycle ||
        _channel != null) {
      return;
    }

    final generation = ++_generation;
    _nextReconnectAt = null;
    _setConnectionStatus(
      reconnecting
          ? AgentBrowserConnectionStatus.reconnecting
          : AgentBrowserConnectionStatus.connecting,
    );

    late final WebSocketChannel channel;
    var browserSessionConnection = false;
    try {
      final resolved = connectionResolver == null
          ? AgentBrowserResolvedConnection(
              streamUri: streamUri!,
              protocols: protocols,
            )
          : await connectionResolver!();
      if (!_isCurrent(generation)) {
        return;
      }
      validateAgentBrowserStreamUri(
        resolved.streamUri,
        allowInsecureRemote: allowInsecureRemote,
      );
      browserSessionConnection = resolved.protocols.contains(
        'browser-session.v1',
      );
      channel = _connector(
        resolved.streamUri,
        protocols: resolved.protocols.isEmpty ? null : resolved.protocols,
      );
    } on Object catch (error, stackTrace) {
      _failConnection(generation, error, stackTrace);
      return;
    }

    if (!_isCurrent(generation)) {
      unawaited(_closeChannel(channel, 1000, 'Connection superseded'));
      return;
    }

    _channel = channel;
    _subscription = channel.stream.cast<Object?>().listen(
      (Object? data) => _handleData(generation, data),
      onError: (Object error, StackTrace stackTrace) {
        _failConnection(generation, error, stackTrace);
      },
      onDone: () {
        _failConnection(
          generation,
          AgentBrowserTransportClosed(
            code: channel.closeCode,
            reason: channel.closeReason,
          ),
          StackTrace.current,
        );
      },
      cancelOnError: false,
    );

    try {
      await channel.ready.timeout(connectionTimeout);
    } on Object catch (error, stackTrace) {
      _failConnection(generation, error, stackTrace);
      return;
    }

    if (!_isCurrent(generation) || _channel != channel) {
      return;
    }
    _reconnectAttempt = 0;
    _lastError = null;
    _lastStackTrace = null;
    _setConnectionStatus(AgentBrowserConnectionStatus.connected);
    if (browserSessionConnection) {
      _heartbeatTimer?.cancel();
      _heartbeatTimer = Timer.periodic(const Duration(seconds: 5), (_) {
        if (_channel != channel || !_isCurrent(generation)) return;
        channel.sink.add(
          jsonEncode({
            'v': 1,
            'type': 'heartbeat',
            'sentAt': DateTime.now().millisecondsSinceEpoch,
          }),
        );
      });
    }
  }

  void _handleData(int generation, Object? data) {
    if (!_isCurrent(generation)) {
      return;
    }

    late final AgentBrowserMessage message;
    try {
      message = AgentBrowserProtocol.parse(data);
    } on Object catch (error) {
      _lastProtocolError = error;
      _protocolErrorCount += 1;
      _notifyListeners();
      return;
    }

    switch (message) {
      case AgentBrowserFrameMessage():
        _queueFrame(generation, message);
      case BrowserSessionBinaryFrameMessage():
        _queueBinaryFrame(generation, message);
      case AgentBrowserStreamStatusMessage():
        _streamStatus = message;
        _notifyListeners();
      case AgentBrowserUrlMessage():
        if (_currentUrl != message.url) {
          _currentUrl = message.url;
          _notifyListeners();
        }
      case AgentBrowserCursorMessage():
        if (_cursor != message.cursor) {
          _cursor = message.cursor;
          _notifyListeners();
        }
      case AgentBrowserUnknownMessage():
        break;
    }
  }

  void _queueFrame(int generation, AgentBrowserFrameMessage message) {
    _frameVersion += 1;
    if (message.data.length > maximumEncodedFrameLength) {
      _lastFrameError = FormatException(
        'Encoded frame exceeds $maximumEncodedFrameLength characters.',
      );
      _notifyListeners();
      return;
    }

    _pendingFrame = (
      generation: generation,
      encodedData: message.data,
      binaryData: null,
      metadata: message.metadata,
      version: _frameVersion,
    );
    if (!_decodingFrame) {
      unawaited(_decodeLatestFrame());
    }
  }

  void _queueBinaryFrame(
    int generation,
    BrowserSessionBinaryFrameMessage message,
  ) {
    if (_sourceEpoch == message.sourceEpoch &&
        message.frameSequence <= _lastRemoteFrameSequence) {
      return;
    }
    if (_sourceEpoch != message.sourceEpoch) {
      _sourceEpoch = message.sourceEpoch;
      _lastRemoteFrameSequence = -1;
    }
    _lastRemoteFrameSequence = message.frameSequence;
    _frameVersion += 1;
    if (message.data.length > maximumEncodedFrameLength) {
      _lastFrameError = FormatException(
        'Binary frame exceeds $maximumEncodedFrameLength bytes.',
      );
      _notifyListeners();
      return;
    }

    _pendingFrame = (
      generation: generation,
      encodedData: null,
      binaryData: message.data,
      metadata: message.metadata,
      version: _frameVersion,
    );
    if (!_decodingFrame) {
      unawaited(_decodeLatestFrame());
    }
  }

  Future<void> _decodeLatestFrame() async {
    if (_decodingFrame) {
      return;
    }
    _decodingFrame = true;
    try {
      while (!_disposed && _pendingFrame != null) {
        final pending = _pendingFrame!;
        _pendingFrame = null;
        ui.Codec? codec;
        ui.Image? image;
        try {
          final bytes =
              pending.binaryData ?? _decodeFrameData(pending.encodedData!);
          codec = await ui.instantiateImageCodec(bytes);
          final frameInfo = await codec.getNextFrame();
          final decodedImage = frameInfo.image;
          image = decodedImage;

          if (_isCurrent(pending.generation) &&
              pending.version == _frameVersion) {
            final nextFrame = AgentBrowserFrame(
              image: decodedImage,
              metadata: pending.metadata,
              sequence: pending.version,
              byteLength: bytes.length,
            );
            image = null;
            _replaceFrame(nextFrame);
          }
        } on Object catch (error) {
          if (_isCurrent(pending.generation) &&
              pending.version == _frameVersion) {
            _lastFrameError = error;
            _notifyListeners();
          }
        } finally {
          codec?.dispose();
          image?.dispose();
        }
      }
    } finally {
      _decodingFrame = false;
      if (!_disposed && _pendingFrame != null) {
        unawaited(_decodeLatestFrame());
      }
    }
  }

  Uint8List _decodeFrameData(String encoded) {
    var payload = encoded.trim();
    if (payload.startsWith('data:')) {
      final separator = payload.indexOf(',');
      if (separator < 0 ||
          !payload.substring(0, separator).contains(';base64')) {
        throw const FormatException('Frame data URI is not base64 encoded.');
      }
      payload = payload.substring(separator + 1);
    }
    return base64Decode(payload);
  }

  void _replaceFrame(AgentBrowserFrame nextFrame) {
    final previous = _frame;
    _frame = nextFrame;
    _lastFrameError = null;
    _notifyListeners();

    if (previous != null) {
      _binding!.addPostFrameCallback((_) {
        previous.image.dispose();
      });
      _binding!.scheduleFrame();
    }
  }

  void _observeAppLifecycle() {
    if (_binding != null) {
      return;
    }
    final binding = WidgetsBinding.instance;
    _binding = binding;
    binding.addObserver(this);
    final lifecycleState = binding.lifecycleState;
    _suspendedByLifecycle =
        lifecycleState != null && lifecycleState != AppLifecycleState.resumed;
  }

  void _failConnection(int generation, Object error, StackTrace stackTrace) {
    if (!_isCurrent(generation)) {
      return;
    }

    _generation += 1;
    _lastError = error;
    _lastStackTrace = stackTrace;
    _invalidateFramesInFlight();
    _closeTransport();

    if (!_wantsConnection) {
      _setConnectionStatus(AgentBrowserConnectionStatus.disconnected);
      return;
    }
    if (_suspendedByLifecycle) {
      _setConnectionStatus(AgentBrowserConnectionStatus.paused);
      return;
    }
    _scheduleReconnect();
  }

  void _scheduleReconnect() {
    final maximumAttempts = reconnectPolicy.maximumAttempts;
    if (maximumAttempts != null && _reconnectAttempt >= maximumAttempts) {
      _nextReconnectAt = null;
      _setConnectionStatus(AgentBrowserConnectionStatus.failed);
      return;
    }

    final delay = reconnectPolicy.delayForAttempt(
      _reconnectAttempt,
      random: _random,
    );
    _reconnectAttempt += 1;
    _nextReconnectAt = DateTime.now().add(delay);
    _setConnectionStatus(AgentBrowserConnectionStatus.reconnecting);
    _reconnectTimer = Timer(delay, () {
      _reconnectTimer = null;
      if (!_disposed && _wantsConnection && !_suspendedByLifecycle) {
        unawaited(_open(reconnecting: true));
      }
    });
  }

  void _cancelReconnect() {
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    _nextReconnectAt = null;
  }

  void _invalidateFramesInFlight() {
    _frameVersion += 1;
    _pendingFrame = null;
  }

  bool _isCurrent(int generation) {
    return !_disposed && generation == _generation;
  }

  void _closeTransport({int? code, String? reason}) {
    _heartbeatTimer?.cancel();
    _heartbeatTimer = null;
    final subscription = _subscription;
    _subscription = null;
    if (subscription != null) {
      unawaited(subscription.cancel());
    }

    final channel = _channel;
    _channel = null;
    if (channel != null) {
      unawaited(_closeChannel(channel, code, reason));
    }
  }

  static Future<void> _closeChannel(
    WebSocketChannel channel,
    int? code,
    String? reason,
  ) async {
    try {
      await channel.sink.close(code, reason);
    } on Object {
      // Closing a failed transport is best effort.
    }
  }

  void _setConnectionStatus(AgentBrowserConnectionStatus status) {
    if (_connectionStatus == status) {
      _notifyListeners();
      return;
    }
    _connectionStatus = status;
    _notifyListeners();
  }

  void _notifyListeners() {
    if (!_disposed) {
      notifyListeners();
    }
  }

  void _ensureNotDisposed() {
    if (_disposed) {
      throw StateError('AgentBrowserController has been disposed.');
    }
  }

  @override
  void dispose() {
    if (_disposed) {
      return;
    }
    _disposed = true;
    _wantsConnection = false;
    _binding?.removeObserver(this);
    _cancelReconnect();
    _invalidateFramesInFlight();
    _generation += 1;
    _closeTransport(code: 1000, reason: 'Controller disposed');
    _frame?.image.dispose();
    _frame = null;
    super.dispose();
  }
}

/// Validates supported production and development stream URLs.
///
/// `wss://` is accepted for any host. `ws://` is accepted by default only for
/// loopback, private/link-local IPs, `.local` names, and single-label LAN names.
void validateAgentBrowserStreamUri(
  Uri uri, {
  bool allowInsecureRemote = false,
}) {
  if (!uri.hasAuthority || uri.host.isEmpty) {
    throw ArgumentError.value(uri, 'uri', 'A WebSocket host is required.');
  }
  if (uri.hasFragment) {
    throw ArgumentError.value(
      uri,
      'uri',
      'WebSocket URLs cannot contain fragments.',
    );
  }
  if (uri.scheme == 'wss') {
    return;
  }
  if (uri.scheme != 'ws') {
    throw ArgumentError.value(
      uri,
      'uri',
      'The scheme must be wss, or ws for local development.',
    );
  }
  if (allowInsecureRemote || _isLoopbackOrLanHost(uri.host)) {
    return;
  }
  throw ArgumentError.value(
    uri,
    'uri',
    'Public remote streams must use wss. Set allowInsecureRemote only for '
        'explicit development exceptions.',
  );
}

bool _isLoopbackOrLanHost(String rawHost) {
  final host = rawHost.toLowerCase();
  if (host == 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      (!host.contains('.') && !host.contains(':'))) {
    return true;
  }
  if (host == '::1' ||
      host.startsWith('fc') ||
      host.startsWith('fd') ||
      RegExp(r'^fe[89ab]').hasMatch(host)) {
    return true;
  }

  final parts = host.split('.');
  if (parts.length != 4) {
    return false;
  }
  final octets = parts.map(int.tryParse).toList(growable: false);
  if (octets.any((octet) => octet == null || octet < 0 || octet > 255)) {
    return false;
  }
  final first = octets[0]!;
  final second = octets[1]!;
  return first == 10 ||
      first == 127 ||
      (first == 169 && second == 254) ||
      (first == 172 && second >= 16 && second <= 31) ||
      (first == 192 && second == 168);
}
