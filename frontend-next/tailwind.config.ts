import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        heading: ["Outfit", "Space Grotesk", "sans-serif"],
        body: ["Work Sans", "Manrope", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      colors: {
        brand: {
          blue: "#012169",
          darkblue: "#000c2b",
          red: "#C8102E",
          redHover: "#a90d26",
          slate: "#f8fafc",
          surface: "rgba(255, 255, 255, 0.92)",
          border: "#e2e8f0",
          text: "#0f172a",
          secondary: "#475569",
          muted: "#64748b",
        },
      },
      boxShadow: {
        glass: "0 20px 40px rgba(1, 33, 105, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.8)",
        glow: "0 10px 25px rgba(200, 16, 46, 0.25)",
        card: "0 10px 30px rgba(1, 33, 105, 0.06)",
      },
      backgroundImage: {
        "uk-gradient": "linear-gradient(135deg, #012169 0%, #000c2b 100%)",
        "red-gradient": "linear-gradient(135deg, #C8102E 0%, #a90d26 100%)",
        "mesh-pattern": "radial-gradient(circle at 10% 10%, rgba(1, 33, 105, 0.08), transparent 30%), radial-gradient(circle at 90% 90%, rgba(200, 16, 46, 0.06), transparent 35%), linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)",
      },
    },
  },
  plugins: [],
};
export default config;
