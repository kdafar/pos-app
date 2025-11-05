module.exports = {
  // Silence the "from" warning and ensure stable source mapping
  from: undefined,
  plugins: {
    // If you use nesting, put it BEFORE tailwind:
    // 'tailwindcss/nesting': {},
    tailwindcss: {},
    autoprefixer: {},
    // If you use imports, they must come first:
    // 'postcss-import': {},
  },
};
