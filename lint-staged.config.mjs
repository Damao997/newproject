export default {
  'server/**/*.{ts,tsx}': () => 'npm run typecheck --prefix server',
  'server/prisma/schema.prisma': () => 'npm run check:naming --prefix server',
  'web/**/*.{ts,tsx}': () => 'npm run lint --prefix web',
}
