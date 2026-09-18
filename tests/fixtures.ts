/**
 * 테스트용 PPTX 를 코드로 만들어 낸다.
 * 저장소에 바이너리 픽스처를 두지 않기 위해 매번 조립한다.
 */

import { strToU8, zipSync } from 'fflate';

const NS = [
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"',
  'xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main"',
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"',
].join(' ');

const REL_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';
const REL_BASE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

export interface Rel {
  id: string;
  type: string;
  target: string;
  external?: boolean;
}

export interface SlideSpec {
  /** `p:spTree` 안에 들어갈 도형 XML. */
  shapes: string;
  rels?: Rel[];
  notes?: string;
}

export interface DeckSpec {
  slides: SlideSpec[];
  /** ppt/media 아래에 넣을 파일. */
  media?: Record<string, Uint8Array>;
  /** sldIdLst 순서를 뒤집는 등 커스터마이즈. 기본은 1..N 순서. */
  slideOrder?: number[];
}

export function slideXml(shapes: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld ${NS}><p:cSld><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr/>
${shapes}
</p:spTree></p:cSld></p:sld>`;
}

/** 텍스트 도형 하나. `ph` 를 주면 플레이스홀더가 된다. */
export function textShape(
  id: number,
  paragraphs: string,
  ph?: string,
  name = `Shape ${id}`,
): string {
  const phXml = ph === undefined ? '' : `<p:ph type="${ph}"/>`;
  return `<p:sp>
<p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr>${phXml}</p:nvPr></p:nvSpPr>
<p:spPr/>
<p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs}</p:txBody>
</p:sp>`;
}

/** 단순 단락. */
export function para(text: string, pPr = ''): string {
  return `<a:p>${pPr}<a:r><a:rPr lang="ko-KR"/><a:t>${escapeXml(text)}</a:t></a:r></a:p>`;
}

/** 이미지 도형. */
export function picShape(id: number, rId: string, descr = ''): string {
  return `<p:pic>
<p:nvPicPr><p:cNvPr id="${id}" name="Picture ${id}" descr="${escapeXml(descr)}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
<p:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr/>
</p:pic>`;
}

/** 오디오/동영상 도형 (포스터 이미지 + 미디어 링크). */
export function mediaShape(id: number, posterRId: string, mediaRId: string, tag: 'a:videoFile' | 'a:audioFile'): string {
  return `<p:pic>
<p:nvPicPr><p:cNvPr id="${id}" name="Media ${id}"/><p:cNvPicPr/>
<p:nvPr><${tag} r:link="${mediaRId}"/></p:nvPr></p:nvPicPr>
<p:blipFill><a:blip r:embed="${posterRId}"/><a:stretch/></p:blipFill>
<p:spPr/>
</p:pic>`;
}

/** 표 도형. rows[0] 이 머리글이 된다. */
export function tableShape(id: number, rows: string[][]): string {
  const trs = rows
    .map(
      (cells) =>
        `<a:tr h="370840">${cells
          .map((c) => `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>${para(c)}</a:txBody><a:tcPr/></a:tc>`)
          .join('')}</a:tr>`,
    )
    .join('');
  const gridCols = (rows[0] ?? []).map(() => '<a:gridCol w="3048000"/>').join('');
  return `<p:graphicFrame>
<p:nvGraphicFramePr><p:cNvPr id="${id}" name="Table ${id}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
<p:xfrm/>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
<a:tbl><a:tblPr firstRow="1"/><a:tblGrid>${gridCols}</a:tblGrid>${trs}</a:tbl>
</a:graphicData></a:graphic>
</p:graphicFrame>`;
}

export function notesXml(text: string): string {
  const paragraphs = text.split('\n').map((line) => para(line)).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes ${NS}><p:cSld><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr/>
${textShape(2, `${para('7')}`, 'sldNum')}
${textShape(3, paragraphs, 'body')}
</p:spTree></p:cSld></p:notes>`;
}

function relsXml(rels: Rel[]): string {
  const items = rels
    .map((r) => {
      const mode = r.external === true ? ' TargetMode="External"' : '';
      return `<Relationship Id="${r.id}" Type="${r.type}" Target="${escapeXml(r.target)}"${mode}/>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships ${REL_NS}>${items}</Relationships>`;
}

/** 완성된 .pptx 바이트를 돌려준다. */
export function buildPptx(spec: DeckSpec): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const count = spec.slides.length;
  const order = spec.slideOrder ?? spec.slides.map((_, i) => i + 1);

  const presRels: Rel[] = order.map((n, i) => ({
    id: `rId${i + 1}`,
    type: `${REL_BASE}/slide`,
    target: `slides/slide${n}.xml`,
  }));

  files['[Content_Types].xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`,
  );
  files['_rels/.rels'] = strToU8(
    relsXml([{ id: 'rId1', type: `${REL_BASE}/officeDocument`, target: 'ppt/presentation.xml' }]),
  );

  const sldIds = order
    .map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`)
    .join('');
  files['ppt/presentation.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation ${NS}><p:sldIdLst>${sldIds}</p:sldIdLst></p:presentation>`,
  );
  files['ppt/_rels/presentation.xml.rels'] = strToU8(relsXml(presRels));

  for (let i = 0; i < count; i++) {
    const slide = spec.slides[i]!;
    const n = i + 1;
    files[`ppt/slides/slide${n}.xml`] = strToU8(slideXml(slide.shapes));

    const rels: Rel[] = [...(slide.rels ?? [])];
    if (slide.notes !== undefined) {
      files[`ppt/notesSlides/notesSlide${n}.xml`] = strToU8(notesXml(slide.notes));
      rels.push({
        id: `rIdNotes${n}`,
        type: `${REL_BASE}/notesSlide`,
        target: `../notesSlides/notesSlide${n}.xml`,
      });
    }
    files[`ppt/slides/_rels/slide${n}.xml.rels`] = strToU8(relsXml(rels));
  }

  for (const [name, bytes] of Object.entries(spec.media ?? {})) {
    files[`ppt/media/${name}`] = bytes;
  }

  return zipSync(files, { level: 6 });
}

export const IMAGE_REL = `${REL_BASE}/image`;
export const VIDEO_REL = `${REL_BASE}/video`;
export const AUDIO_REL = `${REL_BASE}/audio`;
export const HYPERLINK_REL = `${REL_BASE}/hyperlink`;

export function fakeBytes(size: number, seed = 7): Uint8Array {
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i++) out[i] = (i * 31 + seed) & 0xff;
  return out;
}

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
