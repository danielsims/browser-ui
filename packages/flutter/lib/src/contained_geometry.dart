import 'package:flutter/painting.dart';

/// Geometry for content centered with [BoxFit.contain].
final class ContainedViewportGeometry {
  const ContainedViewportGeometry._({
    required this.containerSize,
    required this.contentSize,
    required this.destination,
  });

  factory ContainedViewportGeometry.fromSizes({
    required Size containerSize,
    required Size contentSize,
  }) {
    if (!_isUsable(containerSize) || !_isUsable(contentSize)) {
      return ContainedViewportGeometry._(
        containerSize: containerSize,
        contentSize: contentSize,
        destination: Rect.zero,
      );
    }

    final fitted = applyBoxFit(BoxFit.contain, contentSize, containerSize);
    final destination = Alignment.center.inscribe(
      fitted.destination,
      Offset.zero & containerSize,
    );
    return ContainedViewportGeometry._(
      containerSize: containerSize,
      contentSize: contentSize,
      destination: destination,
    );
  }

  final Size containerSize;
  final Size contentSize;

  /// The non-letterboxed rectangle occupied by the content.
  final Rect destination;

  /// Maps a local point into [coordinateSpace].
  ///
  /// Returns `null` for letterbox input or unusable dimensions. If
  /// [coordinateSpace] is omitted, points are mapped into [contentSize].
  Offset? mapToContent(Offset localPosition, {Size? coordinateSpace}) {
    if (destination.isEmpty || !destination.contains(localPosition)) {
      return null;
    }

    final target = coordinateSpace ?? contentSize;
    if (!_isUsable(target)) {
      return null;
    }

    return Offset(
      (localPosition.dx - destination.left) / destination.width * target.width,
      (localPosition.dy - destination.top) / destination.height * target.height,
    );
  }

  static bool _isUsable(Size size) {
    return size.width.isFinite &&
        size.height.isFinite &&
        size.width > 0 &&
        size.height > 0;
  }
}
