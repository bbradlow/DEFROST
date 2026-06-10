import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "#16181d",
          soft: "#3a3f4b",
          faint: "#6b7280",
        },
        paper: "#fbfaf7",
        panel: "#ffffff",
        line: "#e7e4dd",
        accent: {
          DEFAULT: "#1f5d50", // deep teal-green: "outbound / go" signal
          soft: "#e6f0ed",
          ink: "#0f3a31",
        },
        flag: "#b4471f", // terracotta: validation problems / attention
        flagsoft: "#f7e9e2",
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
