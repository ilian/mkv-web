/// <reference path="./index.d.ts" />
import FFMpegCore  from './ffmpeg-core/ffmpeg-core.js';
import FFMpegWasm   from './ffmpeg-core/ffmpeg-core.wasm';
import FFMpegWorker from './ffmpeg-core/ffmpeg-core.js';
import * as path from 'path-browserify';
import { IChunkedRemuxerWorkerRPC, serverMethod, ChunkedRemuxWorkerRPCServer } from './rpc';
import { Observable, fromEventPattern, firstValueFrom } from 'rxjs';
import { takeWhile, toArray } from 'rxjs/operators';

self.importScripts(
  FFMpegCore
);

enum FFmpegState {
  Uninitialized = 1,
  Initializing,
  Idle,
  Busy
}

export interface MediaMetadata {
  durationSeconds: number
}

export default class FFmpeg implements IChunkedRemuxerWorkerRPC {
  private defaultArgs = [
    "ffmpeg",
    "-hide_banner", // Hide copyright notice, build options and library versions
    "-nostdin", // Non-interactive mode
  ];

  private ffmpegCore: any;
  private ffmpegMain: any;
  private ffmpegLogObservable: Observable<string>;
  private inputPath: string;
  private outputPath = "/output/out.mp4";
  private ffmpegState = FFmpegState.Uninitialized;
  // TODO: Decorator?
  private rpcServer = new ChunkedRemuxWorkerRPCServer(this);

  constructor() {

  }

  private assertState(expected: FFmpegState) {
    if (this.ffmpegState != expected) {
      throw new Error(`Expected state ${expected} but current state is ${this.ffmpegState}`);
    }
  }

  private assertInput() {
    if (typeof this.inputPath === "undefined") {
      throw new Error("No file set as input with setInputFile");
    }
  }

  @serverMethod
  async load(): Promise<void> {
    this.assertState(FFmpegState.Uninitialized);
    this.ffmpegState = FFmpegState.Initializing;
    this.ffmpegLogObservable = new Observable(subscriber => {

    });

    type LogCallback = (line: string) => void;
    const handlers: LogCallback[] = [];

    const addLogHandler = (handler: LogCallback) => {
      handlers.push(handler);
    };
    const removeLogHandler = (handler: LogCallback) => {
      handlers.splice(handlers.indexOf(handler), 1);
    };
    this.ffmpegLogObservable = fromEventPattern(addLogHandler, removeLogHandler);

    const logCallback = (line: string) => {
      console.log(line);
      if (line === "FFMPEG_END") {
        this.ffmpegState = FFmpegState.Idle;
      }
      for (const handler of handlers) {
        handler(line);
      }
    };

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
      printErr: logCallback,
      print: logCallback
    });

    // Get JavaScript function that calls the underlying wasm function
    this.ffmpegMain = this.ffmpegCore.cwrap(
      'main',
      'number', // exit code
      ['number', 'number'] // argc, argv
    );
    this.ffmpegState = FFmpegState.Idle;
  }

  @serverMethod
  async setInputFile(file: File): Promise<void> {
    this.assertState(FFmpegState.Idle);
    const FS = this.ffmpegCore.FS;
    const WORKERFS = this.ffmpegCore.FS_filesystems.WORKERFS;

    const inputDir = "/input";
    FS.mkdir(inputDir);
    this.ffmpegCore.FS_mount(WORKERFS, { files: [file] }, "/input");
    this.inputPath = path.join(inputDir, file.name);
    FS.mkdir(path.dirname(this.outputPath));
  }

  @serverMethod
  async getMetadata(): Promise<MediaMetadata> {
    this.assertInput();
    const logEntriesPromise: Promise<string[]> = firstValueFrom(
      this.ffmpegLogObservable.pipe(
        takeWhile(line => line !== "FFMPEG_END"),
        toArray()
      )
    );
    this.runFFmpeg("-i", this.inputPath);
    const logEntries = await logEntriesPromise;

    let metadata: MediaMetadata = {
      durationSeconds: undefined
    };
    const durationRegex = /Duration: (\d+?):(\d{2}):(.+?),/;
    for (const line of logEntries) {
      const match = line.match(durationRegex);
      if (match) {
        metadata.durationSeconds = parseFloat(match[3]) + 60 * parseInt(match[2]) + 60 * 60 * parseInt(match[1]);
      }
    }
    return metadata;
  }

  async remuxChunkToCompatibleFormat(seekOffsetSeconds = 0.0, durationSeconds: number) {
    this.assertInput();
    // TODO: Get video codec and check if supported by browser and mp4 container
    var args = [
      "-ss", seekOffsetSeconds.toString(), // Seek input file
      "-i", this.inputPath, // Input file
      ...(typeof durationSeconds === "undefined" ? [] : ["-t", durationSeconds.toString()]), // Duration of chunk
      "-c", "copy", // Do not re-encode
      this.outputPath
    ];
    this.runFFmpeg(...args);
  }

  private runFFmpeg(...args: string[]) {
    this.assertState(FFmpegState.Idle);

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
    this.ffmpegState = FFmpegState.Busy;
    try {
      this.ffmpegMain(...parse_args(this.ffmpegCore, this.defaultArgs.concat(args)));
    } catch (e) {console.error("Exception caught from entrypoint: ", e)}
    //this.ffmpegCore._emscripten_proxy_main(...parse_args(this.ffmpegCore, this.defaultArgs.concat(args)));
  }
}
