import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function resolveGitCommit() {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

export default defineConfig({
  define: {
    __APP_COMMIT__: JSON.stringify(resolveGitCommit()),
  },
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: [
      'survival.xn--vz0ba242ncqcba79xhwx.site',
      'helper.xn--vz0ba242ncqcba79xhwx.site',
      'app.xn--9y2br3k43n.kr',
      'localhost',
      '127.0.0.1',
    ],
  },
  preview: {
    host: '0.0.0.0',
    port: 3001,
    allowedHosts: [
      'survival.xn--vz0ba242ncqcba79xhwx.site',
      'helper.xn--vz0ba242ncqcba79xhwx.site',
      'app.xn--9y2br3k43n.kr',
      'localhost',
      '127.0.0.1',
    ],
  },
});
