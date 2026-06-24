/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Nourish brand palette
        sage: {
          50:  '#f6f8f4',
          100: '#eaf0e5',
          200: '#d0e0c7',
          300: '#afc8a2',
          400: '#86a97a',
          500: '#638c57',
          600: '#4d7042',
          700: '#3d5935',
          800: '#33492c',
          900: '#2b3d26',
        },
        cream: {
          50:  '#fdfcf8',
          100: '#f9f6ed',
          200: '#f2ead6',
          300: '#e8d9b5',
          400: '#dbc48e',
          500: '#ccae6e',
        },
        terracotta: {
          50:  '#fdf5f0',
          100: '#fae6d8',
          200: '#f4c9aa',
          400: '#c97b5a',
          500: '#b8622f',
          600: '#9c4f20',
          800: '#6b3214',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
    },
  },
  plugins: [],
}
