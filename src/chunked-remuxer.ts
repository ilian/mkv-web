interface ChunkedRemuxerWorkerRPC {
  getMetadata(): Promise<string>;
}

class ChunkedRemuxWorkerRPCClient implements ChunkedRemuxerWorkerRPC {
  getMetadata(): Promise<string> {
    return new Promise(e => {});
  }
}

export default class ChunkedRemuxer {
  file: File;
  worker: Worker

  constructor(file: File) {
    this.file = file;
    this.worker = new Worker(new URL("./worker/chunked-remuxer-worker.ts", import.meta.url));
  }

  getMetadata(): Promise<String> {
    this.worker.postMessage({
      file: this.file
    });

    return new Promise((resolve, reject) => {
      this.worker.addEventListener('message', e => {
        resolve(e.data);
      });
    });
  }
}
