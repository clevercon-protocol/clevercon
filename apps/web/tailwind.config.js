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
        // Soft, layered elevation for cards: a faint top highlight plus a wide,
        // low shadow. Calmer than a hard drop shadow.
        card: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 12px 34px -18px rgba(0,0,0,0.7)',
        pop: '0 1px 0 0 rgba(255,255,255,0.05) inset, 0 20px 50px -20px rgba(0,0,0,0.8)',
      },
    },
  },
  plugins: [],
};
