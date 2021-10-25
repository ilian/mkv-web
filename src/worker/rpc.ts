import { MediaMetadata } from './ffmpeg';
// Shared IPC interface
// TODO: Avoid Promise<T> on server impl when it's not needed
export interface IChunkedRemuxerWorkerRPC {
  load(): Promise<void>;
  setInputFile(file: File): Promise<void>;
  getMetadata(): Promise<MediaMetadata>;
}

/*
 * Payload sent with postMessage to worker
 */
interface RPCCallerPayload {
  id: number;
  method: string; // TODO: Compatible with overloads?
  args: any[];
}

// Simulate ADTs with tags since we can't pattern match by type at runtime
type RPCResultOk = { tag: "ok", value: any };
type RPCResultException = { tag: "exception", value: any };
type RPCResult = RPCResultOk | RPCResultException;

/*
 * Payload sent with postMessage from worker
 */
interface RPCReplyPayload {
  id: number;
  result: RPCResult;
}

// -- MAIN THREAD --

function clientMethod(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
  const methodName = propertyKey;

  // Change implementation of methods with @rpcClient decorator to an RPC stub
  descriptor.value = function(this: ChunkedRemuxWorkerRPCClient, ...args: any[]) {
    const payload: RPCCallerPayload = {
      id: this.nextId++,
      method: methodName,
      args: args
    };
    this.worker.postMessage(payload);
    return new Promise((resolve, reject) => {
      this.responseCallbacks[payload.id] = (result: RPCResult) => {
        if (result.tag === "ok") {
          resolve((result as RPCResultOk).value);
        } else {
          reject((result as RPCResultException).value);
        }
      };
    });
  }
}

export class ChunkedRemuxWorkerRPCClient implements IChunkedRemuxerWorkerRPC {
  worker: Worker;
  nextId: number = 0;
  responseCallbacks: Record<number, Function> = {};

  constructor(worker: Worker) {
    this.worker = worker;
    this.worker.addEventListener('message', (ev: MessageEvent<RPCReplyPayload>) => {
      const replyPayload = ev.data;
      if (replyPayload.id in this.responseCallbacks) {
        const cb = this.responseCallbacks[replyPayload.id];
        delete this.responseCallbacks[replyPayload.id];
        cb(replyPayload.result);
      } else {
        console.error("Received RPC reply from worker with unmatched id: ", replyPayload);
      }
    });
  }

  // TODO: Avoid having to create dummy functions for stub generation
  @clientMethod
  getMetadata(): Promise<MediaMetadata> { return null; }

  @clientMethod
  setInputFile(file: File): Promise<void> { return null; }

  @clientMethod
  load(): Promise<void> { return null; }

}

// -- WORKER --

const serverMethods: Record<string, Function> = {};

/*
 * Decorator to mark functions as callable by an RPC client
 */
export function serverMethod(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
  serverMethods[propertyKey] = descriptor.value;
}

export class ChunkedRemuxWorkerRPCServer {
  constructor(target: IChunkedRemuxerWorkerRPC) {
    if (typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope) {
      self.addEventListener("message", async function(ev: MessageEvent<RPCCallerPayload>) {
        const payload = ev.data;
        console.log("Server: received payload", payload);
        if (payload.method in serverMethods) {
          let rpcResult: RPCResult;
          try {
            const callReturnValue = await serverMethods[payload.method].apply(target, payload.args);
            rpcResult = {
              tag: "ok",
              value: callReturnValue
            };
          } catch (e) {
            rpcResult = {
              tag: "exception",
              value: e
            };
          }
          // Send message back to caller
          self.postMessage({
            id: payload.id,
            result: rpcResult
          } as RPCReplyPayload);
        } else {
          console.error(`Received RPC message from client with unknown method name ${payload.method}.
                         Is the method registered with the @serverMethod decorator?`);
        }
      });
    } else {
      throw new Error("RPC server created in non-worker context");
    }
  }
}
