/// <reference path="./index.d.ts" />
import FFMpegCore  from './ffmpeg-core/ffmpeg-core.js';
import FFMpegWasm   from './ffmpeg-core/ffmpeg-core.wasm';
import FFMpegWorker from './ffmpeg-core/ffmpeg-core.js';
import * as path from 'path-browserify';

self.importScripts(
  FFMpegCore
);

export default class FFmpeg {
  private defaultArgs = [
    "ffmpeg",
    "-hide_banner", // Hide copyright notice, build options and library versions
    "-nostdin", // Non-interactive mode
  ];

  private ffmpegCore: any;
  private ffmpegMain: any;
  private inputPath: string;

  constructor() {

  }

  async load() {
    // @ts-ignore
    this.ffmpegCore = await createFFmpegCore({
      mainScriptUrlOrBlob: FFMpegCore,
      locateFile: (path: string, prefix: string) => {
        if (path.endsWith('ffmpeg-core.wasm')) {
          return FFMpegWasm;
        }
        if (path.endsWith('ffmpeg-core.worker.js')) {
          return FFMpegWorker;
        }
        return prefix + path;
      },
      printErr: console.error,
      print: console.log
    });

    // Get JavaScript function that calls the underlying wasm function
    this.ffmpegMain = this.ffmpegCore.cwrap(
      'main',
      'number', // exit code
      ['number', 'number'] // argc, argv
    );
  }

  async setInputFile(file: File) {
    const FS = this.ffmpegCore.FS;
    const WORKERFS = this.ffmpegCore.FS_filesystems.WORKERFS;

    const inputDir = "/input";
    FS.mkdir(inputDir);
    this.ffmpegCore.FS_mount(WORKERFS, { files: [file] }, "/input");
    this.inputPath = path.join(inputDir, file.name);
  }

  async getMediaInfo() {
    this.runFFmpeg("-i", this.inputPath);
    // TODO: Parse log data
  }

  async remux()


  private runFFmpeg(...args: string[]) {
    // parse_args from utils.js of ffmpeg.wasm-core
    const parse_args = (Core, _args: string[]) => {
      const _argsPtr = Core._malloc(_args.length * Uint32Array.BYTES_PER_ELEMENT);
      _args.forEach((s, idx) => {
        const buf = Core._malloc(s.length + 1);
        Core.writeAsciiToMemory(s, buf);
        Core.setValue(_argsPtr + (Uint32Array.BYTES_PER_ELEMENT * idx), buf, 'i32');
      });
      return [_args.length, _argsPtr];
    };

    console.log("Running ffmpeg", args)
    this.ffmpegMain(...parse_args(this.ffmpegCore, this.defaultArgs.concat(args)));
    //this.ffmpegCore._emscripten_proxy_main(...parse_args(this.ffmpegCore, this.defaultArgs.concat(args)));
  }
}
