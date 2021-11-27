import spawnFFmpegWorker from './chunked-remuxer';
import type { Remote } from 'comlink';
import type { FFmpeg, MediaMetadata } from './worker/ffmpeg'
// import * as MP4Box from 'mp4box';

function waita(): Promise<void> {
  return new Promise((resolve, _) => {
    setTimeout(resolve, 5000);
  });
}

async function lol() {
  alert(1);
  await waita();
}

const downloadURL = (data, fileName) => {
  const a = document.createElement('a')
  a.href = data
  a.download = fileName
  document.body.appendChild(a)
  a.style.display = 'none'
  a.click()
  a.remove()
}

const downloadBlob = (data, fileName, mimeType) => {
  const blob = new Blob([data], {
    type: mimeType
  })
  const url = window.URL.createObjectURL(blob)
  downloadURL(url, fileName)
  setTimeout(() => window.URL.revokeObjectURL(url), 1000)
}

class SuperVideoElement {
  videoElement: HTMLVideoElement;
  mediaSource: MediaSource;
  ffmpegWorker: Remote<FFmpeg>;
  loadedMediaMetadata: MediaMetadata;

  audioSourceBuffer: SourceBuffer;
  videoSourceBuffer: SourceBuffer;

  updatingTime: number;

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

  async loadMedia(file: File) {
    if (!(await this.ffmpegWorker.isLoaded())) {
      await this.ffmpegWorker.load();
    }
    await this.ffmpegWorker.setInputFile(filePicker.files[0]);
    this.loadedMediaMetadata = await this.ffmpegWorker.getMetadata();
    this.mediaSource.duration = this.loadedMediaMetadata.durationSeconds;
    this.videoElement.addEventListener("timeupdate", () => this.onTimeUpdate());
    this.onTimeUpdate();
  }

  private async onTimeUpdate() {
    console.log("Time update")
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
    console.log("next chunk time", nextChunkTime);
    if (nextChunkTime - time < 5.0) {
      await this.loadChunk(nextChunkTime, 10.0);
    }
    console.log("Time update end")
  }

  private async loadChunk(start: number, len: number) {
    if (this.updatingTime === start) {
      console.log("Ignoring loadChunk that has already been requested");
      return;
    }
    this.updatingTime = start;
    const remuxedChunk = await this.ffmpegWorker.remuxChunk(start, len, this.loadedMediaMetadata.videoStreams[0]?.id, this.loadedMediaMetadata.audioStreams[0]?.id);

    // TODO: laodChunk for updating buffers, not ready
    if (this.audioSourceBuffer === undefined && remuxedChunk.audioChunk !== undefined) {
      this.audioSourceBuffer = this.mediaSource.addSourceBuffer(remuxedChunk.audioChunk.mime);
    }
    if (this.videoSourceBuffer === undefined && remuxedChunk.videoChunk !== undefined) {
      this.videoSourceBuffer = this.mediaSource.addSourceBuffer(remuxedChunk.videoChunk.mime);
    }
    let updating = 0;
    const cb = () => {
      if (--updating == 0) {
        this.updatingTime = undefined;
      }
    }
    if (remuxedChunk.audioChunk) {
      updating++;
      //this.audioSourceBuffer.timestampOffset = start;
      this.audioSourceBuffer.appendBuffer(remuxedChunk.audioChunk.data);
      this.audioSourceBuffer.addEventListener("updateend", cb, { once: true });
    }
    if (remuxedChunk.videoChunk) {
      updating++;
      //this.videoSourceBuffer.timestampOffset = start;
      //downloadBlob(remuxedChunk.videoChunk.data, "remuxed", "video/mp4");
      this.videoSourceBuffer.appendBuffer(remuxedChunk.videoChunk.data);
      this.videoSourceBuffer.addEventListener("updateend", cb, { once: true });
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

const filePicker = document.getElementById("file") as HTMLInputElement;
const video = document.getElementById("video") as HTMLVideoElement;
const superVideoElement = new SuperVideoElement(video);

function loadMedia() {
  if (filePicker.files && filePicker.files[0]) {
    superVideoElement.loadMedia(filePicker.files[0]);
  }
}

filePicker.addEventListener("change", loadMedia);
loadMedia();
