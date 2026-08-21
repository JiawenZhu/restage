// Tailwind 4 ships its PostCSS integration as its own package, and there is no
// tailwind.config.js any more — the theme lives in app/globals.css under @theme.
export default { plugins: { '@tailwindcss/postcss': {} } };
