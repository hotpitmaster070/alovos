import type { Config } from "tailwindcss";
import defaultTheme from "tailwindcss/defaultTheme";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#0A0A0A",
        card: "#151515",
        line: "#222222",
        beige: "#D9C5A5",
        edge: "#333333",
        muted: "#666666",
      },
      fontFamily: {
        sans: ["var(--font-inter)", ...defaultTheme.fontFamily.sans],
        system: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"SF Pro Text"',
          "var(--font-inter)",
          ...defaultTheme.fontFamily.sans,
        ],
      },
      keyframes: {
        "sheet-up": {
          from: { transform: "translateY(100%)" },
          to: { transform: "translateY(0)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
      },
      animation: {
        "sheet-up": "sheet-up 420ms cubic-bezier(0.32, 0.72, 0, 1)",
        "fade-in": "fade-in 240ms ease-out",
      },
    },
  },
  plugins: [],
};
export default config;
