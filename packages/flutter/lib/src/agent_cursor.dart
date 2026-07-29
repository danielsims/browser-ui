import 'package:flutter/material.dart';

/// A transport-neutral cursor for visualising live agent actions.
final class BrowserAgentCursor extends StatelessWidget {
  const BrowserAgentCursor({
    required this.x,
    required this.y,
    this.visible = true,
    this.variant = Brightness.light,
    this.typing = false,
    super.key,
  });

  final double x;
  final double y;
  final bool visible;
  final Brightness variant;
  final bool typing;

  @override
  Widget build(BuildContext context) {
    return Positioned.fill(
      child: IgnorePointer(
        child: LayoutBuilder(
          builder: (context, constraints) => TweenAnimationBuilder<Offset>(
            tween: Tween(end: Offset(x.clamp(0, 1), y.clamp(0, 1))),
            duration: const Duration(milliseconds: 680),
            curve: Curves.easeOutCubic,
            builder: (context, point, child) => Stack(
              children: [
                Positioned(
                  left: point.dx * constraints.maxWidth - 2,
                  top: point.dy * constraints.maxHeight - 2,
                  child: AnimatedOpacity(
                    opacity: visible ? 1 : 0,
                    duration: const Duration(milliseconds: 180),
                    child: SizedBox.square(
                      dimension: 32,
                      child: CustomPaint(
                        painter: _CursorPainter(
                          dark: variant == Brightness.dark,
                          typing: typing,
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

final class _CursorPainter extends CustomPainter {
  const _CursorPainter({required this.dark, required this.typing});

  final bool dark;
  final bool typing;

  @override
  void paint(Canvas canvas, Size size) {
    final glow = Paint()
      ..shader = const RadialGradient(
        colors: [Color(0x992f6bff), Color(0x002f6bff)],
      ).createShader(Offset.zero & size);
    canvas.drawCircle(const Offset(12, 12), typing ? 14 : 12, glow);

    final path = Path()
      ..moveTo(6.05, 3.02)
      ..cubicTo(5.72, 2.70, 5.20, 2.94, 5.20, 3.40)
      ..lineTo(5.20, 20.48)
      ..cubicTo(5.20, 21.12, 5.96, 21.38, 6.38, 20.96)
      ..lineTo(11.06, 16.28)
      ..cubicTo(11.20, 16.14, 11.38, 16.06, 11.57, 16.06)
      ..lineTo(18.50, 16.06)
      ..cubicTo(19.14, 16.06, 19.43, 15.29, 18.97, 14.84)
      ..close();
    final outline = Paint()
      ..color = dark ? Colors.white : const Color(0xff050505)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3
      ..strokeJoin = StrokeJoin.round;
    canvas.drawPath(path, outline);
    canvas.drawPath(
      path,
      Paint()..color = dark ? const Color(0xff050505) : Colors.white,
    );
  }

  @override
  bool shouldRepaint(_CursorPainter oldDelegate) =>
      oldDelegate.dark != dark || oldDelegate.typing != typing;
}
