/**
 * PostCSS pipeline used by Vite.
 *
 * Tailwind expands utility classes first; autoprefixer then adds browser-safe
 * vendor prefixes for the Electron renderer.
 */
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
