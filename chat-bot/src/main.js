// @ts-nocheck
import Worker from './worker.js?worker';

const worker = new Worker();

const messages = [];
let isGenerating = false;
let isComposing = false;
let currentAssistantEl = null;

/** @type {{ type: 'image'|'audio', dataUrl: string, name: string } | null} */
let pendingAttachment = null;

// DOM
const chatEl = document.getElementById('chat');
const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('send');
const statusEl = document.getElementById('status');
const progressEl = document.getElementById('progress');
const progressBarEl = document.getElementById('progress-bar');
const progressTextEl = document.getElementById('progress-text');
const fileInputEl = document.getElementById('file-input');
const attachBtn = document.getElementById('attach-btn');
const attachPreviewEl = document.getElementById('attach-preview');
const attachNameEl = document.getElementById('attach-name');
const attachClearEl = document.getElementById('attach-clear');

// ── Helpers ───────────────────────────────────────────────────

function setStatus(text) {
  statusEl.textContent = text;
}

function showProgress(file, pct) {
  const name = file?.split('/').pop() ?? '';
  progressEl.hidden = false;
  progressBarEl.style.width = `${pct.toFixed(1)}%`;
  progressTextEl.textContent = `${name}  ${pct.toFixed(1)}%`;
}

function hideProgress() {
  progressEl.hidden = true;
}

function scrollToBottom() {
  chatEl.scrollTop = chatEl.scrollHeight;
}

/** Append a message bubble; returns the inner bubble element */
function appendMessage(role, text = '', attachment = null) {
  const wrapper = document.createElement('div');
  wrapper.className = `message ${role}`;

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  if (attachment?.type === 'image') {
    const img = document.createElement('img');
    img.src = attachment.dataUrl;
    img.className = 'attach-img';
    bubble.appendChild(img);
  } else if (attachment?.type === 'audio') {
    const audio = document.createElement('audio');
    audio.src = attachment.dataUrl;
    audio.controls = true;
    audio.className = 'attach-audio';
    bubble.appendChild(audio);
  }

  if (text) {
    const p = document.createElement('p');
    p.textContent = text;
    bubble.appendChild(p);
  }

  wrapper.appendChild(bubble);
  chatEl.appendChild(wrapper);
  scrollToBottom();
  return bubble;
}

// ── Attachment ────────────────────────────────────────────────

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function clearAttachment() {
  pendingAttachment = null;
  attachPreviewEl.hidden = true;
  fileInputEl.value = '';
}

attachBtn.addEventListener('click', () => fileInputEl.click());

fileInputEl.addEventListener('change', async () => {
  const file = fileInputEl.files?.[0];
  if (!file) return;

  const dataUrl = await readFileAsDataUrl(file);
  const type = file.type.startsWith('image/') ? 'image' : 'audio';
  pendingAttachment = { type, dataUrl, name: file.name };

  attachNameEl.textContent = file.name;
  attachPreviewEl.hidden = false;
});

attachClearEl.addEventListener('click', clearAttachment);

// ── Send ──────────────────────────────────────────────────────

function sendMessage() {
  const text = inputEl.value.trim();
  if ((!text && !pendingAttachment) || isGenerating) return;

  inputEl.value = '';
  inputEl.style.height = 'auto';
  isGenerating = true;
  sendBtn.disabled = true;

  const attachment = pendingAttachment;
  clearAttachment();

  const msg = { role: 'user', content: text, attachment };
  messages.push(msg);
  appendMessage('user', text, attachment);

  currentAssistantEl = appendMessage('assistant');

  worker.postMessage({ type: 'generate', messages: [...messages] });
}

sendBtn.addEventListener('click', sendMessage);

// IME: don't send while composing (e.g. Chinese/Japanese input)
inputEl.addEventListener('compositionstart', () => { isComposing = true; });
inputEl.addEventListener('compositionend', () => { isComposing = false; });

inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
    e.preventDefault();
    sendMessage();
  }
});

inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto';
  inputEl.style.height = `${inputEl.scrollHeight}px`;
});

// ── Worker messages ───────────────────────────────────────────

worker.addEventListener('message', ({ data }) => {
  switch (data.type) {
    case 'status':
      setStatus(data.text);
      break;

    case 'progress':
      showProgress(data.file, data.progress ?? 0);
      setStatus('下載模型中...');
      break;

    case 'file_done':
      hideProgress();
      setStatus('載入中...');
      break;

    case 'ready':
      hideProgress();
      setStatus('就緒');
      sendBtn.disabled = false;
      inputEl.disabled = false;
      attachBtn.disabled = false;
      inputEl.focus();
      break;

    case 'token':
      if (currentAssistantEl) {
        currentAssistantEl.querySelector('p')
          ? (currentAssistantEl.querySelector('p').textContent += data.text)
          : currentAssistantEl.appendChild(Object.assign(document.createElement('p'), { textContent: data.text }));
        scrollToBottom();
      }
      break;

    case 'done': {
      const reply = currentAssistantEl?.querySelector('p')?.textContent ?? '';
      if (reply) messages.push({ role: 'assistant', content: reply });
      isGenerating = false;
      sendBtn.disabled = false;
      currentAssistantEl = null;
      break;
    }

    case 'error':
      setStatus(`錯誤：${data.message}`);
      isGenerating = false;
      sendBtn.disabled = false;
      break;
  }
});
