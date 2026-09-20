/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: ["./app/**/*.{js,jsx}", "./components/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#effaf3",
          100: "#d8f3e1",
          200: "#b3e6c8",
          300: "#81d2a7",
          400: "#4cb782",
          500: "#2a9d67",
          600: "#1c7e52",
          700: "#176544",
          800: "#155138",
          900: "#12432f",
          950: "#08251a",
        },
        gold: "#c9a227",
        ink: "#0c1512",
      },
      fontFamily: {
        script: ["var(--font-script)", "Georgia", "Times New Roman", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 3px rgba(12,21,18,0.08), 0 8px 24px rgba(12,21,18,0.06)",
      },
    },
  },
  plugins: [],
};
