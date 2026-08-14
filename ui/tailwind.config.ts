import type { Config } from "tailwindcss";

/**
 * Kleuren verwijzen naar CSS-variabelen uit `app/globals.css` — dáár rebrand je.
 * De `<alpha-value>`-vorm houdt opacity-varianten (`bg-brand-900/40`) werkend.
 */
const scale = (name: string) =>
  Object.fromEntries(
    [50, 100, 200, 300, 400, 500, 600, 700, 800, 900].map((step) => [
      step,
      `rgb(var(--${name}-${step}) / <alpha-value>)`,
    ]),
  );

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: scale("brand"),
        accent: scale("accent"),
        alert: scale("alert"),
        surface: {
          DEFAULT: "rgb(var(--surface) / <alpha-value>)",
          muted: "rgb(var(--surface-muted) / <alpha-value>)",
          subtle: "rgb(var(--surface-subtle) / <alpha-value>)",
        },
        ink: {
          DEFAULT: "rgb(var(--ink) / <alpha-value>)",
          muted: "rgb(var(--ink-muted) / <alpha-value>)",
          subtle: "rgb(var(--ink-subtle) / <alpha-value>)",
        },
        // Triage-bakken: semantisch, bewust niet merkgebonden.
        bucket: {
          auto: "rgb(var(--bucket-auto) / <alpha-value>)",
          review: "rgb(var(--bucket-review) / <alpha-value>)",
          escalate: "rgb(var(--bucket-escalate) / <alpha-value>)",
        },
      },
      fontFamily: {
        display: ["var(--font-display)"],
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      boxShadow: {
        soft: "0 2px 8px -2px rgb(var(--ink) / 0.08), 0 1px 3px -1px rgb(var(--ink) / 0.06)",
        medium:
          "0 4px 16px -4px rgb(var(--ink) / 0.12), 0 2px 6px -2px rgb(var(--ink) / 0.08)",
        large:
          "0 12px 32px -8px rgb(var(--ink) / 0.18), 0 4px 12px -4px rgb(var(--ink) / 0.1)",
      },
      animation: {
        "fade-in": "fadeIn 0.3s ease-out",
        "slide-up": "slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
        "pulse-soft": "pulseSoft 2s ease-in-out infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        pulseSoft: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.6" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
