import { loadLiteRt, loadAndCompile } from '@litertjs/core';
import { runWithTfjsTensors } from '@litertjs/tfjs-interop';
import * as tf from '@tensorflow/tfjs';
import { WebGPUBackend } from '@tensorflow/tfjs-backend-webgpu';

let model: Awaited<ReturnType<typeof loadAndCompile>> | null = null;
let labels: string[] = [];
let device: GPUDevice | null = null;
let baseUrl = '/birdtml/';

async function initDevice() {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('No WebGPU adapter found');
  device = await adapter.requestDevice();
  return device;
}

async function initModel() {
  await loadLiteRt(`${baseUrl}litert-wasm/`);

  device = await initDevice();
  await tf.setBackend('webgpu');
  tf.removeBackend('webgpu');
  tf.registerBackend('webgpu', () => new WebGPUBackend(device!, device!.adapterInfo));
  await tf.setBackend('webgpu');

  self.postMessage({ type: 'PROGRESS', payload: { stage: 'downloading', progress: 0 } });

  const modelUrl = `${baseUrl}models/BirdNET_GLOBAL_6K_V2.4_Model_FP16.tflite`;
  const modelRes = await fetch(modelUrl);
  if (!modelRes.ok) throw new Error(`Failed to fetch model: ${modelRes.statusText}`);

  const contentLength = Number(modelRes.headers.get('content-length') ?? 0);
  const reader = modelRes.body?.getReader();
  if (!reader) throw new Error('Failed to read model stream');

  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (contentLength) {
      self.postMessage({ type: 'PROGRESS', payload: { stage: 'downloading', progress: received / contentLength } });
    }
  }

  const modelData = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    modelData.set(chunk, offset);
    offset += chunk.length;
  }

  self.postMessage({ type: 'PROGRESS', payload: { stage: 'compiling', progress: 0 } });

  model = await loadAndCompile(modelData, { accelerator: 'webgpu' });

  const labelRes = await fetch(`${baseUrl}labels_en.txt`);
  const labelText = await labelRes.text();
  labels = labelRes.ok ? labelText.split('\n').filter((l) => l.trim().length > 0) : [];

  self.postMessage({ type: 'READY' });
}

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data;

  if (type === 'INIT') {
    if (payload?.baseUrl) baseUrl = payload.baseUrl;
    await initModel();
    return;
  }

  if (type === 'INFER' && model) {
    const audioData = payload as Float32Array;
    const inputTensor = tf.tensor(audioData, [1, 144000]);

    const outputs = await runWithTfjsTensors(model, inputTensor);
    const logits = outputs[0];
    const probs = await logits.data();

    const results: { species: string; score: number }[] = [];
    for (let i = 0; i < probs.length; i++) {
      const conf = 1 / (1 + Math.exp(-probs[i]));
      if (conf > 0.5) {
        results.push({ species: labels[i] ?? `species_${i}`, score: conf });
      }
    }
    results.sort((a, b) => b.score - a.score);

    inputTensor.dispose();
    logits.dispose();

    self.postMessage({ type: 'DETECTIONS', payload: results.slice(0, 5) });
  }
};