/**
 * 변환 파이프라인 (Worker 메시지 처리와 분리된 순수 로직).
 *
 * 입력 .pptx 여러 개 → 안전성 검사 → 필요한 파트만 해제 → Markdown + 미디어 →
 * 하나의 ZIP. 네트워크 요청은 어디에도 없다.
 */

import { unzipSync, zipSync, strToU8, type Unzipped } from 'fflate';

import { MAX_ENTRY_UNCOMPRESSED_BYTES, MAX_FILE_BYTES, MAX_FILES } from '../constants.ts';
import type { ConvertOptions, FileReport, InputFile } from '../types.ts';
import { convertPptx, type DeckResult } from './pptx.ts';
import { assertSafePath, readInventory, verifyActualSizes, ZipGuardError } from './zipGuard.ts';

export interface ConvertAllResult {
  zip: Uint8Array;
  zipName: string;
  reports: FileReport[];
}

export type ProgressFn = (ratio: number, message: string) => void;

export function convertAll(
  files: InputFile[],
  options: ConvertOptions,
  onProgress: ProgressFn,
): ConvertAllResult {

  if (files.length === 0) throw new Error('처리할 파일이 없습니다.');
  if (files.length > MAX_FILES) {
    throw new Error(`한 번에 처리할 수 있는 파일은 최대 ${MAX_FILES}개입니다.`);
  }

  const multi = files.length > 1;
  const zipEntries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
  const reports: FileReport[] = [];
  const usedFolders = new Set<string>();

  // 파일당 3단계(검사 → 해제 → 변환) + 마지막 ZIP 생성 1단계
  const totalSteps = files.length * 3 + 1;
  let step = 0;
  const advance = (message: string): void => {
    step++;
    onProgress(Math.min(step / totalSteps, 1), message);
  };

  for (const file of files) {
    const rawBase = stripExtension(file.name);
    const baseName = sanitizeBaseName(rawBase);
    const report: FileReport = {
      name: file.name,
      ok: false,
      slideCount: 0,
      mediaCount: { image: 0, audio: 0, video: 0 },
      warnings: [],
    };
    const stepsBefore = step;

    try {
      advance(`${file.name}: 안전성 검사 중`);

      if (file.buffer.byteLength > MAX_FILE_BYTES) {
        throw new Error(
          `파일이 너무 큽니다 (${formatBytes(file.buffer.byteLength)}, 한도 ${formatBytes(MAX_FILE_BYTES)}).`,
        );
      }

      const bytes = new Uint8Array(file.buffer);

      // (1) 압축을 풀기 전에 중앙 디렉터리로 해제 후 크기를 확인한다.
      readInventory(bytes);

      advance(`${file.name}: 압축 해제 중`);

      // (2) 필요한 파트(ppt/**)만 해제한다. 필터에서 한 번 더 크기와 경로를 막는다.
      const unzipped: Unzipped = unzipSync(bytes, {
        filter: (info) => {
          if (info.originalSize > MAX_ENTRY_UNCOMPRESSED_BYTES) {
            throw new ZipGuardError(`압축 해제 후 너무 큰 항목이 있습니다: ${info.name}`);
          }
          assertSafePath(info.name);
          return isNeededPart(info.name);
        },
      });

      // (3) 실제 해제 결과 크기 재검사 (선언된 크기가 거짓일 수 있다).
      verifyActualSizes(unzipped);

      advance(`${file.name}: 슬라이드 분석 중`);

      const deck: DeckResult = convertPptx(unzipped, rawBase, options);

      const folder = multi ? uniqueFolder(baseName, usedFolders) : '';
      const prefix = folder === '' ? '' : `${folder}/`;

      zipEntries[`${prefix}${baseName}.md`] = [strToU8(deck.markdown), { level: 6 }];

      for (const item of deck.media) {
        // 미디어는 대부분 이미 압축된 포맷이라 재압축하지 않는다(level 0).
        zipEntries[`${prefix}${item.folder}/${item.fileName}`] = [item.bytes, { level: 0 }];
        report.mediaCount[item.kind]++;
      }

      report.ok = true;
      report.slideCount = deck.slideCount;
      report.warnings = deck.warnings;
    } catch (err) {
      report.ok = false;
      report.error = messageOf(err);
      // 실패한 파일에 할당된 남은 단계만큼 진행률을 채운다.
      while (step < stepsBefore + 3) advance(`${file.name}: 건너뜀`);
    }

    reports.push(report);
  }

  if (Object.keys(zipEntries).length === 0) {
    throw new Error('변환에 성공한 파일이 없습니다. 파일별 오류 내용을 확인해 주세요.');
  }

  advance('ZIP 생성 중');
  const zipped = zipSync(zipEntries, { level: 6 });

  const zipName = multi
    ? `slidesplit-${timestamp()}.zip`
    : `${sanitizeBaseName(stripExtension(files[0]!.name))}.zip`;

  return { zip: zipped, zipName, reports };
}

/* -- 보조 ------------------------------------------------------------ */

/** 변환에 필요한 파트만 해제한다 (docProps · 테마 · 레이아웃 등은 제외). */
function isNeededPart(name: string): boolean {
  if (name.endsWith('/')) return false;
  if (name === 'ppt/presentation.xml') return true;
  if (name === 'ppt/_rels/presentation.xml.rels') return true;
  if (/^ppt\/slides\/slide\d+\.xml$/.test(name)) return true;
  if (/^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(name)) return true;
  if (/^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name)) return true;
  if (/^ppt\/notesSlides\/_rels\/notesSlide\d+\.xml\.rels$/.test(name)) return true;
  if (name.startsWith('ppt/media/')) return true;
  return false;
}

function stripExtension(name: string): string {
  const base = name.slice(name.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

/** ZIP 안의 파일/폴더 이름으로 안전한 문자열로 바꾼다. */
function sanitizeBaseName(name: string): string {
  const cleaned = name
    .split('')
    .map((ch) => (ch.charCodeAt(0) < 0x20 || '/\\:*?"<>|'.includes(ch) ? '_' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '_')
    .slice(0, 100)
    .trim();
  return cleaned.length > 0 ? cleaned : 'presentation';
}

function uniqueFolder(base: string, used: Set<string>): string {
  let name = base;
  let n = 2;
  while (used.has(name.toLowerCase())) {
    name = `${base} (${n})`;
    n++;
  }
  used.add(name.toLowerCase());
  return name;
}

function timestamp(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 ? Math.round(v) : v.toFixed(1)}${units[i]}`;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
