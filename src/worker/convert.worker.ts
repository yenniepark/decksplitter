/// <reference lib="webworker" />
/**
 * 변환 Worker (메시지 처리 전용 껍데기).
 *
 * UI 스레드를 막지 않도록 압축 해제 · XML 파싱 · 재압축을 전부 여기서 한다.
 * 이 파일과 여기서 import 하는 모든 코드에는 네트워크 요청이 없다
 * (fetch / XMLHttpRequest / WebSocket / sendBeacon / importScripts 전부 미사용).
 */

import type { WorkerRequest, WorkerResponse } from '../types.ts';
import { convertAll } from './pipeline.ts';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function post(message: WorkerResponse, transfer: Transferable[] = []): void {
  ctx.postMessage(message, transfer);
}

ctx.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request === null || typeof request !== 'object' || request.type !== 'convert') return;

  try {
    const { zip, zipName, reports } = convertAll(request.files, request.options, (ratio, message) =>
      post({ type: 'progress', ratio, message }),
    );

    // Uint8Array 를 복사 없이 넘기기 위해 정확한 구간만 잘라낸 ArrayBuffer 를 만든다.
    const buffer = zip.buffer.slice(
      zip.byteOffset,
      zip.byteOffset + zip.byteLength,
    ) as ArrayBuffer;

    post({ type: 'done', zip: buffer, zipName, reports }, [buffer]);
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
});
