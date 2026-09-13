export {};

interface AudioWorkletProcessorGlobalScope {
  registerProcessor(name: string, ctor: typeof AudioWorkletProcessor): void;
}

declare class AudioWorkletProcessor {
  port: MessagePort;
  process(inputs: Float32Array[][]): boolean;
}