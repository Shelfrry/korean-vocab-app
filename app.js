import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const STORAGE_KEY = "korean-vocab-v2";
const CLOUD_URL_KEY = "korean-vocab-supabase-url";
const CLOUD_ANON_KEY = "korean-vocab-supabase-anon";
const LAST_SYNC_KEY = "korean-vocab-v2-last-sync-at";
const SUPABASE_V2_TABLE = "korean_vocab_words_v2";
const SUPABASE_LEGACY_TABLE = "vocab_cards";
const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const DAILY_GOAL = 10;

const $ = (selector) => document.querySelector(selector);
const nowIso = () => new Date().toISOString();
const todayKey = () => new Date().toISOString().slice(0, 10);
const minutesFromNow = (minutes) => new Date(Date.now() + minutes * MINUTE).toISOString();
const daysFromNow = (days) => new Date(Date.now() + days * DAY).toISOString();

const state = {
  words: loadWords(),
  dueCards: [],
  currentIndex: 0,
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
  doneCount: $("#doneCount"),
  goalProgress: $("#goalProgress"),
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
  nextReview: $("#nextReview"),
  revealAnswer: $("#revealAnswer"),
  forgotButton: $("#forgotButton"),
  fuzzyButton: $("#fuzzyButton"),
  knownButton: $("#knownButton"),
  easyButton: $("#easyButton"),
  filterInput: $("#filterInput"),
  exportButton: $("#exportButton"),
  importInput: $("#importInput"),
  wordList: $("#wordList"),
  supabaseUrlInput: $("#supabaseUrlInput"),
  supabaseAnonInput: $("#supabaseAnonInput"),
  saveCloudConfig: $("#saveCloudConfig"),
  syncEmailInput: $("#syncEmailInput"),
  sendLoginLink: $("#sendLoginLink"),
  refreshSessionButton: $("#refreshSessionButton"),
  signOutButton: $("#signOutButton"),
  pullCloudButton: $("#pullCloudButton"),
  pushCloudButton: $("#pushCloudButton"),
  importLegacyButton: $("#importLegacyButton"),
  syncStatus: $("#syncStatus"),
  tabButtons: document.querySelectorAll(".tab-button"),
  tabViews: document.querySelectorAll(".tab-view"),
};

els.supabaseUrlInput.value = localStorage.getItem(CLOUD_URL_KEY) || "";
els.supabaseAnonInput.value = localStorage.getItem(CLOUD_ANON_KEY) || "";

els.wordForm.addEventListener("submit", saveWordFromForm);
els.revealAnswer.addEventListener("click", revealCurrent);
els.forgotButton.addEventListener("click", () => reviewCurrent("forgot"));
els.fuzzyButton.addEventListener("click", () => reviewCurrent("fuzzy"));
els.knownButton.addEventListener("click", () => reviewCurrent("known"));
els.easyButton.addEventListener("click", () => reviewCurrent("easy"));
els.nextReview.addEventListener("click", nextReviewCard);
els.filterInput.addEventListener("input", (event) => {
  state.filter = event.target.value.trim().toLowerCase();
  renderLibrary();
});
els.exportButton.addEventListener("click", exportWords);
els.importInput.addEventListener("change", importWords);
els.saveCloudConfig.addEventListener("click", saveCloudConfig);
els.sendLoginLink.addEventListener("click", sendLoginLink);
els.refreshSessionButton.addEventListener("click", refreshSession);
els.signOutButton.addEventListener("click", signOut);
els.pullCloudButton.addEventListener("click", restoreFromCloudV2);
els.pushCloudButton.addEventListener("click", syncToCloudV2);
els.importLegacyButton.addEventListener("click", importLegacyToV2);
els.tabButtons.forEach((button) => {
  button.addEventListener("click", () => switchTab(button.dataset.tab));
});

renderAll();
initCloud();

function loadWords() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(parsed) ? normalizeWords(parsed) : [];
  } catch {
    return [];
  }
}

function normalizeWords(words) {
  let changed = false;
  const normalized = words.map((word) => {
    if (typeof word.mastered !== "boolean") {
      word.mastered = false;
      changed = true;
    }
    (word.reviewCards || []).forEach((card) => {
      if (!Array.isArray(card.reviewHistory)) {
        card.reviewHistory = [];
        changed = true;
      }
    });
    return word;
  });
  if (changed) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  }
  return normalized;
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.words));
}

function renderAll() {
  rebuildDueCards();
  renderStats();
  renderReview();
  renderLibrary();
}

function rebuildDueCards() {
  const now = Date.now();
  state.dueCards = state.words
    .flatMap((word) => {
      return (word.reviewCards || []).map((card) => ({ word, card }));
    })
    .filter(({ card }) => new Date(card.dueDate).getTime() <= now)
    .sort((left, right) => {
      return new Date(left.card.dueDate).getTime() - new Date(right.card.dueDate).getTime();
    })
    .slice(0, DAILY_GOAL);

  if (state.currentIndex >= state.dueCards.length) {
    state.currentIndex = 0;
  }
}

function renderStats() {
  const allCards = state.words.flatMap((word) => word.reviewCards || []);
  const allDueCount = allCards.filter((card) => new Date(card.dueDate).getTime() <= Date.now()).length;
  const doneToday = allCards.filter((card) => String(card.lastReviewedAt || "").startsWith(todayKey())).length;
  const mastered = state.words.filter((word) => word.mastered).length;

  els.totalCount.textContent = state.words.length;
  els.dueCount.textContent = allDueCount;
  els.doneCount.textContent = doneToday;
  els.goalProgress.innerHTML = `
    <span class="goal-value">${mastered}</span>
    <small class="goal-title">已掌握</small>
  `;
  els.masteredCount.textContent = mastered;
}

function renderReview() {
  const entry = state.dueCards[state.currentIndex];
  const dueCount = state.dueCards.length;
  els.reviewSubhead.textContent = dueCount
    ? `今天默认显示 ${dueCount} 张到期卡片。`
    : "还没有到期卡片时，可以先录入几个新词。";

  if (!entry) {
    els.reviewCard.className = "review-card empty";
    els.reviewCard.innerHTML = `<p class="empty-title">今天没有到期卡片。</p><p>可以去录入页添加新词，或等待下一次复习。</p>`;
    setReviewButtons(false);
    return;
  }

  const { word, card } = entry;
  const isZhToKo = card.direction === "zh_to_ko";
  const directionLabel = isZhToKo ? "中 → 韩" : "韩 → 中";
  const front = isZhToKo
    ? `<div class="card-meaning">${lineBreaks(word.meaning || "还没有中文释义")}</div>`
    : `<div class="card-word" lang="ko">${escapeHtml(word.korean)}</div>`;
  const answer = isZhToKo ? renderZhToKoAnswer(word) : renderKoToZhAnswer(word);
  const speakButton = !state.revealed && !isZhToKo
    ? `<button type="button" id="speakCurrentButton" class="card-speak-button">朗读</button>`
    : "";

  els.reviewCard.className = state.revealed ? "review-card revealed" : "review-card";
  els.reviewCard.innerHTML = `
    <div>
      <div class="answer-label">${directionLabel}</div>
      ${front}
      ${word.pronunciation ? `<div class="card-pronunciation">[${escapeHtml(word.pronunciation)}]</div>` : ""}
      <p class="card-schedule">${escapeHtml(card.stage)} · 已复习 ${card.reviewCount} 次 · streak ${card.correctStreak}</p>
    </div>
    <div class="card-answer" ${state.revealed ? "" : "hidden"}>
      ${answer}
    </div>
    ${speakButton}
  `;
  $("#speakCurrentButton")?.addEventListener("click", () => speakKorean(word.korean));
  setReviewButtons(true);
}

function renderKoToZhAnswer(word) {
  return `
    ${renderAnswerRow("中文释义", word.meaning || "还没有释义")}
    ${word.partOfSpeech ? renderAnswerRow("词性", displayPartOfSpeech(word.partOfSpeech)) : ""}
    ${word.forms ? renderAnswerRow("变形 / 派生", word.forms, "ko") : ""}
  `;
}

function renderZhToKoAnswer(word) {
  return `
    ${renderAnswerRow("韩语词条", word.korean, "ko")}
    ${word.baseForm ? renderAnswerRow("原形", word.baseForm, "ko") : ""}
    ${word.exampleKo ? renderAnswerRow("韩语原句", word.exampleKo, "ko") : ""}
    ${word.forms ? renderAnswerRow("变形 / 派生", word.forms, "ko") : ""}
    ${word.confusion ? renderAnswerRow("易混点", word.confusion) : ""}
    ${word.notes ? renderAnswerRow("备注", word.notes) : ""}
  `;
}

function renderAnswerRow(label, value, lang = "") {
  const langAttr = lang ? ` lang="${lang}"` : "";
  return `
    <div class="answer-row">
      <span class="answer-label">${escapeHtml(label)}</span>
      <span class="answer-value"${langAttr}>${lineBreaks(value)}</span>
    </div>
  `;
}

function setReviewButtons(hasCard) {
  els.revealAnswer.disabled = !hasCard;
  els.forgotButton.disabled = !hasCard || !state.revealed;
  els.fuzzyButton.disabled = !hasCard || !state.revealed;
  els.knownButton.disabled = !hasCard || !state.revealed;
  els.easyButton.disabled = !hasCard || !state.revealed;
}

function renderLibrary() {
  const words = state.words
    .filter((word) => {
      const haystack = [
        word.korean,
        word.meaning,
        word.notes,
        word.partOfSpeech,
        word.forms,
        word.pronunciation,
      ].join(" ").toLowerCase();
      return !state.filter || haystack.includes(state.filter);
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  if (words.length === 0) {
    els.wordList.innerHTML = `<p class="word-text">词库暂时是空的。先录入一个今天新学的词吧。</p>`;
    return;
  }

  els.wordList.innerHTML = words.map((word) => {
    const card = word.reviewCards?.[0];
    return `
      <article class="word-item" data-id="${word.id}">
        <div class="word-title-row">
          <strong lang="ko">${escapeHtml(word.korean)}</strong>
          <span class="word-meta">${escapeHtml(displayPartOfSpeech(word.partOfSpeech) || "未标注")}</span>
        </div>
        <p class="word-text">${escapeHtml(firstLine(word.meaning) || "无释义")}</p>
        <p class="word-meta">${escapeHtml(card?.stage || "learning")} · 下次 ${formatDue(card?.dueDate)}</p>
        <div class="word-actions">
          <button class="tiny-button" data-action="speak">朗读</button>
          <button class="tiny-button" data-action="edit">编辑</button>
          <button class="tiny-button" data-action="delete">删除</button>
        </div>
      </article>
    `;
  }).join("");

  els.wordList.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", handleWordAction);
  });
}

function saveWordFromForm(event) {
  event.preventDefault();
  const korean = els.wordInput.value.trim();
  if (!korean) return;

  const existing = state.words.find((word) => word.korean === korean);
  const payload = {
    korean,
    baseForm: korean,
    meaning: els.meaningInput.value.trim(),
    partOfSpeech: els.posInput.value.trim(),
    exampleKo: "",
    exampleZh: "",
    pronunciation: els.pronunciationInput.value.trim(),
    forms: els.formsInput.value.trim(),
    confusion: "",
    source: "",
    notes: els.noteInput.value.trim(),
  };

  if (existing) {
    Object.assign(existing, payload);
    existing.mastered = Boolean(existing.mastered);
    existing.updatedAt = nowIso();
    toast("已更新这个词");
  } else {
    const createdAt = nowIso();
    state.words.push({
      id: crypto.randomUUID(),
      ...payload,
      mastered: false,
      createdAt,
      updatedAt: createdAt,
      reviewCards: [createKoToZhCard()],
    });
    toast("已保存，已加入今日复习。");
  }

  persist();
  els.wordForm.reset();
  state.revealed = false;
  renderAll();
}

function createKoToZhCard() {
  return {
    cardId: crypto.randomUUID(),
    direction: "ko_to_zh",
    stage: "learning",
    dueDate: nowIso(),
    intervalDays: 0,
    reviewCount: 0,
    correctStreak: 0,
    wrongCount: 0,
    lastResult: "",
    lastReviewedAt: "",
    reviewHistory: [],
  };
}

function revealCurrent() {
  state.revealed = true;
  renderReview();
  keepReviewControlsInReach();
}

function reviewCurrent(result) {
  const entry = state.dueCards[state.currentIndex];
  if (!entry) return;

  applyReviewResult(entry.word, entry.card, result);
  entry.word.updatedAt = nowIso();
  persist();
  state.revealed = false;
  state.dueCards.splice(state.currentIndex, 1);
  if (state.currentIndex >= state.dueCards.length) {
    state.currentIndex = 0;
  }
  renderAll();
  keepReviewControlsInReach();
}

function applyReviewResult(word, card, result) {
  const wasLearning = card.stage === "learning";
  if (!Array.isArray(card.reviewHistory)) {
    card.reviewHistory = [];
  }
  card.reviewCount += 1;
  card.lastResult = result;
  card.lastReviewedAt = nowIso();
  card.reviewHistory.push({
    result,
    reviewedAt: card.lastReviewedAt,
  });
  card.reviewHistory = card.reviewHistory.slice(-10);

  if (card.stage === "learning") {
    applyLearningResult(card, result);
  } else {
    applyReviewStageResult(card, result);
  }

  if (card.stage === "learning" && card.correctStreak >= 3) {
    card.stage = "review";
    card.intervalDays = Math.max(card.intervalDays, 5);
  }

  if (wasLearning && card.direction === "ko_to_zh" && card.stage === "review") {
    ensureZhToKoCard(word);
  }

  updateMasteredStatus(word);
}

function applyLearningResult(card, result) {
  if (result === "forgot") {
    card.dueDate = minutesFromNow(10);
    card.intervalDays = 0;
    card.correctStreak = 0;
    card.wrongCount += 1;
    return;
  }
  if (result === "fuzzy") {
    card.dueDate = daysFromNow(1);
    card.intervalDays = 1;
    return;
  }
  if (result === "known") {
    card.dueDate = daysFromNow(3);
    card.intervalDays = 3;
    card.correctStreak += 1;
    return;
  }
  if (result === "easy") {
    card.dueDate = daysFromNow(5);
    card.intervalDays = 5;
    card.correctStreak += 1;
  }
}

function applyReviewStageResult(card, result) {
  if (result === "forgot") {
    card.intervalDays = 1;
    card.dueDate = daysFromNow(1);
    card.correctStreak = 0;
    card.wrongCount += 1;
    return;
  }

  const current = Math.max(1, Number(card.intervalDays) || 1);
  if (result === "fuzzy") {
    card.intervalDays = clampInterval(Math.max(2, Math.ceil(current * 1.2)), card);
  }
  if (result === "known") {
    card.intervalDays = clampInterval(Math.ceil(current * 2.2), card);
    card.correctStreak += 1;
  }
  if (result === "easy") {
    card.intervalDays = clampInterval(Math.ceil(current * 3), card);
    card.correctStreak += 1;
  }
  card.dueDate = daysFromNow(card.intervalDays);
}

function clampInterval(intervalDays, card) {
  return Math.min(intervalDays, card.stage === "mastered" ? 90 : 45);
}

function updateMasteredStatus(word) {
  const cards = word.reviewCards || [];
  const koToZh = cards.find((card) => card.direction === "ko_to_zh");
  const zhToKo = cards.find((card) => card.direction === "zh_to_ko");
  const recentResults = cards
    .flatMap((card) => card.reviewHistory || [])
    .sort((a, b) => String(b.reviewedAt).localeCompare(String(a.reviewedAt)))
    .slice(0, 3)
    .map((entry) => entry.result);

  const isMastered = Boolean(
    koToZh &&
      zhToKo &&
      koToZh.correctStreak >= 3 &&
      zhToKo.correctStreak >= 3 &&
      cards.some((card) => Number(card.intervalDays) >= 30) &&
      recentResults.length >= 3 &&
      !recentResults.includes("forgot"),
  );

  if (!isMastered) return;
  word.mastered = true;
  cards.forEach((card) => {
    if (card.stage !== "mastered") {
      card.stage = "mastered";
      card.intervalDays = Math.min(Math.max(Number(card.intervalDays) || 30, 30), 90);
      card.dueDate = daysFromNow(card.intervalDays);
    }
  });
}

function ensureZhToKoCard(word) {
  const hasZhToKo = (word.reviewCards || []).some((card) => card.direction === "zh_to_ko");
  if (hasZhToKo) return;
  word.reviewCards.push(createZhToKoCard());
}

function createZhToKoCard() {
  return {
    cardId: crypto.randomUUID(),
    direction: "zh_to_ko",
    stage: "learning",
    dueDate: nowIso(),
    intervalDays: 0,
    reviewCount: 0,
    correctStreak: 0,
    wrongCount: 0,
    lastResult: "",
    lastReviewedAt: "",
    reviewHistory: [],
  };
}

function nextReviewCard() {
  if (state.dueCards.length < 2) return;
  state.currentIndex = (state.currentIndex + 1) % state.dueCards.length;
  state.revealed = false;
  renderReview();
  keepReviewControlsInReach();
}

function keepReviewControlsInReach() {
  if (!$("#reviewView")?.classList.contains("active")) return;
  requestAnimationFrame(() => {
    $(".review-actions")?.scrollIntoView({
      block: "end",
      inline: "nearest",
      behavior: "auto",
    });
  });
}

function handleWordAction(event) {
  const item = event.target.closest(".word-item");
  const word = state.words.find((entry) => entry.id === item.dataset.id);
  if (!word) return;

  const action = event.target.dataset.action;
  if (action === "speak") speakKorean(word.korean);
  if (action === "edit") editWord(word);
  if (action === "delete") deleteWord(word);
}

function speakKorean(word) {
  const utterance = new SpeechSynthesisUtterance(word);
  utterance.lang = "ko-KR";
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

function editWord(word) {
  els.wordInput.value = word.korean;
  els.meaningInput.value = word.meaning || "";
  els.noteInput.value = word.notes || "";
  els.posInput.value = word.partOfSpeech || "";
  els.pronunciationInput.value = word.pronunciation || "";
  els.formsInput.value = word.forms || "";
  switchTab("entry");
  els.wordInput.focus();
}

function deleteWord(word) {
  state.words = state.words.filter((entry) => entry.id !== word.id);
  persist();
  state.revealed = false;
  renderAll();
  toast("已删除");
}

function exportWords() {
  const blob = new Blob([JSON.stringify(state.words, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `korean-vocab-v2-${todayKey()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importWords(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(String(reader.result));
      if (!Array.isArray(imported)) throw new Error("格式不正确");
      state.words = imported;
      persist();
      state.revealed = false;
      renderAll();
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
    state.supabase = createClient(url, anonKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "implicit",
        persistSession: true,
      },
    });
    state.cloudReady = true;
    await refreshSession({ quiet: true });
    state.supabase.auth.onAuthStateChange((_event, session) => {
      state.user = session?.user || null;
      updateCloudStatus();
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
      emailRedirectTo: cleanCurrentUrl(),
    },
  });

  if (error) {
    toast(`发送失败：${error.message}`);
    return;
  }
  toast("登录邮件已发送，请去邮箱点链接");
}

async function refreshSession(options = {}) {
  if (!state.supabase) {
    updateCloudStatus("先保存云配置");
    if (!options.quiet) toast("先保存云配置");
    return;
  }

  const { data, error } = await state.supabase.auth.getSession();
  if (error) {
    updateCloudStatus(`登录检查失败：${error.message}`);
    if (!options.quiet) toast(`登录检查失败：${error.message}`);
    return;
  }

  state.user = data.session?.user || null;
  updateCloudStatus();
  if (state.user && !options.quiet) {
    toast("已登录云端");
  }
}

async function signOut() {
  if (!state.supabase) return;
  await state.supabase.auth.signOut();
  state.user = null;
  updateCloudStatus();
  toast("已退出云端登录");
}

async function syncToCloudV2() {
  if (!ensureCloudUser()) return;
  if (!window.confirm("这会将当前本地新版词库同步到云端 v2，是否继续？")) return;

  const words = loadWords();
  if (words.length === 0) {
    toast("本地新版词库为空");
    return;
  }

  setSyncing(true, "正在同步到云端 v2...");
  const rows = words.map((word) => toDbWord(word, state.user.id));
  const { error } = await state.supabase
    .from(SUPABASE_V2_TABLE)
    .upsert(rows, { onConflict: "id" });

  if (error) {
    setSyncing(false, `同步失败：${error.message}`);
    return;
  }

  const syncedAt = nowIso();
  localStorage.setItem(LAST_SYNC_KEY, syncedAt);
  setSyncing(false);
  updateCloudStatus(`已同步到云端 v2：${formatDateTime(syncedAt)}`);
  toast("已同步到云端 v2");
}

async function restoreFromCloudV2() {
  if (!ensureCloudUser()) return;
  if (!window.confirm("这会用云端 v2 词库覆盖当前本地新版词库，是否继续？")) return;

  setSyncing(true, "正在从云端 v2 恢复...");
  const { data, error } = await state.supabase
    .from(SUPABASE_V2_TABLE)
    .select("*")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });

  if (error) {
    setSyncing(false, `恢复失败：${error.message}`);
    return;
  }

  state.words = normalizeWords((data || []).map(fromDbWord));
  persist();
  state.revealed = false;
  state.currentIndex = 0;
  renderAll();

  const syncedAt = nowIso();
  localStorage.setItem(LAST_SYNC_KEY, syncedAt);
  setSyncing(false);
  updateCloudStatus(`已从云端 v2 恢复：${formatDateTime(syncedAt)}`);
  toast("已从云端 v2 恢复到本地");
}

async function importLegacyToV2() {
  if (!ensureCloudUser()) return;
  if (
    !window.confirm(
      "这会读取旧表 vocab_cards，并把旧词条复制到新版云端 v2。旧表不会被删除或修改，是否继续？",
    )
  ) {
    return;
  }

  setSyncing(true, "正在读取旧词库...");
  const { data: legacyRows, error: legacyError } = await state.supabase
    .from(SUPABASE_LEGACY_TABLE)
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (legacyError) {
    setSyncing(false, `读取旧词库失败：${legacyError.message}`);
    return;
  }

  if (!legacyRows?.length) {
    setSyncing(false);
    updateCloudStatus("旧词库里没有可导入的词");
    toast("旧词库里没有可导入的词");
    return;
  }

  const { data: existingRows, error: existingError } = await state.supabase
    .from(SUPABASE_V2_TABLE)
    .select("id,korean")
    .is("deleted_at", null);

  if (existingError) {
    setSyncing(false, `检查新版词库失败：${existingError.message}`);
    return;
  }

  const existingKorean = new Set([
    ...(existingRows || []).map((row) => normalizeKoreanKey(row.korean)),
    ...state.words.map((word) => normalizeKoreanKey(word.korean)),
  ]);
  const rowsToImport = legacyRows
    .filter((row) => {
      const koreanKey = normalizeKoreanKey(row.word);
      if (!koreanKey || existingKorean.has(koreanKey)) return false;
      existingKorean.add(koreanKey);
      return true;
    })
    .map((row) => legacyRowToDbWord(row, state.user.id));

  if (rowsToImport.length === 0) {
    setSyncing(false);
    updateCloudStatus("旧词库已在 v2 中存在，没有新增导入");
    toast("没有需要新增导入的旧词");
    return;
  }

  setSyncing(true, `正在导入 ${rowsToImport.length} 个旧词到 v2...`);
  const { error: importError } = await state.supabase
    .from(SUPABASE_V2_TABLE)
    .upsert(rowsToImport, { onConflict: "id" });

  if (importError) {
    setSyncing(false, `导入失败：${importError.message}`);
    return;
  }

  const syncedAt = nowIso();
  state.words = normalizeWords([...state.words, ...rowsToImport.map(fromDbWord)]);
  persist();
  state.revealed = false;
  state.currentIndex = 0;
  renderAll();
  localStorage.setItem(LAST_SYNC_KEY, syncedAt);
  setSyncing(false);
  updateCloudStatus(`已导入旧词库到 v2：新增 ${rowsToImport.length} 个，跳过 ${legacyRows.length - rowsToImport.length} 个`);
  toast(`已导入 ${rowsToImport.length} 个旧词到 v2`);
}

function toDbWord(word, userId) {
  const createdAt = word.createdAt || nowIso();
  const updatedAt = word.updatedAt || createdAt;
  return {
    id: word.id,
    user_id: userId,
    korean: word.korean || "",
    base_form: word.baseForm || "",
    meaning: word.meaning || "",
    part_of_speech: word.partOfSpeech || "",
    example_ko: word.exampleKo || "",
    example_zh: word.exampleZh || "",
    pronunciation: word.pronunciation || "",
    forms: word.forms || "",
    confusion: word.confusion || "",
    source: word.source || "",
    notes: word.notes || "",
    mastered: Boolean(word.mastered),
    review_cards: word.reviewCards || [],
    created_at: createdAt,
    updated_at: updatedAt,
    deleted_at: null,
  };
}

function legacyRowToDbWord(row, userId) {
  const createdAt = row.created_at || nowIso();
  const updatedAt = nowIso();
  const korean = row.word || "";
  return {
    id: row.id || crypto.randomUUID(),
    user_id: userId,
    korean,
    base_form: korean,
    meaning: row.meaning || "",
    part_of_speech: row.pos || "",
    example_ko: "",
    example_zh: "",
    pronunciation: row.pronunciation || "",
    forms: row.forms || "",
    confusion: "",
    source: "旧词库导入",
    notes: row.note || "",
    mastered: false,
    review_cards: [createLegacyKoToZhCard(row)],
    created_at: createdAt,
    updated_at: updatedAt,
    deleted_at: null,
  };
}

function createLegacyKoToZhCard(row) {
  return {
    cardId: crypto.randomUUID(),
    direction: "ko_to_zh",
    stage: "learning",
    dueDate: legacyDueDateToIso(row.next_review),
    intervalDays: 0,
    reviewCount: Array.isArray(row.history) ? row.history.length : 0,
    correctStreak: 0,
    wrongCount: 0,
    lastResult: "",
    lastReviewedAt: "",
    reviewHistory: [],
  };
}

function fromDbWord(row) {
  return {
    id: row.id,
    korean: row.korean || "",
    baseForm: row.base_form || row.korean || "",
    meaning: row.meaning || "",
    partOfSpeech: row.part_of_speech || "",
    exampleKo: row.example_ko || "",
    exampleZh: row.example_zh || "",
    pronunciation: row.pronunciation || "",
    forms: row.forms || "",
    confusion: row.confusion || "",
    source: row.source || "",
    notes: row.notes || "",
    mastered: Boolean(row.mastered),
    reviewCards: Array.isArray(row.review_cards) ? row.review_cards : [],
    createdAt: row.created_at || nowIso(),
    updatedAt: row.updated_at || row.created_at || nowIso(),
  };
}

function legacyDueDateToIso(value) {
  if (!value) return nowIso();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? nowIso() : parsed.toISOString();
}

function normalizeKoreanKey(value) {
  return String(value || "").trim().toLowerCase();
}

function ensureCloudUser() {
  if (!state.supabase) {
    toast("先保存云配置");
    return false;
  }
  if (!state.user) {
    toast("请先登录云端");
    return false;
  }
  return true;
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
    const lastSyncAt = localStorage.getItem(LAST_SYNC_KEY);
    els.syncStatus.textContent = lastSyncAt
      ? `已登录：${state.user.email || "当前账号"} · 上次同步 ${formatDateTime(lastSyncAt)}`
      : `已登录：${state.user.email || "当前账号"}`;
  }

  const canUseCloud = Boolean(state.supabase && state.user && !state.syncing);
  els.signOutButton.disabled = !state.user || state.syncing;
  els.pullCloudButton.disabled = !canUseCloud;
  els.pushCloudButton.disabled = !canUseCloud;
  els.importLegacyButton.disabled = !canUseCloud;
}

function cleanCurrentUrl() {
  const url = new URL(window.location.href);
  url.hash = "";
  url.search = "";
  return url.toString();
}

function formatDateTime(value) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function switchTab(tabName) {
  els.tabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tabName);
  });
  els.tabViews.forEach((view) => {
    view.classList.toggle("active", view.dataset.view === tabName);
  });
}

function firstLine(value) {
  return String(value || "").split(/\n/)[0];
}

function lineBreaks(value) {
  return escapeHtml(value).replace(/\n/g, "<br />");
}

function formatDue(value) {
  if (!value) return "未安排";
  return new Date(value).toLocaleDateString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  });
}

function displayPartOfSpeech(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const labels = {
    명사: "名词",
    대명사: "代词",
    수사: "数词",
    동사: "动词",
    형용사: "形容词",
    관형사: "冠形词",
    부사: "副词",
    조사: "助词",
    감탄사: "叹词",
    어미: "语尾",
    표현: "表达",
    기타: "其他",
  };
  if (labels[raw]) return labels[raw];
  const matched = Object.keys(labels).find((key) => raw.includes(key));
  return matched ? labels[matched] : raw;
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
