import MKVWeb from './mkv-web';

const filePicker = document.getElementById("file") as HTMLInputElement;
const video = document.getElementById("video") as HTMLVideoElement;
const logs = document.getElementById("logs") as HTMLDivElement;
const mkvWeb = new MKVWeb(video);

const playFileButton = document.getElementById("playfile") as HTMLButtonElement;
playFileButton.addEventListener("click",  () => {
  if (filePicker.files && filePicker.files[0]) {
    mkvWeb.loadMedia(filePicker.files[0]);
  } else {
    alert("No file selected.");
  }
});

const sampleButton = document.getElementById("sample") as HTMLButtonElement;
sampleButton.addEventListener("click", async () => {
  log("Downloading sample MKV file");
  const blob = await (await fetch("https://de.catbox.moe/ol3g57.mkv")).blob();
  mkvWeb.loadMedia(new File([await blob.arrayBuffer()], "demo.mkv"));
}, {once: true});

function log(e: string) {
  const p = document.createElement("p");
  p.innerText = e;
  logs.append(p);
  logs.scrollTop = logs.scrollHeight; // scroll to bottom
}

mkvWeb.addLogCallback(log);

// @ts-ignore
if (!!window.chrome) {
  log("[ERR] Chrome-based browsers don't appear to respect the presentation time.");
  log("[ERR] Please use Firefox instead");
}
log("Welcome to the ilian/mkv-web demo");
log("More detailed logs are printed to the console");
log("Please select an MKV file to play");
