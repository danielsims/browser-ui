import 'dart:async';

import 'package:flutter/material.dart';

import 'access.dart';
import 'agent_browser_view.dart';
import 'controller.dart';

/// A native-feeling in-app browser sheet around [AgentBrowserView].
///
/// This widget never connects, disconnects, or disposes [controller].
final class BrowserSheet extends StatelessWidget {
  const BrowserSheet({
    required this.controller,
    required this.onClose,
    this.onEndSession,
    this.title = 'Browser',
    this.interactive = false,
    this.access,
    this.semanticLabel = 'Remote browser',
    this.closeTooltip = 'Close browser',
    this.endSessionTooltip = 'End browsing session',
    this.backgroundColor,
    this.placeholderBuilder,
    this.onStatusChanged,
    this.onUrlChanged,
    this.onFrame,
    this.onInputSent,
    super.key,
  });

  final AgentBrowserController controller;
  final VoidCallback onClose;
  final FutureOr<void> Function()? onEndSession;
  final String title;
  final bool interactive;
  final BrowserSessionAccess? access;
  final String semanticLabel;
  final String closeTooltip;
  final String endSessionTooltip;
  final Color? backgroundColor;
  final AgentBrowserPlaceholderBuilder? placeholderBuilder;
  final ValueChanged<AgentBrowserConnectionStatus>? onStatusChanged;
  final ValueChanged<String?>? onUrlChanged;
  final ValueChanged<AgentBrowserFrame>? onFrame;
  final ValueChanged<Map<String, Object?>>? onInputSent;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final surface = backgroundColor ?? colorScheme.surface;

    return Material(
      color: surface,
      clipBehavior: Clip.antiAlias,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
      ),
      child: SafeArea(
        top: false,
        child: Column(
          children: <Widget>[
            const SizedBox(height: 9),
            ExcludeSemantics(
              child: Container(
                width: 36,
                height: 5,
                decoration: BoxDecoration(
                  color: colorScheme.onSurfaceVariant.withValues(alpha: 0.28),
                  borderRadius: BorderRadius.circular(99),
                ),
              ),
            ),
            AnimatedBuilder(
              animation: controller,
              builder: (BuildContext context, Widget? child) {
                return _BrowserSheetHeader(
                  controller: controller,
                  title: title,
                  closeTooltip: closeTooltip,
                  endSessionTooltip: endSessionTooltip,
                  onEndSession: onEndSession,
                  onClose: onClose,
                );
              },
            ),
            Divider(
              height: 1,
              thickness: 1,
              color: colorScheme.outlineVariant.withValues(alpha: 0.65),
            ),
            Expanded(
              child: AgentBrowserView(
                controller: controller,
                interactive: interactive,
                access: access,
                semanticLabel: semanticLabel,
                placeholderBuilder: placeholderBuilder,
                onStatusChanged: onStatusChanged,
                onUrlChanged: onUrlChanged,
                onFrame: onFrame,
                onInputSent: onInputSent,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

final class _BrowserSheetHeader extends StatelessWidget {
  const _BrowserSheetHeader({
    required this.controller,
    required this.title,
    required this.closeTooltip,
    required this.endSessionTooltip,
    required this.onClose,
    this.onEndSession,
  });

  final AgentBrowserController controller;
  final String title;
  final String closeTooltip;
  final String endSessionTooltip;
  final VoidCallback onClose;
  final FutureOr<void> Function()? onEndSession;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final status = controller.connectionStatus;
    final statusColor = switch (status) {
      AgentBrowserConnectionStatus.connected => colorScheme.tertiary,
      AgentBrowserConnectionStatus.connecting ||
      AgentBrowserConnectionStatus.reconnecting => colorScheme.primary,
      AgentBrowserConnectionStatus.failed => colorScheme.error,
      AgentBrowserConnectionStatus.disconnected ||
      AgentBrowserConnectionStatus.paused => colorScheme.onSurfaceVariant,
    };
    final detail = _headerDetail(controller.currentUrl, status);

    return SizedBox(
      height: 62,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8),
        child: Row(
          children: <Widget>[
            SizedBox(width: onEndSession == null ? 48 : 96),
            Expanded(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: <Widget>[
                  Text(
                    title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.titleSmall?.copyWith(
                      color: colorScheme.onSurface,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: <Widget>[
                      Container(
                        width: 7,
                        height: 7,
                        decoration: BoxDecoration(
                          color: statusColor,
                          shape: BoxShape.circle,
                        ),
                      ),
                      const SizedBox(width: 6),
                      Flexible(
                        child: Text(
                          detail,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: theme.textTheme.labelSmall?.copyWith(
                            color: colorScheme.onSurfaceVariant,
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            Row(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                if (onEndSession != null)
                  BrowserEndSessionButton(
                    onEndSession: onEndSession!,
                    tooltip: endSessionTooltip,
                  ),
                SizedBox.square(
                  dimension: 48,
                  child: IconButton(
                    onPressed: onClose,
                    tooltip: closeTooltip,
                    icon: const Icon(Icons.close_rounded),
                    visualDensity: VisualDensity.compact,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  static String _headerDetail(
    String? currentUrl,
    AgentBrowserConnectionStatus status,
  ) {
    final statusLabel = switch (status) {
      AgentBrowserConnectionStatus.disconnected => 'Offline',
      AgentBrowserConnectionStatus.connecting => 'Connecting',
      AgentBrowserConnectionStatus.connected => 'Live',
      AgentBrowserConnectionStatus.reconnecting => 'Connecting',
      AgentBrowserConnectionStatus.paused => 'Paused',
      AgentBrowserConnectionStatus.failed => 'Connection failed',
    };
    if (currentUrl == null || currentUrl.isEmpty) {
      return statusLabel;
    }
    final uri = Uri.tryParse(currentUrl);
    final location = uri != null && uri.host.isNotEmpty ? uri.host : currentUrl;
    return '$statusLabel - $location';
  }
}

/// Package-owned terminal action. Closing the sheet remains presentation-only.
final class BrowserEndSessionButton extends StatefulWidget {
  const BrowserEndSessionButton({
    required this.onEndSession,
    this.tooltip = 'End browsing session',
    super.key,
  });

  final FutureOr<void> Function() onEndSession;
  final String tooltip;

  @override
  State<BrowserEndSessionButton> createState() =>
      _BrowserEndSessionButtonState();
}

final class _BrowserEndSessionButtonState
    extends State<BrowserEndSessionButton> {
  bool _ending = false;

  Future<void> _end() async {
    if (_ending) return;
    setState(() => _ending = true);
    try {
      await widget.onEndSession();
    } finally {
      if (mounted) setState(() => _ending = false);
    }
  }

  @override
  Widget build(BuildContext context) => SizedBox.square(
    dimension: 48,
    child: IconButton(
      onPressed: _ending ? null : _end,
      tooltip: _ending ? 'Ending browsing session' : widget.tooltip,
      icon: _ending
          ? const SizedBox.square(
              dimension: 18,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : const Icon(Icons.stop_circle_outlined),
      visualDensity: VisualDensity.compact,
    ),
  );
}

/// Presents [BrowserSheet] without taking ownership of the browser session.
///
/// The supplied controller is not connected, disconnected, or disposed. The
/// host can use [onDismissed] to release a control lease. Only
/// [onEndSession] represents terminal browser lifecycle intent.
Future<T?> showBrowserSheet<T>({
  required BuildContext context,
  required AgentBrowserController controller,
  String title = 'Browser',
  bool interactive = false,
  BrowserSessionAccess? access,
  String semanticLabel = 'Remote browser',
  String closeTooltip = 'Close browser',
  String endSessionTooltip = 'End browsing session',
  double heightFactor = 0.92,
  bool isDismissible = true,
  bool enableDrag = true,
  bool useRootNavigator = false,
  Color? barrierColor,
  Color? backgroundColor,
  RouteSettings? routeSettings,
  AgentBrowserPlaceholderBuilder? placeholderBuilder,
  ValueChanged<AgentBrowserConnectionStatus>? onStatusChanged,
  ValueChanged<String?>? onUrlChanged,
  ValueChanged<AgentBrowserFrame>? onFrame,
  ValueChanged<Map<String, Object?>>? onInputSent,
  VoidCallback? onDismissed,
  FutureOr<void> Function()? onEndSession,
}) async {
  assert(heightFactor > 0 && heightFactor <= 1);
  final result = await showModalBottomSheet<T>(
    context: context,
    isScrollControlled: true,
    isDismissible: isDismissible,
    enableDrag: enableDrag,
    useRootNavigator: useRootNavigator,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    barrierColor: barrierColor,
    routeSettings: routeSettings,
    builder: (BuildContext sheetContext) {
      return FractionallySizedBox(
        heightFactor: heightFactor,
        child: BrowserSheet(
          controller: controller,
          title: title,
          interactive: interactive,
          access: access,
          semanticLabel: semanticLabel,
          closeTooltip: closeTooltip,
          endSessionTooltip: endSessionTooltip,
          onEndSession: onEndSession,
          backgroundColor: backgroundColor,
          placeholderBuilder: placeholderBuilder,
          onStatusChanged: onStatusChanged,
          onUrlChanged: onUrlChanged,
          onFrame: onFrame,
          onInputSent: onInputSent,
          onClose: () => Navigator.of(sheetContext).pop(),
        ),
      );
    },
  );
  onDismissed?.call();
  return result;
}
