(function () {
  "use strict";

  const TARGET_PREFIX = "Ascetik";
  const TARGET_DEVICE = "Ascetik Ash";

  const MFR = 0x7D;
  const SYSEX_DEVICE_INFO = 0x01;
  const SYSEX_LOG = 0x02;
  const SYSEX_STATUS = 0x03;
  const SYSEX_PARAM_VELOCITY = 0x0A;
  const SYSEX_PARAM_CHANNEL = 0x0B;
  const SYSEX_PARAM_THRU = 0x0C;
  const SYSEX_PARAM_DELAY_FEEDBACK = 0x0D;
  const SYSEX_PARAM_DELAY_MIX = 0x0E;
  const SYSEX_PARAM_FILTER_RESONANCE = 0x0F;
  const SYSEX_PARAM_CC_MAPPING = 0x10;
  const SYSEX_PARAM_SAVE_SETTINGS = 0x11;
  const SYSEX_PARAM_DUMP_SETTINGS = 0x12;
  const SYSEX_PARAM_DUMP_WAVETABLE = 0x13;
  const SYSEX_PARAM_DEVICE_MODE = 0x14;

  let midi = null;
  let input = null;
  let output = null;

  let handlers = {
    onSysExLog: null,
    onSysExStatus: null,
    onDeviceInfo: null,
    onSysExParam: null,
    onNote: null,
    onCC: null,
    onStatus: null,
    onStateChange: null,
  };

  function setHandlers(next) {
    handlers = { ...handlers, ...next };
  }

  function notifyStatus(msg) {
    if (handlers.onStatus) handlers.onStatus(msg);
  }

  function ascii(bytes) {
    return String.fromCharCode(...bytes);
  }

  function parseLogPayload(payload) {
    if (payload[0] !== MFR || payload[1] !== SYSEX_LOG) return null;
    const z1 = payload.indexOf(0x00, 2);
    if (z1 < 0) return null;
    const name = ascii(payload.slice(2, z1));
    const z2 = payload.indexOf(0x00, z1 + 1);
    const valueStr = ascii(payload.slice(z1 + 1, z2 < 0 ? payload.length : z2));
    return { name, value: valueStr };
  }

  function parseStatusPayload(payload) {
    if (payload[0] !== MFR || payload[1] !== SYSEX_STATUS) return null;
    const z1 = payload.indexOf(0x00, 2);
    if (z1 < 0) return null;
    return { message: ascii(payload.slice(2, z1)) };
  }

  function parseDeviceInfo(payload) {
    if (payload[0] !== MFR || payload[1] !== SYSEX_DEVICE_INFO) return null;
    if (payload.length < 7) return null;
    return {
      model: payload[2],
      hw: payload[3],
      fw: payload[4],
      serial: (payload[5] << 7) | payload[6],
    };
  }

  function parseParamPayload(payload) {
    if (payload[0] !== MFR) return null;
    if (payload.length !== 4) return null;
    const param = payload[1];
    if (param < SYSEX_PARAM_VELOCITY || param > SYSEX_PARAM_DEVICE_MODE) return null;
    return { param, a: payload[2], b: payload[3] };
  }

  function onMIDIMessage(e) {
    const d = e.data;
    if (d[0] !== 0xF0 || d[d.length - 1] !== 0xF7) return;

    const payload = Array.from(d.slice(1, -1));
    const deviceInfo = parseDeviceInfo(payload);
    if (deviceInfo) {
      if (handlers.onDeviceInfo) handlers.onDeviceInfo(deviceInfo);
      return;
    }
    const statusMsg = parseStatusPayload(payload);
    if (statusMsg) {
      if (handlers.onSysExStatus) handlers.onSysExStatus(statusMsg.message);
      return;
    }
    const logMsg = parseLogPayload(payload);
    if (logMsg) {
      if (handlers.onSysExLog) handlers.onSysExLog(logMsg.name, logMsg.value);
      return;
    }
    const paramMsg = parseParamPayload(payload);
    if (paramMsg) {
      if (handlers.onSysExParam) handlers.onSysExParam(paramMsg.param, paramMsg.a, paramMsg.b);
      return;
    }
  }

  function onNoteMessage(e) {
    const d = e.data;
    if (!d || d.length < 3) return;

    const status = d[0];
    const type = status & 0xF0;
    const channel = (status & 0x0F) + 1;
    const note = d[1];
    const velocity = d[2];

    if (type === 0x90 && velocity > 0) {
      if (handlers.onNote) handlers.onNote(note, velocity, channel, "on");
      return;
    }

    if (type === 0x80 || (type === 0x90 && velocity === 0)) {
      if (handlers.onNote) handlers.onNote(note, velocity, channel, "off");
    }
  }

  function onAnyMIDIMessage(e) {
    onMIDIMessage(e);
    onNoteMessage(e);
    onCCMessage(e);
  }

  function onCCMessage(e) {
    const d = e.data;
    if (!d || d.length < 3) return;

    const status = d[0];
    const type = status & 0xF0;
    if (type !== 0xB0) return;

    const channel = (status & 0x0F) + 1;
    const cc = d[1];
    const value = d[2];

    if (handlers.onCC) handlers.onCC(cc, value, channel);
  }

  function listInputs() {
    if (!midi) return [];
    return [...midi.inputs.values()].filter(
      i => i.name && i.name.startsWith(TARGET_PREFIX)
    );
  }

  function preferredInputId(inputs) {
    for (const i of inputs) {
      if (i.name === TARGET_DEVICE) return i.id;
    }
    return inputs.length ? inputs[0].id : null;
  }

  function selectInputById(id) {
    if (!midi) return;
    if (input) input.onmidimessage = null;
    input = midi.inputs.get(id) || null;

    output = null;
    if (input) {
      input.onmidimessage = onAnyMIDIMessage;

      const inName = input.name || "";
      for (const o of midi.outputs.values()) {
        if ((o.name || "") === inName) { output = o; break; }
      }
      if (!output) {
        const outs = [...midi.outputs.values()].filter(
          o => o.name && o.name.startsWith(TARGET_PREFIX)
        );
        if (outs.length === 1) output = outs[0];
      }

      notifyStatus("");
    }
  }

  function notifyState() {
    const inputs = listInputs();
    const preferredId = preferredInputId(inputs);
    if (handlers.onStateChange) handlers.onStateChange(inputs, preferredId);
  }

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val | 0));
  }

  function sendParam(param, value) {
    if (!output) return;
    const v = clamp(value, 0, 16383);
    const msb = (v >> 7) & 0x7F;
    const lsb = v & 0x7F;
    const msg = new Uint8Array([0xF0, MFR, param, msb, lsb, 0xF7]);
    const hex = Array.from(msg).map(b => "0x" + b.toString(16).padStart(2, "0"));
    console.log("SysEx send:", hex);
    output.send(msg);
  }

  function sendParam2(param, value1, value2) {
    if (!output) return;
    const v1 = clamp(value1, 0, 127);
    const v2 = clamp(value2, 0, 127);
    const msg = new Uint8Array([0xF0, MFR, param, v1, v2, 0xF7]);
    const hex = Array.from(msg).map(b => "0x" + b.toString(16).padStart(2, "0"));
    console.log("SysEx send:", hex);
    output.send(msg);
  }

  function sendDeviceInfoRequest() {
    if (!output) return;
    const msg = new Uint8Array([0xF0, MFR, SYSEX_DEVICE_INFO, 0xF7]);
    const hex = Array.from(msg).map(b => "0x" + b.toString(16).padStart(2, "0"));
    console.log("SysEx send:", hex);
    output.send(msg);
  }

  function sendVelocity(v) {
    sendParam(SYSEX_PARAM_VELOCITY, clamp(v, 0, 127));
  }

  function sendMIDIChannel(ch) {
    sendParam(SYSEX_PARAM_CHANNEL, clamp(ch, 1, 16));
  }

  function sendMIDIThru(enabled) {
    sendParam(SYSEX_PARAM_THRU, enabled ? 1 : 0);
  }

  function sendDelayFeedback(v) {
    sendParam(SYSEX_PARAM_DELAY_FEEDBACK, clamp(v, 0, 127));
  }

  function sendDelayMix(v) {
    sendParam(SYSEX_PARAM_DELAY_MIX, clamp(v, 0, 127));
  }

  function sendFilterResonance(v) {
    sendParam(SYSEX_PARAM_FILTER_RESONANCE, clamp(v, 0, 255));
  }

  function sendCC(cc, value, channel) {
    if (!output) return;
    const ch = clamp(channel || 1, 1, 16);
    const msg = new Uint8Array([
      0xB0 + (ch - 1),
      clamp(cc, 0, 127),
      clamp(value, 0, 127),
    ]);
    output.send(msg);
  }

  function sendCCMap(index, value) {
    sendParam2(SYSEX_PARAM_CC_MAPPING, clamp(index, 0, 12), clamp(value, 0, 127));
  }

  function sendDeviceMode(mode) {
    sendParam(SYSEX_PARAM_DEVICE_MODE, clamp(mode, 0, 2));
  }

  function sendStorePreset() {
    sendParam(SYSEX_PARAM_SAVE_SETTINGS, 1);
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function sendWavetableDump(tableId, samples) {
    if (!output) return false;
    if (!samples || samples.length !== 1024) return false;
    const table = clamp(tableId, 0, 2);
    const chunkSize = 32;
    const totalChunks = samples.length / chunkSize;
    for (let chunk = 0; chunk < totalChunks; chunk += 1) {
      const start = chunk * chunkSize;
      const msg = [0xF0, MFR, SYSEX_PARAM_DUMP_WAVETABLE, table, chunk];
      for (let i = 0; i < chunkSize; i += 1) {
        const value = (samples[start + i] | 0) + 128;
        const msb = (value >> 7) & 0x01;
        const lsb = value & 0x7F;
        msg.push(msb, lsb);
      }
      msg.push(0xF7);
      output.send(new Uint8Array(msg));
      await sleep(4);
    }
    return true;
  }

  async function initMIDI() {
    if (!navigator.requestMIDIAccess) {
      notifyStatus("WebMIDI not supported");
      return;
    }

    try {
      notifyStatus("Looking for devices…");
      midi = await navigator.requestMIDIAccess({ sysex: true });
      notifyState();
      midi.onstatechange = notifyState;
    } catch {
      notifyStatus("MIDI access denied or SysEx blocked");
    }
  }

  window.MidiControl = {
    initMIDI,
    setHandlers,
    selectInputById,
    sendDeviceInfoRequest,
    sendVelocity,
    sendMIDIChannel,
    sendMIDIThru,
    sendDelayFeedback,
    sendDelayMix,
    sendFilterResonance,
    sendCC,
    sendCCMap,
    sendStorePreset,
    sendWavetableDump,
    sendDeviceMode,
  };
})();
