import type { Config } from "tailwindcss";

/**
 * Activant brand palette
 *   Dark Blue  #08163D   (primary surfaces, headings)
 *   Blue       #0017DE   (primary actions, focus)
 *   Light Blue #005DFE   (secondary / links)
 *   White      #F5F5F7   (page background)
 *   Black      #010715   (destructive / errors — no red exists in-brand)
 *   Green      #5AFF9C   (success / "ready" accents)
 *
 * Semantic token names are kept stable so existing components re-skin without
 * markup changes. Hairline/secondary neutrals are the brand Dark Blue at
 * reduced presence rather than new hues.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Raw brand swatches (use directly when you want an exact brand color)
        brand: {
          dark: "#08163D",
          blue: "#0017DE",
          light: "#005DFE",
          white: "#F5F5F7",
          black: "#010715",
          green: "#5AFF9C",
        },

        // Text hierarchy — Dark Blue and tints of it
        ink: {
          DEFAULT: "#08163D",
          soft: "#445069",
          faint: "#8a93a6",
        },
        paper: "#F5F5F7", // Activant White
        panel: "#ffffff",
        line: "rgb(8 22 61 / 0.12)", // Dark Blue hairline

        accent: {
          DEFAULT: "#0017DE", // Activant Blue
          soft: "#e7eafd", // pale tint of Activant Blue (backgrounds, pills)
          ink: "#08163D", // Activant Dark Blue (hover / strong text)
        },

        // Success / positive
        success: {
          DEFAULT: "#5AFF9C", // Activant Green
          ink: "#0b7a44", // darkened for legible text on light
        },

        // Attention / destructive. No red exists in the Activant palette, so we
        // use Activant Black and distinguish by weight, borders, and labels.
        flag: "#010715",
        flagsoft: "rgb(1 7 21 / 0.06)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      borderRadius: {
        DEFAULT: "6px",
      },
    },
  },
  plugins: [],
};

export default config;
