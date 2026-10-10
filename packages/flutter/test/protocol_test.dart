import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:browser_ui/browser_ui.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final fixtures = jsonDecode(
    File('test/fixtures/protocol/messages.json').readAsStringSync(),
  ) as Map<String, Object?>;

  group('AgentBrowserProtocol', () {
    test('matches the shared agent-browser protocol fixtures', () {
      final messages = fixtures['agentBrowserMessages']! as List<Object?>;
      for (final value in messages) {
        final fixture = value! as Map<String, Object?>;
        final message = AgentBrowserProtocol.tryParse(fixture['message']);
        expect(
          message != null,
          fixture['valid'],
          reason: fixture['name']! as String,
        );
        if (message != null) {
          expect(
            _messageKind(message),
            fixture['kind'],
            reason: fixture['name']! as String,
          );
        }
      }
    });

    test('parses a frame while ignoring additive fields', () {
      final message = AgentBrowserProtocol.parse(
        jsonEncode(<String, Object?>{
          'type': 'frame',
          'data': 'aGVsbG8=',
          'metadata': <String, Object?>{
            'deviceWidth': 1440,
            'deviceHeight': 900,
            'pageScaleFactor': 1,
            'offsetTop': 0,
            'scrollOffsetX': 12.5,
            'scrollOffsetY': 24,
            'futureMetadata': true,
          },
          'sequence': 42,
        }),
      );

      expect(message, isA<AgentBrowserFrameMessage>());
      final frame = message as AgentBrowserFrameMessage;
      expect(frame.data, 'aGVsbG8=');
      expect(frame.metadata.deviceWidth, 1440);
      expect(frame.metadata.deviceHeight, 900);
      expect(frame.metadata.scrollOffsetX, 12.5);
    });

    test('defaults optional frame metadata from older servers', () {
      final message = AgentBrowserProtocol.parse(<String, Object?>{
        'type': 'frame',
        'data': 'aGVsbG8=',
        'metadata': <String, Object?>{'deviceWidth': 800, 'deviceHeight': 600},
      }) as AgentBrowserFrameMessage;

      expect(message.metadata.pageScaleFactor, 1);
      expect(message.metadata.offsetTop, 0);
      expect(message.metadata.scrollOffsetX, 0);
      expect(message.metadata.scrollOffsetY, 0);
    });

    test('parses UTF-8 bytes and known non-frame messages', () {
      final status = AgentBrowserProtocol.parse(
        utf8.encode(
          jsonEncode(<String, Object?>{
            'type': 'status',
            'connected': true,
            'screencasting': true,
            'viewportWidth': 1280,
            'viewportHeight': 720,
            'futureField': 'ignored',
          }),
        ),
      );
      final url = AgentBrowserProtocol.parse(<String, Object?>{
        'type': 'url',
        'url': 'https://example.com/path',
      });
      final cursor = AgentBrowserProtocol.parse(<String, Object?>{
        'type': 'cursor',
        'cursor': 'pointer',
      });

      expect(status, isA<AgentBrowserStreamStatusMessage>());
      expect((status as AgentBrowserStreamStatusMessage).viewportWidth, 1280);
      expect((url as AgentBrowserUrlMessage).url, 'https://example.com/path');
      expect((cursor as AgentBrowserCursorMessage).cursor, 'pointer');
    });

    test('parses binary JPEG gateway frames', () {
      final fixture = fixtures['binaryFrame']! as Map<String, Object?>;
      final message = AgentBrowserProtocol.parse(
        _binaryFrame(
          header: Map<String, Object?>.from(
            fixture['header']! as Map<Object?, Object?>,
          ),
          jpeg: (fixture['jpeg']! as List<Object?>).cast<int>(),
        ),
      );

      expect(message, isA<BrowserSessionBinaryFrameMessage>());
      final frame = message as BrowserSessionBinaryFrameMessage;
      expect(frame.frameSequence, 7);
      expect(frame.sourceEpoch, 'epoch-one');
      expect(frame.metadata.deviceWidth, 1280);
      expect(frame.data, <int>[0xff, 0xd8, 1, 2, 0xff, 0xd9]);
    });

    test('preserves unknown additive message types', () {
      final message = AgentBrowserProtocol.parse(<String, Object?>{
        'type': 'future_event',
        'value': 7,
      });

      expect(message, isA<AgentBrowserUnknownMessage>());
      final unknown = message as AgentBrowserUnknownMessage;
      expect(unknown.type, 'future_event');
      expect(unknown.payload['value'], 7);
    });

    test('rejects malformed known messages without throwing from tryParse', () {
      expect(
        AgentBrowserProtocol.tryParse(<String, Object?>{
          'type': 'frame',
          'data': 'aGVsbG8=',
          'metadata': <String, Object?>{'deviceWidth': 0, 'deviceHeight': 600},
        }),
        isNull,
      );
      expect(AgentBrowserProtocol.tryParse('{nope'), isNull);
      expect(
        () => AgentBrowserProtocol.parse(<String, Object?>{'type': 'status'}),
        throwsFormatException,
      );
    });
  });
}

String _messageKind(AgentBrowserMessage message) => switch (message) {
  AgentBrowserFrameMessage() => 'frame',
  AgentBrowserStreamStatusMessage() => 'status',
  AgentBrowserUrlMessage() => 'url',
  AgentBrowserCursorMessage() => 'cursor',
  BrowserSessionBinaryFrameMessage() => 'binary-frame',
  AgentBrowserUnknownMessage() => message.type,
};

Uint8List _binaryFrame({
  required Map<String, Object?> header,
  required List<int> jpeg,
}) {
  final encodedHeader = utf8.encode(jsonEncode(header));
  final result = Uint8List(12 + encodedHeader.length + jpeg.length);
  result.setAll(0, <int>[0x42, 0x55, 0x49, 0x46, 1, 1, 0, 0]);
  ByteData.sublistView(result).setUint32(8, encodedHeader.length);
  result.setAll(12, encodedHeader);
  result.setAll(12 + encodedHeader.length, jpeg);
  return result;
}
