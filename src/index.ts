import spawnFFmpegWorker from './chunked-remuxer';

const filePicker = document.getElementById("file") as HTMLInputElement;

async function loadMedia() {
  if (filePicker.files && filePicker.files[0]) {
    const ffmpeg = spawnFFmpegWorker();
    await ffmpeg.load();
    await ffmpeg.setInputFile(filePicker.files[0]);
    const meta = await ffmpeg.getMetadata();
    alert(JSON.stringify(meta));
    //const videoChunk = mkv.getVideoChunk(filePicker.files[0], 0.0);
  }
}

filePicker.addEventListener("change", loadMedia);
loadMedia();
