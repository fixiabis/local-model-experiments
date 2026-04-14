// @ts-nocheck
import {
  AutoProcessor,
  Gemma4ForConditionalGeneration,
  TextStreamer,
  load_image,
  read_audio,
} from '@huggingface/transformers';

const MODEL_ID = 'onnx-community/gemma-4-E2B-it-ONNX';

let processor = null;
let model = null;
let modelDevice = null; // 'webgpu' | 'wasm'

function onProgress(info) {
  if (info.status === 'progress') {
    self.postMessage({ type: 'progress', file: info.file, progress: info.progress });
  } else if (info.status === 'done') {
    self.postMessage({ type: 'file_done', file: info.file });
  }
}

const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

async function loadWasm() {
  self.postMessage({ type: 'status', text: '載入模型（WASM）...' });
  model = await Gemma4ForConditionalGeneration.from_pretrained(MODEL_ID, {
    dtype: 'q4f16',
    device: 'wasm',
    progress_callback: onProgress,
  });
  modelDevice = 'wasm';
}

async function loadModel() {
  try {
    self.postMessage({ type: 'status', text: '載入 Processor...' });
    processor = await AutoProcessor.from_pretrained(MODEL_ID, {
      progress_callback: onProgress,
    });

    if (isMobile) {
      // Mobile GPUs often load WebGPU successfully but hang or OOM on inference;
      // skip WebGPU entirely to avoid loading the model twice.
      await loadWasm();
    } else {
      self.postMessage({ type: 'status', text: '載入模型（WebGPU）...' });
      model = await Gemma4ForConditionalGeneration.from_pretrained(MODEL_ID, {
        dtype: 'q4f16',
        device: 'webgpu',
        progress_callback: onProgress,
      });
      modelDevice = 'webgpu';
    }

    self.postMessage({ type: 'ready' });
  } catch (err) {
    console.warn('載入失敗，切換至 WASM:', err.message);
    try {
      model?.dispose?.();
      model = null;
      await loadWasm();
      self.postMessage({ type: 'ready' });
    } catch (err2) {
      self.postMessage({ type: 'load_failed', message: err2.message });
    }
  }
}

async function generate(messages) {
  try {
    // The last user message may carry an attachment
    const lastMsg = messages.at(-1);
    const attachment = lastMsg?.attachment ?? null;

    // Load media for the current turn
    const image = attachment?.type === 'image' ? await load_image(attachment.dataUrl) : null;
    const audio = attachment?.type === 'audio' ? await read_audio(attachment.dataUrl, 16000) : null;

    // Build content arrays for apply_chat_template
    const formatted = messages.map((m) => {
      const isLast = m === lastMsg;
      const parts = [];
      if (isLast && image) parts.push({ type: 'image' });
      if (isLast && audio) parts.push({ type: 'audio' });
      if (m.content) parts.push({ type: 'text', text: m.content });
      return { role: m.role, content: parts };
    });

    const prompt = processor.apply_chat_template(formatted, {
      enable_thinking: false,
      add_generation_prompt: true,
    });

    const inputs = await processor(prompt, image, audio, { add_special_tokens: false });

    const streamer = new TextStreamer(processor.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (text) => {
        self.postMessage({ type: 'token', text });
      },
    });

    await model.generate({
      ...inputs,
      max_new_tokens: 1024,
      do_sample: true,
      temperature: 1.0,
      top_p: 0.95,
      top_k: 64,
      streamer,
    });

    self.postMessage({ type: 'done' });
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message });
  }
}

self.addEventListener('message', ({ data }) => {
  if (data.type === 'generate') {
    generate(data.messages);
  }
});

loadModel();
