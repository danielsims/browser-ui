export const browserPropGroups = [
  {
    title: "Stream",
    props: [
      [
        "streamUrl",
        "string · required",
        "WebSocket endpoint returned by agent-browser. Frames and user input travel over this connection.",
      ],
      [
        "viewportSize",
        "{ width, height }",
        "Remote browser resolution, independent from the rendered component. Keep it fixed to preserve desktop breakpoints in PiP.",
      ],
      [
        "displayAspectRatio",
        "CSS aspect-ratio",
        "Shape of the rendered component only. It never changes the remote viewport.",
      ],
      [
        "colorScheme",
        '"light" | "dark" | "system"',
        "Controls Browser UI chrome independently from the streamed page. System follows the host device preference.",
      ],
      [
        "onUrlChange",
        "(url) => void",
        "Reports navigation messages emitted by the remote browser.",
      ],
      [
        "onViewportResize",
        "(width, height) => void",
        "Reports the requested remote viewport dimensions to the session owner.",
      ],
      [
        "onStatusChange",
        "(status) => void",
        "Reports connecting, connected, disconnected and error states.",
      ],
    ],
  },
  {
    title: "Agent activity",
    props: [
      [
        "operating",
        "boolean · false",
        "Shows the activity shader and pauses direct viewport input while the agent owns the session.",
      ],
      [
        "operatingLabel",
        "string",
        "Current action displayed in the compact status control.",
      ],
      [
        "operatingShader",
        "{ variant, direction, speed }",
        "Selects the active-agent shader and configures its movement across the viewport.",
      ],
      [
        "agentCursor",
        "BrowserAgentCursorState",
        "Normalized cursor position and pressed or typing state for visualizing live or recorded agent actions.",
      ],
      [
        "agentCursor.size",
        "number · 24",
        "Controls the rendered cursor width in CSS pixels.",
      ],
      [
        "agentCursor.backgroundColor",
        "CSS color · #2f6bff",
        "Controls the soft radial glow beneath the cursor.",
      ],
      [
        "onActivityChange",
        "(activity) => void",
        "Reports structured agent activity, including labels and live cursor state.",
      ],
      [
        "loadingLabel",
        "string",
        "Copy shown while the WebSocket is connecting or reconnecting.",
      ],
    ],
  },
  {
    title: "Display",
    props: [
      [
        "variant",
        '"framed" | "bare"',
        "Use the standalone glass frame or an unstyled edge-to-edge surface.",
      ],
      [
        "showControls",
        "boolean · false",
        "Adds the optional address and reload controls.",
      ],
      [
        "showPictureInPicture",
        "boolean · false",
        "Adds the floating picture-in-picture control.",
      ],
      [
        "showFullscreen",
        "boolean · false",
        "Adds application fullscreen without changing the remote viewport size.",
      ],
      [
        "fullscreenTarget",
        "HTMLElement | null",
        "Constrains fullscreen to a host element and tracks its bounds and border radius.",
      ],
      [
        "mode",
        '"inline" | "picture-in-picture" | "fullscreen"',
        "Controls the display mode from your application.",
      ],
      [
        "defaultMode",
        'display mode · "inline"',
        "Initial display mode when Browser manages its own state.",
      ],
      [
        "onModeChange",
        "(mode) => void",
        "Reports transitions between inline, PiP and fullscreen.",
      ],
      [
        "displayControls",
        "ReactNode",
        "Adds host-owned actions to Browser UI's display-control strip.",
      ],
      [
        "displayControlsClassName",
        "string",
        "Class name applied to the package-owned display-control strip.",
      ],
    ],
  },
  {
    title: "Session control",
    props: [
      [
        "access",
        "BrowserSessionAccess",
        "Projects the viewer's capabilities and active control lease into the browser surface.",
      ],
      [
        "interactive",
        "boolean · false",
        "Enables local input intent; projected access still decides whether commands are authorized.",
      ],
      [
        "onTakeControl",
        "() => void",
        "Called when the person stops the workflow and takes ownership of browser input.",
      ],
      [
        "onEndSession",
        "() => Promise<void> | void",
        "Renders the terminal action and delegates destruction of the underlying browser to the host.",
      ],
      [
        "endSessionLabel",
        "string · End session",
        "Overrides the accessible label for the package-owned terminal action.",
      ],
    ],
  },
  {
    title: "Navigation",
    props: [
      ["url", "string", "Current URL shown by the optional controls."],
      [
        "onNavigate",
        "(url) => void",
        "Receives address submissions so the session owner can navigate agent-browser.",
      ],
      [
        "onReload",
        "() => void",
        "Receives reload requests from the optional browser controls.",
      ],
      [
        "ariaLabel",
        "string",
        "Accessible name for the interactive remote viewport.",
      ],
      [
        "viewportClassName",
        "string",
        "Class name applied directly to AgentBrowserViewport.",
      ],
    ],
  },
] as const;
