import { defineConfig } from '../../../../define-config';

export default defineConfig([
  { build: { command: 'bun run build', retries: 2 }, name: 'project' },
]);
