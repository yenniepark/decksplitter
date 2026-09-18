/**
 * 빌드 산출물(dist/)이 정말로 오프라인인지 검사한다.
 *
 * 1. 네트워크 API 호출이 하나도 없어야 한다.
 * 2. 외부 출처(CDN 등)를 가리키는 script/link/img 태그가 없어야 한다.
 * 3. index.html 에 요구된 CSP 가 들어 있어야 한다.
 *
 * `npm run build` 뒤에 실행한다. 실패하면 0이 아닌 코드로 종료한다.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const DIST = 'dist';

/** 호출되면 네트워크로 나가는 API 들. */
const NETWORK_APIS = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'sendBeacon',
  'importScripts',
  'RTCPeerConnection',
  'SharedWorker',
  'navigator.connection',
  'serviceWorker',
];

/** CSP 에 반드시 들어 있어야 하는 지시어. */
const REQUIRED_CSP = ["default-src 'self'", "connect-src 'none'"];

const failures = [];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

let files;
try {
  files = walk(DIST);
} catch {
  console.error(`✗ ${DIST}/ 가 없습니다. 먼저 \`npm run build\` 를 실행하세요.`);
  process.exit(1);
}

const textFiles = files.filter((f) => /\.(html|js|css|mjs)$/.test(f));

// 1. 네트워크 API
for (const file of textFiles) {
  const source = readFileSync(file, 'utf8');
  for (const api of NETWORK_APIS) {
    // 식별자 경계를 지켜서 찾는다 (예: `prefetch` 는 `fetch` 가 아니다).
    const re = new RegExp(`(^|[^A-Za-z0-9_$.])${api.replace('.', '\\.')}\\s*[(.]`, 'g');
    const hit = re.exec(source);
    if (hit !== null) {
      const line = source.slice(0, hit.index).split('\n').length;
      failures.push(`${relative('.', file)}:${line} — 네트워크 API 사용: ${api}`);
    }
  }
}

// 2. 외부 출처 참조
const EXTERNAL_URL = /\b(?:src|href)\s*=\s*["'](https?:)?\/\/[^"']+/gi;
for (const file of textFiles) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(EXTERNAL_URL)) {
    failures.push(`${relative('.', file)} — 외부 출처 참조: ${match[0].slice(0, 80)}`);
  }
}

// 3. CSP
const html = files.filter((f) => f.endsWith('.html'));
if (html.length === 0) failures.push('dist/ 에 HTML 파일이 없습니다.');
for (const file of html) {
  const source = readFileSync(file, 'utf8');
  // 속성 값 안에 작은따옴표('self' 등)가 들어 있으므로 여는 따옴표를 역참조로 맞춘다.
  const csp =
    /<meta[^>]*http-equiv=["']Content-Security-Policy["'][^>]*content=(["'])([\s\S]*?)\1/i.exec(
      source,
    );
  if (csp === null) {
    failures.push(`${relative('.', file)} — CSP meta 태그가 없습니다.`);
    continue;
  }
  for (const directive of REQUIRED_CSP) {
    if (!csp[2].includes(directive)) {
      failures.push(`${relative('.', file)} — CSP 에 "${directive}" 가 없습니다.`);
    }
  }
}

if (failures.length > 0) {
  console.error('✗ 오프라인 검사 실패:\n');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(`✓ 오프라인 검사 통과 (${textFiles.length}개 파일: 네트워크 API 없음, 외부 출처 없음, CSP 확인)`);
