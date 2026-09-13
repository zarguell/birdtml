import { loadLiteRt, loadAndCompile } from '@litertjs/core';
import { runWithTfjsTensors } from '@litertjs/tfjs-interop';
import * as tf from '@tensorflow/tfjs';
import { WebGPUBackend } from '@tensorflow/tfjs-backend-webgpu';

let model: Awaited<ReturnType<typeof loadAndCompile>> | null = null;
let labels: string[] = [];
let device: GPUDevice | null = null;

const BASE = import.meta.env.BASE_URL;
const WASM_PATH = `${BASE}litert-wasm/`;
const MODEL_URL = `${BASE}models/BirdNET_GLOBAL_6K_V2.4_Model_FP16.tflite`;
const LABELS_URL = `${BASE}labels_en.txt`;

async function initDevice() {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('No WebGPU adapter found');
  device = await adapter.requestDevice();
  return device;
}

async function initModel() {
  await loadLiteRt(WASM_PATH);

  device = await initDevice();
  await tf.setBackend('webgpu');
  tf.removeBackend('webgpu');
  tf.registerBackend('webgpu', () => new WebGPUBackend(device!, device!.adapterInfo));
  await tf.setBackend('webgpu');

  model = await loadAndCompile(MODEL_URL, { accelerator: 'webgpu' });

  const labelRes = await fetch(LABELS_URL);
  const labelText = await labelRes.text();
  labels = labelText.split('\n').filter((l) => l.trim().length > 0);

  self.postMessage({ type: 'READY' });
}

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data;

  if (type === 'INIT') {
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