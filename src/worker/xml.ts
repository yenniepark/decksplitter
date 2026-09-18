/**
 * 최소 XML → DOM 파서.
 *
 * ── 왜 DOMParser 를 직접 쓰지 않는가 ──────────────────────────────
 * `DOMParser` 는 `Window` 에만 노출되는 API 라서 Web Worker 안에서는
 * 사용할 수 없다 (`WorkerGlobalScope` 에 없다). "처리는 Worker 에서"와
 * "DOMParser 로 XML 파싱"을 동시에 만족시킬 수 없으므로, Worker 안에서
 * 동일한 호출 형태(`getElementsByTagName` / `getAttribute` / `textContent`)를
 * 제공하는 파서를 직접 구현했다. 외부 의존성 없이 번들에 포함된다.
 *
 * OOXML 은 기계가 생성한 XML 이므로 DTD·커스텀 엔티티·네임스페이스 재정의
 * 같은 기능은 지원하지 않는다. 태그 이름은 접두사를 포함한 원문 그대로
 * (`a:t`, `p:sp`) 비교한다 — PPTX 는 접두사를 고정해서 쓴다.
 *
 * 보안: `<!DOCTYPE>` 은 파싱하지 않고 통째로 건너뛰며, 커스텀 엔티티를
 * 전혀 확장하지 않는다. (XXE / billion-laughs 류가 성립하지 않는다.)
 */

export class XmlElement {
  readonly tagName: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly childNodes: Array<XmlElement | string> = [];
  parent: XmlElement | null = null;

  constructor(tagName: string, attributes: Record<string, string>) {
    this.tagName = tagName;
    this.attributes = attributes;
  }

  /** 접두사를 제외한 이름. `a:t` → `t` */
  get localName(): string {
    const i = this.tagName.indexOf(':');
    return i < 0 ? this.tagName : this.tagName.slice(i + 1);
  }

  /** 자식 엘리먼트만 (문서 순서). */
  get children(): XmlElement[] {
    const out: XmlElement[] = [];
    for (const n of this.childNodes) if (typeof n !== 'string') out.push(n);
    return out;
  }

  /** 하위 모든 텍스트 노드를 이어붙인 값. */
  get textContent(): string {
    let out = '';
    for (const n of this.childNodes) out += typeof n === 'string' ? n : n.textContent;
    return out;
  }

  getAttribute(name: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.attributes, name)
      ? this.attributes[name]!
      : null;
  }

  /** 자손 전체를 문서 순서로 검색한다. `'*'` 는 전부. */
  getElementsByTagName(name: string): XmlElement[] {
    const out: XmlElement[] = [];
    const all = name === '*';
    const stack: XmlElement[] = [this];
    while (stack.length > 0) {
      const el = stack.pop()!;
      if (el !== this && (all || el.tagName === name)) out.push(el);
      const kids = el.children;
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!);
    }
    return out;
  }

  /** 자손 중 첫 번째 일치 엘리먼트. 없으면 null. */
  firstDescendant(name: string): XmlElement | null {
    const stack: XmlElement[] = [this];
    while (stack.length > 0) {
      const el = stack.pop()!;
      if (el !== this && el.tagName === name) return el;
      const kids = el.children;
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!);
    }
    return null;
  }

  /** 직계 자식 중 첫 번째 일치 엘리먼트. */
  child(name: string): XmlElement | null {
    for (const n of this.childNodes) {
      if (typeof n !== 'string' && n.tagName === name) return n;
    }
    return null;
  }

  /** 직계 자식 중 일치하는 것 전부. */
  childrenNamed(name: string): XmlElement[] {
    const out: XmlElement[] = [];
    for (const n of this.childNodes) {
      if (typeof n !== 'string' && n.tagName === name) out.push(n);
    }
    return out;
  }

  /** `a/b/c` 경로를 직계 자식으로만 따라간다. */
  path(...names: string[]): XmlElement | null {
    let cur: XmlElement | null = this;
    for (const n of names) {
      cur = cur.child(n);
      if (cur === null) return null;
    }
    return cur;
  }
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/** XML 엔티티를 해석한다. 정의되지 않은 엔티티는 원문 그대로 남긴다. */
export function decodeEntities(input: string): string {
  if (input.indexOf('&') < 0) return input;
  return input.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body: string) => {
    if (body.charCodeAt(0) === 35 /* # */) {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const code = parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    const named = NAMED_ENTITIES[body];
    return named === undefined ? whole : named;
  });
}

const NAME_RE = /[^\s/>=]+/y;

/**
 * XML 문자열을 파싱해 루트 엘리먼트를 돌려준다.
 * 잘못된 XML 이면 예외를 던진다.
 */
export function parseXml(source: string): XmlElement {
  // BOM 제거
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const len = text.length;

  let i = 0;
  let root: XmlElement | null = null;
  const stack: XmlElement[] = [];

  const appendText = (raw: string): void => {
    const top = stack[stack.length - 1];
    if (top === undefined) return; // 루트 바깥의 공백 등은 버린다
    if (raw.length === 0) return;
    const last = top.childNodes[top.childNodes.length - 1];
    const decoded = decodeEntities(raw);
    if (typeof last === 'string') top.childNodes[top.childNodes.length - 1] = last + decoded;
    else top.childNodes.push(decoded);
  };

  while (i < len) {
    const lt = text.indexOf('<', i);
    if (lt < 0) {
      appendText(text.slice(i));
      break;
    }
    if (lt > i) appendText(text.slice(i, lt));

    const next = text[lt + 1];

    if (next === '?') {
      // <?xml ... ?> / 처리 명령
      const end = text.indexOf('?>', lt + 2);
      if (end < 0) throw new Error('XML 구문 오류: 닫히지 않은 처리 명령');
      i = end + 2;
      continue;
    }

    if (next === '!') {
      if (text.startsWith('<!--', lt)) {
        const end = text.indexOf('-->', lt + 4);
        if (end < 0) throw new Error('XML 구문 오류: 닫히지 않은 주석');
        i = end + 3;
        continue;
      }
      if (text.startsWith('<![CDATA[', lt)) {
        const end = text.indexOf(']]>', lt + 9);
        if (end < 0) throw new Error('XML 구문 오류: 닫히지 않은 CDATA');
        const top = stack[stack.length - 1];
        if (top !== undefined) top.childNodes.push(text.slice(lt + 9, end));
        i = end + 3;
        continue;
      }
      // <!DOCTYPE ...> — 내부 서브셋([...])까지 통째로 건너뛴다. 엔티티는 정의하지 않는다.
      let j = lt + 2;
      let depth = 0;
      let inBracket = false;
      for (; j < len; j++) {
        const c = text[j];
        if (c === '[') inBracket = true;
        else if (c === ']') inBracket = false;
        else if (c === '<' && !inBracket) depth++;
        else if (c === '>') {
          if (inBracket) continue;
          if (depth === 0) break;
          depth--;
        }
      }
      if (j >= len) throw new Error('XML 구문 오류: 닫히지 않은 선언');
      i = j + 1;
      continue;
    }

    if (next === '/') {
      // 종료 태그
      const end = text.indexOf('>', lt + 2);
      if (end < 0) throw new Error('XML 구문 오류: 닫히지 않은 종료 태그');
      const name = text.slice(lt + 2, end).trim();
      const top = stack.pop();
      if (top === undefined || top.tagName !== name) {
        throw new Error(`XML 구문 오류: </${name}> 짝이 맞지 않음`);
      }
      i = end + 1;
      continue;
    }

    // 시작 태그
    NAME_RE.lastIndex = lt + 1;
    const nameMatch = NAME_RE.exec(text);
    if (nameMatch === null || nameMatch.index !== lt + 1) {
      throw new Error('XML 구문 오류: 태그 이름을 읽을 수 없음');
    }
    const tagName = nameMatch[0];
    let p = NAME_RE.lastIndex;

    const attributes: Record<string, string> = {};
    let selfClosing = false;

    for (;;) {
      while (p < len && isSpace(text.charCodeAt(p))) p++;
      if (p >= len) throw new Error('XML 구문 오류: 닫히지 않은 시작 태그');

      const c = text[p];
      if (c === '>') {
        p++;
        break;
      }
      if (c === '/') {
        if (text[p + 1] !== '>') throw new Error('XML 구문 오류: 잘못된 태그 종료');
        selfClosing = true;
        p += 2;
        break;
      }

      NAME_RE.lastIndex = p;
      const attrMatch = NAME_RE.exec(text);
      if (attrMatch === null || attrMatch.index !== p) {
        throw new Error('XML 구문 오류: 속성 이름을 읽을 수 없음');
      }
      const attrName = attrMatch[0];
      p = NAME_RE.lastIndex;

      while (p < len && isSpace(text.charCodeAt(p))) p++;
      if (text[p] !== '=') {
        // 값 없는 속성 (XML 에선 비정상이지만 관대하게 처리)
        attributes[attrName] = '';
        continue;
      }
      p++;
      while (p < len && isSpace(text.charCodeAt(p))) p++;

      const quote = text[p];
      if (quote !== '"' && quote !== "'") {
        throw new Error('XML 구문 오류: 따옴표 없는 속성 값');
      }
      const valueEnd = text.indexOf(quote, p + 1);
      if (valueEnd < 0) throw new Error('XML 구문 오류: 닫히지 않은 속성 값');
      attributes[attrName] = decodeEntities(text.slice(p + 1, valueEnd));
      p = valueEnd + 1;
    }

    const el = new XmlElement(tagName, attributes);
    const parent = stack[stack.length - 1];
    if (parent !== undefined) {
      el.parent = parent;
      parent.childNodes.push(el);
    } else if (root === null) {
      root = el;
    } else {
      throw new Error('XML 구문 오류: 루트 엘리먼트가 여러 개');
    }
    if (!selfClosing) stack.push(el);

    i = p;
  }

  if (stack.length > 0) throw new Error(`XML 구문 오류: <${stack[stack.length - 1]!.tagName}> 가 닫히지 않음`);
  if (root === null) throw new Error('XML 구문 오류: 엘리먼트가 없음');
  return root;
}

function isSpace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13;
}
