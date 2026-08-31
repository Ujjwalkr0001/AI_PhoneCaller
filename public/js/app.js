import * as api from './api.js';
import { formatClock, formatDurationWords, formatPhone, formatWhen, normalizePhone, isValidPhone } from './format.js';
import { iconPhone, iconSparkle, iconPerson, iconCheck, iconBack, iconMissed } from './icons.js';

const stage = document.getElementById('stage');
const historyList = document.getElementById('historyList');
const toast = document.getElementById('toast');

const TERMINAL_STATUSES = new Set(['completed', 'no-answer', 'busy', 'failed']);
const POLL_INTERVAL_MS = 500;
const TICK_INTERVAL_MS = 200;

let pollToken = 0;
let tickHandle = null;
let toastTimer = null;

// ---------------------------------------------------------------- rendering

function setView(html) {
  stage.classList.remove('view-enter');
  // Force reflow so the enter animation replays every time.
  void stage.offsetWidth;
  stage.innerHTML = html;
  stage.classList.add('view-enter');
}

function renderIdle() {
  setView(`
    <div class="dial">
      <div class="dial-icon">${iconPhone}</div>
      <h1>Start a call</h1>
      <p class="dial-sub">Enter a number to begin an AI-powered voice call.</p>
      <form id="dialForm" class="dial-form" novalidate>
        <input id="phoneInput" class="phone-input" type="tel" placeholder="+1 415 555 0132" autocomplete="tel" />
        <button id="callBtn" class="btn-call" type="submit">
          <span class="btn-call-icon">${iconPhone}</span>
          <span>Call</span>
        </button>
      </form>
      <p id="dialError" class="field-error" hidden></p>
    </div>
  `);
  document.getElementById('dialForm').addEventListener('submit', onDialSubmit);
  document.getElementById('phoneInput').focus();
}

function renderConnecting(phone) {
  setView(`
    <div class="status-card connecting">
      <div class="connect-dot"></div>
      <div class="status-phone">${formatPhone(phone)}</div>
      <div class="status-label">Calling…</div>
    </div>
  `);
}

function renderActive(phone) {
  setView(`
    <div class="status-card active">
      <div class="pulse">
        <span class="pulse-ring"></span>
        <span class="pulse-ring delay"></span>
        <span class="pulse-dot"></span>
      </div>
      <div class="status-phone">${formatPhone(phone)}</div>
      <div class="status-label">Call in progress</div>
      <div class="call-timer" id="callTimer">00:00</div>
      <div class="waveform" aria-hidden="true">
        <span></span><span></span><span></span><span></span><span></span><span></span>
      </div>
    </div>
  `);
}

function speakerMeta(role) {
  return role === 'agent'
    ? { label: 'AI Agent', icon: iconSparkle, cls: 'agent' }
    : { label: 'Customer', icon: iconPerson, cls: 'caller' };
}

function renderTranscript(session) {
  const isCompleted = session.status === 'completed';
  const statusLabel = { completed: 'Completed', 'no-answer': 'No answer', busy: 'Busy', failed: 'Failed' }[session.status] ?? session.status;

  const body = !isCompleted
    ? `<div class="empty-state">
         <div class="empty-icon">${iconMissed}</div>
         <p>This call wasn't answered, so there's no transcript to show.</p>
       </div>`
    : `<div class="transcript-body">
         ${session.transcript
           .map((entry) => {
             const meta = speakerMeta(entry.role);
             const seconds = (new Date(entry.at) - new Date(session.answeredAt ?? session.callStartedAt)) / 1000;
             return `
               <div class="turn ${meta.cls}">
                 <div class="turn-label">
                   <span class="speaker-icon">${meta.icon}</span>
                   <span class="speaker-name">${meta.label}</span>
                   <span class="turn-time">${formatClock(seconds)}</span>
                 </div>
                 <p class="turn-text">${escapeHtml(entry.text)}</p>
               </div>`;
           })
           .join('')}
       </div>`;

  setView(`
    <div class="transcript-view">
      <button id="backBtn" class="back-btn" type="button">${iconBack}<span>New call</span></button>
      <div class="transcript-header">
        <div class="transcript-phone">${formatPhone(session.phone)}</div>
        <div class="transcript-meta">
          <span class="status-pill ${session.status}">${statusLabel}</span>
          ${isCompleted ? `<span class="meta-sep">·</span><span>${formatDurationWords(session.durationSeconds ?? 0)}</span>` : ''}
          <span class="meta-sep">·</span><span>${formatWhen(session.callStartedAt)}</span>
        </div>
      </div>
      ${body}
    </div>
  `);
  document.getElementById('backBtn').addEventListener('click', () => {
    stopPolling();
    renderIdle();
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// -------------------------------------------------------------------- toast

function showToast(message) {
  clearTimeout(toastTimer);
  toast.innerHTML = `<span class="toast-icon">${iconCheck}</span><span>${escapeHtml(message)}</span>`;
  toast.hidden = false;
  toast.classList.remove('toast-out');
  requestAnimationFrame(() => toast.classList.add('toast-in'));
  toastTimer = setTimeout(() => {
    toast.classList.remove('toast-in');
    toast.classList.add('toast-out');
    setTimeout(() => { toast.hidden = true; }, 260);
  }, 2400);
}

// -------------------------------------------------------------- dial + flow

async function onDialSubmit(event) {
  event.preventDefault();
  const input = document.getElementById('phoneInput');
  const errorEl = document.getElementById('dialError');
  const raw = input.value;

  if (!isValidPhone(raw)) {
    errorEl.textContent = 'Enter a valid phone number, e.g. +1 415 555 0132';
    errorEl.hidden = false;
    input.classList.add('shake');
    setTimeout(() => input.classList.remove('shake'), 400);
    return;
  }

  const phone = normalizePhone(raw);
  const btn = document.getElementById('callBtn');
  btn.disabled = true;
  btn.classList.add('is-loading');

  try {
    const { callSid } = await api.placeCall(phone);
    showToast(`Call placed to ${formatPhone(phone)}`);
    renderConnecting(phone);
    beginPolling(callSid, phone);
  } catch {
    errorEl.textContent = "Couldn't place the call. Please try again.";
    errorEl.hidden = false;
    btn.disabled = false;
    btn.classList.remove('is-loading');
  }
}

function stopPolling() {
  pollToken += 1;
  stopTicking();
}

function beginPolling(callSid, phone) {
  pollToken += 1;
  const myToken = pollToken;
  let shownActive = false;

  const poll = async () => {
    if (myToken !== pollToken) return;
    let session;
    try {
      session = await api.getCallStatus(callSid);
    } catch {
      return; // transient — try again next tick
    }
    if (myToken !== pollToken) return;

    if (session.status === 'in-progress') {
      if (!shownActive) {
        renderActive(phone);
        shownActive = true;
      }
      startTicking(session.answeredAt);
    } else if (TERMINAL_STATUSES.has(session.status)) {
      stopTicking();
      renderTranscript(session);
      refreshHistory();
      return;
    }
    setTimeout(poll, POLL_INTERVAL_MS);
  };

  poll();
}

function startTicking(answeredAtIso) {
  stopTicking();
  const answeredAt = new Date(answeredAtIso).getTime();
  const tick = () => {
    const el = document.getElementById('callTimer');
    if (!el) return;
    el.textContent = formatClock((Date.now() - answeredAt) / 1000);
  };
  tick();
  tickHandle = setInterval(tick, TICK_INTERVAL_MS);
}

function stopTicking() {
  if (tickHandle) clearInterval(tickHandle);
  tickHandle = null;
}

// ------------------------------------------------------------------ history

function historySkeleton(count = 4) {
  return Array.from({ length: count }, () => `
    <div class="history-item skeleton">
      <div class="skeleton-line short"></div>
      <div class="skeleton-line long"></div>
    </div>
  `).join('');
}

function renderHistory(calls) {
  if (!calls.length) {
    historyList.innerHTML = `<p class="history-empty">Your call history will appear here.</p>`;
    return;
  }
  historyList.innerHTML = calls
    .map((call) => {
      const statusLabel = { completed: 'Completed', 'no-answer': 'No answer', busy: 'Busy', failed: 'Failed', ringing: 'Ringing', 'in-progress': 'Live' }[call.status] ?? call.status;
      return `
        <button class="history-item" data-call-sid="${call.callSid}">
          <div class="history-main">
            <span class="history-phone">${formatPhone(call.phone)}</span>
            <span class="status-pill ${call.status}">${statusLabel}</span>
          </div>
          <div class="history-sub">
            <span>${formatWhen(call.callStartedAt)}</span>
            ${typeof call.durationSeconds === 'number' && call.durationSeconds > 0 ? `<span class="dot-sep">•</span><span>${formatDurationWords(call.durationSeconds)}</span>` : ''}
          </div>
        </button>`;
    })
    .join('');

  historyList.querySelectorAll('.history-item').forEach((item) => {
    item.addEventListener('click', () => openHistoryItem(item.dataset.callSid));
  });
}

async function openHistoryItem(callSid) {
  stopPolling();
  try {
    const session = await api.getCallStatus(callSid);
    renderTranscript(session);
  } catch {
    // Item disappeared between render and click — ignore.
  }
}

async function refreshHistory() {
  try {
    const calls = await api.listCalls();
    renderHistory(calls);
  } catch {
    // keep last known list on a transient failure
  }
}

// -------------------------------------------------------------------- init

historyList.innerHTML = historySkeleton();
renderIdle();
refreshHistory();
