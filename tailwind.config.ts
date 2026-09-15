import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        slate: { 50: "#f5f7f6", 100: "#eaf0ed", 200: "#d6e1dc", 300: "#b6c8bf", 400: "#91a99d", 500: "#526e61", 600: "#425b50", 700: "#30493e", 800: "#20382e", 900: "#13271f", 950: "#0b1913" },
      },
    },
  },
  plugins: [],
} satisfies Config;
