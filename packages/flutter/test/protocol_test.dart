import 'dart:convert';
import 'dart:typed_data';

import 'package:browser_ui/browser_ui.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('AgentBrowserProtocol', () {
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
      final message =
          AgentBrowserProtocol.parse(<String, Object?>{
                'type': 'frame',
                'data': 'aGVsbG8=',
                'metadata': <String, Object?>{
                  'deviceWidth': 800,
                  'deviceHeight': 600,
                },
              })
              as AgentBrowserFrameMessage;

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
      final message = AgentBrowserProtocol.parse(_binaryFrame(sequence: 7));

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

Uint8List _binaryFrame({required int sequence}) {
  final header = utf8.encode(
    jsonEncode(<String, Object?>{
      'v': 1,
      'type': 'frame',
      'codec': 'image/jpeg',
      'width': 1280,
      'height': 800,
      'capturedAt': 1000,
      'sourceEpoch': 'epoch-one',
      'frameSequence': sequence,
      'viewportRevision': 0,
      'metadata': <String, Object?>{
        'deviceWidth': 1280,
        'deviceHeight': 800,
        'pageScaleFactor': 1,
        'offsetTop': 0,
        'scrollOffsetX': 0,
        'scrollOffsetY': 0,
      },
    }),
  );
  final jpeg = <int>[0xff, 0xd8, 1, 2, 0xff, 0xd9];
  final result = Uint8List(12 + header.length + jpeg.length);
  result.setAll(0, <int>[0x42, 0x55, 0x49, 0x46, 1, 1, 0, 0]);
  ByteData.sublistView(result).setUint32(8, header.length);
  result.setAll(12, header);
  result.setAll(12 + header.length, jpeg);
  return result;
}
