import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const STORAGE_KEY = "korean-vocab-cards";
const CLOUD_URL_KEY = "korean-vocab-supabase-url";
const CLOUD_ANON_KEY = "korean-vocab-supabase-anon";
const DAY = 24 * 60 * 60 * 1000;

const $ = (selector) => document.querySelector(selector);
const todayKey = () => new Date().toISOString().slice(0, 10);
const daysFromNow = (days) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

const state = {
  cards: loadCards(),
  reviewQueue: [],
  currentId: null,
  revealed: false,
  filter: "",
  supabase: null,
  user: null,
  cloudReady: false,
  syncing: false,
};

const els = {
  totalCount: $("#totalCount"),
  dueCount: $("#dueCount"),
  masteredCount: $("#masteredCount"),
  wordForm: $("#wordForm"),
  wordInput: $("#wordInput"),
  meaningInput: $("#meaningInput"),
  noteInput: $("#noteInput"),
  posInput: $("#posInput"),
  pronunciationInput: $("#pronunciationInput"),
  formsInput: $("#formsInput"),
  reviewCard: $("#reviewCard"),
  reviewSubhead: $("#reviewSubhead"),
  shuffleReview: $("#shuffleReview"),
  revealAnswer: $("#revealAnswer"),
  againButton: $("#againButton"),
  hardButton: $("#hardButton"),
  goodButton: $("#goodButton"),
  filterInput: $("#filterInput"),
  exportButton: $("#exportButton"),
  importInput: $("#importInput"),
  wordList: $("#wordList"),
  supabaseUrlInput: $("#supabaseUrlInput"),
  supabaseAnonInput: $("#supabaseAnonInput"),
  saveCloudConfig: $("#saveCloudConfig"),
  syncEmailInput: $("#syncEmailInput"),
  sendLoginLink: $("#sendLoginLink"),
  signOutButton: $("#signOutButton"),
  pullCloudButton: $("#pullCloudButton"),
  pushCloudButton: $("#pushCloudButton"),
  syncStatus: $("#syncStatus"),
};

els.supabaseUrlInput.value = localStorage.getItem(CLOUD_URL_KEY) || "";
els.supabaseAnonInput.value = localStorage.getItem(CLOUD_ANON_KEY) || "";

els.wordForm.addEventListener("submit", saveWordFromForm);
els.revealAnswer.addEventListener("click", revealCurrent);
els.againButton.addEventListener("click", () => gradeCurrent("again"));
els.hardButton.addEventListener("click", () => gradeCurrent("hard"));
els.goodButton.addEventListener("click", () => gradeCurrent("good"));
els.shuffleReview.addEventListener("click", nextReviewCard);
els.filterInput.addEventListener("input", (event) => {
  state.filter = event.target.value.trim().toLowerCase();
  renderLibrary();
});
els.exportButton.addEventListener("click", exportCards);
els.importInput.addEventListener("change", importCards);
els.saveCloudConfig.addEventListener("click", saveCloudConfig);
els.sendLoginLink.addEventListener("click", sendLoginLink);
els.signOutButton.addEventListener("click", signOut);
els.pullCloudButton.addEventListener("click", pullCloudCards);
els.pushCloudButton.addEventListener("click", pushCloudCards);

renderAll();
initCloud();

function loadCards() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.cards));
}

function renderAll() {
  rebuildReviewQueue();
  renderStats();
  renderReview();
  renderLibrary();
}

function renderStats() {
  const due = state.cards.filter((card) => card.nextReview <= todayKey()).length;
  const mastered = state.cards.filter((card) => card.box >= 5).length;
  els.totalCount.textContent = state.cards.length;
  els.dueCount.textContent = due;
  els.masteredCount.textContent = mastered;
}

function rebuildReviewQueue() {
  state.reviewQueue = state.cards
    .filter((card) => card.nextReview <= todayKey())
    .sort((a, b) => a.nextReview.localeCompare(b.nextReview) || a.createdAt.localeCompare(b.createdAt))
    .map((card) => card.id);

  if (state.currentId && !state.reviewQueue.includes(state.currentId)) {
    state.currentId = null;
  }
  if (!state.currentId && state.reviewQueue.length > 0) {
    state.currentId = state.reviewQueue[0];
  }
}

function renderReview() {
  const card = currentCard();
  const dueCount = state.reviewQueue.length;
  els.reviewSubhead.textContent = dueCount ? `今天还有 ${dueCount} 张卡片。` : "还没有到期卡片时，可以先录入几个新词。";

  if (!card) {
    els.reviewCard.className = "review-card empty";
    els.reviewCard.innerHTML = `<p class="empty-title">今天的卡片会出现在这里</p><p>单词先出现，点“显示答案”后再判断熟练度。</p>`;
    setReviewButtons(false);
    return;
  }

  els.reviewCard.className = "review-card";
  els.reviewCard.innerHTML = `
    <div>
      <div class="card-word" lang="ko">${escapeHtml(card.word)}</div>
      ${card.pronunciation ? `<div class="card-pronunciation">[${escapeHtml(card.pronunciation)}]</div>` : ""}
      <p class="card-schedule">第 ${card.box} 阶段 · 下次复习：${escapeHtml(card.nextReview)}</p>
    </div>
    <div class="card-answer" ${state.revealed ? "" : "hidden"}>
      <div>
        <div class="answer-label">中文释义</div>
        <p>${lineBreaks(card.meaning || "还没有释义")}</p>
      </div>
      ${card.forms ? `<div><div class="answer-label">变形 / 派生</div><p lang="ko">${lineBreaks(card.forms)}</p></div>` : ""}
      ${card.note ? `<div><div class="answer-label">我的笔记</div><p>${lineBreaks(card.note)}</p></div>` : ""}
    </div>
  `;
  setReviewButtons(true);
}

function setReviewButtons(hasCard) {
  els.revealAnswer.disabled = !hasCard;
  els.againButton.disabled = !hasCard || !state.revealed;
  els.hardButton.disabled = !hasCard || !state.revealed;
  els.goodButton.disabled = !hasCard || !state.revealed;
}

function renderLibrary() {
  const cards = state.cards
    .filter((card) => {
      const haystack = [card.word, card.meaning, card.note, card.pos, card.forms].join(" ").toLowerCase();
      return !state.filter || haystack.includes(state.filter);
    })
    .sort((a, b) => a.nextReview.localeCompare(b.nextReview) || b.createdAt.localeCompare(a.createdAt));

  if (cards.length === 0) {
    els.wordList.innerHTML = `<p class="word-text">词库暂时是空的。先录入一个今天新学的词吧。</p>`;
    return;
  }

  els.wordList.innerHTML = cards.map((card) => `
    <article class="word-item" data-id="${card.id}">
      <div class="word-title-row">
        <strong lang="ko">${escapeHtml(card.word)}</strong>
        <span class="word-meta">${escapeHtml(card.pos || "未标注")}</span>
      </div>
      <p class="word-text">${escapeHtml(firstLine(card.meaning) || "无释义")}</p>
      <p class="word-meta">阶段 ${card.box} · 下次 ${escapeHtml(card.nextReview)}</p>
      <div class="word-actions">
        <button class="tiny-button" data-action="speak">朗读</button>
        <button class="tiny-button" data-action="edit">编辑</button>
        <button class="tiny-button" data-action="delete">删除</button>
      </div>
    </article>
  `).join("");

  els.wordList.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", handleCardAction);
  });
}

function saveWordFromForm(event) {
  event.preventDefault();
  const word = els.wordInput.value.trim();
  if (!word) return;

  const existing = state.cards.find((card) => card.word === word);
  const payload = {
    word,
    meaning: els.meaningInput.value.trim(),
    note: els.noteInput.value.trim(),
    pos: els.posInput.value.trim(),
    pronunciation: els.pronunciationInput.value.trim(),
    forms: els.formsInput.value.trim(),
    updatedAt: new Date().toISOString(),
  };

  if (existing) {
    Object.assign(existing, payload);
    toast("已更新这个词");
  } else {
    state.cards.push({
      id: crypto.randomUUID(),
      ...payload,
      box: 1,
      nextReview: todayKey(),
      createdAt: new Date().toISOString(),
      history: [],
    });
    toast("已加入今日复习");
  }

  persist();
  els.wordForm.reset();
  renderAll();
  syncCard(existing || state.cards.find((card) => card.word === word));
}

function currentCard() {
  return state.cards.find((card) => card.id === state.currentId);
}

function revealCurrent() {
  state.revealed = true;
  renderReview();
}

function gradeCurrent(grade) {
  const card = currentCard();
  if (!card) return;

  const oldBox = card.box;
  if (grade === "again") {
    card.box = 1;
    card.nextReview = daysFromNow(1);
  }
  if (grade === "hard") {
    card.box = Math.max(1, card.box);
    card.nextReview = daysFromNow(Math.max(1, card.box));
  }
  if (grade === "good") {
    card.box = Math.min(6, card.box + 1);
    const intervals = [0, 1, 3, 7, 14, 30, 60];
    card.nextReview = daysFromNow(intervals[card.box] || 60);
  }

  card.history.push({ date: new Date().toISOString(), grade, from: oldBox, to: card.box });
  card.updatedAt = new Date().toISOString();
  state.currentId = null;
  state.revealed = false;
  persist();
  renderAll();
  syncCard(card);
}

function nextReviewCard() {
  if (state.reviewQueue.length < 2) return;
  const index = state.reviewQueue.indexOf(state.currentId);
  const nextIndex = index >= 0 ? (index + 1) % state.reviewQueue.length : 0;
  state.currentId = state.reviewQueue[nextIndex];
  state.revealed = false;
  renderReview();
}

function handleCardAction(event) {
  const item = event.target.closest(".word-item");
  const card = state.cards.find((entry) => entry.id === item.dataset.id);
  if (!card) return;

  const action = event.target.dataset.action;
  if (action === "speak") speakKorean(card.word);
  if (action === "edit") editCard(card);
  if (action === "delete") deleteCard(card);
}

function speakKorean(word) {
  const utterance = new SpeechSynthesisUtterance(word);
  utterance.lang = "ko-KR";
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

function editCard(card) {
  els.wordInput.value = card.word;
  els.meaningInput.value = card.meaning || "";
  els.noteInput.value = card.note || "";
  els.posInput.value = card.pos || "";
  els.pronunciationInput.value = card.pronunciation || "";
  els.formsInput.value = card.forms || "";
  els.wordInput.focus();
}

function deleteCard(card) {
  state.cards = state.cards.filter((entry) => entry.id !== card.id);
  persist();
  renderAll();
  deleteCloudCard(card.id);
  toast("已删除");
}

function exportCards() {
  const blob = new Blob([JSON.stringify(state.cards, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `korean-vocab-${todayKey()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importCards(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(String(reader.result));
      if (!Array.isArray(imported)) throw new Error("格式不正确");
      const byWord = new Map(state.cards.map((card) => [card.word, card]));
      imported.forEach((card) => byWord.set(card.word, { ...card, id: card.id || crypto.randomUUID() }));
      state.cards = [...byWord.values()];
      persist();
      renderAll();
      pushCloudCards();
      toast("导入完成");
    } catch (error) {
      toast(`导入失败：${error.message}`);
    }
  };
  reader.readAsText(file);
  event.target.value = "";
}

async function initCloud() {
  const url = els.supabaseUrlInput.value.trim();
  const anonKey = els.supabaseAnonInput.value.trim();
  if (!url || !anonKey) {
    updateCloudStatus("未配置云端");
    return;
  }

  try {
    state.supabase = createClient(url, anonKey);
    state.cloudReady = true;
    const { data, error } = await state.supabase.auth.getSession();
    if (error) throw error;
    state.user = data.session?.user || null;
    state.supabase.auth.onAuthStateChange((_event, session) => {
      state.user = session?.user || null;
      updateCloudStatus();
      if (state.user) {
        pullCloudCards({ quiet: true });
      }
    });
    updateCloudStatus();
  } catch (error) {
    state.cloudReady = false;
    updateCloudStatus(`云配置不可用：${error.message}`);
  }
}

function saveCloudConfig() {
  localStorage.setItem(CLOUD_URL_KEY, els.supabaseUrlInput.value.trim());
  localStorage.setItem(CLOUD_ANON_KEY, els.supabaseAnonInput.value.trim());
  state.supabase = null;
  state.user = null;
  state.cloudReady = false;
  initCloud();
  toast("云配置已保存");
}

async function sendLoginLink() {
  if (!state.supabase) {
    toast("先保存云配置");
    return;
  }
  const email = els.syncEmailInput.value.trim();
  if (!email) {
    toast("先输入邮箱");
    return;
  }
  const { error } = await state.supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: window.location.href.split("#")[0],
    },
  });
  if (error) {
    toast(`发送失败：${error.message}`);
    return;
  }
  toast("登录邮件已发送，请去邮箱点链接");
}

async function signOut() {
  if (!state.supabase) return;
  await state.supabase.auth.signOut();
  state.user = null;
  updateCloudStatus();
  toast("已退出云端登录");
}

async function pullCloudCards(options = {}) {
  if (!ensureCloudUser()) return;
  setSyncing(true, "正在从云端拉取...");
  const { data, error } = await state.supabase
    .from("vocab_cards")
    .select("*")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });

  if (error) {
    setSyncing(false, `拉取失败：${error.message}`);
    return;
  }

  const merged = new Map(state.cards.map((card) => [card.id, card]));
  data.forEach((row) => {
    const cloudCard = rowToCard(row);
    const localCard = merged.get(cloudCard.id);
    if (!localCard || newerThan(cloudCard.updatedAt, localCard.updatedAt)) {
      merged.set(cloudCard.id, cloudCard);
    }
  });

  state.cards = [...merged.values()];
  persist();
  renderAll();
  setSyncing(false);
  if (!options.quiet) toast("已从云端拉取");
}

async function pushCloudCards() {
  if (!ensureCloudUser()) return;
  if (state.cards.length === 0) {
    toast("本地词库为空");
    return;
  }

  setSyncing(true, "正在同步到云端...");
  const rows = state.cards.map(cardToRow);
  const { error } = await state.supabase
    .from("vocab_cards")
    .upsert(rows, { onConflict: "id" });

  if (error) {
    setSyncing(false, `同步失败：${error.message}`);
    return;
  }

  setSyncing(false);
  toast("已同步到云端");
}

async function syncCard(card) {
  if (!card || !state.supabase || !state.user || state.syncing) return;
  await state.supabase.from("vocab_cards").upsert(cardToRow(card), { onConflict: "id" });
  updateCloudStatus("已自动同步");
}

async function deleteCloudCard(id) {
  if (!state.supabase || !state.user) return;
  await state.supabase
    .from("vocab_cards")
    .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id);
}

function ensureCloudUser() {
  if (!state.supabase) {
    toast("先保存云配置");
    return false;
  }
  if (!state.user) {
    toast("先用邮箱登录云端");
    return false;
  }
  return true;
}

function cardToRow(card) {
  return {
    id: card.id,
    user_id: state.user.id,
    word: card.word,
    meaning: card.meaning || "",
    note: card.note || "",
    pos: card.pos || "",
    pronunciation: card.pronunciation || "",
    forms: card.forms || "",
    box: card.box || 1,
    next_review: card.nextReview || todayKey(),
    created_at: card.createdAt || new Date().toISOString(),
    updated_at: card.updatedAt || new Date().toISOString(),
    history: card.history || [],
    deleted_at: null,
  };
}

function rowToCard(row) {
  return {
    id: row.id,
    word: row.word,
    meaning: row.meaning || "",
    note: row.note || "",
    pos: row.pos || "",
    pronunciation: row.pronunciation || "",
    forms: row.forms || "",
    box: row.box || 1,
    nextReview: row.next_review || todayKey(),
    createdAt: row.created_at || new Date().toISOString(),
    updatedAt: row.updated_at || new Date().toISOString(),
    history: row.history || [],
  };
}

function newerThan(left, right) {
  return new Date(left || 0).getTime() > new Date(right || 0).getTime();
}

function setSyncing(syncing, message) {
  state.syncing = syncing;
  updateCloudStatus(message);
}

function updateCloudStatus(message) {
  if (message) {
    els.syncStatus.textContent = message;
  } else if (!state.cloudReady) {
    els.syncStatus.textContent = "未配置云端";
  } else if (!state.user) {
    els.syncStatus.textContent = "云端已配置，未登录";
  } else {
    els.syncStatus.textContent = `已登录：${state.user.email || "当前账号"}`;
  }

  const canUseCloud = Boolean(state.supabase && state.user && !state.syncing);
  els.signOutButton.disabled = !state.user || state.syncing;
  els.pullCloudButton.disabled = !canUseCloud;
  els.pushCloudButton.disabled = !canUseCloud;
}

function firstLine(value) {
  return String(value || "").split(/\n/)[0];
}

function lineBreaks(value) {
  return escapeHtml(value).replace(/\n/g, "<br />");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function toast(message) {
  const existing = document.querySelector(".toast");
  existing?.remove();
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  document.body.append(node);
  setTimeout(() => node.remove(), 2600);
}
