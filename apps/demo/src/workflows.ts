export type WorkflowStep =
  | { action: "open"; label: string; url: string; wait?: number }
  | { action: "reset-page"; label: string; wait?: number }
  | { action: "click"; label: string; selector: string; index?: number; activation?: "pointer" | "programmatic" | "same-tab"; waitFor?: string; waitTimeout?: number; fallbackUrl?: string; wait?: number; optional?: boolean }
  | { action: "click-text"; label: string; role: string; text: string; wait?: number; optional?: boolean }
  | { action: "select-dates"; label: string; leadDays: number; nights: number; wait?: number }
  | { action: "type"; label: string; selector: string; text: string; wait?: number }
  | { action: "press"; label: string; key: string; wait?: number }
  | { action: "scroll-into-view"; label: string; selector: string; wait?: number }
  | { action: "scroll"; label: string; direction: "up" | "down"; amount: number; wait?: number };

export interface DemoWorkflow {
  id: string;
  title: string;
  source: string;
  description: string;
  outcome: string;
  startUrl: string;
  /** A bundled capture used by the public demo when no live stream is configured. */
  previewSrc: string;
  steps: readonly WorkflowStep[];
}

/** Public workflows that exercise the same live stream used in production. */
export const workflows = [
  {
    id: "configure-mac-mini",
    title: "Configure a Mac mini",
    source: "Apple",
    description: "Find Mac mini, configure the desktop and a Studio Display, then hand the live session back at Apple’s final review.",
    outcome: "Mac mini and Studio Display configured for final review",
    startUrl: "https://www.apple.com/",
    previewSrc: "/previews/configure-mac-mini.webm",
    steps: [
      { action: "open", label: "Opening apple.com", url: "https://www.apple.com/", wait: 2_800 },
      { action: "reset-page", label: "Starting with a fresh Apple session", wait: 1_100 },
      { action: "click", label: "Closing the region prompt", selector: "button[aria-label=\"Close country or region selector\"]", optional: true, wait: 550 },
      { action: "click", label: "Opening Mac from Apple’s navigation", selector: "a.globalnav-link-mac[aria-label=\"Mac\"]", waitFor: "a[aria-label=\"Learn more, Mac mini\"]", fallbackUrl: "https://www.apple.com/mac/", wait: 1_050 },
      { action: "scroll-into-view", label: "Finding Mac mini in the lineup", selector: "a[aria-label=\"Learn more, Mac mini\"]", wait: 800 },
      { action: "click", label: "Opening Mac mini", selector: "a[aria-label=\"Learn more, Mac mini\"]", waitFor: "a.detail-ctas-link[aria-label=\"Buy, Mac mini\"]", fallbackUrl: "https://www.apple.com/mac-mini/", wait: 1_050 },
      { action: "scroll-into-view", label: "Locating the Mac mini Buy button", selector: "a.detail-ctas-link[aria-label=\"Buy, Mac mini\"]", wait: 1_150 },
      { action: "click", label: "Starting the configuration", selector: "a.detail-ctas-link[aria-label=\"Buy, Mac mini\"]", waitFor: "input[data-autom=\"processor-dimensionChipm4\"]", fallbackUrl: "https://www.apple.com/shop/buy-mac/mac-mini", wait: 850 },
      { action: "click", label: "Choosing the M4 chip", selector: "input[data-autom=\"processor-dimensionChipm4\"]", waitFor: "input[data-autom=\"memory-dimensionMemory_24gb\"]:not(:disabled)", wait: 600 },
      { action: "click", label: "Selecting 24GB unified memory", selector: "input[data-autom=\"memory-dimensionMemory_24gb\"]", waitFor: "input[data-autom=\"storage-dimensionCapacity_512gb\"]:not(:disabled)", wait: 600 },
      { action: "click", label: "Selecting 512GB storage", selector: "input[data-autom=\"storage-dimensionCapacity_512gb\"]", waitFor: "input[data-autom=\"ethernet_adapter-ethernetBandwidth_1gb_per_second\"]:not(:disabled)", wait: 600 },
      { action: "click", label: "Keeping Gigabit Ethernet", selector: "input[data-autom=\"ethernet_adapter-ethernetBandwidth_1gb_per_second\"]", waitFor: "input[data-autom=\"choose-noTradeIn\"]:not(:disabled)", wait: 600 },
      { action: "click", label: "Continuing without a trade-in", selector: "input[data-autom=\"choose-noTradeIn\"]", waitFor: "input[data-autom=\"purchaseGroupOptionfullprice\"]:not(:disabled)", wait: 700 },
      { action: "click", label: "Choosing the standard purchase option", selector: "input[data-autom=\"purchaseGroupOptionfullprice\"] + label", activation: "programmatic", waitFor: "button[data-autom=\"proceed\"]:not(:disabled)", wait: 850 },
      { action: "click", label: "Reviewing the completed Mac mini", selector: "button[data-autom=\"proceed\"]", waitFor: "input[data-autom=\"dimensionFinishglossy\"]", waitTimeout: 18_000, wait: 900 },
      { action: "click", label: "Adding a Studio Display with standard glass", selector: "input[data-autom=\"dimensionFinishglossy\"]", waitFor: "input[data-autom=\"dimensionStandTypetiltadjuststand\"]:not(:disabled)", wait: 700 },
      { action: "click", label: "Choosing the tilt-adjustable stand", selector: "input[data-autom=\"dimensionStandTypetiltadjuststand\"]", waitFor: "input[data-autom=\"noapplecare\"]:not(:disabled)", wait: 700 },
      { action: "click", label: "Continuing without AppleCare", selector: "input[data-autom=\"noapplecare\"]", waitFor: ".rc-summary-button button[data-autom=\"add-to-cart\"]", wait: 900 },
      { action: "scroll-into-view", label: "Ready for you to review the configured order", selector: ".rc-summary-button button[data-autom=\"add-to-cart\"]", wait: 1_200 },
    ],
  },
  {
    id: "find-tokyo-stay",
    title: "Find a Tokyo stay",
    source: "Airbnb",
    description: "Search Tokyo for a five-night stay, compare real homes with essential amenities and hand over on the selected property.",
    outcome: "Tokyo Airbnb selected for review",
    startUrl: "https://www.airbnb.com/",
    previewSrc: "/previews/find-tokyo-stay.webm",
    steps: [
      { action: "open", label: "Opening Airbnb", url: "https://www.airbnb.com/", wait: 4_500 },
      { action: "type", label: "Searching for Tokyo", selector: "input[aria-label=\"Where\"]", text: "Tokyo", wait: 1_000 },
      { action: "click", label: "Choosing Tokyo, Japan", selector: "[role=\"option\"]", waitFor: "button[aria-label*=\"Select as check-in date\"]", wait: 700 },
      { action: "select-dates", label: "Planning five nights in Tokyo", leadDays: 21, nights: 5, wait: 650 },
      { action: "click-text", label: "Adding two travellers", role: "button", text: "Add guests", wait: 450 },
      { action: "click", label: "Adding the first guest", selector: "button[aria-label=\"Increase Adults\"]", wait: 250 },
      { action: "click", label: "Adding the second guest", selector: "button[aria-label=\"Increase Adults\"]", wait: 400 },
      { action: "click", label: "Finding available Tokyo homes", selector: "button[aria-label=\"Search\"]", waitFor: "[data-testid=\"card-container\"]", waitTimeout: 18_000, wait: 1_000 },
      { action: "click", label: "Filtering for Wi-Fi", selector: "[role=\"checkbox\"][aria-label=\"Wifi\"]", wait: 1_100 },
      { action: "click", label: "Filtering for air conditioning", selector: "[role=\"checkbox\"][aria-label=\"Air conditioning\"]", wait: 1_100 },
      { action: "click", label: "Looking through the first stay", selector: "button[aria-label^=\"Next photo:\"]", index: 0, wait: 700 },
      { action: "click", label: "Comparing another stay", selector: "button[aria-label^=\"Next photo:\"]", index: 1, wait: 700 },
      { action: "scroll", label: "Browsing more Tokyo homes", direction: "down", amount: 520, wait: 650 },
      { action: "click", label: "Checking one more property", selector: "button[aria-label^=\"Next photo:\"]", index: 3, wait: 800 },
      { action: "click", label: "Opening a promising Tokyo stay", selector: "[data-testid=\"card-container\"] > a[href*=\"/rooms/\"]", index: 3, activation: "same-tab", waitFor: "h1", waitTimeout: 18_000, wait: 1_200 },
      { action: "click", label: "Closing the translation note", selector: "button[aria-label=\"Close\"]", optional: true, wait: 450 },
      { action: "scroll", label: "Reviewing the property details", direction: "down", amount: 560, wait: 700 },
      { action: "scroll", label: "Checking amenities and availability", direction: "down", amount: 620, wait: 800 },
      { action: "scroll-into-view", label: "Ready for you to review this Tokyo stay", selector: "button[aria-label^=\"Change dates;\"]", wait: 1_200 },
    ],
  },
] as const satisfies readonly DemoWorkflow[];

export type WorkflowId = (typeof workflows)[number]["id"];
