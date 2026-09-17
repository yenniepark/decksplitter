import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { decodeEntities, parseXml } from '../src/worker/xml.ts';

describe('parseXml', () => {
  it('엘리먼트 · 속성 · 텍스트를 읽는다', () => {
    const root = parseXml('<a:p x="1" y=\'2\'><a:t>안녕</a:t></a:p>');
    assert.equal(root.tagName, 'a:p');
    assert.equal(root.localName, 'p');
    assert.equal(root.getAttribute('x'), '1');
    assert.equal(root.getAttribute('y'), '2');
    assert.equal(root.getAttribute('z'), null);
    assert.equal(root.textContent, '안녕');
  });

  it('XML 선언 · 주석 · CDATA 를 처리한다', () => {
    const root = parseXml(
      '<?xml version="1.0"?><!-- 주석 --><r><![CDATA[<raw & text>]]>tail</r>',
    );
    assert.equal(root.textContent, '<raw & text>tail');
  });

  it('DOCTYPE 을 건너뛰고 커스텀 엔티티를 확장하지 않는다', () => {
    const xml =
      '<!DOCTYPE r [<!ENTITY xxe "PWNED">]><r><a:t xmlns:a="x">&xxe;</a:t></r>';
    const root = parseXml(xml);
    // 엔티티를 확장하지 않으므로 원문 그대로 남는다 (XXE 불가).
    assert.equal(root.textContent, '&xxe;');
  });

  it('자기 종료 태그와 중첩을 처리한다', () => {
    const root = parseXml('<p><b/><c><d/></c></p>');
    assert.deepEqual(root.children.map((e) => e.tagName), ['b', 'c']);
    assert.equal(root.getElementsByTagName('d').length, 1);
  });

  it('getElementsByTagName 이 문서 순서를 지킨다', () => {
    const root = parseXml('<r><t>1</t><g><t>2</t></g><t>3</t></r>');
    assert.deepEqual(
      root.getElementsByTagName('t').map((e) => e.textContent),
      ['1', '2', '3'],
    );
  });

  it('child / path / firstDescendant 가 직계와 자손을 구분한다', () => {
    const root = parseXml('<r><a><b><c/></b></a></r>');
    assert.equal(root.child('b'), null);
    assert.notEqual(root.firstDescendant('b'), null);
    assert.notEqual(root.path('a', 'b', 'c'), null);
    assert.equal(root.path('a', 'c'), null);
  });

  it('짝이 맞지 않는 태그를 거부한다', () => {
    assert.throws(() => parseXml('<a><b></a></b>'), /짝이 맞지 않음/);
    assert.throws(() => parseXml('<a>'), /닫히지 않음/);
    assert.throws(() => parseXml('   '), /엘리먼트가 없음/);
  });

  it('루트가 여러 개면 거부한다', () => {
    assert.throws(() => parseXml('<a/><b/>'), /루트 엘리먼트가 여러 개/);
  });

  it('BOM 을 무시한다', () => {
    assert.equal(parseXml('﻿<r>x</r>').textContent, 'x');
  });
});

describe('decodeEntities', () => {
  it('이름 있는 엔티티와 숫자 엔티티를 해석한다', () => {
    assert.equal(decodeEntities('&lt;a&gt; &amp; &quot;b&quot; &apos;c&apos;'), '<a> & "b" \'c\'');
    assert.equal(decodeEntities('&#54620;&#xAE00;'), '한글');
  });

  it('알 수 없는 엔티티는 그대로 둔다', () => {
    assert.equal(decodeEntities('&unknown; &#xZZ;'), '&unknown; &#xZZ;');
  });
});
