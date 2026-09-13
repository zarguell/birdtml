declare class AudioWorkletProcessor {
  port: MessagePort;
  process(inputs: Float32Array[][]): boolean;
}

declare function registerProcessor(name: string, ctor: typeof AudioWorkletProcessor): void;