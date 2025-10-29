// main.js
// Single-file client-side logic to call an OpenAI-compatible provider at
// BASE = "http://116.72.105.227:1234/v1"
// Auth header will be: "Authorization": "<key>" (no "Bearer " prefix).
//
// Requirements in DOM (IDs used):
// - modelSelect        (select element for models)
// - refreshModels      (button to refresh models)
// - temperature        (input range)
// - maxTokens          (input number)
// - systemPrompt       (input text)
// - prompt             (textarea for user input)
// - sendBtn            (button to send)
// - messages           (container element to append messages)
// Optionally:
// - apiKey             (input to paste API key, if not using window.OPENAI_KEY)
//
// Ensure this script is included AFTER those elements in the HTML.

(function () {
  const BASE = 'http://116.72.105.227:1234/v1';

  // DOM refs (graceful fallback if element missing)
  const $ = id => document.getElementById(id);
  const modelSelect = $('modelSelect');
  const refreshBtn = $('refreshModels');
  const tempEl = $('temperature');
  const maxTokensEl = $('maxTokens');
  const systemPromptEl = $('systemPrompt');
  const promptEl = $('prompt');
  const sendBtn = $('sendBtn');
  const messagesEl = $('messages');
  const apiKeyInput = $('apiKey'); // optional

  // util: append message bubble
  function appendMessage(text, who = 'bot', rawHtml = false) {
    if (!messagesEl) {
      console.warn('messages element not found; cannot display messages.');
      return;
    }
    const wrapper = document.createElement('div');
    wrapper.className = 'msg ' + (who === 'user' ? 'user' : 'bot');
    if (rawHtml) wrapper.innerHTML = text;
    else wrapper.textContent = text;
    messagesEl.appendChild(wrapper);
    // scroll to bottom
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function setStatus(text) {
    // replace or add a small status message (optional)
    // I'll append a lightweight bot message for status updates.
    appendMessage(text, 'bot');
  }

  function getApiKey() {
    // priority: window.OPENAI_KEY -> input#apiKey -> prompt user
    const globalKey = typeof window !== 'undefined' ? window.OPENAI_KEY : undefined;
    if (globalKey && globalKey.trim()) return globalKey.trim();
    if (apiKeyInput && apiKeyInput.value && apiKeyInput.value.trim()) return apiKeyInput.value.trim();
    return null;
  }

  async function fetchModels() {
    if (!modelSelect) return;
    modelSelect.disabled = true;
    modelSelect.innerHTML = '<option>Loading models…</option>';
    try {
      const key = getApiKey();
      if (!key) {
        modelSelect.innerHTML = '<option>Provide API key (window.OPENAI_KEY or #apiKey)</option>';
        appendMessage('No API key found. Provide window.OPENAI_KEY in HTML or an input#apiKey.', 'bot');
        modelSelect.disabled = false;
        return;
      }

      const res = await fetch(`${BASE}/models`, {
        method: 'GET',
        headers: {
          'Authorization': key,
          'Accept': 'application/json'
        }
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Models fetch failed: ${res.status} ${text}`);
      }

      const j = await res.json();

      // Try to find array of model ids
      // Support multiple response shapes: { data: [ { id }... ] } or { models: [...] } or array
      let models = [];
      if (Array.isArray(j)) models = j.map(m => m.id || m.model || m.name || String(m));
      else if (Array.isArray(j.data)) models = j.data.map(m => m.id || m.name || m.model || JSON.stringify(m));
      else if (Array.isArray(j.models)) models = j.models.map(m => m.id || m.name || m.model || JSON.stringify(m));
      else {
        // fallback: try to pick keys
        models = Object.keys(j).slice(0, 20);
      }

      if (!models.length) {
        // fallback defaults
        models = ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo'];
        appendMessage('No models found in response; using fallback list.', 'bot');
      }

      // populate select
      modelSelect.innerHTML = models.map(m => `<option value="${m}">${m}</option>`).join('');
    } catch (err) {
      console.error('fetchModels error', err);
      modelSelect.innerHTML = '<option>Error loading models</option>';
      appendMessage('Error fetching models: ' + (err.message || err), 'bot');
      appendMessage('If you see a CORS or network error, ensure the provider host allows browser requests from this origin.', 'bot');
    } finally {
      modelSelect.disabled = false;
    }
  }

  async function sendChat() {
    if (!promptEl) {
      alert('No prompt textarea found (#prompt).');
      return;
    }
    const userText = promptEl.value.trim();
    if (!userText) return;
    const key = getApiKey();
    if (!key) {
      alert('API key not found. Provide window.OPENAI_KEY in HTML or an input#apiKey.');
      return;
    }
    const model = modelSelect ? modelSelect.value : undefined;
    const temperature = tempEl ? parseFloat(tempEl.value) : 0.7;
    const systemPrompt = systemPromptEl ? (systemPromptEl.value || '') : '';

    // show user message
    appendMessage(userText, 'user');
    promptEl.value = '';
    // show thinking placeholder
    const thinkingId = 'thinking-' + Date.now();
    const thinkingEl = document.createElement('div');
    thinkingEl.className = 'msg bot';
    thinkingEl.id = thinkingId;
    thinkingEl.textContent = 'Thinking…';
    messagesEl.appendChild(thinkingEl);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    try {
      const payload = {
        model,
        messages: [
          ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
          { role: 'user', content: userText }
        ],
        temperature,
      };

      const res = await fetch(`${BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': key, // exactly as requested — no "Bearer "
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Chat failed: ${res.status} ${txt}`);
      }

      const j = await res.json();

      // Try common shapes to extract assistant content
      // OpenAI-style: j.choices[0].message.content
      let assistantText = null;
      if (j.choices && Array.isArray(j.choices) && j.choices[0]) {
        const c = j.choices[0];
        assistantText = (c.message && c.message.content) || c.text || (c.delta && c.delta.content) || null;
      } else if (j.output) {
        // some providers use output
        assistantText = (typeof j.output === 'string') ? j.output : (Array.isArray(j.output) ? j.output.map(x=>x.content||JSON.stringify(x)).join('\n') : JSON.stringify(j.output));
      } else if (j.result) {
        assistantText = j.result;
      } else {
        assistantText = JSON.stringify(j, null, 2);
      }

      // remove thinking element
      const t = document.getElementById(thinkingId);
      if (t) t.remove();

      // show assistant message (allow HTML lightly if it's safe)
      // We'll escape <script> tags just in case
      if (assistantText && /<\/?script/i.test(assistantText)) {
        // avoid inserting scripts: show as text
        appendMessage(assistantText, 'bot');
      } else {
        // Basic formatting: convert newlines -> <br> for readability
        const html = (assistantText || '').replace(/\n/g, '<br>');
        const botEl = document.createElement('div');
        botEl.className = 'msg bot';
        botEl.innerHTML = html;
        messagesEl.appendChild(botEl);
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
    } catch (err) {
      console.error('sendChat error', err);
      // replace thinking with error
      const t = document.getElementById(thinkingId);
      if (t) t.textContent = 'Error: ' + (err.message || err);
      else appendMessage('Error: ' + (err.message || err), 'bot');

      // Provide hint for CORS
      if (err.message && /CORS|Network|Failed to fetch/i.test(err.message)) {
        appendMessage('Network/CORS error detected. Ensure http://116.72.105.227:1234 allows CORS from this origin and that the host is reachable.', 'bot');
      }
    }
  }

  // Key handling: Enter sends, Shift+Enter newline
  if (promptEl) {
    promptEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (sendBtn) sendBtn.click();
        else sendChat();
      }
    });
  }

  if (sendBtn) sendBtn.addEventListener('click', sendChat);
  if (refreshBtn) refreshBtn.addEventListener('click', fetchModels);

  // init
  (async function init() {
    // initial hint message
    // populate models if possible (if no modelSelect present, skip)
    if (modelSelect) {
      try { await fetchModels(); } catch (e) { console.warn(e); }
    }
  })();

  // expose some helpers for debugging
  window.__plugin_debug = {
    BASE,
    getApiKey,
    fetchModels,
    sendChat
  };

})();
