/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        navy: { 900: '#1F4E79', 700: '#2E75B6', 100: '#D6E4F0' },
        teal: { 600: '#1D9E75', 100: '#E1F5EE' }
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] }
    }
  },
  plugins: []
};
