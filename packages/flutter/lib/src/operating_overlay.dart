import 'dart:async';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

/// Blocks browser input while visualising active agent work.
final class BrowserOperatingOverlay extends StatefulWidget {
  const BrowserOperatingOverlay({
    this.label = 'Agent is operating this browser',
    super.key,
  });

  final String label;

  @override
  State<BrowserOperatingOverlay> createState() =>
      _BrowserOperatingOverlayState();
}

final class _BrowserOperatingOverlayState extends State<BrowserOperatingOverlay>
    with SingleTickerProviderStateMixin {
  late final AnimationController _animation;
  ui.FragmentShader? _shader;

  @override
  void initState() {
    super.initState();
    _animation = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 12),
    );
    unawaited(_animation.repeat());
    unawaited(_loadShader());
  }

  Future<void> _loadShader() async {
    for (final asset in const [
      'packages/browser_ui/shaders/operating_overlay.frag',
      'shaders/operating_overlay.frag',
    ]) {
      try {
        final program = await ui.FragmentProgram.fromAsset(asset);
        if (!mounted) return;
        setState(() => _shader = program.fragmentShader());
        return;
      } on Exception {
        // The package-prefixed key is used by consumers; package tests use the
        // local key. The gradient fallback remains if neither is available.
      }
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MediaQuery.disableAnimationsOf(context)) {
      _animation.stop();
      _animation.value = 1 / 3;
    } else if (!_animation.isAnimating) {
      unawaited(_animation.repeat());
    }
  }

  @override
  void dispose() {
    _animation.dispose();
    _shader?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Positioned.fill(
      child: AbsorbPointer(
        child: AnimatedBuilder(
          animation: _animation,
          builder: (context, _) => Stack(
            fit: StackFit.expand,
            children: [
              CustomPaint(painter: _OperatingFallbackPainter(_animation.value)),
              if (_shader != null)
                Opacity(
                  opacity: 0.9,
                  child: CustomPaint(
                    painter: _OperatingShaderPainter(
                      shader: _shader!,
                      elapsedSeconds: _animation.value * 12,
                    ),
                  ),
                ),
              Align(
                alignment: const Alignment(0, 0.82),
                child: _OperatingPill(
                  label: widget.label,
                  shimmer: (_animation.value * 6) % 1,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

final class _OperatingPill extends StatelessWidget {
  const _OperatingPill({required this.label, required this.shimmer});

  final String label;
  final double shimmer;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 18),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 320),
        child: Container(
          height: 32,
          decoration: BoxDecoration(
            color: Colors.black.withValues(alpha: 0.92),
            border: Border.all(color: Colors.white.withValues(alpha: 0.14)),
            borderRadius: BorderRadius.circular(999),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.34),
                blurRadius: 30,
                offset: const Offset(0, 10),
              ),
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.22),
                blurRadius: 8,
                offset: const Offset(0, 2),
              ),
            ],
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 13),
            child: Center(
              widthFactor: 1,
              child: ShaderMask(
                blendMode: BlendMode.srcIn,
                shaderCallback: (bounds) => LinearGradient(
                  begin: Alignment(-3 + shimmer * 6, 0),
                  end: Alignment(-1 + shimmer * 6, 0),
                  colors: const [
                    Color(0x94ffffff),
                    Colors.white,
                    Color(0x94ffffff),
                  ],
                ).createShader(bounds),
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 11,
                    fontWeight: FontWeight.w500,
                    letterSpacing: -0.13,
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

final class _OperatingShaderPainter extends CustomPainter {
  const _OperatingShaderPainter({
    required this.shader,
    required this.elapsedSeconds,
  });

  final ui.FragmentShader shader;
  final double elapsedSeconds;

  @override
  void paint(Canvas canvas, Size size) {
    shader
      ..setFloat(0, size.width)
      ..setFloat(1, size.height)
      ..setFloat(2, elapsedSeconds);
    canvas.drawRect(Offset.zero & size, Paint()..shader = shader);
  }

  @override
  bool shouldRepaint(_OperatingShaderPainter oldDelegate) =>
      oldDelegate.elapsedSeconds != elapsedSeconds ||
      oldDelegate.shader != shader;
}

final class _OperatingFallbackPainter extends CustomPainter {
  const _OperatingFallbackPainter(this.progress);

  final double progress;

  @override
  void paint(Canvas canvas, Size size) {
    final drift = 0.06 * (progress < 0.5 ? progress * 2 : (1 - progress) * 2);
    final rect = Offset.zero & size;
    canvas.drawRect(
      rect,
      Paint()
        ..shader = ui.Gradient.radial(
          Offset(size.width * (0.18 + drift), size.height * 0.34),
          size.longestSide * 0.45,
          const [Color(0x1f6eff9d), Color(0x00110000)],
        ),
    );
    canvas.drawRect(
      rect,
      Paint()
        ..shader = ui.Gradient.radial(
          Offset(size.width * (0.82 - drift), size.height * 0.66),
          size.longestSide * 0.48,
          const [Color(0x1af75ccd), Color(0x00000000)],
        ),
    );
  }

  @override
  bool shouldRepaint(_OperatingFallbackPainter oldDelegate) =>
      oldDelegate.progress != progress;
}
