import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { strToU8, unzipSync, zipSync } from 'fflate';

import type { ConvertOptions } from '../src/types.ts';
import { convertAll } from '../src/worker/pipeline.ts';
import {
  AUDIO_REL,
  buildPptx,
  fakeBytes,
  IMAGE_REL,
  mediaShape,
  para,
  picShape,
  tableShape,
  textShape,
  toArrayBuffer,
  VIDEO_REL,
  type DeckSpec,
} from './fixtures.ts';

const ALL_ON: ConvertOptions = {
  media: { images: true, audio: true, video: true },
  markdown: { slideTitles: true, separators: true, speakerNotes: true },
};

function options(patch: Partial<ConvertOptions['markdown']> = {}, media: Partial<ConvertOptions['media']> = {}): ConvertOptions {
  return {
    media: { ...ALL_ON.media, ...media },
    markdown: { ...ALL_ON.markdown, ...patch },
  };
}

interface RunResult {
  md: string;
  names: string[];
  files: Record<string, Uint8Array>;
  zipName: string;
  reports: ReturnType<typeof convertAll>['reports'];
}

function run(spec: DeckSpec, opts: ConvertOptions = ALL_ON, fileName = '발표 자료.pptx'): RunResult {
  const bytes = buildPptx(spec);
  const result = convertAll(
    [{ name: fileName, size: bytes.byteLength, buffer: toArrayBuffer(bytes) }],
    opts,
    () => {},
  );
  const files = unzipSync(result.zip);
  const names = Object.keys(files).sort();
  const mdName = names.find((n) => n.endsWith('.md'));
  return {
    md: mdName === undefined ? '' : new TextDecoder().decode(files[mdName]!),
    names,
    files,
    zipName: result.zipName,
    reports: result.reports,
  };
}

/* ── Markdown 본문 ───────────────────────────────────────────────── */

describe('Markdown 변환', () => {
  it('제목 · 글머리표 목록 · 중첩 수준을 유지한다', () => {
    const { md } = run({
      slides: [
        {
          shapes:
            textShape(2, para('첫 슬라이드'), 'title') +
            textShape(
              3,
              para('상위') + para('하위', '<a:pPr lvl="1"/>') + para('더 하위', '<a:pPr lvl="2"/>'),
              'body',
            ),
        },
      ],
    });

    assert.match(md, /^# 발표 자료$/m);
    assert.match(md, /^## 첫 슬라이드$/m);
    assert.match(md, /^- 상위$/m);
    assert.match(md, /^ {2}- 하위$/m);
    assert.match(md, /^ {4}- 더 하위$/m);
  });

  it('제목 도형 텍스트가 본문에 중복되지 않는다', () => {
    const { md } = run({
      slides: [{ shapes: textShape(2, para('유일한 제목'), 'title') }],
    });
    assert.equal(md.match(/유일한 제목/g)?.length, 1);
  });

  it('슬라이드 제목 옵션을 끄면 «슬라이드 N» 을 쓴다', () => {
    const { md } = run(
      { slides: [{ shapes: textShape(2, para('진짜 제목'), 'title') }] },
      options({ slideTitles: false }),
    );
    assert.match(md, /^## 슬라이드 1$/m);
    assert.doesNotMatch(md, /진짜 제목/);
  });

  it('제목 도형이 없으면 «슬라이드 N» 으로 대체한다', () => {
    const { md } = run({ slides: [{ shapes: textShape(2, para('본문만 있음')) }] });
    assert.match(md, /^## 슬라이드 1$/m);
    assert.match(md, /본문만 있음/);
  });

  it('구분선 옵션이 슬라이드 사이에만 --- 를 넣는다', () => {
    const spec: DeckSpec = {
      slides: [
        { shapes: textShape(2, para('A'), 'title') },
        { shapes: textShape(2, para('B'), 'title') },
        { shapes: textShape(2, para('C'), 'title') },
      ],
    };
    assert.equal(run(spec).md.match(/^---$/gm)?.length, 2);
    assert.equal(run(spec, options({ separators: false })).md.match(/^---$/gm), null);
  });

  it('발표자 노트를 인용문으로 붙이고, 끄면 빼놓는다', () => {
    const spec: DeckSpec = {
      slides: [{ shapes: textShape(2, para('제목'), 'title'), notes: '노트 첫 줄\n노트 둘째 줄' }],
    };
    const on = run(spec).md;
    assert.match(on, /^> \*\*발표자 노트\*\*$/m);
    assert.match(on, /^> 노트 첫 줄$/m);
    assert.match(on, /^> 노트 둘째 줄$/m);
    // 노트의 슬라이드 번호 플레이스홀더는 제외된다.
    assert.doesNotMatch(on, /^> 7$/m);

    assert.doesNotMatch(run(spec, options({ speakerNotes: false })).md, /발표자 노트/);
  });

  it('번호 매기기(buAutoNum)를 순번으로 출력한다', () => {
    const numbered = '<a:pPr><a:buAutoNum type="arabicPeriod"/></a:pPr>';
    const { md } = run({
      slides: [
        {
          shapes: textShape(
            2,
            para('첫째', numbered) + para('둘째', numbered) + para('셋째', numbered),
          ),
        },
      ],
    });
    assert.match(md, /^1\. 첫째$/m);
    assert.match(md, /^2\. 둘째$/m);
    assert.match(md, /^3\. 셋째$/m);
  });

  it('buNone 단락은 글머리표 없이 낸다', () => {
    const { md } = run({
      slides: [{ shapes: textShape(2, para('그냥 문단', '<a:pPr><a:buNone/></a:pPr>'), 'body') }],
    });
    assert.match(md, /^그냥 문단$/m);
  });

  it('굵게 · 기울임 서식을 유지한다', () => {
    const shapes = `<p:sp><p:nvSpPr><p:cNvPr id="2" name="s"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p>
<a:r><a:rPr b="1"/><a:t>굵게</a:t></a:r>
<a:r><a:rPr/><a:t> 와 </a:t></a:r>
<a:r><a:rPr i="1"/><a:t>기울임</a:t></a:r>
</a:p></p:txBody></p:sp>`;
    const { md } = run({ slides: [{ shapes }] });
    assert.match(md, /\*\*굵게\*\* 와 \*기울임\*/);
  });

  it('슬라이드 번호 · 날짜 · 바닥글 플레이스홀더를 건너뛴다', () => {
    const { md } = run({
      slides: [
        {
          shapes:
            textShape(2, para('본문'), 'body') +
            textShape(3, para('3'), 'sldNum') +
            textShape(4, para('2026-01-01'), 'dt') +
            textShape(5, para('회사 기밀'), 'ftr'),
        },
      ],
    });
    assert.match(md, /본문/);
    assert.doesNotMatch(md, /회사 기밀/);
    assert.doesNotMatch(md, /2026-01-01/);
  });

  it('마크다운 특수문자를 이스케이프한다', () => {
    const { md } = run({ slides: [{ shapes: textShape(2, para('a_b *c* [d] <e>')) }] });
    assert.match(md, /a\\_b \\\*c\\\* \\\[d\\\] \\<e\\>/);
  });
});

/* ── 표 ─────────────────────────────────────────────────────────── */

describe('표 변환', () => {
  it('a:tbl 을 마크다운 표로 바꾼다', () => {
    const { md } = run({
      slides: [
        {
          shapes: tableShape(2, [
            ['항목', '값'],
            ['A', '1'],
            ['B', '2'],
          ]),
        },
      ],
    });
    assert.match(md, /^\| 항목 \| 값 \|$/m);
    assert.match(md, /^\| --- \| --- \|$/m);
    assert.match(md, /^\| A \| 1 \|$/m);
    assert.match(md, /^\| B \| 2 \|$/m);
  });

  it('셀 안의 파이프를 이스케이프해 표가 깨지지 않게 한다', () => {
    const { md } = run({ slides: [{ shapes: tableShape(2, [['a|b'], ['c']]) }] });
    assert.match(md, /^\| a\\\|b \|$/m);
  });

  it('행마다 열 수가 달라도 폭을 맞춘다', () => {
    const { md } = run({ slides: [{ shapes: tableShape(2, [['a', 'b', 'c'], ['d']]) }] });
    assert.match(md, /^\| d \|  \|  \|$/m);
  });
});

/* ── 미디어 ─────────────────────────────────────────────────────── */

describe('미디어 추출', () => {
  const deck: DeckSpec = {
    slides: [
      { shapes: textShape(2, para('첫 장'), 'title') },
      { shapes: textShape(2, para('둘째 장'), 'title') },
      {
        shapes: picShape(2, 'rId1', '로고') + picShape(3, 'rId2', '도표'),
        rels: [
          { id: 'rId1', type: IMAGE_REL, target: '../media/image1.png' },
          { id: 'rId2', type: IMAGE_REL, target: '../media/image2.jpeg' },
        ],
      },
      {
        shapes:
          mediaShape(2, 'rId1', 'rId2', 'a:videoFile') + mediaShape(3, 'rId3', 'rId4', 'a:audioFile'),
        rels: [
          { id: 'rId1', type: IMAGE_REL, target: '../media/image3.png' },
          { id: 'rId2', type: VIDEO_REL, target: '../media/media1.mp4' },
          { id: 'rId3', type: IMAGE_REL, target: '../media/image4.png' },
          { id: 'rId4', type: AUDIO_REL, target: '../media/media2.mp3' },
        ],
      },
    ],
    media: {
      'image1.png': fakeBytes(64, 1),
      'image2.jpeg': fakeBytes(64, 2),
      'image3.png': fakeBytes(64, 3),
      'image4.png': fakeBytes(64, 4),
      'media1.mp4': fakeBytes(256, 5),
      'media2.mp3': fakeBytes(256, 6),
    },
  };

  it('slideNN_MM.ext 이름으로 폴더별로 저장한다', () => {
    // 번호는 슬라이드 XML 안에서 처음 참조된 순서를 따른다.
    // 동영상/오디오 도형은 p:nvPicPr(미디어 링크)가 p:blipFill(포스터 이미지)보다
    // 앞에 오므로 미디어가 먼저 번호를 받는다.
    const { names } = run(deck);
    assert.deepEqual(names, [
      '발표 자료.md',
      'audio/slide04_03.mp3',
      'images/slide03_01.png',
      'images/slide03_02.jpeg',
      'images/slide04_02.png',
      'images/slide04_04.png',
      'video/slide04_01.mp4',
    ].sort());
  });

  it('이미지를 상대경로로 본문에 삽입한다', () => {
    const { md } = run(deck);
    assert.match(md, /!\[로고\]\(images\/slide03_01\.png\)/);
    assert.match(md, /!\[도표\]\(images\/slide03_02\.jpeg\)/);
    assert.match(md, /\[동영상: [^\]]*\]\(video\/slide04_01\.mp4\)/);
    assert.match(md, /\[오디오: [^\]]*\]\(audio\/slide04_03\.mp3\)/);
  });

  it('추출한 바이트가 원본과 같다', () => {
    const { files } = run(deck);
    assert.deepEqual(files['images/slide03_01.png'], fakeBytes(64, 1));
    assert.deepEqual(files['video/slide04_01.mp4'], fakeBytes(256, 5));
  });

  it('미디어 옵션을 끄면 해당 종류를 빼놓는다', () => {
    const { names, md } = run(deck, options({}, { images: false }));
    assert.ok(!names.some((n) => n.startsWith('images/')));
    assert.ok(names.some((n) => n.startsWith('video/')));
    assert.doesNotMatch(md, /!\[/);

    const noMedia = run(deck, options({}, { images: false, audio: false, video: false }));
    assert.deepEqual(noMedia.names, ['발표 자료.md']);
  });

  it('외부 링크 미디어는 내려받지 않고 경고로 남긴다', () => {
    const { names, reports } = run({
      slides: [
        {
          shapes: picShape(2, 'rId1', '외부'),
          rels: [
            { id: 'rId1', type: IMAGE_REL, target: 'https://example.com/a.png', external: true },
          ],
        },
      ],
    });
    assert.deepEqual(names, ['발표 자료.md']);
    assert.match(reports[0]!.warnings.join('\n'), /외부 링크 미디어는 내려받지 않습니다/);
  });

  it('같은 미디어를 여러 rId 로 가리켜도 한 번만 저장한다', () => {
    const { names } = run({
      slides: [
        {
          shapes: mediaShape(2, 'rId1', 'rId2', 'a:videoFile'),
          rels: [
            { id: 'rId1', type: IMAGE_REL, target: '../media/poster.png' },
            { id: 'rId2', type: VIDEO_REL, target: '../media/clip.mp4' },
            { id: 'rId3', type: VIDEO_REL, target: '../media/clip.mp4' },
          ],
        },
      ],
      media: { 'poster.png': fakeBytes(32), 'clip.mp4': fakeBytes(64) },
    });
    assert.equal(names.filter((n) => n.endsWith('.mp4')).length, 1);
  });
});

/* ── 슬라이드 순서 · 여러 파일 ──────────────────────────────────── */

describe('슬라이드 순서', () => {
  it('파일 번호가 아니라 presentation.xml 의 sldIdLst 순서를 따른다', () => {
    const { md } = run({
      slides: [
        { shapes: textShape(2, para('원래 1번'), 'title') },
        { shapes: textShape(2, para('원래 2번'), 'title') },
        { shapes: textShape(2, para('원래 3번'), 'title') },
      ],
      slideOrder: [3, 1, 2],
    });
    const order = [...md.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    assert.deepEqual(order, ['원래 3번', '원래 1번', '원래 2번']);
  });
});

describe('여러 파일 처리', () => {
  const deck = buildPptx({ slides: [{ shapes: textShape(2, para('제목'), 'title') }] });

  it('파일이 하나면 ZIP 최상위에 평평하게 담는다', () => {
    const result = convertAll(
      [{ name: '하나.pptx', size: deck.byteLength, buffer: toArrayBuffer(deck) }],
      ALL_ON,
      () => {},
    );
    assert.equal(result.zipName, '하나.zip');
    assert.deepEqual(Object.keys(unzipSync(result.zip)), ['하나.md']);
  });

  it('파일이 여러 개면 파일별 폴더로 나눈다', () => {
    const result = convertAll(
      [
        { name: 'A.pptx', size: deck.byteLength, buffer: toArrayBuffer(deck) },
        { name: 'B.pptx', size: deck.byteLength, buffer: toArrayBuffer(deck) },
      ],
      ALL_ON,
      () => {},
    );
    assert.match(result.zipName, /^slidesplit-\d{8}-\d{4}\.zip$/);
    assert.deepEqual(Object.keys(unzipSync(result.zip)).sort(), ['A/A.md', 'B/B.md']);
  });

  it('이름이 같은 파일이 들어와도 폴더가 겹치지 않는다', () => {
    const result = convertAll(
      [
        { name: '같은이름.pptx', size: deck.byteLength, buffer: toArrayBuffer(deck) },
        { name: '같은이름.pptx', size: deck.byteLength, buffer: toArrayBuffer(deck) },
      ],
      ALL_ON,
      () => {},
    );
    assert.deepEqual(
      Object.keys(unzipSync(result.zip)).sort(),
      ['같은이름 (2)/같은이름.md', '같은이름/같은이름.md'].sort(),
    );
  });

  it('한 파일이 실패해도 나머지는 계속 변환한다', () => {
    const broken = zipSync({ 'nope.txt': strToU8('PPTX 아님') });
    const result = convertAll(
      [
        { name: '깨진.pptx', size: broken.byteLength, buffer: toArrayBuffer(broken) },
        { name: '정상.pptx', size: deck.byteLength, buffer: toArrayBuffer(deck) },
      ],
      ALL_ON,
      () => {},
    );
    assert.equal(result.reports[0]!.ok, false);
    assert.match(result.reports[0]!.error ?? '', /PPTX 구조가 아닙니다/);
    assert.equal(result.reports[1]!.ok, true);
    assert.ok(Object.keys(unzipSync(result.zip)).some((n) => n.endsWith('정상.md')));
  });

  it('모든 파일이 실패하면 오류를 던진다', () => {
    const broken = zipSync({ 'nope.txt': strToU8('x') });
    assert.throws(
      () =>
        convertAll(
          [{ name: '깨진.pptx', size: broken.byteLength, buffer: toArrayBuffer(broken) }],
          ALL_ON,
          () => {},
        ),
      /변환에 성공한 파일이 없습니다/,
    );
  });

  it('진행률이 0 에서 1 까지 단조 증가한다', () => {
    const seen: number[] = [];
    convertAll(
      [{ name: 'A.pptx', size: deck.byteLength, buffer: toArrayBuffer(deck) }],
      ALL_ON,
      (ratio) => seen.push(ratio),
    );
    assert.ok(seen.length > 0);
    assert.deepEqual(seen, [...seen].sort((a, b) => a - b));
    assert.equal(seen.at(-1), 1);
  });
});

describe('보고서', () => {
  it('슬라이드 수와 미디어 개수를 센다', () => {
    const { reports } = run({
      slides: [
        { shapes: textShape(2, para('A'), 'title') },
        {
          shapes: picShape(2, 'rId1'),
          rels: [{ id: 'rId1', type: IMAGE_REL, target: '../media/i.png' }],
        },
      ],
      media: { 'i.png': fakeBytes(16) },
    });
    assert.equal(reports[0]!.ok, true);
    assert.equal(reports[0]!.slideCount, 2);
    assert.deepEqual(reports[0]!.mediaCount, { image: 1, audio: 0, video: 0 });
  });
});
