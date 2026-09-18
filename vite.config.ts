import { defineConfig, type Plugin } from 'vite';

/**
 * 프로덕션 빌드 산출물 index.html 에 CSP meta 를 주입한다.
 *
 * 요구 정책: default-src 'self'; connect-src 'none'
 *  - connect-src 'none' 이므로 fetch / XHR / WebSocket / sendBeacon 이 전부 차단된다.
 *    (네트워크 요청 코드를 아예 작성하지 않지만, 런타임에서도 한 번 더 막는다.)
 *  - 개발 서버(vite dev)는 HMR 이 WebSocket 을 쓰기 때문에 dev 에서만 connect-src 를 완화한다.
 *    배포되는 dist/index.html 에는 항상 'none' 이 들어간다.
 */
const PROD_CSP = [
  "default-src 'self'",
  "connect-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const DEV_CSP = PROD_CSP.replace(
  "connect-src 'none'",
  "connect-src 'self' ws://localhost:* ws://127.0.0.1:*",
);

function cspPlugin(): Plugin {
  return {
    name: 'decksplitter-csp',
    transformIndexHtml: {
      order: 'pre',
      handler(_html, ctx) {
        const content = ctx.server ? DEV_CSP : PROD_CSP;
        return [
          {
            tag: 'meta',
            attrs: { 'http-equiv': 'Content-Security-Policy', content },
            injectTo: 'head-prepend' as const,
          },
        ];
      },
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [cspPlugin()],
  build: {
    target: 'es2022',
    // Vite 의 modulepreload 폴리필은 fetch() 로 청크를 미리 받아온다.
    // 네트워크 요청 코드를 남기지 않기 위해 끈다 (CSP connect-src 'none' 에서도 어차피 막힌다).
    modulePreload: { polyfill: false },
    // 모든 의존성(fflate 포함)을 번들에 인라인한다. CDN 사용 금지.
    rollupOptions: { external: [] },
    assetsInlineLimit: 0,
    sourcemap: false,
  },
  worker: {
    format: 'es',
  },
  server: {
    port: 5173,
  },
});
