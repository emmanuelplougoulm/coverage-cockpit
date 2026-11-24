import { execFile } from 'node:child_process';
import { defineConfig, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';

/**
 * Relais de développement : en navigateur seul, l'UI appelle POST /__engine
 * avec les arguments en JSON ; on lance le même CLI que la coque Tauri
 * (arguments passés en tableau, sans shell). N'existe qu'en `vite dev`.
 */
function engineDevRelay(): Plugin {
  return {
    name: 'engine-dev-relay',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__engine', (req, res) => {
        let body = '';
        req.on('data', (c: Buffer) => (body += c.toString()));
        req.on('end', () => {
          let args: unknown;
          try {
            args = JSON.parse(body || '[]');
          } catch {
            args = null;
          }
          if (!Array.isArray(args) || !args.every((a) => typeof a === 'string')) {
            res.statusCode = 400;
            res.end('arguments attendus : tableau de chaînes');
            return;
          }
          // tsx directement (pas `pnpm engine`) : pnpm réécrit les arguments qui contiennent des sauts de ligne.
          execFile('./node_modules/.bin/tsx', ['src/engine/cli.ts', ...args], { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
            res.statusCode = err ? 500 : 200;
            res.end(err ? stderr.trim() || err.message : stdout);
          });
        });
      });
    },
  };
}

// Tauri attend un port fixe et ne doit pas masquer ses propres erreurs.
export default defineConfig({
  plugins: [vue(), engineDevRelay()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: { target: 'safari16', outDir: 'dist' },
});
