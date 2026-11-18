import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Vite adds crossorigin to module scripts, which can silently fail same-origin
// loads on some localhost setups (blank page). Strip it, matching the dashboard.
function removeCrossorigin(): Plugin {
  return {
    name: 'remove-crossorigin',
    transformIndexHtml(html: string) {
      return html.replace(/ crossorigin(?:="[^"]*")?/g, '');
    },
  };
}

export default defineConfig({
  plugins: [react(), removeCrossorigin()],
  // @stellar/stellar-sdk and the wallet kit reference `global` in a few places.
  define: { global: 'globalThis' },
  server: { port: 5173 },
});
