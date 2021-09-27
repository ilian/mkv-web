import MKV from './mkv';

const filePicker = document.getElementById("file") as HTMLInputElement;

function loadMedia() {
  if (filePicker.files && filePicker.files[0]) {
    const mkv = new MKV(filePicker.files[0]);
    const meta = mkv.getMetadata();
    //const videoChunk = mkv.getVideoChunk(filePicker.files[0], 0.0);
  }
}

filePicker.addEventListener("change", loadMedia);
loadMedia();
