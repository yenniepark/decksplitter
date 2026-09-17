import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { strToU8, zipSync } from 'fflate';

import { MAX_TOTAL_UNCOMPRESSED_BYTES } from '../src/constants.ts';
import {
  assertSafePath,
  readInventory,
  verifyActualSizes,
  ZipGuardError,
} from '../src/worker/zipGuard.ts';

describe('readInventory', () => {
  it('정상 ZIP 의 목록과 해제 후 크기를 읽는다', () => {
    const zip = zipSync({ 'a.txt': strToU8('hello'), 'dir/b.txt': strToU8('world!') });
    const inv = readInventory(zip);
    assert.deepEqual(inv.entries.map((e) => e.name).sort(), ['a.txt', 'dir/b.txt']);
    assert.equal(inv.totalUncompressed, 11);
  });

  it('ZIP 이 아니면 거부한다', () => {
    assert.throws(() => readInventory(strToU8('이건 ZIP 이 아닙니다')), ZipGuardError);
  });

  it('압축 폭탄(전체 압축률 초과)을 압축 해제 없이 막는다', () => {
    // 64MB 의 0 → deflate 로 수십 KB. 전체 압축률이 150:1 을 크게 넘는다.
    const bomb = zipSync({ 'bomb.bin': new Uint8Array(64 * 1024 * 1024) }, { level: 9 });
    assert.ok(bomb.byteLength < 1024 * 1024, '폭탄이 실제로 잘 압축되어야 테스트가 유효하다');
    assert.throws(() => readInventory(bomb), /압축률|ZIP 폭탄/);
  });

  it('선언된 해제 후 총 크기가 한도를 넘으면 막는다', () => {
    // 중앙 디렉터리의 uncompressedSize 만 거대하게 위조한다.
    const zip = zipSync({ 'a.bin': new Uint8Array(1024) });
    const forged = forgeCentralUncompressedSize(zip, MAX_TOTAL_UNCOMPRESSED_BYTES + 1);
    assert.throws(() => readInventory(forged), /총 크기|너무 큰 항목/);
  });
});

describe('verifyActualSizes', () => {
  it('한도 안의 결과는 통과시킨다', () => {
    assert.doesNotThrow(() => verifyActualSizes({ a: new Uint8Array(1024) }));
  });
});

describe('assertSafePath', () => {
  it('상위 경로 탈출을 거부한다', () => {
    assert.throws(() => assertSafePath('../etc/passwd'), /상위 경로/);
    assert.throws(() => assertSafePath('ppt/../../x'), /상위 경로/);
    assert.throws(() => assertSafePath('ppt\\..\\x'), /상위 경로/);
  });

  it('절대 경로를 거부한다', () => {
    assert.throws(() => assertSafePath('/etc/passwd'), /절대 경로/);
    assert.throws(() => assertSafePath('C:\\windows'), /절대 경로/);
  });

  it('NUL 이 섞인 이름을 거부한다', () => {
    assert.throws(() => assertSafePath('a\u0000b'), /허용되지 않는 문자/);
  });

  it('정상 경로는 통과시킨다', () => {
    assert.doesNotThrow(() => assertSafePath('ppt/media/image1.png'));
    assert.doesNotThrow(() => assertSafePath('ppt/slides/_rels/slide1.xml.rels'));
  });
});

/** 중앙 디렉터리 엔트리의 uncompressedSize 필드만 바꿔치기한다. */
function forgeCentralUncompressedSize(zip: Uint8Array, size: number): Uint8Array {
  const out = zip.slice();
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  for (let p = 0; p + 4 <= out.byteLength; p++) {
    if (view.getUint32(p, true) === 0x02014b50) {
      view.setUint32(p + 24, size >>> 0, true);
      // 4GB 를 넘는 값은 32비트에 담기지 않으므로 한도 바로 위 값으로 맞춘다.
      view.setUint32(p + 24, Math.min(size, 0xfffffffe), true);
      break;
    }
  }
  return out;
}
