/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}', '../frontend/src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        navy: { 900: '#123D68', 700: '#2F79AB', 100: '#DCECF8' },
        teal: { 600: '#169673', 100: '#DDF6ED' },
        ink: { 950: '#0F1E33', 900: '#10233A', 700: '#31465F', 500: '#6A7E93', 200: '#D7E2EE', 100: '#EDF4FA' },
        coral: { 500: '#DF6A4F', 100: '#FDE7E1' },
        sand: { 500: '#D79844', 100: '#FCF0D8' }
      },
      fontFamily: {
        sans: ['Manrope', 'system-ui', 'sans-serif'],
        display: ['"Space Grotesk"', 'Manrope', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace']
      },
      boxShadow: {
        soft: '0 18px 60px rgba(18, 40, 63, 0.08)',
        float: '0 28px 80px rgba(16, 35, 58, 0.12)',
        glow: '0 24px 60px rgba(20, 77, 128, 0.18)'
      }
    }
  },
  plugins: []
};
