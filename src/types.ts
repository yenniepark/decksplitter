/** UI ↔ Worker 사이에서 주고받는 메시지 및 옵션 타입. */

export type MediaKind = 'image' | 'audio' | 'video';

export interface ConvertOptions {
  /** 추출할 미디어 종류. */
  media: {
    images: boolean;
    audio: boolean;
    video: boolean;
  };
  /** Markdown 출력 옵션. */
  markdown: {
    /** 슬라이드 제목을 `## 제목` 으로 출력. 끄면 `## 슬라이드 N`. */
    slideTitles: boolean;
    /** 슬라이드 사이에 `---` 구분선 삽입. */
    separators: boolean;
    /** 발표자 노트를 인용문으로 덧붙임. */
    speakerNotes: boolean;
  };
}

export interface InputFile {
  name: string;
  size: number;
  /** Transferable 로 넘긴다. */
  buffer: ArrayBuffer;
}

/* ── Worker 요청 ─────────────────────────────────────────────────── */

export interface ConvertRequest {
  type: 'convert';
  files: InputFile[];
  options: ConvertOptions;
}

export type WorkerRequest = ConvertRequest;

/* ── Worker 응답 ─────────────────────────────────────────────────── */

export interface ProgressMessage {
  type: 'progress';
  /** 0 ~ 1 */
  ratio: number;
  /** 사용자에게 보여줄 한국어 상태 문구. */
  message: string;
}

export interface FileReport {
  name: string;
  ok: boolean;
  /** 실패 사유 (ok === false 일 때). */
  error?: string;
  slideCount: number;
  mediaCount: Record<MediaKind, number>;
  /** 건너뛴 항목 안내 (외부 링크 미디어 등). */
  warnings: string[];
}

export interface DoneMessage {
  type: 'done';
  zip: ArrayBuffer;
  zipName: string;
  reports: FileReport[];
}

export interface ErrorMessage {
  type: 'error';
  message: string;
}

export type WorkerResponse = ProgressMessage | DoneMessage | ErrorMessage;
