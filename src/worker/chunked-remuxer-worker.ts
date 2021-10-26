import FFmpeg from './ffmpeg';
import * as Comlink from 'comlink';

Comlink.expose(new FFmpeg());
