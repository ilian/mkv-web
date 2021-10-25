import ChunkedRemuxer from './chunked-remuxer';

const filePicker = document.getElementById("file") as HTMLInputElement;

async function loadMedia() {
  if (filePicker.files && filePicker.files[0]) {
    const remuxer = new ChunkedRemuxer(filePicker.files[0]);
    const meta = await remuxer.getMetadata();
    alert(meta);
    //const videoChunk = mkv.getVideoChunk(filePicker.files[0], 0.0);
  }
}

filePicker.addEventListener("change", loadMedia);
loadMedia();
