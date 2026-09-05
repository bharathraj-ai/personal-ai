/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#0c0f14",
          raised: "#151a22",
          border: "#2a3341",
          soft: "#1c2430",
        },
        ink: {
          DEFAULT: "#e8eef6",
          muted: "#9aa8b8",
          faint: "#6b7a8c",
        },
        accent: {
          DEFAULT: "#2eb8a0",
          muted: "#5dceb9",
          deep: "#1f8f7c",
        },
        warn: "#e6b35a",
        danger: "#e07a6a",
      },
      fontFamily: {
        display: ["var(--font-display)", "ui-sans-serif", "system-ui", "sans-serif"],
        sans: ["var(--font-body)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        glow: "0 0 40px rgba(46, 184, 160, 0.12)",
      },
      keyframes: {
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        pulseDot: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
      },
      animation: {
        "fade-up": "fadeUp 0.35s ease-out",
        "pulse-dot": "pulseDot 1.2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
