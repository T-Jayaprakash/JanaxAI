/**
 * Launch pricing (USD). Payments aren't live yet: during the Trichy beta
 * everything is free, and the pages say so. "soon" marks features that are
 * planned but not built, so nothing is promised that the product can't do.
 */
export interface PlanFeature {
  text: string;
  soon?: boolean;
}

export interface Plan {
  id: "basic" | "creator" | "pro" | "studio";
  name: string;
  tagline: string;
  monthly: number;
  annual: number;
  highlight?: boolean;
  features: PlanFeature[];
  /** Usage limits shown in the studio's usage meters. AI usage scales 1×/3×/10×/30×. */
  limits: PlanLimits;
}

export interface PlanLimits {
  /** AI edit requests per 5-hour session (the window starts with the first message). */
  sessionRequests: number;
  /** AI edit requests per week (Monday 12:00 AM IST). */
  weeklyRequests: number;
  /** Delivered videos per calendar month; null = unlimited. */
  monthlyExports: number | null;
  storageGB: number;
}

const BASE_SESSION = 10;
const BASE_WEEKLY = 40;
const ai = (x: number, monthlyExports: number | null, storageGB: number): PlanLimits => ({
  sessionRequests: BASE_SESSION * x,
  weeklyRequests: BASE_WEEKLY * x,
  monthlyExports,
  storageGB,
});

export const PLANS: Plan[] = [
  {
    id: "basic",
    name: "Basic",
    tagline: "Try it on your own footage",
    monthly: 8,
    annual: 6,
    features: [
      { text: "5 exports a month, 1080p" },
      { text: "Smart cuts: pauses, mistakes, retakes" },
      { text: "Word-by-word captions in Tamil & English" },
      { text: "Voice notes in any language" },
      { text: "Small JANUXAI watermark" },
    ],
    limits: ai(1, 5, 5),
  },
  {
    id: "creator",
    name: "Creator",
    tagline: "For weekly reels and shorts",
    monthly: 29,
    annual: 23,
    features: [
      { text: "Everything in Basic" },
      { text: "Unlimited exports, no watermark" },
      { text: "3× AI editing usage" },
      { text: "Animated captions with emojis" },
      { text: "Music cut to the beat, auto-ducked" },
      { text: "Motion graphics, intros & titles" },
    ],
    limits: ai(3, null, 25),
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "For full-time creators & shops",
    monthly: 59,
    annual: 47,
    highlight: true,
    features: [
      { text: "Everything in Creator" },
      { text: "10× AI editing usage" },
      { text: "Brand kit: logo, colours, contact end cards" },
      { text: "Match the style of a reference video", soon: true },
      { text: "Stock B-roll for your story", soon: true },
      { text: "1,500 AI generation credits (video & images)", soon: true },
      { text: "4K export", soon: true },
    ],
    limits: ai(10, null, 100),
  },
  {
    id: "studio",
    name: "Studio",
    tagline: "For agencies and brands",
    monthly: 175,
    annual: 140,
    features: [
      { text: "Everything in Pro" },
      { text: "30× AI editing usage" },
      { text: "Priority rendering" },
      { text: "5,000 AI generation credits", soon: true },
      { text: "Voice-over in your own voice", soon: true },
      { text: "Team seats & shared projects", soon: true },
    ],
    limits: ai(30, null, 500),
  },
];
