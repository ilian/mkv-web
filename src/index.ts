import spawnFFmpegWorker from './chunked-remuxer';
import * as MP4Box from 'mp4box';

const filePicker = document.getElementById("file") as HTMLInputElement;
const video = document.getElementById("video") as HTMLVideoElement;

if (!window.MediaSource) {
  const err = "Media Source Extensions are not supported by this browser.";
  alert(err);
  throw new Error(err);
}

const mediaSource = new MediaSource();
video.src = URL.createObjectURL(mediaSource);
mediaSource.addEventListener('sourceopen', () => {
  URL.revokeObjectURL(video.src);
}, { once: true });

async function waitOpenState(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (mediaSource.readyState === "open") {
      resolve();
    } else {
      mediaSource.addEventListener("sourceopen", () => {
        resolve();
      }, { once: true });
    }
  });
}

async function getMP4Mime(array: Uint8Array): Promise<string> {
  const buffer = array.buffer.slice(array.byteOffset, array.byteLength + array.byteOffset);
  return new Promise((resolve, reject) => {
    const mp4boxfile = MP4Box.createFile();
    mp4boxfile.onReady = (info) => {
      console.log(info);
      resolve(info.mime);
    }
    mp4boxfile.onError = (error) => {
      reject(error);
    };
    // @ts-ignore
    buffer.fileStart = 0;
    mp4boxfile.appendBuffer(buffer);
    mp4boxfile.flush();
  });
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

async function loadMedia() {
  if (filePicker.files && filePicker.files[0]) {
    const ffmpeg = spawnFFmpegWorker();
    await ffmpeg.load();
    await ffmpeg.setInputFile(filePicker.files[0]);
    const meta = await ffmpeg.getMetadata();
    const duration = meta.durationSeconds;

    await waitOpenState();
    mediaSource.duration = duration;
    const videoChunk = await ffmpeg.remuxChunk(0.0, 30.0);
    console.log("Received video chunk", videoChunk);
    // https://developer.mozilla.org/en-US/docs/Web/Media/Formats/codecs_parameter
    var mime = await getMP4Mime(videoChunk);
    // Just add something that can be played by Firefox, since the type check is too conservative
    mime = 'video/mp4; codecs="avc1.640033"';
    console.log("Mime of video: " + mime);
    // downloadBlob(videoChunk, "test.mp4", "video/mp4");
    if (!MediaSource.isTypeSupported(mime)) {
      console.error(`Mime type '${mime}' is not supported`);
    }
    const sourceBuffer = mediaSource.addSourceBuffer(mime);
    sourceBuffer.appendBuffer(videoChunk);
    sourceBuffer.onupdatestart = () => {
      console.log("UPDATESTART");
    };
    sourceBuffer.onupdateend = () => {
      console.log("UPDATEEND");
    }
    sourceBuffer.onerror = e => {
      console.log("ERR", e);
    }
    video.oncanplay = () => {
      console.log("CANPLAY");
      video.play();
    };
  }
}

filePicker.addEventListener("change", loadMedia);
loadMedia();
