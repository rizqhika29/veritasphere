import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        sphere: { 950: "#06071a", 900: "#0d1030", 700: "#3b2fb3", 400: "#8b7bff", 300: "#67e8f9" },
      },
    },
  },
  plugins: [],
};
export default config;
