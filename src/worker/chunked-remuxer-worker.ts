import FFmpeg from './ffmpeg';


self.addEventListener('message', async function(e) {
  const ffmpeg = new FFmpeg();
  await ffmpeg.load();
  ffmpeg.setInputFile(e.data.file);
  ffmpeg.getMediaInfo();
});
