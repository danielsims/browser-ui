import 'dart:ui' as ui;

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'access.dart';
import 'contained_geometry.dart';
import 'controller.dart';

typedef AgentBrowserPlaceholderBuilder = Widget Function(
  BuildContext context,
  AgentBrowserConnectionStatus status,
  Object? error,
);

/// Displays the latest agent-browser JPEG and optionally forwards pointer input.
///
/// Input is disabled by default. The host must acquire and enforce any control
/// lease before setting [interactive] to true.
final class AgentBrowserView extends StatefulWidget {
  const AgentBrowserView({
    required this.controller,
    this.interactive = false,
    this.access,
    this.semanticLabel = 'Remote browser',
    this.backgroundColor = const Color(0xff111214),
    this.placeholderBuilder,
    this.onStatusChanged,
    this.onUrlChanged,
    this.onFrame,
    this.onInputSent,
    super.key,
  });

  final AgentBrowserController controller;
  final bool interactive;
  final BrowserSessionAccess? access;
  final String semanticLabel;
  final Color backgroundColor;
  final AgentBrowserPlaceholderBuilder? placeholderBuilder;
  final ValueChanged<AgentBrowserConnectionStatus>? onStatusChanged;
  final ValueChanged<String?>? onUrlChanged;
  final ValueChanged<AgentBrowserFrame>? onFrame;

  /// Called only after an input payload has been accepted by the socket sink.
  final ValueChanged<Map<String, Object?>>? onInputSent;

  @override
  State<AgentBrowserView> createState() => _AgentBrowserViewState();
}

final class _AgentBrowserViewState extends State<AgentBrowserView> {
  final Map<int, _ActivePointer> _activePointers = <int, _ActivePointer>{};
  final Map<int, _TouchGesture> _touchGestures = <int, _TouchGesture>{};

  late AgentBrowserConnectionStatus _lastStatus;
  AgentBrowserFrame? _lastFrame;
  String? _lastUrl;

  bool get _inputEnabled =>
      widget.interactive &&
      (widget.access == null || canSendBrowserInput(widget.access!));

  @override
  void initState() {
    super.initState();
    _captureControllerState();
    widget.controller.addListener(_handleControllerChange);
  }

  @override
  void didUpdateWidget(AgentBrowserView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.controller != widget.controller) {
      _releaseAllPointers(controller: oldWidget.controller);
      oldWidget.controller.removeListener(_handleControllerChange);
      _captureControllerState();
      widget.controller.addListener(_handleControllerChange);
    }
    final oldInputEnabled =
        oldWidget.interactive &&
        (oldWidget.access == null || canSendBrowserInput(oldWidget.access!));
    if (oldInputEnabled && !_inputEnabled) {
      _releaseAllPointers();
    }
  }

  @override
  void dispose() {
    widget.controller.removeListener(_handleControllerChange);
    _releaseAllPointers();
    super.dispose();
  }

  void _captureControllerState() {
    _lastStatus = widget.controller.connectionStatus;
    _lastUrl = widget.controller.currentUrl;
    _lastFrame = widget.controller.frame;
  }

  void _handleControllerChange() {
    if (!mounted) {
      return;
    }
    final status = widget.controller.connectionStatus;
    final url = widget.controller.currentUrl;
    final frame = widget.controller.frame;
    final statusChanged = status != _lastStatus;
    final urlChanged = url != _lastUrl;
    final frameChanged = frame != null && !identical(frame, _lastFrame);

    _lastStatus = status;
    _lastUrl = url;
    _lastFrame = frame;
    if (status != AgentBrowserConnectionStatus.connected) {
      _clearPointerState();
    }
    setState(() {});

    if (statusChanged) {
      widget.onStatusChanged?.call(status);
    }
    if (urlChanged) {
      widget.onUrlChanged?.call(url);
    }
    if (frameChanged) {
      widget.onFrame?.call(frame);
    }
  }

  @override
  Widget build(BuildContext context) {
    final frame = widget.controller.frame;
    final cursor = _inputEnabled
        ? _systemCursor(widget.controller.cursor)
        : SystemMouseCursors.basic;

    return Semantics(
      label: widget.semanticLabel,
      image: true,
      enabled: _inputEnabled,
      child: RepaintBoundary(
        child: IgnorePointer(
          ignoring: !_inputEnabled,
          child: MouseRegion(
            cursor: cursor,
            child: LayoutBuilder(
              builder: (BuildContext context, BoxConstraints constraints) {
                final size = constraints.biggest;
                return GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  // Win against a sheet's drag gesture while controlling the
                  // browser. Raw pointer events below carry the actual input.
                  onPanStart: (_) {},
                  onPanUpdate: (_) {},
                  child: Listener(
                    behavior: HitTestBehavior.opaque,
                    onPointerDown: (PointerDownEvent event) {
                      _handlePointerDown(event, size);
                    },
                    onPointerMove: (PointerMoveEvent event) {
                      _handlePointerMove(event, size);
                    },
                    onPointerHover: (PointerHoverEvent event) {
                      _handlePointerHover(event, size);
                    },
                    onPointerUp: (PointerUpEvent event) {
                      _handlePointerUp(event, size);
                    },
                    onPointerCancel: _handlePointerCancel,
                    onPointerSignal: (PointerSignalEvent event) {
                      _handlePointerSignal(event, size);
                    },
                    child: SizedBox.expand(
                      child: ColoredBox(
                        color: widget.backgroundColor,
                        child: frame == null
                            ? _buildPlaceholder(context)
                            : RawImage(
                                image: frame.image,
                                fit: BoxFit.contain,
                                filterQuality: FilterQuality.medium,
                              ),
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildPlaceholder(BuildContext context) {
    final builder = widget.placeholderBuilder;
    if (builder != null) {
      return builder(
        context,
        widget.controller.connectionStatus,
        widget.controller.lastError ?? widget.controller.lastFrameError,
      );
    }

    final status = widget.controller.connectionStatus;
    final label = switch (status) {
      AgentBrowserConnectionStatus.disconnected => 'Browser stream is offline',
      AgentBrowserConnectionStatus.connecting => 'Connecting',
      AgentBrowserConnectionStatus.connected => 'Connecting',
      AgentBrowserConnectionStatus.reconnecting => 'Connecting',
      AgentBrowserConnectionStatus.paused => 'Browser stream paused',
      AgentBrowserConnectionStatus.failed => 'Unable to reach browser',
    };
    final waiting =
        status == AgentBrowserConnectionStatus.connecting ||
        status == AgentBrowserConnectionStatus.reconnecting ||
        status == AgentBrowserConnectionStatus.connected;
    final colorScheme = Theme.of(context).colorScheme;
    final darkBackground =
        ThemeData.estimateBrightnessForColor(widget.backgroundColor) ==
        Brightness.dark;
    final foreground = darkBackground
        ? Colors.white70
        : colorScheme.onSurfaceVariant;

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            if (waiting)
              SizedBox.square(
                dimension: 22,
                child: CircularProgressIndicator(
                  color: foreground,
                  strokeWidth: 2,
                ),
              )
            else
              Icon(
                status == AgentBrowserConnectionStatus.failed
                    ? Icons.cloud_off_rounded
                    : Icons.pause_circle_outline_rounded,
                color: foreground,
                size: 24,
              ),
            const SizedBox(height: 12),
            Text(
              label,
              style: Theme.of(context).textTheme.bodyMedium
                  ?.copyWith(color: foreground),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }

  Offset? _mapPoint(Offset localPosition, Size containerSize) {
    final frame = widget.controller.frame;
    if (frame == null) {
      return null;
    }
    final geometry = ContainedViewportGeometry.fromSizes(
      containerSize: containerSize,
      contentSize: frame.pixelSize,
    );
    return geometry.mapToContent(
      localPosition,
      coordinateSpace: Size(
        frame.metadata.deviceWidth,
        frame.metadata.deviceHeight,
      ),
    );
  }

  void _handlePointerDown(PointerDownEvent event, Size size) {
    final point = _mapPoint(event.localPosition, size);
    if (point == null) {
      return;
    }

    if (event.kind == ui.PointerDeviceKind.touch) {
      _touchGestures[event.pointer] = _TouchGesture(
        startLocal: event.localPosition,
        lastPoint: point,
      );
      return;
    }

    final button = _mouseButton(event.buttons);
    final active = _activePointers.remove(event.pointer);
    if (active != null) {
      _sendMouseRelease(active);
    }
    final next = _ActivePointer(button: button, lastPoint: point);
    if (_send(<String, Object?>{
      'type': 'input_mouse',
      'eventType': 'mousePressed',
      'x': point.dx,
      'y': point.dy,
      'button': button,
      'clickCount': 1,
      'modifiers': _modifiers(),
    })) {
      _activePointers[event.pointer] = next;
    }
  }

  void _handlePointerMove(PointerMoveEvent event, Size size) {
    if (event.kind == ui.PointerDeviceKind.touch) {
      final gesture = _touchGestures[event.pointer];
      if (gesture == null) {
        return;
      }
      final point = _mapPoint(event.localPosition, size);
      if (point == null) {
        return;
      }
      if (!gesture.moved &&
          (event.localPosition - gesture.startLocal).distance >= 6) {
        gesture.moved = true;
      }
      if (gesture.moved) {
        _send(<String, Object?>{
          'type': 'input_mouse',
          'eventType': 'mouseWheel',
          'x': point.dx,
          'y': point.dy,
          'deltaX': gesture.lastPoint.dx - point.dx,
          'deltaY': gesture.lastPoint.dy - point.dy,
          'modifiers': _modifiers(),
        });
      }
      gesture.lastPoint = point;
      return;
    }

    final point = _mapPoint(event.localPosition, size);
    if (point == null) {
      return;
    }
    final active = _activePointers[event.pointer];
    if (active != null) {
      active.lastPoint = point;
    }
    _sendMouseMove(point, active?.button ?? 'none');
  }

  void _handlePointerHover(PointerHoverEvent event, Size size) {
    final point = _mapPoint(event.localPosition, size);
    if (point != null) {
      _sendMouseMove(point, 'none');
    }
  }

  void _handlePointerUp(PointerUpEvent event, Size size) {
    if (event.kind == ui.PointerDeviceKind.touch) {
      final gesture = _touchGestures.remove(event.pointer);
      if (gesture == null || gesture.moved) {
        return;
      }
      final point = _mapPoint(event.localPosition, size);
      if (point == null) {
        return;
      }
      final input = <String, Object?>{
        'type': 'input_mouse',
        'x': point.dx,
        'y': point.dy,
        'button': 'left',
        'clickCount': 1,
        'modifiers': _modifiers(),
      };
      _send(<String, Object?>{...input, 'eventType': 'mouseMoved'});
      _send(<String, Object?>{...input, 'eventType': 'mousePressed'});
      _send(<String, Object?>{...input, 'eventType': 'mouseReleased'});
      return;
    }

    final active = _activePointers.remove(event.pointer);
    if (active == null) {
      return;
    }
    active.lastPoint = _mapPoint(event.localPosition, size) ?? active.lastPoint;
    _sendMouseRelease(active);
  }

  void _handlePointerCancel(PointerCancelEvent event) {
    _touchGestures.remove(event.pointer);
    final active = _activePointers.remove(event.pointer);
    if (active != null) {
      _sendMouseRelease(active);
    }
  }

  void _handlePointerSignal(PointerSignalEvent event, Size size) {
    if (event is! PointerScrollEvent) {
      return;
    }
    final point = _mapPoint(event.localPosition, size);
    if (point == null) {
      return;
    }
    _send(<String, Object?>{
      'type': 'input_mouse',
      'eventType': 'mouseWheel',
      'x': point.dx,
      'y': point.dy,
      'deltaX': event.scrollDelta.dx,
      'deltaY': event.scrollDelta.dy,
      'modifiers': _modifiers(),
    });
  }

  void _sendMouseMove(Offset point, String button) {
    _send(<String, Object?>{
      'type': 'input_mouse',
      'eventType': 'mouseMoved',
      'x': point.dx,
      'y': point.dy,
      'button': button,
      'clickCount': 1,
      'modifiers': _modifiers(),
    });
  }

  void _sendMouseRelease(
    _ActivePointer active, {
    AgentBrowserController? controller,
  }) {
    _send(
      <String, Object?>{
        'type': 'input_mouse',
        'eventType': 'mouseReleased',
        'x': active.lastPoint.dx,
        'y': active.lastPoint.dy,
        'button': active.button,
        'clickCount': 1,
        'modifiers': _modifiers(),
      },
      allowWhenDisabled: true,
      controller: controller,
    );
  }

  bool _send(
    Map<String, Object?> input, {
    bool allowWhenDisabled = false,
    AgentBrowserController? controller,
  }) {
    if (!_inputEnabled && !allowWhenDisabled) {
      return false;
    }
    try {
      final sent = (controller ?? widget.controller).sendInput(input);
      if (sent) {
        widget.onInputSent?.call(Map<String, Object?>.unmodifiable(input));
      }
      return sent;
    } on StateError {
      return false;
    }
  }

  void _releaseAllPointers({AgentBrowserController? controller}) {
    final pointers = _activePointers.values.toList(growable: false);
    _clearPointerState();
    for (final active in pointers) {
      _sendMouseRelease(active, controller: controller);
    }
  }

  void _clearPointerState() {
    _activePointers.clear();
    _touchGestures.clear();
  }

  static String _mouseButton(int buttons) {
    if (buttons & kSecondaryMouseButton != 0) {
      return 'right';
    }
    if (buttons & kMiddleMouseButton != 0) {
      return 'middle';
    }
    return 'left';
  }

  static int _modifiers() {
    final keyboard = HardwareKeyboard.instance;
    return (keyboard.isAltPressed ? 1 : 0) |
        (keyboard.isControlPressed ? 2 : 0) |
        (keyboard.isMetaPressed ? 4 : 0) |
        (keyboard.isShiftPressed ? 8 : 0);
  }

  static MouseCursor _systemCursor(String? cursor) {
    return switch (cursor) {
      'pointer' => SystemMouseCursors.click,
      'text' || 'vertical-text' => SystemMouseCursors.text,
      'crosshair' => SystemMouseCursors.precise,
      'move' => SystemMouseCursors.move,
      'grab' => SystemMouseCursors.grab,
      'grabbing' => SystemMouseCursors.grabbing,
      'not-allowed' => SystemMouseCursors.forbidden,
      'wait' || 'progress' => SystemMouseCursors.wait,
      'help' => SystemMouseCursors.help,
      'zoom-in' => SystemMouseCursors.zoomIn,
      'zoom-out' => SystemMouseCursors.zoomOut,
      'col-resize' => SystemMouseCursors.resizeColumn,
      'row-resize' => SystemMouseCursors.resizeRow,
      'nwse-resize' => SystemMouseCursors.resizeDownRight,
      'nesw-resize' => SystemMouseCursors.resizeDownLeft,
      _ => SystemMouseCursors.basic,
    };
  }
}

final class _ActivePointer {
  _ActivePointer({required this.button, required this.lastPoint});

  final String button;
  Offset lastPoint;
}

final class _TouchGesture {
  _TouchGesture({required this.startLocal, required this.lastPoint});

  final Offset startLocal;
  Offset lastPoint;
  bool moved = false;
}
