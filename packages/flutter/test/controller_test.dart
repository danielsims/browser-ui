import 'package:browser_ui/browser_ui.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('validateAgentBrowserStreamUri', () {
    test('accepts secure remote and insecure development endpoints', () {
      expect(
        () => validateAgentBrowserStreamUri(
          Uri.parse('wss://gateway.example.com/session/stream'),
        ),
        returnsNormally,
      );
      expect(
        () => validateAgentBrowserStreamUri(
          Uri.parse('ws://127.0.0.1:9222/stream'),
        ),
        returnsNormally,
      );
      expect(
        () => validateAgentBrowserStreamUri(
          Uri.parse('ws://192.168.1.25:9222/stream'),
        ),
        returnsNormally,
      );
      expect(
        () => validateAgentBrowserStreamUri(
          Uri.parse('ws://dev-machine.local:9222/stream'),
        ),
        returnsNormally,
      );
    });

    test('rejects insecure public endpoints by default', () {
      expect(
        () => validateAgentBrowserStreamUri(
          Uri.parse('ws://gateway.example.com/session/stream'),
        ),
        throwsArgumentError,
      );
    });
  });

  test('reconnect delay remains capped', () {
    const policy = AgentBrowserReconnectPolicy(
      initialDelay: Duration(milliseconds: 250),
      maximumDelay: Duration(seconds: 2),
      randomizationFactor: 0,
    );

    expect(policy.delayForAttempt(0), const Duration(milliseconds: 250));
    expect(policy.delayForAttempt(2), const Duration(seconds: 1));
    expect(policy.delayForAttempt(20), const Duration(seconds: 2));
  });
}
