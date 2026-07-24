export default {
  'server/**/*.{ts,tsx}': () => 'npm run typecheck --prefix server',
  'web/**/*.{ts,tsx}': () => 'npm run lint --prefix web',
}
