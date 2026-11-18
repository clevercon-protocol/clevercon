/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: 'var(--cc-surface)',
        'surface-2': 'var(--cc-surface-2)',
        line: 'var(--cc-line)',
        'line-strong': 'var(--cc-line-strong)',
      },
      boxShadow: {
        // Soft, layered elevation for cards: a very faint top highlight plus a
        // wide, low shadow that does the separation the border used to. Calmer
        // than a hard drop shadow, and no grey outline.
        card: '0 1px 0 0 rgba(255,255,255,0.025) inset, 0 14px 40px -22px rgba(0,0,0,0.8)',
        pop: '0 1px 0 0 rgba(255,255,255,0.035) inset, 0 24px 60px -24px rgba(0,0,0,0.85)',
      },
    },
  },
  plugins: [],
};
