/**
 * Tailwind scan configuration for renderer components.
 *
 * Most visual changes happen in App.tsx via utility classes, so keep this list
 * aligned with any future src/ layout changes.
 */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
};
