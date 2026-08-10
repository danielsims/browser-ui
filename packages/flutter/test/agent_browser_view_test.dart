import 'package:browser_ui/browser_ui.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('renders an offline, view-only browser surface', (
    WidgetTester tester,
  ) async {
    final controller = AgentBrowserController(
      streamUri: Uri.parse('wss://gateway.example.com/browser/stream'),
    );
    addTearDown(controller.dispose);

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Center(
            child: SizedBox(
              width: 320,
              height: 200,
              child: AgentBrowserView(controller: controller),
            ),
          ),
        ),
      ),
    );

    expect(find.text('Browser stream is offline'), findsOneWidget);
    expect(find.byType(RawImage), findsNothing);
    final ignorePointer = tester.widget<IgnorePointer>(
      find.descendant(
        of: find.byType(AgentBrowserView),
        matching: find.byType(IgnorePointer),
      ),
    );
    expect(ignorePointer.ignoring, isTrue);
  });

  testWidgets('renders the browser sheet chrome without starting transport', (
    WidgetTester tester,
  ) async {
    final controller = AgentBrowserController(
      streamUri: Uri.parse('ws://192.168.1.25:9222/stream'),
    );
    addTearDown(controller.dispose);
    var closed = false;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SizedBox(
            height: 600,
            child: BrowserSheet(
              controller: controller,
              title: 'Checkout',
              onClose: () => closed = true,
            ),
          ),
        ),
      ),
    );

    expect(find.text('Checkout'), findsOneWidget);
    expect(find.text('Offline'), findsOneWidget);
    expect(
      controller.connectionStatus,
      AgentBrowserConnectionStatus.disconnected,
    );

    await tester.tap(find.byTooltip('Close browser'));
    expect(closed, isTrue);
  });

  testWidgets('renders a view-only operating overlay and status pill', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: SizedBox(
            width: 320,
            height: 200,
            child: Stack(
              children: [
                ColoredBox(color: Colors.black),
                BrowserOperatingOverlay(
                  label: 'Selecting memory',
                  shader: BrowserOperatingShaderConfiguration(
                    variant: BrowserOperatingShaderVariant.tide,
                    direction: BrowserOperatingShaderDirection.rightToLeft,
                    speed: BrowserOperatingShaderSpeed.slow,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );

    expect(find.text('Selecting memory'), findsOneWidget);
    expect(
      find.byWidgetPredicate(
        (widget) => widget is AbsorbPointer && widget.absorbing,
      ),
      findsOneWidget,
    );
    expect(find.byType(TextButton), findsNothing);
  });

  test('exposes every shared shader variant, direction, and speed', () {
    expect(BrowserOperatingShaderVariant.values, [
      BrowserOperatingShaderVariant.subtle,
      BrowserOperatingShaderVariant.prism,
      BrowserOperatingShaderVariant.pulse,
      BrowserOperatingShaderVariant.tide,
    ]);
    expect(BrowserOperatingShaderDirection.values, hasLength(8));
    expect(
      BrowserOperatingShaderVariant.tide.defaults.resolvedDirection,
      BrowserOperatingShaderDirection.topLeftToBottomRight,
    );
    expect(
      BrowserOperatingShaderVariant.pulse.defaults.resolvedSpeed,
      BrowserOperatingShaderSpeed.fast,
    );
  });
}
