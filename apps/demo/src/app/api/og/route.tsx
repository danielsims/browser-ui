import { ImageResponse } from "next/og";

export const runtime = "edge";

const description =
  "A composable React viewport for agent-browser. Stream a real session, visualize agent actions and hand control to a person without changing transports.";

export async function GET() {
  const [interLight, plexMono] = await Promise.all([
    fetch(
      "https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuOKfMZg.ttf",
    ).then((response) => response.arrayBuffer()),
    fetch(
      "https://fonts.gstatic.com/s/ibmplexmono/v20/-F63fjptAgt5VM-kVkqdyU8n5ig.ttf",
    ).then((response) => response.arrayBuffer()),
  ]);

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        backgroundColor: "#fafafa",
        fontFamily: "Inter",
        padding: 80,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontFamily: "IBM Plex Mono",
          fontSize: 22,
          letterSpacing: "0.02em",
        }}
      >
        <span style={{ color: "#737373" }}>@browser-ui</span>
        <span style={{ color: "#d4d4d4" }}>/</span>
        <span style={{ color: "#171717" }}>react</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        <span
          style={{
            fontSize: 62,
            fontWeight: 300,
            color: "#171717",
            letterSpacing: "-0.015em",
          }}
        >
          browser-ui
        </span>
        <span
          style={{
            fontSize: 24,
            fontWeight: 300,
            color: "#737373",
            lineHeight: 1.4,
            marginTop: 16,
            maxWidth: 900,
          }}
        >
          {description}
        </span>
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: "Inter", data: interLight, weight: 300, style: "normal" },
        { name: "IBM Plex Mono", data: plexMono, weight: 400, style: "normal" },
      ],
    },
  );
}
