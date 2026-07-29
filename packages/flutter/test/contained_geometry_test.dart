import 'package:browser_ui/browser_ui.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('ContainedViewportGeometry', () {
    test('centers contained content and maps its coordinates', () {
      final geometry = ContainedViewportGeometry.fromSizes(
        containerSize: const Size(300, 300),
        contentSize: const Size(200, 100),
      );

      expect(geometry.destination, const Rect.fromLTWH(0, 75, 300, 150));
      expect(
        geometry.mapToContent(const Offset(150, 150)),
        const Offset(100, 50),
      );
    });

    test('ignores points in the letterbox', () {
      final geometry = ContainedViewportGeometry.fromSizes(
        containerSize: const Size(300, 300),
        contentSize: const Size(200, 100),
      );

      expect(geometry.mapToContent(const Offset(150, 20)), isNull);
      expect(geometry.mapToContent(const Offset(150, 280)), isNull);
    });

    test('maps into a distinct remote coordinate space', () {
      final geometry = ContainedViewportGeometry.fromSizes(
        containerSize: const Size(400, 300),
        contentSize: const Size(400, 200),
      );

      expect(
        geometry.mapToContent(
          const Offset(200, 150),
          coordinateSpace: const Size(1600, 800),
        ),
        const Offset(800, 400),
      );
    });

    test('returns no mapping for unusable dimensions', () {
      final geometry = ContainedViewportGeometry.fromSizes(
        containerSize: Size.zero,
        contentSize: const Size(200, 100),
      );

      expect(geometry.destination, Rect.zero);
      expect(geometry.mapToContent(Offset.zero), isNull);
    });
  });
}
