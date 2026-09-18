/**
 * PPTX(OOXML) → Markdown + 미디어 추출.
 *
 * 네트워크 접근은 전혀 하지 않는다. 외부 링크(TargetMode="External")로
 * 걸린 미디어는 내려받지 않고 경고로만 남긴다.
 */

import { AUDIO_EXTS, IMAGE_EXTS, VIDEO_EXTS } from '../constants.ts';
import type { ConvertOptions, MediaKind } from '../types.ts';
import { parseXml, type XmlElement } from './xml.ts';

export interface ExtractedMedia {
  kind: MediaKind;
  /** ZIP 안에 들어갈 폴더 이름. */
  folder: 'images' | 'audio' | 'video';
  /** `slide03_01.png` */
  fileName: string;
  bytes: Uint8Array;
}

export interface DeckResult {
  markdown: string;
  media: ExtractedMedia[];
  slideCount: number;
  warnings: string[];
}

const FOLDER_BY_KIND: Record<MediaKind, 'images' | 'audio' | 'video'> = {
  image: 'images',
  audio: 'audio',
  video: 'video',
};

const utf8 = new TextDecoder('utf-8');

/** 무시할 플레이스홀더 (슬라이드 번호 · 날짜 · 바닥글). */
const CHROME_PLACEHOLDERS = new Set(['sldNum', 'dt', 'ftr']);

const TITLE_PLACEHOLDERS = new Set(['title', 'ctrTitle']);

/** 자동 글머리표가 기본값인 플레이스홀더. */
const BULLET_PLACEHOLDERS = new Set(['body', 'subTitle', 'obj', 'tbl', 'chart', 'txBox']);

type ZipFiles = Record<string, Uint8Array>;

/* ────────────────────────────────────────────────────────────────── */

export function convertPptx(
  files: ZipFiles,
  deckTitle: string,
  options: ConvertOptions,
): DeckResult {
  const warnings: string[] = [];

  if (files['ppt/presentation.xml'] === undefined) {
    throw new Error('PPTX 구조가 아닙니다 (ppt/presentation.xml 없음).');
  }

  const slidePaths = resolveSlideOrder(files, warnings);
  if (slidePaths.length === 0) {
    throw new Error('슬라이드를 찾을 수 없습니다.');
  }

  const media: ExtractedMedia[] = [];
  const blocks: string[] = [];

  for (let index = 0; index < slidePaths.length; index++) {
    const slidePath = slidePaths[index]!;
    const slideNo = index + 1;
    const raw = files[slidePath];
    if (raw === undefined) continue;

    let slideRoot: XmlElement;
    try {
      slideRoot = parseXml(utf8.decode(raw));
    } catch (err) {
      warnings.push(`슬라이드 ${slideNo}: XML 을 읽지 못해 건너뜁니다 (${messageOf(err)}).`);
      blocks.push(renderHeading(slideNo, null, options));
      continue;
    }

    const rels = readRels(files, slidePath);
    const ctx: SlideContext = {
      files,
      rels,
      slideNo,
      slidePath,
      options,
      media,
      warnings,
      savedByRel: new Map(),
      savedByPath: new Map(),
      counter: { n: 0 },
    };

    const tree = slideRoot.firstDescendant('p:spTree');
    const body: string[] = [];
    let title: string | null = null;

    if (tree !== null) {
      const collected = walkShapes(tree, ctx);
      title = collected.title;
      body.push(...collected.blocks);
    }

    const parts: string[] = [renderHeading(slideNo, title, options)];
    parts.push(...body);

    if (options.markdown.speakerNotes) {
      const notes = readSpeakerNotes(files, rels, ctx);
      if (notes !== null && notes.length > 0) parts.push(notes);
    }

    blocks.push(parts.filter((s) => s.length > 0).join('\n\n'));
  }

  const separator = options.markdown.separators ? '\n\n---\n\n' : '\n\n';
  const markdown = `# ${escapeInline(deckTitle)}\n\n${blocks.join(separator)}\n`;

  return { markdown, media, slideCount: slidePaths.length, warnings };
}

/* ── 슬라이드 순서 ────────────────────────────────────────────────── */

/**
 * presentation.xml 의 `p:sldIdLst` 순서를 따른다. (파일 번호 순서와 다를 수 있다)
 * 실패하면 slideN.xml 의 숫자 순서로 되돌린다.
 */
function resolveSlideOrder(files: ZipFiles, warnings: string[]): string[] {
  const numeric = Object.keys(files)
    .filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
    .sort((a, b) => slideNumberOf(a) - slideNumberOf(b));

  try {
    const presRels = readRels(files, 'ppt/presentation.xml');
    const raw = files['ppt/presentation.xml'];
    if (raw === undefined) return numeric;
    const root = parseXml(utf8.decode(raw));
    const list = root.firstDescendant('p:sldIdLst');
    if (list === null) return numeric;

    const ordered: string[] = [];
    for (const sldId of list.childrenNamed('p:sldId')) {
      const rid = sldId.getAttribute('r:id');
      if (rid === null) continue;
      const rel = presRels.get(rid);
      if (rel === undefined || rel.external) continue;
      if (files[rel.path] !== undefined) ordered.push(rel.path);
    }
    if (ordered.length === 0) return numeric;

    // sldIdLst 에 빠진 슬라이드가 있으면 뒤에 붙인다.
    const seen = new Set(ordered);
    for (const p of numeric) if (!seen.has(p)) ordered.push(p);
    return ordered;
  } catch (err) {
    warnings.push(`슬라이드 순서를 확인하지 못해 파일 이름 순으로 처리합니다 (${messageOf(err)}).`);
    return numeric;
  }
}

function slideNumberOf(path: string): number {
  const m = /slide(\d+)\.xml$/.exec(path);
  return m === null ? 0 : Number(m[1]);
}

/* ── 관계(.rels) ─────────────────────────────────────────────────── */

interface RelTarget {
  /** ZIP 내부 정규화 경로. external 이면 원본 URL. */
  path: string;
  type: string;
  external: boolean;
}

function relsPathFor(partPath: string): string {
  const slash = partPath.lastIndexOf('/');
  const dir = slash < 0 ? '' : partPath.slice(0, slash + 1);
  const base = slash < 0 ? partPath : partPath.slice(slash + 1);
  return `${dir}_rels/${base}.rels`;
}

function readRels(files: ZipFiles, partPath: string): Map<string, RelTarget> {
  const out = new Map<string, RelTarget>();
  const raw = files[relsPathFor(partPath)];
  if (raw === undefined) return out;

  let root: XmlElement;
  try {
    root = parseXml(utf8.decode(raw));
  } catch {
    return out;
  }

  const slash = partPath.lastIndexOf('/');
  const baseDir = slash < 0 ? '' : partPath.slice(0, slash + 1);

  for (const rel of root.getElementsByTagName('Relationship')) {
    const id = rel.getAttribute('Id');
    const target = rel.getAttribute('Target');
    if (id === null || target === null) continue;
    const external = (rel.getAttribute('TargetMode') ?? '') === 'External';
    out.set(id, {
      type: rel.getAttribute('Type') ?? '',
      external,
      path: external ? target : resolveZipPath(baseDir, target),
    });
  }
  return out;
}

/** `ppt/slides/` + `../media/image1.png` → `ppt/media/image1.png` */
function resolveZipPath(baseDir: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const stack = baseDir.split('/').filter((s) => s.length > 0);
  for (const seg of target.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') stack.pop();
    else stack.push(seg);
  }
  return stack.join('/');
}

/* ── 슬라이드 순회 ───────────────────────────────────────────────── */

interface SlideContext {
  files: ZipFiles;
  rels: Map<string, RelTarget>;
  slideNo: number;
  slidePath: string;
  options: ConvertOptions;
  media: ExtractedMedia[];
  warnings: string[];
  /**
   * 같은 슬라이드에서 같은 미디어를 두 번 저장하지 않기 위한 캐시.
   * 키는 rId 와 ZIP 내부 경로 둘 다 쓴다 — 동영상은 `a:videoFile@r:link` 와
   * `p14:media@r:embed` 처럼 서로 다른 rId 가 같은 파일을 가리키는 경우가 있다.
   */
  savedByRel: Map<string, SavedMedia>;
  savedByPath: Map<string, SavedMedia>;
  counter: { n: number };
}

interface WalkResult {
  title: string | null;
  blocks: string[];
}

function walkShapes(tree: XmlElement, ctx: SlideContext): WalkResult {
  const blocks: string[] = [];
  let title: string | null = null;

  const visit = (node: XmlElement): void => {
    for (const child of node.children) {
      switch (child.tagName) {
        case 'p:sp': {
          const ph = placeholderTypeOf(child);
          if (ph !== null && CHROME_PLACEHOLDERS.has(ph)) break;
          const txBody = child.firstDescendant('p:txBody');
          if (txBody === null) break;
          if (ph !== null && TITLE_PLACEHOLDERS.has(ph) && title === null) {
            const text = plainText(txBody);
            if (text.length > 0) {
              title = text;
              break; // 제목은 본문에 중복 출력하지 않는다
            }
          }
          const rendered = renderTextBody(txBody, ph, ctx);
          if (rendered.length > 0) blocks.push(rendered);
          break;
        }
        case 'p:pic': {
          const rendered = renderPicture(child, ctx);
          if (rendered.length > 0) blocks.push(rendered);
          break;
        }
        case 'p:graphicFrame': {
          const tbl = child.firstDescendant('a:tbl');
          if (tbl !== null) {
            const rendered = renderTable(tbl, ctx.rels);
            if (rendered.length > 0) blocks.push(rendered);
            break;
          }
          // 차트 · 다이어그램 등은 이름만 남긴다.
          const label = shapeNameOf(child);
          if (label !== null) blocks.push(`> (${escapeInline(label)})`);
          break;
        }
        case 'p:grpSp':
          visit(child);
          break;
        case 'mc:AlternateContent': {
          const branch = child.child('mc:Choice') ?? child.child('mc:Fallback');
          if (branch !== null) visit(branch);
          break;
        }
        default:
          break;
      }
    }
  };

  visit(tree);
  return { title, blocks };
}

function placeholderTypeOf(sp: XmlElement): string | null {
  const ph = sp.firstDescendant('p:ph');
  if (ph === null) return null;
  // `type` 생략 시 기본값은 body 다 (ECMA-376).
  return ph.getAttribute('type') ?? 'body';
}

function shapeNameOf(el: XmlElement): string | null {
  const cNvPr = el.firstDescendant('p:cNvPr');
  if (cNvPr === null) return null;
  const name = cNvPr.getAttribute('name');
  return name !== null && name.length > 0 ? name : null;
}

/* ── 텍스트 ──────────────────────────────────────────────────────── */

type BulletMode = 'none' | 'bullet' | 'number';

interface Paragraph {
  level: number;
  bullet: BulletMode;
  /** 이미 마크다운 이스케이프가 끝난 텍스트. */
  text: string;
}

function renderTextBody(txBody: XmlElement, placeholder: string | null, ctx: SlideContext): string {
  const defaultBullet: BulletMode =
    placeholder !== null && BULLET_PLACEHOLDERS.has(placeholder) ? 'bullet' : 'none';

  const paragraphs = readParagraphs(txBody, defaultBullet, ctx.rels);
  return paragraphsToMarkdown(paragraphs);
}

function readParagraphs(
  txBody: XmlElement,
  defaultBullet: BulletMode,
  rels: Map<string, RelTarget>,
): Paragraph[] {
  const out: Paragraph[] = [];

  for (const p of txBody.childrenNamed('a:p')) {
    const pPr = p.child('a:pPr');
    const level = clampLevel(pPr?.getAttribute('lvl'));
    const bullet = bulletModeOf(pPr, defaultBullet);
    const text = renderRuns(p, rels);

    if (text.length === 0) continue;

    out.push({ level, bullet, text });
  }
  return out;
}

function clampLevel(value: string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.trunc(n), 8);
}

function bulletModeOf(pPr: XmlElement | null | undefined, fallback: BulletMode): BulletMode {
  if (pPr === null || pPr === undefined) return fallback;
  if (pPr.child('a:buNone') !== null) return 'none';
  if (pPr.child('a:buAutoNum') !== null) return 'number';
  if (pPr.child('a:buChar') !== null) return 'bullet';
  return fallback;
}

/** 런(a:r)을 이어붙여 인라인 마크다운을 만든다. 굵게/기울임/하이퍼링크 유지. */
function renderRuns(p: XmlElement, rels: Map<string, RelTarget>): string {
  let out = '';

  for (const node of p.children) {
    switch (node.tagName) {
      case 'a:r':
      case 'a:fld': {
        const t = node.child('a:t');
        if (t === null) break;
        const raw = t.textContent;
        if (raw.length === 0) break;
        out += decorateRun(raw, node.child('a:rPr'), rels);
        break;
      }
      case 'a:br':
        out += '\n';
        break;
      default:
        break;
    }
  }

  // 줄 안의 공백 정리 (OOXML 은 줄바꿈을 a:br 로만 표현한다)
  return out
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function decorateRun(raw: string, rPr: XmlElement | null, rels: Map<string, RelTarget>): string {
  let text = escapeInline(raw);
  const leading = /^\s*/.exec(raw)![0];
  const trailing = /\s*$/.exec(raw)![0];
  const core = text.slice(leading.length, text.length - trailing.length);

  if (core.length === 0) return text;

  let decorated = core;
  if (rPr !== null) {
    if (rPr.getAttribute('b') === '1') decorated = `**${decorated}**`;
    if (rPr.getAttribute('i') === '1') decorated = `*${decorated}*`;

    const link = rPr.child('a:hlinkClick');
    const rid = link?.getAttribute('r:id') ?? null;
    if (rid !== null) {
      const rel = rels.get(rid);
      // 외부 URL 은 텍스트로만 기록한다 — 앱이 직접 요청하지는 않는다.
      if (rel !== undefined && rel.external && rel.path.length > 0) {
        decorated = `[${decorated}](${encodeMarkdownUrl(rel.path)})`;
      }
    }
  }
  text = leading + decorated + trailing;
  return text;
}

function paragraphsToMarkdown(paragraphs: Paragraph[]): string {
  const lines: string[] = [];
  const counters: number[] = [];

  for (const para of paragraphs) {
    const indent = '  '.repeat(para.level);
    const [first, ...rest] = para.text.split('\n');

    if (para.bullet === 'number') {
      counters.length = para.level + 1;
      counters[para.level] = (counters[para.level] ?? 0) + 1;
      lines.push(`${indent}${counters[para.level]}. ${escapeLineStart(first ?? '')}`);
    } else if (para.bullet === 'bullet') {
      counters.length = 0;
      lines.push(`${indent}- ${escapeLineStart(first ?? '')}`);
    } else {
      counters.length = 0;
      lines.push(para.level > 0 ? `${indent}${escapeLineStart(first ?? '')}` : escapeLineStart(first ?? ''));
    }

    // a:br 로 나뉜 추가 줄은 같은 항목 안에서 줄바꿈으로 이어붙인다.
    const contIndent = para.bullet === 'none' ? indent : `${indent}  `;
    for (const line of rest) {
      lines[lines.length - 1] += '  ';
      lines.push(`${contIndent}${escapeLineStart(line)}`);
    }

    if (para.bullet === 'none') lines.push('');
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function plainText(txBody: XmlElement): string {
  const parts: string[] = [];
  for (const t of txBody.getElementsByTagName('a:t')) parts.push(t.textContent);
  return parts.join('').replace(/\s+/g, ' ').trim();
}

/* ── 표 ─────────────────────────────────────────────────────────── */

function renderTable(tbl: XmlElement, rels: Map<string, RelTarget>): string {
  const rows: string[][] = [];
  let width = 0;

  for (const tr of tbl.childrenNamed('a:tr')) {
    const cells: string[] = [];
    for (const tc of tr.childrenNamed('a:tc')) {
      // 병합된 뒤쪽 셀은 빈 칸으로 둔다 (마크다운 표에 병합 개념이 없다).
      if (tc.getAttribute('hMerge') === '1' || tc.getAttribute('vMerge') === '1') {
        cells.push('');
      } else {
        const txBody = tc.child('a:txBody');
        cells.push(txBody === null ? '' : cellText(txBody, rels));
      }
      const span = Number(tc.getAttribute('gridSpan') ?? '1');
      if (Number.isFinite(span) && span > 1) {
        for (let k = 1; k < span; k++) cells.push('');
      }
    }
    width = Math.max(width, cells.length);
    rows.push(cells);
  }

  if (rows.length === 0 || width === 0) return '';

  const pad = (cells: string[]): string =>
    `| ${Array.from({ length: width }, (_, i) => cells[i] ?? '').join(' | ')} |`;

  const header = rows[0]!;
  const out = [pad(header), `| ${Array.from({ length: width }, () => '---').join(' | ')} |`];
  for (let r = 1; r < rows.length; r++) out.push(pad(rows[r]!));
  return out.join('\n');
}

function cellText(txBody: XmlElement, rels: Map<string, RelTarget>): string {
  const parts: string[] = [];
  for (const p of txBody.childrenNamed('a:p')) {
    const text = renderRuns(p, rels);
    if (text.length > 0) parts.push(text);
  }
  // `|` 는 escapeInline 에서 이미 이스케이프된다. 줄바꿈만 <br> 로 바꾼다.
  return parts.join('\n').split('\n').join('<br>');
}

/* ── 미디어 ─────────────────────────────────────────────────────── */

function renderPicture(pic: XmlElement, ctx: SlideContext): string {
  const out: string[] = [];
  const alt = pictureAltOf(pic);
  // 같은 도형이 같은 파일을 여러 rId 로 가리킬 수 있다. 본문에는 한 번만 넣는다.
  const emitted = new Set<string>();

  for (const rid of collectMediaRefs(pic)) {
    const saved = saveMedia(rid, ctx);
    if (saved === null) continue;
    if (emitted.has(saved.fileName)) continue;
    emitted.add(saved.fileName);

    const relPath = `${saved.folder}/${saved.fileName}`;
    if (saved.kind === 'image') {
      out.push(`![${escapeInline(alt ?? `슬라이드 ${ctx.slideNo} 이미지`)}](${encodeMarkdownUrl(relPath)})`);
    } else {
      const label = saved.kind === 'audio' ? '오디오' : '동영상';
      out.push(`[${label}: ${escapeInline(alt ?? saved.fileName)}](${encodeMarkdownUrl(relPath)})`);
    }
  }

  return out.join('\n\n');
}

/**
 * `p:pic` 안에서 참조하는 모든 미디어 관계 ID 를 문서 순서로 모은다.
 * - `a:blip@r:embed` : 이미지 (동영상일 경우 포스터 프레임)
 * - `a:videoFile` / `a:audioFile` / `p14:media` : 오디오 · 동영상
 */
function collectMediaRefs(pic: XmlElement): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (rid: string | null): void => {
    if (rid === null || rid.length === 0 || seen.has(rid)) return;
    seen.add(rid);
    out.push(rid);
  };

  for (const el of pic.getElementsByTagName('*')) {
    switch (el.tagName) {
      case 'a:blip':
        push(el.getAttribute('r:embed'));
        break;
      case 'a:videoFile':
      case 'a:audioFile':
      case 'a:quickTimeFile':
      case 'a:wavAudioFile':
      case 'p14:media':
        push(el.getAttribute('r:embed'));
        push(el.getAttribute('r:link'));
        break;
      default:
        break;
    }
  }
  return out;
}

function pictureAltOf(pic: XmlElement): string | null {
  const cNvPr = pic.firstDescendant('p:cNvPr');
  if (cNvPr === null) return null;
  const descr = cNvPr.getAttribute('descr');
  if (descr !== null && descr.trim().length > 0) return descr.trim();
  const name = cNvPr.getAttribute('name');
  if (name !== null && name.trim().length > 0) return name.trim();
  return null;
}

interface SavedMedia {
  kind: MediaKind;
  folder: 'images' | 'audio' | 'video';
  fileName: string;
}

function saveMedia(rid: string, ctx: SlideContext): SavedMedia | null {
  const cached = ctx.savedByRel.get(rid);
  if (cached !== undefined) return cached;

  const rel = ctx.rels.get(rid);
  if (rel === undefined) return null;

  if (rel.external) {
    ctx.warnings.push(
      `슬라이드 ${ctx.slideNo}: 외부 링크 미디어는 내려받지 않습니다 (${rel.path}).`,
    );
    return null;
  }

  const byPath = ctx.savedByPath.get(rel.path);
  if (byPath !== undefined) {
    ctx.savedByRel.set(rid, byPath);
    return byPath;
  }

  const ext = extensionOf(rel.path);
  const kind = kindOfExtension(ext);
  if (kind === null) return null;
  if (!isKindEnabled(kind, ctx.options)) return null;

  const bytes = ctx.files[rel.path];
  if (bytes === undefined) {
    ctx.warnings.push(`슬라이드 ${ctx.slideNo}: 미디어를 찾을 수 없습니다 (${rel.path}).`);
    return null;
  }

  ctx.counter.n++;
  const fileName = `slide${pad2(ctx.slideNo)}_${pad2(ctx.counter.n)}.${ext}`;
  const folder = FOLDER_BY_KIND[kind];

  ctx.media.push({ kind, folder, fileName, bytes });

  const saved: SavedMedia = { kind, folder, fileName };
  ctx.savedByRel.set(rid, saved);
  ctx.savedByPath.set(rel.path, saved);
  return saved;
}

function isKindEnabled(kind: MediaKind, options: ConvertOptions): boolean {
  if (kind === 'image') return options.media.images;
  if (kind === 'audio') return options.media.audio;
  return options.media.video;
}

function kindOfExtension(ext: string): MediaKind | null {
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (VIDEO_EXTS.has(ext)) return 'video';
  return null;
}

function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  if (dot < 0) return '';
  return base.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/* ── 발표자 노트 ─────────────────────────────────────────────────── */

const NOTES_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide';

function readSpeakerNotes(
  files: ZipFiles,
  rels: Map<string, RelTarget>,
  ctx: SlideContext,
): string | null {
  let notesPath: string | null = null;
  for (const rel of rels.values()) {
    if (rel.type === NOTES_REL_TYPE && !rel.external) {
      notesPath = rel.path;
      break;
    }
  }
  if (notesPath === null) return null;

  const raw = files[notesPath];
  if (raw === undefined) return null;

  let root: XmlElement;
  try {
    root = parseXml(utf8.decode(raw));
  } catch (err) {
    ctx.warnings.push(`슬라이드 ${ctx.slideNo}: 발표자 노트를 읽지 못했습니다 (${messageOf(err)}).`);
    return null;
  }

  const tree = root.firstDescendant('p:spTree');
  if (tree === null) return null;

  const chunks: string[] = [];
  for (const sp of tree.childrenNamed('p:sp')) {
    const ph = placeholderTypeOf(sp);
    if (ph !== null && CHROME_PLACEHOLDERS.has(ph)) continue;
    const txBody = sp.firstDescendant('p:txBody');
    if (txBody === null) continue;
    for (const p of txBody.childrenNamed('a:p')) {
      const text = renderRuns(p, rels);
      if (text.length > 0) chunks.push(text);
    }
  }
  if (chunks.length === 0) return null;

  const quoted = chunks
    .join('\n')
    .split('\n')
    .map((line) => `> ${escapeLineStart(line)}`)
    .join('\n');
  return `> **발표자 노트**\n>\n${quoted}`;
}

/* ── 마크다운 보조 ───────────────────────────────────────────────── */

function renderHeading(slideNo: number, title: string | null, options: ConvertOptions): string {
  if (options.markdown.slideTitles && title !== null && title.length > 0) {
    return `## ${escapeInline(title)}`;
  }
  return `## 슬라이드 ${slideNo}`;
}

/** 마크다운 인라인 문법으로 해석될 문자를 이스케이프한다. */
export function escapeInline(text: string): string {
  return text.replace(/([\\`*_[\]<>|])/g, '\\$1');
}

/** 줄 첫머리에서만 의미가 생기는 문자를 이스케이프한다. */
function escapeLineStart(line: string): string {
  return line.replace(/^(\s*)([#>+=-]|\d+[.)])(\s)/, '$1\\$2$3');
}

/** 마크다운 링크 대상으로 안전한 형태로 만든다. */
function encodeMarkdownUrl(url: string): string {
  return url.replace(/[ ()<>]/g, (c) => encodeURIComponent(c));
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
