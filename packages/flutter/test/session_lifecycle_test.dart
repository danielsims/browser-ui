import 'dart:convert';
import 'dart:io';

import 'package:browser_ui/browser_ui.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('session lifecycle matches the shared cross-platform fixture', () {
    final fixture = jsonDecode(
      File('../core/test/fixtures/session-lifecycle.json').readAsStringSync(),
    ) as Map<String, Object?>;

    expect(fixture['version'], browserSessionLifecycleVersion);
    expect(
      fixture['endReasons'],
      BrowserSessionEndReason.values.map((reason) => reason.wireValue).toList(),
    );
    expect(
      fixture['viewportModes'],
      BrowserViewportPresentationMode.values.map((mode) => mode.name).toList(),
    );
    expect(
      fixture['releaseOutcomes'],
      BrowserSessionReleaseOutcome.values
          .map((outcome) => outcome.wireValue)
          .toList(),
    );

    for (final value in fixture['validRequests']! as List<Object?>) {
      expect(
        () => BrowserSessionEndRequest.fromJson(
          (value! as Map).cast<String, Object?>(),
        ),
        returnsNormally,
      );
    }
    for (final value in fixture['invalidRequests']! as List<Object?>) {
      expect(
        () => BrowserSessionEndRequest.fromJson(
          (value! as Map).cast<String, Object?>(),
        ),
        throwsFormatException,
      );
    }
    expect(
      () => BrowserSessionEndReceipt.fromJson(
        (fixture['receipt']! as Map).cast<String, Object?>(),
      ),
      returnsNormally,
    );
    for (final value in fixture['validReleaseRequests']! as List<Object?>) {
      expect(
        () => BrowserSessionReleaseRequest.fromJson(
          (value! as Map).cast<String, Object?>(),
        ),
        returnsNormally,
      );
    }
    for (final value in fixture['invalidReleaseRequests']! as List<Object?>) {
      expect(
        () => BrowserSessionReleaseRequest.fromJson(
          (value! as Map).cast<String, Object?>(),
        ),
        throwsFormatException,
      );
    }
    expect(
      () => BrowserSessionReleaseReceipt.fromJson(
        (fixture['releaseReceipt']! as Map).cast<String, Object?>(),
      ),
      returnsNormally,
    );
  });

  testWidgets('end action is separate from closing the viewer', (tester) async {
    var ended = false;
    await tester.pumpWidget(
      MaterialApp(
        home: BrowserEndSessionButton(onEndSession: () => ended = true),
      ),
    );

    await tester.tap(find.byTooltip('End browsing session'));
    await tester.pump();
    expect(ended, isTrue);
  });
}
