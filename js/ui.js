(function () {
  "use strict";

  const inputsSel = document.getElementById("inputs");
  const monitorLogEl = document.getElementById("monitorLog");
  const deviceSectionEl = document.getElementById("deviceSection");
  const wavetableSectionEl = document.getElementById("wavetableSection");

  const velEl = document.getElementById("vel");
  const velValEl = document.getElementById("velVal");
  const chanEl = document.getElementById("midiChannel");
  const chanValEl = document.getElementById("midiChannelVal");
  const thruEl = document.getElementById("midiThru");
  const filterResEl = document.getElementById("filterResonance");
  const filterResValEl = document.getElementById("filterResonanceVal");
  const deviceModeEl = document.getElementById("deviceMode");
  const ashPanelEl = document.getElementById("ashPanel");
  const settingsSectionEl = document.getElementById("settingsSection");
  const ccFields = document.querySelectorAll(".cc-field");
  const storeBtn = document.getElementById("storePreset");
  const savePresetBtn = document.getElementById("savePreset");
  const loadPresetBtn = document.getElementById("loadPreset");
  const uploadWavetableBtn = document.getElementById("uploadWavetable");
  const playWavetableBtn = document.getElementById("playWavetable");
  const sendWavetableBtn = document.getElementById("sendWavetable");
  const wavetableTargetEl = document.getElementById("wavetableTarget");
  const wavetablePreviewEl = document.getElementById("wavetablePreview");
  const wavetableFilenameEl = document.getElementById("wavetableFilename");
  const wavetableVolumeEl = document.getElementById("wavetableVolume");
  const presetNameEl = document.getElementById("presetName");
  const logHistory = [];
  let lastLoadedInputId = null;
  let awaitingSettingsDump = false;
  let pendingWavetable = null;
  let wavetableAudioCtx = null;
  let wavetableSource = null;
  let wavetableGain = null;

  function clamp(value, min, max) {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, value));
  }

  function renderMonitorLog() {
    monitorLogEl.innerHTML = logHistory.map(entry => formatLogLine(entry)).join("<br>");
  }

  function formatValue(value) {
    const str = String(value);
    if (/^-?\d+\.0+$/.test(str)) return str.replace(/\.0+$/, "");
    return str;
  }

  function addSysExMessage(name, value) {
    const line = `> ${name.toUpperCase()} ${formatValue(value)}`.trim();
    const existing = logHistory.find(entry => entry.kind === "sysex" && entry.key === name);
    if (existing) {
      existing.line = line;
      renderMonitorLog();
      return;
    }
    pushLog(line, { kind: "sysex", key: name });
  }

  function addStatusMessage(message) {
    pushLog(`> ${message}`, { kind: "sysex-status" });
  }

  function addLocalStatus(message) {
    pushLog(`< ${message}`, { kind: "local-status" });
  }

  function setUiConnected(connected) {
    // Keep UI visible even when no device is connected.
    if (settingsSectionEl) settingsSectionEl.style.display = "";
    if (deviceSectionEl) deviceSectionEl.style.display = "";
    if (wavetableSectionEl) wavetableSectionEl.style.display = "";
  }

  function addNoteMessage(note, velocity, channel, kind) {
    pushLog(`> ${note} / ${velocity} / ${channel}`);
  }

  function addCCMessage(cc, value, channel) {
    const key = String(cc);
    const line = `> CC / ${cc} / ${value} / ${channel}`;
    const existing = logHistory.find(entry => entry.kind === "cc" && entry.key === key);
    if (existing) {
      existing.line = line;
      renderMonitorLog();
      return;
    }
    pushLog(line, { kind: "cc", key });
  }

  function populateInputs(inputs, preferredId) {
    inputsSel.innerHTML = "";
    if (!inputs.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No devices";
      opt.disabled = true;
      opt.selected = true;
      inputsSel.appendChild(opt);
      inputsSel.disabled = true;
      storeBtn.disabled = true;
      savePresetBtn.disabled = true;
      loadPresetBtn.disabled = true;
      if (presetNameEl) presetNameEl.disabled = true;
      lastLoadedInputId = null;
      awaitingSettingsDump = false;
      setUiConnected(false);
    } else {
      inputsSel.disabled = false;
      storeBtn.disabled = false;
      savePresetBtn.disabled = false;
      loadPresetBtn.disabled = false;
      if (presetNameEl) presetNameEl.disabled = false;
      setUiConnected(true);
    }
    for (const i of inputs) {
      const opt = document.createElement("option");
      opt.value = i.id;
      opt.textContent = i.name;
      inputsSel.appendChild(opt);
    }

    if (preferredId) {
      inputsSel.value = preferredId;
      MidiControl.selectInputById(preferredId);
      // Intentionally skip connection log per UI requirement.
      if (lastLoadedInputId !== preferredId) {
        awaitingSettingsDump = true;
        MidiControl.sendDeviceInfoRequest();
        lastLoadedInputId = preferredId;
      }
    }

    if (!inputs.length) {
        if (!logHistory.some(entry => entry.line === "< No Ascetik devices found")) {
          addLocalStatus("No Ascetik devices found");
        }
      }

    if (ashPanelEl) {
      ashPanelEl.style.display = "";
    }
  }

  MidiControl.setHandlers({
    onSysExLog: addSysExMessage,
    onSysExStatus: addStatusMessage,
    onDeviceInfo: () => {},
    onSysExParam: (param, valueA, valueB) => {
      if (awaitingSettingsDump) {
        awaitingSettingsDump = false;
      }
      switch (param) {
      case 0x0A: {
        const value = ((valueA & 0x7F) << 7) | (valueB & 0x7F);
        velEl.value = value;
        velValEl.textContent = value;
        break;
      }
      case 0x0B: {
        const value = ((valueA & 0x7F) << 7) | (valueB & 0x7F);
        chanEl.value = value;
        chanValEl.textContent = value;
        break;
      }
      case 0x0C: {
        const value = ((valueA & 0x7F) << 7) | (valueB & 0x7F);
        thruEl.checked = value !== 0;
        break;
      }
      case 0x0F: {
        const value = ((valueA & 0x7F) << 7) | (valueB & 0x7F);
        filterResEl.value = value;
        filterResValEl.textContent = value;
        break;
      }
      case 0x14: {
        const value = ((valueA & 0x7F) << 7) | (valueB & 0x7F);
        if (deviceModeEl) deviceModeEl.value = String(Math.max(0, Math.min(2, value)));
        break;
      }
      case 0x10: {
        const index = valueA;
        const ccValue = valueB;
        if (index < 0 || index > 12) return;
        const field = document.querySelector(`.cc-field[data-cc-index="${index}"]`);
        if (field) field.value = String(ccValue);
        break;
      }
      default:
        break;
      }
    },
    onNote: () => {},
    onCC: () => {},
    onStatus: msg => {
      if (msg === "") return;
      if (msg === "WebMIDI not supported" ||
          msg === "MIDI access denied or SysEx blocked") {
        setUiConnected(false);
      }
      if (msg.startsWith("0x")) {
        pushOut(`< ${msg}`);
        return;
      }
      const line = `< ${msg}`;
      if (!logHistory.some(entry => entry.line === line)) {
        pushLog(line, { kind: "local-status" });
      }
    },
    onStateChange: populateInputs,
  });

  inputsSel.onchange = () => MidiControl.selectInputById(inputsSel.value);

  function sendCCMapping(field) {
    const raw = field.value.trim();
    if (!/^\d+$/.test(raw)) return;
    const entered = Number(raw);
    if (!Number.isInteger(entered) || entered < 0 || entered > 127) return;
    const index = Number(field.dataset.ccIndex);
    if (!Number.isInteger(index) || index < 0 || index > 12) return;
    MidiControl.sendCCMap(index, entered);
  }

  function currentChannel() {
    const value = Number(chanEl.value);
    if (!Number.isFinite(value)) return 1;
    return clamp(value, 1, 16);
  }

  function sendSliderCC(inputEl) {
    const cc = Number(inputEl.dataset.cc);
    if (!Number.isInteger(cc)) return;
    const value = clamp(Number(inputEl.value), 0, 127);
    MidiControl.sendCC(cc, value, currentChannel());
  }

  function collectPreset() {
    const ccMap = Array.from(ccFields).map(field => {
      const raw = field.value.trim();
      const value = Number(raw);
      if (!Number.isInteger(value)) return 0;
      return Math.max(0, Math.min(127, value));
    });
    return {
      version: 1,
      velocity: Number(velEl.value),
      midiChannel: Number(chanEl.value),
      midiThru: thruEl.checked,
      filterResonance: Number(filterResEl.value),
      ccMap,
    };
  }

  function applyPreset(preset) {
    if (!preset || typeof preset !== "object") return;
    if (Number.isInteger(preset.velocity)) {
      velEl.value = preset.velocity;
      velValEl.textContent = preset.velocity;
      MidiControl.sendVelocity(preset.velocity);
    }
    if (Number.isInteger(preset.midiChannel)) {
      chanEl.value = preset.midiChannel;
      chanValEl.textContent = preset.midiChannel;
      MidiControl.sendMIDIChannel(preset.midiChannel);
    }
    if (typeof preset.midiThru === "boolean") {
      thruEl.checked = preset.midiThru;
      MidiControl.sendMIDIThru(preset.midiThru);
    }
    if (Number.isInteger(preset.filterResonance)) {
      const value = clamp(preset.filterResonance, 0, 127);
      filterResEl.value = value;
      filterResValEl.textContent = value;
      sendSliderCC(filterResEl);
    }
    if (Array.isArray(preset.ccMap)) {
      preset.ccMap.slice(0, 13).forEach((value, index) => {
        if (!Number.isInteger(value)) return;
        const clamped = Math.max(0, Math.min(127, value));
        const field = document.querySelector(`.cc-field[data-cc-index="${index}"]`);
        if (field) field.value = String(clamped);
        MidiControl.sendCCMap(index, clamped);
      });
    }
  }

  function savePresetToFile() {
    const rawName = presetNameEl ? presetNameEl.value : "";
    const safeName = String(rawName || "ascetik-ash-preset").trim();
    if (!safeName) return;
    const data = collectPreset();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = safeName.endsWith(".json") ? safeName : `${safeName}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    addLocalStatus("Preset saved to file");
  }

  function loadPresetFromFile() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result);
          applyPreset(parsed);
          addLocalStatus("Preset loaded from file");
        } catch {
          addLocalStatus("Invalid preset file");
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  function downmixToMono(buffer) {
    const channels = buffer.numberOfChannels || 1;
    const length = buffer.length;
    const mono = new Float32Array(length);
    if (channels === 1) {
      mono.set(buffer.getChannelData(0));
      return mono;
    }
    for (let ch = 0; ch < channels; ch += 1) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i += 1) {
        mono[i] += data[i] / channels;
      }
    }
    return mono;
  }

  function resampleToLength(data, targetLength) {
    const srcLength = data.length;
    if (srcLength === targetLength) return data.slice();
    const output = new Float32Array(targetLength);
    const scale = srcLength / targetLength;
    for (let i = 0; i < targetLength; i += 1) {
      const pos = i * scale;
      const idx = Math.floor(pos);
      const frac = pos - idx;
      const a = data[idx];
      const b = data[Math.min(idx + 1, srcLength - 1)];
      output[i] = a + (b - a) * frac;
    }
    return output;
  }

  function normalizeSamples(data) {
    let maxAbs = 0;
    for (let i = 0; i < data.length; i += 1) {
      const abs = Math.abs(data[i]);
      if (abs > maxAbs) maxAbs = abs;
    }
    if (maxAbs <= 0) return data;
    const scale = 1 / maxAbs;
    const out = new Float32Array(data.length);
    for (let i = 0; i < data.length; i += 1) {
      out[i] = data[i] * scale;
    }
    return out;
  }

  function toInt8Array(data) {
    const out = new Int8Array(data.length);
    for (let i = 0; i < data.length; i += 1) {
      const sample = data[i];
      const scaled = sample < 0 ? sample * 128 : sample * 127;
      const rounded = Math.round(scaled);
      out[i] = Math.max(-128, Math.min(127, rounded));
    }
    return out;
  }

  function drawWavetable(values) {
    if (!wavetablePreviewEl) return;
    const ctx = wavetablePreviewEl.getContext("2d");
    if (!ctx) return;
    const width = wavetablePreviewEl.clientWidth || 340;
    const height = wavetablePreviewEl.clientHeight || 120;
    const dpr = window.devicePixelRatio || 1;
    wavetablePreviewEl.width = Math.floor(width * dpr);
    wavetablePreviewEl.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1;

    const mid = height / 2;
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(width, mid);
    ctx.stroke();

    if (!values || !values.length) return;
    ctx.beginPath();
    for (let i = 0; i < values.length; i += 1) {
      const x = (i / (values.length - 1)) * width;
      const y = mid - (values[i] / 128) * (height / 2 - 4);
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }

  function clearWavetablePreview() {
    drawWavetable(null);
    if (wavetableFilenameEl) wavetableFilenameEl.textContent = "No file loaded";
  }

  function uploadWavetableFromFile() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".wav,audio/wav";
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      let decodeCtx = null;
      try {
        if (wavetableFilenameEl) {
          wavetableFilenameEl.textContent = file.name || "Unnamed file";
        }
        const buffer = await file.arrayBuffer();
        decodeCtx = new (window.AudioContext || window.webkitAudioContext)();
        const audio = await decodeCtx.decodeAudioData(buffer);
        const mono = downmixToMono(audio);
        const resampled = resampleToLength(mono, 1024);
        const normalized = normalizeSamples(resampled);
        const int8 = toInt8Array(normalized);
        pendingWavetable = int8;
        if (playWavetableBtn) playWavetableBtn.disabled = false;
        if (sendWavetableBtn) sendWavetableBtn.disabled = false;
        drawWavetable(int8);
        addLocalStatus("Wavetable converted");
      } catch (err) {
        addLocalStatus("Failed to load wavetable");
      } finally {
        if (decodeCtx && decodeCtx.state !== "closed") {
          decodeCtx.close();
        }
      }
    };
    input.click();
  }

  function ensureAudioContext() {
    if (wavetableAudioCtx && wavetableAudioCtx.state !== "closed") {
      return wavetableAudioCtx;
    }
    wavetableAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return wavetableAudioCtx;
  }

  function stopWavetablePlayback() {
    if (wavetableSource) {
      wavetableSource.stop();
      wavetableSource.disconnect();
      wavetableSource = null;
    }
    if (wavetableGain) {
      wavetableGain.disconnect();
      wavetableGain = null;
    }
    if (playWavetableBtn) playWavetableBtn.textContent = "Play";
  }

  function getWavetableGainValue() {
    if (!wavetableVolumeEl) return 0.5;
    const value = Number(wavetableVolumeEl.value);
    if (!Number.isFinite(value)) return 0.5;
    return Math.max(0, Math.min(1, value / 127));
  }

  function playWavetableLoop() {
    if (!pendingWavetable) return;
    if (wavetableSource) {
      stopWavetablePlayback();
      return;
    }
    const ctx = ensureAudioContext();
    const buffer = ctx.createBuffer(1, pendingWavetable.length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < pendingWavetable.length; i += 1) {
      data[i] = pendingWavetable[i] / 128;
    }
    const targetHz = 131;
    const baseHz = ctx.sampleRate / pendingWavetable.length;
    wavetableSource = ctx.createBufferSource();
    wavetableSource.buffer = buffer;
    wavetableSource.loop = true;
    wavetableSource.playbackRate.value = targetHz / baseHz;
    wavetableGain = ctx.createGain();
    wavetableGain.gain.value = getWavetableGainValue();
    wavetableSource.connect(wavetableGain);
    wavetableGain.connect(ctx.destination);
    wavetableSource.onended = () => {
      wavetableSource = null;
      if (wavetableGain) {
        wavetableGain.disconnect();
        wavetableGain = null;
      }
      if (playWavetableBtn) playWavetableBtn.textContent = "Play";
    };
    wavetableSource.start();
    if (playWavetableBtn) playWavetableBtn.textContent = "Stop";
  }

  async function sendWavetableToDevice() {
    if (!pendingWavetable) return;
    const tableId = wavetableTargetEl ? Number(wavetableTargetEl.value) : 0;
    if (sendWavetableBtn) sendWavetableBtn.disabled = true;
    addLocalStatus("Sending wavetable");
    const ok = await MidiControl.sendWavetableDump(tableId, pendingWavetable);
    if (ok) {
      addLocalStatus("Wavetable sent");
    } else {
      addLocalStatus("Wavetable send failed");
    }
    if (sendWavetableBtn && pendingWavetable) sendWavetableBtn.disabled = false;
  }

  ccFields.forEach(field => {
    field.addEventListener("input", () => {
      const digits = field.value.replace(/\D/g, "").slice(0, 3);
      if (field.value !== digits) field.value = digits;
    });
    field.addEventListener("change", () => sendCCMapping(field));
    field.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        field.blur();
      }
    });
  });


  velEl.oninput = () => {
    velValEl.textContent = velEl.value;
    MidiControl.sendVelocity(Number(velEl.value));
  };

  chanEl.oninput = () => {
    chanValEl.textContent = chanEl.value;
    MidiControl.sendMIDIChannel(Number(chanEl.value));
  };

  thruEl.onchange = () => {
    MidiControl.sendMIDIThru(thruEl.checked);
  };

  filterResEl.oninput = () => {
    filterResValEl.textContent = filterResEl.value;
    sendSliderCC(filterResEl);
  };

  if (deviceModeEl) {
    deviceModeEl.onchange = () => {
      MidiControl.sendDeviceMode(Number(deviceModeEl.value));
    };
  }

  storeBtn.onmousedown = () => {
    MidiControl.sendStorePreset();
  };
  storeBtn.ontouchstart = (e) => {
    e.preventDefault();
    MidiControl.sendStorePreset();
  };

  savePresetBtn.onmousedown = savePresetToFile;
  savePresetBtn.ontouchstart = (e) => {
    e.preventDefault();
    savePresetToFile();
  };
  loadPresetBtn.onmousedown = loadPresetFromFile;
  loadPresetBtn.ontouchstart = (e) => {
    e.preventDefault();
    loadPresetFromFile();
  };
  if (uploadWavetableBtn) {
    uploadWavetableBtn.onmousedown = uploadWavetableFromFile;
    uploadWavetableBtn.ontouchstart = (e) => {
      e.preventDefault();
      uploadWavetableFromFile();
    };
  }
  if (sendWavetableBtn) {
    sendWavetableBtn.onmousedown = sendWavetableToDevice;
    sendWavetableBtn.ontouchstart = (e) => {
      e.preventDefault();
      sendWavetableToDevice();
    };
  }
  if (playWavetableBtn) {
    playWavetableBtn.onmousedown = playWavetableLoop;
    playWavetableBtn.ontouchstart = (e) => {
      e.preventDefault();
      playWavetableLoop();
    };
  }
  if (wavetableVolumeEl) {
    wavetableVolumeEl.oninput = () => {
      if (wavetableGain) {
        wavetableGain.gain.value = getWavetableGainValue();
      }
    };
  }

  renderMonitorLog();
  clearWavetablePreview();
  storeBtn.disabled = true;
  savePresetBtn.disabled = true;
  loadPresetBtn.disabled = true;
  if (sendWavetableBtn) sendWavetableBtn.disabled = true;
  if (presetNameEl) presetNameEl.disabled = true;
  window.addEventListener("load", () => MidiControl.initMIDI());

  function pushLog(line, meta = {}) {
    logHistory.unshift({ line, ...meta });
    if (logHistory.length > 4) logHistory.length = 4;
    renderMonitorLog();
  }

  function formatLogLine(entry) {
    const line = entry.line;
    if (entry.kind === "sysex-status" || entry.kind === "local-status") {
      return `<span class="status-line">${escapeHtml(line)}</span>`;
    }
    if (!line.startsWith("> ") && !line.startsWith("< ")) {
      return `<span class="status-line">${escapeHtml(line)}</span>`;
    }
    return escapeHtml(line);
  }

  function escapeHtml(value) {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function pushOut(line) {
    const bytes = line.match(/0x[0-9a-f]{2}/gi) || [];
    const key = bytes[2] ? bytes[2].slice(2).toLowerCase() : null;
    if (bytes.length >= 6 &&
        bytes[0].toLowerCase() === "0xf0" &&
        bytes[1].toLowerCase() === "0x7d" &&
        bytes[2].toLowerCase() === "0x07") {
      const index = bytes[3].slice(2).toLowerCase();
      const ccKey = `cc-map-${index}`;
      const existing = logHistory.find(entry => entry.kind === "out-cc-map" && entry.key === ccKey);
      if (existing) {
        existing.line = line;
        renderMonitorLog();
        return;
      }
      pushLog(line, { kind: "out-cc-map", key: ccKey });
      return;
    }
    const sliderParams = new Set(["01", "02", "03", "04", "05", "06"]);
    if (key && sliderParams.has(key)) {
      const existing = logHistory.find(entry => entry.kind === "out-sysex" && entry.key === key);
      if (existing) {
        existing.line = line;
        renderMonitorLog();
        return;
      }
      pushLog(line, { kind: "out-sysex", key });
      return;
    }
    pushLog(line);
  }
})();
