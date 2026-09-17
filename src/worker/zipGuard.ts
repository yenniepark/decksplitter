/**
 * 압축을 풀기 전에 ZIP 중앙 디렉터리(Central Directory)만 읽어서
 * 해제 후 크기를 미리 확인한다. (ZIP 폭탄 방어)
 *
 * fflate 의 unzip 은 호출 즉시 실제로 압축을 풀기 때문에, 그 전에
 * 여기서 선언된 크기를 검사하고 한도를 넘으면 아예 해제하지 않는다.
 * 선언된 크기가 거짓일 수 있으므로, 실제 해제 후에도 다시 검사한다
 * (verifyActualSizes 참고).
 */

import {
  MAX_ENTRIES,
  MAX_ENTRY_COMPRESSION_RATIO,
  MAX_ENTRY_UNCOMPRESSED_BYTES,
  MAX_TOTAL_COMPRESSION_RATIO,
  MAX_TOTAL_UNCOMPRESSED_BYTES,
  RATIO_CHECK_MIN_BYTES,
} from '../constants.ts';

const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_EOCD64_LOCATOR = 0x07064b50;
const SIG_CENTRAL = 0x02014b50;

export interface ZipEntryInfo {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number;
  /** 디렉터리 엔트리(이름이 `/` 로 끝남)인지. */
  isDirectory: boolean;
}

export interface ZipInventory {
  entries: ZipEntryInfo[];
  totalUncompressed: number;
}

export class ZipGuardError extends Error {}

/**
 * 중앙 디렉터리를 훑어 엔트리 목록과 해제 후 총 크기를 구한다.
 * 압축은 전혀 풀지 않는다.
 */
export function readInventory(data: Uint8Array): ZipInventory {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const eocd = findEocd(view, data.byteLength);

  let entryCount = view.getUint16(eocd + 10, true);
  let cdSize = view.getUint32(eocd + 12, true);
  let cdOffset = view.getUint32(eocd + 16, true);

  // ZIP64 인 경우 실제 값은 ZIP64 EOCD 에 있다.
  if (entryCount === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const z64 = findZip64Eocd(view, eocd);
    if (z64 !== null) {
      entryCount = safeU64(view, z64 + 32);
      cdSize = safeU64(view, z64 + 40);
      cdOffset = safeU64(view, z64 + 48);
    }
  }

  if (entryCount > MAX_ENTRIES) {
    throw new ZipGuardError(
      `ZIP 엔트리가 너무 많습니다 (${entryCount.toLocaleString('ko-KR')}개, 한도 ${MAX_ENTRIES.toLocaleString('ko-KR')}개).`,
    );
  }
  if (cdOffset + cdSize > data.byteLength) {
    throw new ZipGuardError('ZIP 중앙 디렉터리 위치가 파일 범위를 벗어납니다. 손상된 파일일 수 있습니다.');
  }

  const entries: ZipEntryInfo[] = [];
  let totalUncompressed = 0;
  let totalCompressed = 0;
  let p = cdOffset;

  for (let n = 0; n < entryCount; n++) {
    if (p + 46 > data.byteLength) {
      throw new ZipGuardError('ZIP 중앙 디렉터리가 잘려 있습니다. 손상된 파일일 수 있습니다.');
    }
    if (view.getUint32(p, true) !== SIG_CENTRAL) break;

    const method = view.getUint16(p + 10, true);
    let compressedSize = view.getUint32(p + 20, true);
    let uncompressedSize = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const nameStart = p + 46;
    const extraStart = nameStart + nameLen;

    if (extraStart + extraLen + commentLen > data.byteLength) {
      throw new ZipGuardError('ZIP 중앙 디렉터리가 잘려 있습니다. 손상된 파일일 수 있습니다.');
    }

    // ZIP64 확장 필드에서 실제 크기를 읽는다.
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      const z = readZip64Extra(view, extraStart, extraLen, uncompressedSize === 0xffffffff, compressedSize === 0xffffffff);
      if (z.uncompressed !== null) uncompressedSize = z.uncompressed;
      if (z.compressed !== null) compressedSize = z.compressed;
    }

    const name = decodeName(data.subarray(nameStart, nameStart + nameLen));
    assertSafePath(name);

    const isDirectory = name.endsWith('/');

    if (uncompressedSize > MAX_ENTRY_UNCOMPRESSED_BYTES) {
      throw new ZipGuardError(
        `압축 해제 후 너무 큰 항목이 있습니다: ${name} (${formatBytes(uncompressedSize)}, 한도 ${formatBytes(MAX_ENTRY_UNCOMPRESSED_BYTES)}).`,
      );
    }
    if (
      uncompressedSize >= RATIO_CHECK_MIN_BYTES &&
      compressedSize > 0 &&
      uncompressedSize / compressedSize > MAX_ENTRY_COMPRESSION_RATIO
    ) {
      throw new ZipGuardError(
        `비정상적인 압축률이 감지되었습니다: ${name} (${Math.round(uncompressedSize / compressedSize)}:1). ZIP 폭탄일 수 있어 중단합니다.`,
      );
    }

    totalUncompressed += uncompressedSize;
    totalCompressed += compressedSize;

    if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new ZipGuardError(
        `압축 해제 후 총 크기가 한도를 넘습니다 (${formatBytes(totalUncompressed)} 이상, 한도 ${formatBytes(MAX_TOTAL_UNCOMPRESSED_BYTES)}).`,
      );
    }

    entries.push({ name, compressedSize, uncompressedSize, compressionMethod: method, isDirectory });
    p = extraStart + extraLen + commentLen;
  }

  if (entries.length === 0) {
    throw new ZipGuardError('ZIP 안에 파일이 없습니다.');
  }

  const ratio = totalCompressed > 0 ? totalUncompressed / totalCompressed : 0;
  if (totalUncompressed >= RATIO_CHECK_MIN_BYTES && ratio > MAX_TOTAL_COMPRESSION_RATIO) {
    throw new ZipGuardError(
      `전체 압축률이 비정상적으로 높습니다 (${Math.round(ratio)}:1, 한도 ${MAX_TOTAL_COMPRESSION_RATIO}:1). ZIP 폭탄일 수 있어 중단합니다.`,
    );
  }

  return { entries, totalUncompressed };
}

/**
 * 실제로 해제된 데이터의 크기를 다시 검사한다.
 * 중앙 디렉터리에 적힌 크기는 위조될 수 있기 때문이다.
 */
export function verifyActualSizes(unzipped: Record<string, Uint8Array>): void {
  let total = 0;
  for (const [name, bytes] of Object.entries(unzipped)) {
    if (bytes.byteLength > MAX_ENTRY_UNCOMPRESSED_BYTES) {
      throw new ZipGuardError(
        `압축 해제 결과가 선언된 크기보다 큽니다: ${name} (${formatBytes(bytes.byteLength)}).`,
      );
    }
    total += bytes.byteLength;
    if (total > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new ZipGuardError(
        `압축 해제 결과 총 크기가 한도를 넘습니다 (${formatBytes(total)} 이상).`,
      );
    }
  }
}

/** `..` 상위 경로 탈출 / 절대 경로 / NUL 이 섞인 엔트리 이름을 거부한다. */
export function assertSafePath(name: string): void {
  if (name.includes('\0')) {
    throw new ZipGuardError('ZIP 항목 이름에 허용되지 않는 문자가 있습니다.');
  }
  if (name.startsWith('/') || name.startsWith('\\') || /^[a-zA-Z]:/.test(name)) {
    throw new ZipGuardError(`ZIP 항목 이름이 절대 경로입니다: ${name}`);
  }
  const parts = name.split(/[/\\]/);
  if (parts.includes('..')) {
    throw new ZipGuardError(`ZIP 항목 이름이 상위 경로를 참조합니다: ${name}`);
  }
}

function findEocd(view: DataView, length: number): number {
  // EOCD 는 최소 22바이트, 주석은 최대 65535바이트.
  const minStart = Math.max(0, length - 22 - 0xffff);
  for (let p = length - 22; p >= minStart; p--) {
    if (view.getUint32(p, true) === SIG_EOCD) return p;
  }
  throw new ZipGuardError('ZIP 형식이 아니거나 파일이 손상되었습니다 (EOCD 없음).');
}

function findZip64Eocd(view: DataView, eocd: number): number | null {
  const locator = eocd - 20;
  if (locator < 0 || view.getUint32(locator, true) !== SIG_EOCD64_LOCATOR) return null;
  const offset = safeU64(view, locator + 8);
  if (offset < 0 || offset + 56 > view.byteLength) return null;
  if (view.getUint32(offset, true) !== SIG_EOCD64) return null;
  return offset;
}

function readZip64Extra(
  view: DataView,
  start: number,
  length: number,
  wantUncompressed: boolean,
  wantCompressed: boolean,
): { uncompressed: number | null; compressed: number | null } {
  let p = start;
  const end = start + length;
  while (p + 4 <= end) {
    const headerId = view.getUint16(p, true);
    const size = view.getUint16(p + 2, true);
    if (headerId === 0x0001) {
      let q = p + 4;
      let uncompressed: number | null = null;
      let compressed: number | null = null;
      if (wantUncompressed && q + 8 <= end) {
        uncompressed = safeU64(view, q);
        q += 8;
      }
      if (wantCompressed && q + 8 <= end) {
        compressed = safeU64(view, q);
      }
      return { uncompressed, compressed };
    }
    p += 4 + size;
  }
  return { uncompressed: null, compressed: null };
}

function safeU64(view: DataView, offset: number): number {
  const value = view.getBigUint64(offset, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ZipGuardError('ZIP 크기 값이 처리 가능한 범위를 넘습니다.');
  }
  return Number(value);
}

const utf8 = new TextDecoder('utf-8');

function decodeName(bytes: Uint8Array): string {
  return utf8.decode(bytes);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 ? Math.round(v) : v.toFixed(1)}${units[i]}`;
}
