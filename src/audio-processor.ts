class BirdNetAudioProcessor extends AudioWorkletProcessor {
  private buffer = new Float32Array(144000);
  private writeIndex = 0;
  private strideCounter = 0;
  private readonly strideSize = 48000;

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0]?.[0];
    if (!input) return true;

    for (let i = 0; i < input.length; i++) {
      this.buffer[this.writeIndex] = input[i];
      this.writeIndex = (this.writeIndex + 1) % 144000;
      this.strideCounter++;

      if (this.strideCounter >= this.strideSize) {
        this.strideCounter = 0;
        const windowData = new Float32Array(144000);
        windowData.set(this.buffer.subarray(this.writeIndex));
        windowData.set(
          this.buffer.subarray(0, this.writeIndex),
          144000 - this.writeIndex,
        );
        this.port.postMessage(windowData, [windowData.buffer]);
      }
    }
    return true;
  }
}

registerProcessor('birdnet-audio-processor', BirdNetAudioProcessor);