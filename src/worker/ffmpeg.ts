/// <reference path="./index.d.ts" />
import FFMpegCore   from './ffmpeg-core/ffmpeg-core.js';
import FFMpegWasm   from './ffmpeg-core/ffmpeg-core.wasm';
import FFMpegWorker from './ffmpeg-core/ffmpeg-core.js';
import * as path from 'path-browserify';
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

interface Stream {
  id: string
  lang?: string
  /** Long format description of a stream e.g. 'h264 (High 10), yuv420p10le(tv, bt709, progressive), 1920x1080 [SAR 1:1 DAR 16:9], 23.98 fps, 23.98 tbr, 1k tbn, 47.95 tbc (default)' **/
  formatDescription?: string
}

export interface MediaMetadata {
  durationSeconds: number
  audioStreams: Stream[]
  videoStreams: Stream[]
}

interface ContainerType {
  /** FFMpeg format code of container as listed by 'ffmpeg -formats' **/
  ffmpegFormat: string
  /** MIME type of container for SourceBuffer of a MediaSource  **/
  mime: string
}

export interface RemuxedChunkStream {
  data: Uint8Array
  mime: string
}

export interface RemuxedChunk {
  videoChunk: RemuxedChunkStream,
  audioChunk: RemuxedChunkStream
}

function ffmpegFormatToCompatibleContainer(format: string): ContainerType {
  if (format.startsWith("h264")) {
    return {
      ffmpegFormat: "mp4",
      mime: 'video/mp4; codecs="avc1.640033' // AVC High Level 5.1
    };
  } else if (format.startsWith("flac")) {
    return {
      ffmpegFormat: "mp4",
      mime: 'audio/mp4; codecs="flac"'
    };
  } else if (format.startsWith("vorbis")) {
    return {
      ffmpegFormat: "webm",
      mime: 'audio/webm; codecs="vorbis"'
    };
  } else if (format.startsWith("aac")) {
    return {
      ffmpegFormat: "mp4",
      mime: 'audio/mp4; codecs="mp4a.40.2"' // AAC-LC
    };
  } else if (format.startsWith("opus")) {
    return {
      ffmpegFormat: "webm",
      mime: 'audio/webm; codecs="opus"'
    };
  }
  throw new Error("Unsupported ffmpeg format description: " + format);
}

export class FFmpeg {
  static defaultArgs = [
    "ffmpeg",
    "-hide_banner", // Hide copyright notice, build options and library versions
    "-nostdin", // Non-interactive mode
  ];

  static streamRegex = /\s*Stream #(?<id>\d+:\d+)\(?(?<lang>.*?)\)?: (?<type>\w+): (?<formatDescription>.*)/;
  static durationRegex = /Duration: (\d+?):(\d{2}):(.+?),/;

  private ffmpegCore: any;
  private ffmpegMain: any;
  private ffmpegLogObservable: Observable<string>;
  private inputPath: string;
  private inputMetadata: MediaMetadata;
  private outputDir = "/output";
  private ffmpegState = FFmpegState.Uninitialized;

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

  isLoaded(): boolean {
    return !(this.ffmpegState == FFmpegState.Uninitialized);
  }

  async load() {
    this.assertState(FFmpegState.Uninitialized);
    this.ffmpegState = FFmpegState.Initializing;

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

  async setInputFile(file: File) {
    this.assertState(FFmpegState.Idle);
    const FS = this.ffmpegCore.FS;
    const WORKERFS = this.ffmpegCore.FS_filesystems.WORKERFS;

    const inputDir = "/input";
    FS.mkdir(inputDir);
    this.ffmpegCore.FS_mount(WORKERFS, { files: [file] }, inputDir);
    this.inputPath = path.join(inputDir, file.name);
    FS.mkdir(this.outputDir);

    /* Get metadata by invoking ffmpeg -i */

    const logEntriesPromise: Promise<string[]> = firstValueFrom(
      this.ffmpegLogObservable.pipe(
        takeWhile(line => line !== "FFMPEG_END"),
        toArray()
      )
    );
    this.runFFmpeg("-i", this.inputPath);
    const logEntries = await logEntriesPromise;

    this.inputMetadata = {
      durationSeconds: undefined,
      audioStreams: [],
      videoStreams: []
    };
    for (const line of logEntries) {
      const durationMatch = line.match(FFmpeg.durationRegex);
      if (durationMatch) {
        this.inputMetadata.durationSeconds = parseFloat(durationMatch[3]) + 60 * parseInt(durationMatch[2]) + 60 * 60 * parseInt(durationMatch[1]);
      }

      const streamMatch = FFmpeg.streamRegex.exec(line);
      if (streamMatch) {
        const { id, lang, type, formatDescription } = streamMatch.groups;
        const stream: Stream = {
          id,
          lang,
          formatDescription
        };
        switch (type) {
          case "Audio":
            this.inputMetadata.audioStreams.push(stream);
          break;
          case "Video":
            this.inputMetadata.videoStreams.push(stream);
          break;
          default:
            console.warn("Ignoring non-audio/video stream", stream);
        }
      }
    }
    console.log(this.inputMetadata);
  }

  async getMetadata(): Promise<MediaMetadata> {
    this.assertInput();
    return this.inputMetadata;
  }

  async remuxChunk(seekOffsetSeconds = 0.0, durationSeconds: number, videoStreamId: string, audioStreamId: string): Promise<RemuxedChunk> {
    this.assertInput();
    // TODO: Get video codec and check if supported by browser and mp4 container

    const videoStreams = this.inputMetadata.videoStreams.filter(s => s.id == videoStreamId);
    // assert(videoStream.length <= 1);
    if (videoStreams.length == 0) {
      throw Error(`No video stream found with id ${videoStreamId}`);
    }
    const videoStream: Stream = videoStreams[0];
    const videoStreamContainer = ffmpegFormatToCompatibleContainer(videoStream.formatDescription);

    var audioStream: Stream;
    var audioStreamContainer: ContainerType;
    if (audioStreamId != null) {
      var audioStreams = this.inputMetadata.audioStreams.filter(s => s.id == audioStreamId);
      // assert(audioStream.length <= 1);
      if (audioStreams.length == 0) {
        throw Error(`No audio stream found with id ${audioStreamId}`);
      }
      audioStream = audioStreams[0];
      audioStreamContainer = ffmpegFormatToCompatibleContainer(audioStream.formatDescription);
    }

    let args = [
      "-ss", seekOffsetSeconds.toString(), // Seek input file
      ...(typeof durationSeconds === "undefined" ? [] : ["-t", durationSeconds.toString()]), // Duration of chunk
      "-copyts",
      "-i", this.inputPath, // Input file
    ];

    if (videoStreamContainer) {
      args = args.concat([
        "-map", videoStream.id,
        "-f", videoStreamContainer.ffmpegFormat,
        "-vcodec", "copy",
        // "-map_chapters", "-1", // Don't copy chapters metadata, which can cause problems with MIME type containing 'text' codec
        /*
         * Fragment MP4 files, required for MSE (frag_keyframe, empty_moov)
         * Avoid 'TFHD base-data-offset not allowed by MSE.' error for Chrome (default_base_moof)
         "-movflags", "frag_keyframe+empty_moov+default_base_moof",
         */
        "-movflags", "frag_keyframe+delay_moov+default_base_moof",
        `${this.outputDir}/video`,
      ]);
    }

    if (audioStreamContainer) {
      args = args.concat([
        "-map", audioStream.id,
        "-strict", "-2", // Experimental flac in mp4 support
        "-f", audioStreamContainer.ffmpegFormat,
        "-acodec", "copy",
        "-movflags", "frag_keyframe+delay_moov+default_base_moof",
        `${this.outputDir}/audio`
      ])
    }

    this.runFFmpeg(...args);
    const FS = this.ffmpegCore.FS;

    let videoChunk: RemuxedChunkStream = null;
    let audioChunk: RemuxedChunkStream = null;

    if (videoStreamContainer) {
      videoChunk = {
        data: FS.readFile(`${this.outputDir}/video`),
        mime: videoStreamContainer.mime
      };
      FS.unlink(`${this.outputDir}/video`);
    }

    if (audioStreamContainer) {
      audioChunk = {
        data: FS.readFile(`${this.outputDir}/audio`),
        mime: audioStreamContainer.mime
      };
      FS.unlink(`${this.outputDir}/audio`);
    }

    return {
      audioChunk,
      videoChunk
    };
  }

  private runFFmpeg(...args: string[]) {
    this.assertState(FFmpegState.Idle);

    // parse_args based of utils.js of ffmpeg.wasm-core, but modified to handle UTF-8 paths
    const parse_args = (Core, _args: string[]) => {
      const _argsPtr = Core._malloc(_args.length * Uint32Array.BYTES_PER_ELEMENT);
      _args.forEach((s, idx) => {
        const bufSize = Core.lengthBytesUTF8(s) + 1;
        const buf = Core._malloc(bufSize);
        Core.stringToUTF8(s, buf, bufSize);
        Core.setValue(_argsPtr + (Uint32Array.BYTES_PER_ELEMENT * idx), buf, 'i32');
      });
      return [_args.length, _argsPtr];
    };

    console.log("Running ffmpeg", args)
    this.ffmpegState = FFmpegState.Busy;
    try {
      this.ffmpegMain(...parse_args(this.ffmpegCore, FFmpeg.defaultArgs.concat(args)));
    } catch (e) {console.error("Exception caught from entrypoint: ", e)}
    //this.ffmpegCore._emscripten_proxy_main(...parse_args(this.ffmpegCore, this.defaultArgs.concat(args)));
  }
}

export default FFmpeg;
