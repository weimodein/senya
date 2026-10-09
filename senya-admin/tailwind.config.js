/** Tokens live in src/index.css as CSS variables; Tailwind only names them. */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        paper: v("paper"),
        card: v("card"),
        well: v("well"),
        ink: { DEFAULT: v("ink"), 2: v("ink-2"), 3: v("ink-3"), 4: v("ink-4") },
        rule: "rgb(var(--ink) / 0.10)",
        "rule-strong": "rgb(var(--ink) / 0.18)",
        clay: { DEFAULT: v("clay"), deep: v("clay-deep"), wash: v("clay-wash") },
        leaf: { DEFAULT: v("leaf"), wash: v("leaf-wash") },
        ochre: { DEFAULT: v("ochre"), wash: v("ochre-wash") },
        rust: { DEFAULT: v("rust"), wash: v("rust-wash") },
      },
      fontFamily: {
        sans: ['"Instrument Sans"', "system-ui", "sans-serif"],
        glyph: ['"Fraunces"', "Georgia", "serif"],
      },
      fontSize: {
        // 14px base, ~1.25 ratio
        caption: ["11px", { lineHeight: "16px", letterSpacing: "0.04em" }],
        meta: ["12px", "16px"],
        body: ["14px", "20px"],
        h3: ["16px", "22px"],
        h2: ["20px", { lineHeight: "26px", letterSpacing: "-0.01em" }],
        h1: ["26px", { lineHeight: "32px", letterSpacing: "-0.015em" }],
      },
      borderRadius: { sm: "6px", md: "10px", lg: "14px" },
      boxShadow: {
        lift: "0 0 0 1px rgb(var(--ink) / 0.07), 0 1px 2px -1px rgb(var(--ink) / 0.08), 0 2px 6px rgb(var(--ink) / 0.04)",
        float: "0 0 0 1px rgb(var(--ink) / 0.08), 0 8px 24px -6px rgb(var(--ink) / 0.18)",
      },
      transitionTimingFunction: { out: "cubic-bezier(0.23, 1, 0.32, 1)" },
    },
  },
  plugins: [],
};
