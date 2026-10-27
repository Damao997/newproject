import path from 'node:path';
import process from 'node:process';
import { defineConfig, loadEnv } from 'vite-plus';
import { fmt, lint } from '@soybeanjs/oxc-config';
import { createViteProxy, getBuildTime } from './build/config';
import { setupVitePlugins } from './build/plugins';

export default defineConfig(configEnv => {
  const viteEnv = loadEnv(configEnv.mode, process.cwd()) as unknown as Env.ImportMeta;
  const serverEnv = loadEnv(configEnv.mode, path.resolve(process.cwd(), '../server'), '');
  const apiPort = Number(serverEnv.PORT || 3001);

  const buildTime = getBuildTime();

  const enableProxy = configEnv.command === 'serve' && !configEnv.isPreview;

  return {
    base: viteEnv.VITE_BASE_URL,
    staged: {
      '*': 'vp check --fix'
    },
    lint,
    fmt: {
      ...fmt,
      ignorePatterns: [
        'CHANGELOG.md',
        'src/typings/components.d.ts',
        'src/typings/elegant-router.d.ts',
        'src/router/elegant'
      ]
    },
    resolve: {
      tsconfigPaths: true
    },
    css: {
      preprocessorOptions: {
        scss: {
          api: 'modern-compiler',
          additionalData: `@use "@/styles/scss/global.scss" as *;`
        }
      }
    },
    plugins: setupVitePlugins(viteEnv, buildTime),
    define: {
      BUILD_TIME: JSON.stringify(buildTime)
    },
    server: {
      host: '0.0.0.0',
      port: 9527,
      open: false,
      proxy: {
        ...(createViteProxy(viteEnv, enableProxy) || {}),
        '/api': {
          target: `http://127.0.0.1:${apiPort}`,
          changeOrigin: true
        }
      }
    },
    preview: {
      port: 9725
    },
    build: {
      reportCompressedSize: false,
      sourcemap: viteEnv.VITE_SOURCE_MAP === 'Y',
      commonjsOptions: {
        ignoreTryCatch: false
      }
    }
  };
});
