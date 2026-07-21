import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          void:       "#080808",
          carbon:     "#0E0E0E",
          graphite:   "#161616",
          steel:      "#252525",
          blue:       "#3B9EE8",
          "blue-deep":"#1A6FB5",
          chrome:     "#C4C4C4",
          gold:       "#EF9F27",
        },
      },
      fontFamily: {
        body: ["var(--font-dm-sans)", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
