/** 전역 한도값. UI · Worker 양쪽에서 공유한다. */

/** 입력 파일 1개당 최대 크기 (200MB). */
export const MAX_FILE_BYTES = 200 * 1024 * 1024;

/** 한 번에 처리할 수 있는 파일 개수. */
export const MAX_FILES = 50;

/* ── ZIP 폭탄 방어 한도 ───────────────────────────────────────────── */

/** 압축 해제 후 전체 크기 상한 (1GB). 중앙 디렉터리로 "해제 전" 검사한다. */
export const MAX_TOTAL_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024;

/** 엔트리 1개의 압축 해제 후 크기 상한 (512MB). */
export const MAX_ENTRY_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;

/**
 * 전체 압축률 상한 (해제 후 총합 / 압축된 총합).
 *
 * deflate 의 이론상 최대 압축률은 약 1032:1 이다. 정상적인 PPTX 는 XML 이
 * 10~20배, 미디어가 1~2배 수준이라 전체로는 보통 한 자릿수에 그친다.
 * 150:1 은 넉넉한 여유를 두면서도 전형적인 ZIP 폭탄을 걸러낸다.
 */
export const MAX_TOTAL_COMPRESSION_RATIO = 150;

/** 엔트리 1개의 압축률 상한. */
export const MAX_ENTRY_COMPRESSION_RATIO = 500;

/**
 * 압축률 검사를 적용할 최소 크기.
 * 작은 XML 은 원래 압축률이 높으므로 절대 크기 한도로만 막는다.
 */
export const RATIO_CHECK_MIN_BYTES = 8 * 1024 * 1024;

/** ZIP 엔트리 개수 상한. */
export const MAX_ENTRIES = 20_000;

/* ── 미디어 확장자 분류 ───────────────────────────────────────────── */

export const IMAGE_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'tiff', 'tif', 'svg', 'webp', 'emf', 'wmf', 'jfif', 'heic',
]);

export const AUDIO_EXTS = new Set([
  'mp3', 'wav', 'm4a', 'wma', 'aac', 'ogg', 'oga', 'flac', 'aiff', 'aif', 'mid', 'midi',
]);

export const VIDEO_EXTS = new Set([
  'mp4', 'm4v', 'mov', 'avi', 'wmv', 'mkv', 'webm', 'mpg', 'mpeg', 'asf', 'ogv', '3gp',
]);
