import spawnFFmpegWorker from './chunked-remuxer';
import type { Remote } from 'comlink';
import type { FFmpeg, MediaMetadata, RemuxedChunkStream } from './worker/ffmpeg'

type LogCallback = (logEntry: string) => void;

export default class MKVWeb {
  videoElement: HTMLVideoElement;
  mediaSource: MediaSource;
  ffmpegWorker: Remote<FFmpeg>;
  loadedMediaMetadata: MediaMetadata;

  audioSourceBuffer: SourceBuffer;
  videoSourceBuffer: SourceBuffer;

  updatingTime: number;

  logCallbacks: LogCallback[] = [];

  constructor(video: HTMLVideoElement) {
    if (!window.MediaSource) {
      const err = "Media Source Extensions are not supported by this browser.";
      alert(err);
      throw new Error(err);
    }

    this.videoElement = video;
    this.mediaSource = new MediaSource();
    this.videoElement.src = URL.createObjectURL(this.mediaSource);
    this.mediaSource.addEventListener('sourceopen', () => {
      URL.revokeObjectURL(video.src);
    }, { once: true });
    this.ffmpegWorker = spawnFFmpegWorker();
  }

  addLogCallback(cb: LogCallback) {
    this.logCallbacks.push(cb);
  }

  private log(logEntry: string) {
    console.log(logEntry);
    this.logCallbacks.forEach(cb => cb(logEntry));
  }

  async loadMedia(file: File) {
    if (!(await this.ffmpegWorker.isLoaded())) {
      this.log("Starting ffmpeg worker");
      await this.ffmpegWorker.load();
      this.log("Loaded ffmpeg worker");
    }
    await this.ffmpegWorker.setInputFile(file);
    this.loadedMediaMetadata = await this.ffmpegWorker.getMetadata();
    this.logMetadata();
    this.mediaSource.duration = this.loadedMediaMetadata.durationSeconds;
    this.videoElement.addEventListener("timeupdate", () => this.onTimeUpdate());
    this.onTimeUpdate();
  }

  private logMetadata() {
    this.log("Parsed metadata:")
    this.log(`  Duration: ${this.loadedMediaMetadata.durationSeconds}s`);
    this.loadedMediaMetadata.audioStreams.forEach(s => {
      this.log(`  Audio stream ${s.id}(${s.lang || "n/a"}): ${s.formatDescription}`);
    })
    this.loadedMediaMetadata.videoStreams.forEach(s => {
      this.log(`  Video stream ${s.id}(${s.lang || "n/a"}): ${s.formatDescription}`);
    })
  }

  private async onTimeUpdate() {
    const time = this.videoElement.currentTime;

    const getFirstUnbuffered = () => {
      const buffers = this.mediaSource.sourceBuffers;
      let res = undefined;

      for (let i = 0; i < buffers.length; i++) {
        let intersectingRangeEnd = undefined;
        const bufferedRanges = buffers[i].buffered;
        for (let j = 0; j < bufferedRanges.length; j++) {
          const start = bufferedRanges.start(j);
          const end = bufferedRanges.end(j);
          if (start <= time && time <= end) {
            intersectingRangeEnd = end;
            break;
          }
        }
        if (intersectingRangeEnd === undefined) {
          return time;
        } else if (res === undefined)  {
          res = intersectingRangeEnd;
        } else {
          res = Math.min(res, intersectingRangeEnd);
        }
      }
      return res || time;
    }

    const nextChunkTime = getFirstUnbuffered();
    if (nextChunkTime - time < 5.0) {
      await this.loadChunk(nextChunkTime, 10.0);
    }
  }

  private async loadChunk(start: number, len: number) {
    if (this.updatingTime === start) {
      console.log("Ignoring loadChunk that has already been requested");
      return;
    }
    this.updatingTime = start;
    this.log(`Remuxing media segment with time range [${start} - ${start + len}]`);
    const remuxedChunk = await this.ffmpegWorker.remuxChunk(start, len, this.loadedMediaMetadata.videoStreams[0]?.id, this.loadedMediaMetadata.audioStreams[0]?.id);

    // TODO: loadChunk for updating buffers, not ready
    if (this.audioSourceBuffer === undefined && remuxedChunk.audioChunk != null) {
      this.audioSourceBuffer = this.mediaSource.addSourceBuffer(remuxedChunk.audioChunk.mime);
    }
    if (this.videoSourceBuffer === undefined && remuxedChunk.videoChunk != null) {
      this.videoSourceBuffer = this.mediaSource.addSourceBuffer(remuxedChunk.videoChunk.mime);
    }
    let updating = 0;
    const cb = (s: RemuxedChunkStream) => {
      const sizeMB = (s.data.length / (1 << 20)).toFixed(3);
      this.log(`Added remuxed segment of type ${s.mime} with size ${sizeMB} MB to SourceBuffer`);
      if (--updating == 0) {
        this.updatingTime = undefined;
      }
    }
    if (remuxedChunk.audioChunk) {
      updating++;
      this.audioSourceBuffer.appendBuffer(remuxedChunk.audioChunk.data);
      this.audioSourceBuffer.addEventListener("updateend", () => cb(remuxedChunk.audioChunk), { once: true });
    }
    if (remuxedChunk.videoChunk) {
      updating++;
      this.videoSourceBuffer.appendBuffer(remuxedChunk.videoChunk.data);
      this.videoSourceBuffer.addEventListener("updateend", () => cb(remuxedChunk.videoChunk), { once: true });
    }
  }

  private async waitOpenState(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.mediaSource.readyState === "open") {
        resolve();
      } else if (this.mediaSource.readyState == "closed") {
        this.mediaSource.addEventListener("sourceopen", () => {
          resolve();
        }, { once: true });
      } else {
        reject(`Unexpected MediaSource readyState when asked to wait for open state: ${this.mediaSource.readyState}`);
      }
    });
  }
}
