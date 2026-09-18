/**
 * UI 스레드.
 *
 * 하는 일: 파일 수집 · 옵션 수집 · Worker 호출 · 결과 표시.
 * 무거운 작업(압축 해제, XML 파싱, 재압축)은 전부 Worker 에서 한다.
 *
 * 네트워크 요청 코드는 이 파일을 포함해 어디에도 없다.
 */

import './styles.css';
import { MAX_FILE_BYTES, MAX_FILES } from './constants.ts';
import type { ConvertOptions, FileReport, InputFile, WorkerResponse } from './types.ts';

/* ── DOM 참조 ────────────────────────────────────────────────────── */

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`요소를 찾을 수 없습니다: #${id}`);
  return el as T;
};

const dropzone = $<HTMLDivElement>('dropzone');
const fileInput = $<HTMLInputElement>('file-input');
const fileList = $<HTMLUListElement>('file-list');
const uploadError = $<HTMLParagraphElement>('upload-error');
const clearFilesBtn = $<HTMLButtonElement>('clear-files');
const limitLabel = $<HTMLSpanElement>('limit-label');

const runBtn = $<HTMLButtonElement>('run');
const runSummary = $<HTMLSpanElement>('run-summary');
const runError = $<HTMLParagraphElement>('run-error');
const progressWrap = $<HTMLDivElement>('progress-wrap');
const progressBar = $<HTMLDivElement>('progress-bar');
const progressLabel = $<HTMLParagraphElement>('progress-label');

const downloadBtn = $<HTMLButtonElement>('download');
const downloadSummary = $<HTMLSpanElement>('download-summary');
const reportsBox = $<HTMLDivElement>('reports');
const stepper = $<HTMLOListElement>('stepper');

const optImages = $<HTMLInputElement>('opt-images');
const optAudio = $<HTMLInputElement>('opt-audio');
const optVideo = $<HTMLInputElement>('opt-video');
const optTitles = $<HTMLInputElement>('opt-titles');
const optSeparators = $<HTMLInputElement>('opt-separators');
const optNotes = $<HTMLInputElement>('opt-notes');

/* ── 상태 ────────────────────────────────────────────────────────── */

interface PendingDownload {
  url: string;
  name: string;
}

let selected: File[] = [];
let busy = false;
let pending: PendingDownload | null = null;
let worker: Worker | null = null;

limitLabel.textContent = formatBytes(MAX_FILE_BYTES);

/* ── 1단계: 파일 수집 ────────────────────────────────────────────── */

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});

fileInput.addEventListener('change', () => {
  if (fileInput.files !== null) addFiles(Array.from(fileInput.files));
  fileInput.value = '';
});

for (const type of ['dragenter', 'dragover'] as const) {
  dropzone.addEventListener(type, (e) => {
    e.preventDefault();
    if (e.dataTransfer !== null) e.dataTransfer.dropEffect = 'copy';
    dropzone.classList.add('is-dragover');
  });
}

for (const type of ['dragleave', 'dragend'] as const) {
  dropzone.addEventListener(type, () => dropzone.classList.remove('is-dragover'));
}

dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('is-dragover');
  if (e.dataTransfer === null) return;
  addFiles(Array.from(e.dataTransfer.files));
});

// 드롭존 바깥에 떨어뜨렸을 때 브라우저가 파일을 열어버리는 것을 막는다.
for (const type of ['dragover', 'drop'] as const) {
  window.addEventListener(type, (e) => {
    if (!dropzone.contains(e.target as Node)) e.preventDefault();
  });
}

clearFilesBtn.addEventListener('click', () => {
  selected = [];
  showUploadError(null);
  renderFiles();
});

function addFiles(incoming: File[]): void {
  if (busy) return;

  const problems: string[] = [];
  const accepted: File[] = [];

  for (const file of incoming) {
    if (!file.name.toLowerCase().endsWith('.pptx')) {
      problems.push(`${file.name}: .pptx 파일이 아닙니다.`);
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      problems.push(
        `${file.name}: 파일이 너무 큽니다 (${formatBytes(file.size)} / 한도 ${formatBytes(MAX_FILE_BYTES)}).`,
      );
      continue;
    }
    if (file.size === 0) {
      problems.push(`${file.name}: 빈 파일입니다.`);
      continue;
    }
    const duplicate = selected.some(
      (f) => f.name === file.name && f.size === file.size && f.lastModified === file.lastModified,
    );
    if (duplicate) continue;
    accepted.push(file);
  }

  const room = MAX_FILES - selected.length;
  if (accepted.length > room) {
    problems.push(`한 번에 처리할 수 있는 파일은 최대 ${MAX_FILES}개입니다.`);
    accepted.length = Math.max(room, 0);
  }

  selected = selected.concat(accepted);
  showUploadError(problems.length > 0 ? problems.join('\n') : null);
  renderFiles();
}

function renderFiles(): void {
  fileList.replaceChildren();

  selected.forEach((file, index) => {
    const li = document.createElement('li');
    li.className = 'file-item';

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = file.name;
    name.title = file.name;

    const size = document.createElement('span');
    size.className = 'size';
    size.textContent = formatBytes(file.size);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'icon-btn';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `${file.name} 제거`);
    remove.addEventListener('click', () => {
      if (busy) return;
      selected.splice(index, 1);
      renderFiles();
    });

    li.append(name, size, remove);
    fileList.append(li);
  });

  clearFilesBtn.hidden = selected.length === 0;
  syncRunState();
}

function showUploadError(text: string | null): void {
  uploadError.textContent = text ?? '';
  uploadError.hidden = text === null;
}

/* ── 2단계: 옵션 ─────────────────────────────────────────────────── */

function readOptions(): ConvertOptions {
  return {
    media: {
      images: optImages.checked,
      audio: optAudio.checked,
      video: optVideo.checked,
    },
    markdown: {
      slideTitles: optTitles.checked,
      separators: optSeparators.checked,
      speakerNotes: optNotes.checked,
    },
  };
}

for (const input of [optImages, optAudio, optVideo, optTitles, optSeparators, optNotes]) {
  input.addEventListener('change', syncRunState);
}

/* ── 3단계: 실행 ─────────────────────────────────────────────────── */

function syncRunState(): void {
  const ready = selected.length > 0 && !busy;
  runBtn.disabled = !ready;

  if (busy) {
    runSummary.textContent = '변환 중입니다…';
  } else if (selected.length === 0) {
    runSummary.textContent = '먼저 파일을 추가해 주세요.';
  } else {
    const total = selected.reduce((sum, f) => sum + f.size, 0);
    runSummary.textContent = `${selected.length}개 파일 · 합계 ${formatBytes(total)}`;
  }

  updateStepper();
}

function updateStepper(): void {
  const done = new Set<number>();
  const current =
    pending !== null ? 4 : busy ? 3 : selected.length > 0 ? 3 : 1;

  if (selected.length > 0) {
    done.add(1);
    done.add(2);
  }
  if (pending !== null) done.add(3);

  for (const li of Array.from(stepper.children)) {
    const step = Number((li as HTMLElement).dataset['step']);
    li.classList.toggle('is-done', done.has(step) && step !== current);
    li.classList.toggle('is-current', step === current);
  }
}

runBtn.addEventListener('click', () => {
  void start();
});

async function start(): Promise<void> {
  if (busy || selected.length === 0) return;

  setBusy(true);
  showRunError(null);
  reportsBox.replaceChildren();
  releaseDownload();
  downloadBtn.disabled = true;
  downloadSummary.textContent = '변환이 끝나면 여기에서 받을 수 있습니다.';

  progressWrap.hidden = false;
  setProgress(0, '파일을 읽는 중…');

  let payload: InputFile[];
  try {
    payload = await readAll(selected);
  } catch (err) {
    setBusy(false);
    progressWrap.hidden = true;
    showRunError(`파일을 읽지 못했습니다: ${messageOf(err)}`);
    return;
  }

  const w = ensureWorker();
  setProgress(0.02, '변환을 시작합니다…');
  w.postMessage(
    { type: 'convert', files: payload, options: readOptions() },
    payload.map((f) => f.buffer),
  );
}

async function readAll(files: File[]): Promise<InputFile[]> {
  const out: InputFile[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    setProgress((i / files.length) * 0.02, `파일을 읽는 중… (${i + 1}/${files.length})`);
    const buffer = await file.arrayBuffer();
    if (buffer.byteLength > MAX_FILE_BYTES) {
      throw new Error(`${file.name}: 파일이 너무 큽니다.`);
    }
    out.push({ name: file.name, size: file.size, buffer });
  }
  return out;
}

function ensureWorker(): Worker {
  if (worker !== null) return worker;

  const w = new Worker(new URL('./worker/convert.worker.ts', import.meta.url), {
    type: 'module',
    name: 'slidesplit-convert',
  });

  w.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
    handleWorkerMessage(event.data);
  });

  w.addEventListener('error', (event) => {
    event.preventDefault();
    setBusy(false);
    progressWrap.hidden = true;
    showRunError(`변환 작업에서 오류가 발생했습니다: ${event.message}`);
    // 손상된 Worker 는 버리고 다음 실행 때 새로 만든다.
    w.terminate();
    worker = null;
  });

  worker = w;
  return w;
}

function handleWorkerMessage(msg: WorkerResponse): void {
  switch (msg.type) {
    case 'progress':
      setProgress(msg.ratio, msg.message);
      break;

    case 'error':
      setBusy(false);
      progressWrap.hidden = true;
      showRunError(msg.message);
      break;

    case 'done': {
      setProgress(1, '완료되었습니다.');
      setBusy(false);
      finishDownload(msg.zip, msg.zipName);
      renderReports(msg.reports);
      break;
    }
  }
}

function setBusy(value: boolean): void {
  busy = value;
  fileInput.disabled = value;
  clearFilesBtn.disabled = value;
  syncRunState();
}

function setProgress(ratio: number, label: string): void {
  const pct = Math.round(Math.max(0, Math.min(ratio, 1)) * 100);
  progressBar.style.width = `${pct}%`;
  progressLabel.textContent = `${label} (${pct}%)`;
  const bar = progressBar.parentElement;
  if (bar !== null) bar.setAttribute('aria-valuenow', String(pct));
}

function showRunError(text: string | null): void {
  runError.textContent = text ?? '';
  runError.hidden = text === null;
}

/* ── 4단계: 다운로드 ─────────────────────────────────────────────── */

function finishDownload(zip: ArrayBuffer, zipName: string): void {
  releaseDownload();
  const blob = new Blob([zip], { type: 'application/zip' });
  pending = { url: URL.createObjectURL(blob), name: zipName };

  downloadBtn.disabled = false;
  downloadSummary.textContent = `${zipName} · ${formatBytes(blob.size)}`;
  updateStepper();
  downloadBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function releaseDownload(): void {
  if (pending === null) return;
  URL.revokeObjectURL(pending.url);
  pending = null;
}

downloadBtn.addEventListener('click', () => {
  if (pending === null) return;
  const a = document.createElement('a');
  a.href = pending.url;
  a.download = pending.name;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
});

window.addEventListener('pagehide', releaseDownload);

function renderReports(reports: FileReport[]): void {
  reportsBox.replaceChildren();

  for (const report of reports) {
    const box = document.createElement('div');
    box.className = `report ${report.ok ? 'is-ok' : 'is-fail'}`;

    const title = document.createElement('p');
    title.className = 'title';
    title.textContent = `${report.ok ? '✓' : '✗'} ${report.name}`;
    box.append(title);

    if (report.ok) {
      const detail = document.createElement('p');
      detail.className = 'detail';
      const media = [
        report.mediaCount.image > 0 ? `이미지 ${report.mediaCount.image}` : null,
        report.mediaCount.audio > 0 ? `오디오 ${report.mediaCount.audio}` : null,
        report.mediaCount.video > 0 ? `동영상 ${report.mediaCount.video}` : null,
      ].filter((s): s is string => s !== null);
      detail.textContent =
        `슬라이드 ${report.slideCount}개` +
        (media.length > 0 ? ` · ${media.join(' · ')}` : ' · 추출된 미디어 없음');
      box.append(detail);
    } else {
      const reason = document.createElement('p');
      reason.className = 'fail-reason';
      reason.textContent = report.error ?? '알 수 없는 오류';
      box.append(reason);
    }

    if (report.warnings.length > 0) {
      const ul = document.createElement('ul');
      for (const warning of report.warnings.slice(0, 20)) {
        const li = document.createElement('li');
        li.textContent = warning;
        ul.append(li);
      }
      if (report.warnings.length > 20) {
        const li = document.createElement('li');
        li.textContent = `그 외 ${report.warnings.length - 20}건`;
        ul.append(li);
      }
      box.append(ul);
    }

    reportsBox.append(box);
  }
}

/* ── 공통 ────────────────────────────────────────────────────────── */

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

renderFiles();
