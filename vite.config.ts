import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { jingguanApiPlugin } from './server/devApiPlugin';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  for (const [key, value] of Object.entries(env)) {
    process.env[key] ??= value;
  }

  return {
    plugins: [react(), jingguanApiPlugin()],
    server: {
      host: '127.0.0.1',
      port: 5173,
    },
  };
});
