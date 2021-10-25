import { ChunkedRemuxWorkerRPCClient } from './worker/rpc';
export default class ChunkedRemuxer {
  file: File;
  worker: Worker
  rpcClient: ChunkedRemuxWorkerRPCClient;

  constructor(file: File) {
    this.file = file;
    this.worker = new Worker(new URL("./worker/chunked-remuxer-worker.ts", import.meta.url));
    this.rpcClient = new ChunkedRemuxWorkerRPCClient(this.worker);
  }

  async getMetadata(): Promise<String> {
    await this.rpcClient.load();
    await this.rpcClient.setInputFile(this.file);
    return JSON.stringify(await this.rpcClient.getMetadata());
  }
}
