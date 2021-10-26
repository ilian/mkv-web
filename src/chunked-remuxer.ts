import * as Comlink from 'comlink';
import type FFmpeg from './worker/ffmpeg';

export default function spawnFFmpegWorker(): Comlink.Remote<FFmpeg> {
  const worker = new Worker(new URL("./worker/chunked-remuxer-worker.ts", import.meta.url));
  return Comlink.wrap(worker);
}
