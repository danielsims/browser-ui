export interface BrowserViewportSize {
  width: number;
  height: number;
}

export interface BrowserViewportPoint {
  x: number;
  y: number;
}

/** Preview uses the agent's stable canvas; takeover uses the viewer device bounds. */
export const browserViewportPresentationModes = [
  "preview",
  "takeover",
] as const;
export type BrowserViewportPresentationMode =
  (typeof browserViewportPresentationModes)[number];

/**
 * Maps a point in a contained presentation surface to the remote viewport.
 * Points in letterboxed space are rejected instead of hitting a page edge.
 */
export function mapContainedPointToViewport(
  point: BrowserViewportPoint,
  container: BrowserViewportSize,
  viewport: BrowserViewportSize,
): BrowserViewportPoint | null {
  if (
    !positiveFinite(container.width) ||
    !positiveFinite(container.height) ||
    !positiveFinite(viewport.width) ||
    !positiveFinite(viewport.height) ||
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y)
  ) {
    return null;
  }

  const scale = Math.min(
    container.width / viewport.width,
    container.height / viewport.height,
  );
  const renderedWidth = viewport.width * scale;
  const renderedHeight = viewport.height * scale;
  const offsetX = (container.width - renderedWidth) / 2;
  const offsetY = (container.height - renderedHeight) / 2;
  if (
    point.x < offsetX ||
    point.y < offsetY ||
    point.x > offsetX + renderedWidth ||
    point.y > offsetY + renderedHeight
  ) {
    return null;
  }

  return {
    x: (point.x - offsetX) / scale,
    y: (point.y - offsetY) / scale,
  };
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
