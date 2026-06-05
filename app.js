import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const STORAGE_KEY = "korean-vocab-v2";
const DAILY_DECK_KEY = "korean-vocab-v2-daily-deck";
const CLOUD_URL_KEY = "korean-vocab-supabase-url";
const CLOUD_ANON_KEY = "korean-vocab-supabase-anon";
const LAST_SYNC_KEY = "korean-vocab-v2-last-sync-at";
const PENDING_DELETES_KEY = "korean-vocab-v2-pending-deletes";
const SUPABASE_V2_TABLE = "korean_vocab_words_v2";
const SUPABASE_LEGACY_TABLE = "vocab_cards";
const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const DAILY_CARD_GOAL = 25;
const DAILY_CARD_MAX = 35;

const $ = (selector) => document.querySelector(selector);
const nowIso = () => new Date().toISOString();
const getBeijingDateKey = (date = new Date()) => new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
const todayKey = () => getBeijingDateKey();
const minutesFromNow = (minutes) => new Date(Date.now() + minutes * MINUTE).toISOString();
const daysFromNow = (days) => new Date(Date.now() + days * DAY).toISOString();

const state = {
  words: loadWords(),
  dueCards: [],
  dailyCardLimit: DAILY_CARD_GOAL,
  dailyDeck: null,
  currentIndex: 0,
  cyclingCompletedDeck: false,
  revealed: false,
  reviewMode: "due",
  filter: "",
  supabase: null,
  user: null,
  cloudReady: false,
  syncing: false,
  editingWordId: null,
  librarySortOrder: "newest",
};

const els = {
  totalCount: $("#totalCount"),
  dueCount: $("#dueCount"),
  doneCount: $("#doneCount"),
  goalProgress: $("#goalProgress"),
  masteredCount: $("#masteredCount"),
  wordForm: $("#wordForm"),
  wordInput: $("#wordInput"),
  wordFormTitle: $("#wordFormTitle"),
  wordSubmitButton: $("#wordSubmitButton"),
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
  sortOldestButton: $("#sortOldestButton"),
  sortNewestButton: $("#sortNewestButton"),
  exportButton: $("#exportButton"),
  importInput: $("#importInput"),
  wordList: $("#wordList"),
  supabaseUrlInput: $("#supabaseUrlInput"),
  supabaseAnonInput: $("#supabaseAnonInput"),
  saveCloudConfig: $("#saveCloudConfig"),
  syncEmailInput: $("#syncEmailInput"),
  sendLoginLink: $("#sendLoginLink"),
  magicLinkInput: $("#magicLinkInput"),
  applyMagicLinkButton: $("#applyMagicLinkButton"),
  refreshSessionButton: $("#refreshSessionButton"),
  signOutButton: $("#signOutButton"),
  pullCloudButton: $("#pullCloudButton"),
  pushCloudButton: $("#pushCloudButton"),
  syncStatus: $("#syncStatus"),
  tabButtons: document.querySelectorAll(".tab-button"),
  tabViews: document.querySelectorAll(".tab-view"),
};

els.supabaseUrlInput.value = localStorage.getItem(CLOUD_URL_KEY) || "";
els.supabaseAnonInput.value = localStorage.getItem(CLOUD_ANON_KEY) || "";

els.wordForm.addEventListener("submit", saveWordFromForm);
els.revealAnswer.addEventListener("click", revealCurrent);
els.forgotButton.addEventListener("click", (event) => reviewCurrent("forgot", event));
els.fuzzyButton.addEventListener("click", (event) => reviewCurrent("fuzzy", event));
els.knownButton.addEventListener("click", (event) => reviewCurrent("known", event));
els.easyButton.addEventListener("click", (event) => reviewCurrent("easy", event));
els.nextReview.addEventListener("click", nextReviewCard);
els.filterInput.addEventListener("input", (event) => {
  state.filter = event.target.value.trim().toLowerCase();
  renderLibrary();
});
els.sortOldestButton.addEventListener("click", () => setLibrarySortOrder("oldest"));
els.sortNewestButton.addEventListener("click", () => setLibrarySortOrder("newest"));
els.exportButton.addEventListener("click", exportWords);
els.importInput.addEventListener("change", importWords);
els.saveCloudConfig.addEventListener("click", saveCloudConfig);
els.sendLoginLink.addEventListener("click", sendLoginLink);
els.applyMagicLinkButton.addEventListener("click", applyMagicLink);
els.refreshSessionButton.addEventListener("click", refreshSession);
els.signOutButton.addEventListener("click", signOut);
els.pullCloudButton.addEventListener("click", restoreFromCloudV2);
els.pushCloudButton.addEventListener("click", syncToCloudV2);
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
    if (typeof word.placementPending !== "boolean") {
      word.placementPending = true;
      changed = true;
    }
    (word.reviewCards || []).forEach((card) => {
      if (!card.cardId) {
        card.cardId = crypto.randomUUID();
        changed = true;
      }
      if (!Array.isArray(card.reviewHistory)) {
        card.reviewHistory = [];
        changed = true;
      }
      if (typeof card.lastAppliedReviewDate !== "string") {
        card.lastAppliedReviewDate = "";
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

function readPendingDeletes() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PENDING_DELETES_KEY));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePendingDeletes(ids) {
  localStorage.setItem(PENDING_DELETES_KEY, JSON.stringify([...new Set(ids)]));
}

function addPendingDelete(id) {
  savePendingDeletes([...readPendingDeletes(), id]);
}

function removePendingDelete(id) {
  savePendingDeletes(readPendingDeletes().filter((entryId) => entryId !== id));
}

function renderAll() {
  rebuildDueCards();
  renderStats();
  renderReview();
  renderLibrary();
}

function rebuildDueCards() {
  state.reviewMode = "due";
  const deck = ensureDailyDeck();
  state.dailyCardLimit = getDailyDeckCardIds(deck).length;
  state.dueCards = getDailyDeckEntries(deck);

  if (state.currentIndex >= state.dueCards.length) {
    state.currentIndex = 0;
  }
}

function ensureDailyDeck() {
  const dateKey = getBeijingDateKey();
  const stored = readDailyDeck();
  if (stored.dateKey === dateKey) {
    state.dailyDeck = normalizeDailyDeck(stored);
    return state.dailyDeck;
  }
  state.dailyDeck = createDailyDeck();
  saveDailyDeck(state.dailyDeck);
  return state.dailyDeck;
}

function readDailyDeck() {
  try {
    return JSON.parse(localStorage.getItem(DAILY_DECK_KEY)) || {};
  } catch {
    return {};
  }
}

function createDailyDeck() {
  const now = nowIso();
  const cardIds = getDueCardEntries({ includeReviewedToday: true })
    .slice(0, DAILY_CARD_GOAL)
    .map(cardKey);
  return {
    dateKey: getBeijingDateKey(),
    cardIds,
    expandedCardIds: [],
    completedCardIds: [],
    finalResults: {},
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeDailyDeck(deck) {
  const normalized = {
    dateKey: deck.dateKey || getBeijingDateKey(),
    cardIds: Array.isArray(deck.cardIds) ? deck.cardIds : [],
    expandedCardIds: Array.isArray(deck.expandedCardIds) ? deck.expandedCardIds : [],
    completedCardIds: Array.isArray(deck.completedCardIds) ? deck.completedCardIds : [],
    finalResults: deck.finalResults && typeof deck.finalResults === "object" ? deck.finalResults : {},
    createdAt: deck.createdAt || nowIso(),
    updatedAt: deck.updatedAt || deck.createdAt || nowIso(),
  };
  const validKeys = new Set(state.words.flatMap((word) => (word.reviewCards || []).map((card) => card.cardId)));
  normalized.cardIds = uniqueExistingIds(normalized.cardIds, validKeys).slice(0, DAILY_CARD_GOAL);
  normalized.expandedCardIds = uniqueExistingIds(normalized.expandedCardIds, validKeys)
    .filter((cardId) => !normalized.cardIds.includes(cardId))
    .slice(0, Math.max(0, DAILY_CARD_MAX - normalized.cardIds.length));
  const deckKeys = new Set(getDailyDeckCardIds(normalized));
  normalized.completedCardIds = uniqueExistingIds(normalized.completedCardIds, deckKeys);
  normalized.finalResults = Object.fromEntries(Object.entries(normalized.finalResults).filter(([cardId]) => deckKeys.has(cardId)));
  saveDailyDeck(normalized);
  return normalized;
}

function uniqueExistingIds(cardIds, validKeys) {
  return [...new Set(cardIds)].filter((cardId) => validKeys.has(cardId));
}

function saveDailyDeck(deck = state.dailyDeck) {
  if (!deck) return;
  deck.updatedAt = nowIso();
  localStorage.setItem(DAILY_DECK_KEY, JSON.stringify(deck));
}

function getDailyDeckCardIds(deck = state.dailyDeck) {
  if (!deck) return [];
  return [...deck.cardIds, ...deck.expandedCardIds];
}

function getDailyDeckEntries(deck = state.dailyDeck) {
  return getDailyDeckCardIds(deck).map(findCardEntryByKey).filter(Boolean);
}

function getDueCardEntries(options = {}) {
  const now = Date.now();
  const includeReviewedToday = Boolean(options.includeReviewedToday);
  return state.words
    .flatMap((word) => {
      return (word.reviewCards || []).map((card) => ({ word, card }));
    })
    .filter(({ card }) => {
      const due = new Date(card.dueDate).getTime() <= now;
      return due && (includeReviewedToday || !isReviewedToday(card));
    })
    .map((entry) => ({ ...entry, randomTieBreaker: Math.random() }))
    .sort(compareDueCards);
}

function compareDueCards(left, right) {
  const leftForgot = left.card.lastResult === "forgot" ? 0 : 1;
  const rightForgot = right.card.lastResult === "forgot" ? 0 : 1;
  if (leftForgot !== rightForgot) return leftForgot - rightForgot;

  const leftDirection = left.card.direction === "zh_to_ko" ? 0 : 1;
  const rightDirection = right.card.direction === "zh_to_ko" ? 0 : 1;
  if (leftDirection !== rightDirection) return leftDirection - rightDirection;

  const leftDue = new Date(left.card.dueDate).getTime();
  const rightDue = new Date(right.card.dueDate).getTime();
  if (leftDue !== rightDue) return leftDue - rightDue;

  return left.randomTieBreaker - right.randomTieBreaker;
}

function cardKey(entry) {
  return entry.card.cardId;
}

function findCardEntryByKey(key) {
  for (const word of state.words) {
    for (const card of word.reviewCards || []) {
      const entry = { word, card };
      if (cardKey(entry) === key) return entry;
    }
  }
  return null;
}

function isReviewedToday(card) {
  if (!card.lastReviewedAt) return false;
  const reviewedAt = new Date(card.lastReviewedAt);
  return !Number.isNaN(reviewedAt.getTime()) && getBeijingDateKey(reviewedAt) === todayKey();
}

function shuffleEntries(entries) {
  const shuffled = [...entries];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function renderStats() {
  const deck = ensureDailyDeck();
  const deckCardIds = new Set(getDailyDeckCardIds(deck));
  const allCards = state.words.flatMap((word) => word.reviewCards || []);
  const allDueCount = allCards.filter((card) => new Date(card.dueDate).getTime() <= Date.now()).length;
  const doneToday = deck.completedCardIds.filter((cardId) => deckCardIds.has(cardId)).length;
  const mastered = state.words.filter((word) => word.mastered).length;

  els.totalCount.textContent = state.words.length;
  els.dueCount.textContent = allDueCount;
  els.doneCount.textContent = doneToday;
  els.goalProgress.textContent = mastered;
  els.masteredCount.textContent = mastered;
}

function renderReview() {
  const displayEntries = getReviewDisplayEntries();
  if (state.currentIndex >= displayEntries.length) {
    state.currentIndex = 0;
  }
  const entry = displayEntries[state.currentIndex];
  const dueCount = state.dueCards.length;
  els.reviewSubhead.textContent = state.reviewMode === "extra"
    ? `加练模式：随机显示 ${dueCount} 张卡片。`
    : dueCount
    ? `今日固定牌组 ${dueCount} 张卡片。`
    : "";

  if (state.dueCards.length === 0) {
    els.reviewCard.className = "review-card empty";
    els.reviewCard.innerHTML = `<p class="empty-title">今天没有到期卡片。</p><p>可以去录入页添加新词，或等待下一次复习。</p>`;
    setReviewButtons(false);
    return;
  }

  if (!entry) {
    els.reviewCard.className = "review-card empty";
    els.reviewCard.innerHTML = `<p class="empty-title">今日卡片已完成。</p><p>点击刷新按钮在今天的卡片里再过一遍。</p>`;
    setReviewButtons(false);
    return;
  }

  const { word, card } = entry;
  const isZhToKo = card.direction === "zh_to_ko";
  const directionLabel = isZhToKo ? "中 → 韩" : "韩 → 中";
  const pronunciation = word.pronunciation
    ? `<div class="card-front-pronunciation">${escapeHtml(word.pronunciation)}</div>`
    : "";
  const front = isZhToKo
    ? `<div class="card-meaning">${lineBreaks(word.meaning || "还没有中文释义")}</div>`
    : `<div class="card-word" lang="ko">${escapeHtml(word.korean)}</div>${pronunciation}`;
  const answer = isZhToKo ? renderZhToKoAnswer(word) : renderKoToZhAnswer(word);
  const speakButton = `<button type="button" id="speakCurrentButton" class="card-speak-button">朗读</button>`;

  els.reviewCard.className = state.revealed ? "review-card revealed" : "review-card";
  els.reviewCard.innerHTML = `
    <div>
      <div class="direction-pill">${directionLabel}</div>
      ${front}
    </div>
    <div class="card-answer" ${state.revealed ? "" : "hidden"}>
      ${answer}
    </div>
    ${speakButton}
  `;
  $("#speakCurrentButton")?.addEventListener("click", () => speakKorean(word.korean));
  setReviewButtons(true);
}

function getReviewDisplayEntries() {
  const deck = ensureDailyDeck();
  const completed = new Set(deck.completedCardIds);
  const incompleteEntries = state.dueCards.filter((entry) => !completed.has(cardKey(entry)));
  if (incompleteEntries.length > 0) return incompleteEntries;
  return state.cyclingCompletedDeck ? state.dueCards : [];
}

function getCurrentReviewEntry() {
  const entries = getReviewDisplayEntries();
  if (state.currentIndex >= entries.length) {
    state.currentIndex = 0;
  }
  return entries[state.currentIndex] || null;
}

function renderKoToZhAnswer(word) {
  return `
    ${renderAnswerRow("释义", word.meaning || "还没有释义")}
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
    .sort((a, b) => {
      const compare = String(a.createdAt).localeCompare(String(b.createdAt));
      return state.librarySortOrder === "oldest" ? compare : -compare;
    });

  els.sortOldestButton.classList.toggle("active-sort", state.librarySortOrder === "oldest");
  els.sortNewestButton.classList.toggle("active-sort", state.librarySortOrder === "newest");

  if (words.length === 0) {
    els.wordList.innerHTML = `<p class="word-text">词库暂时是空的。先录入一个今天新学的词吧。</p>`;
    return;
  }

  els.wordList.innerHTML = words.map((word) => {
    const card = word.reviewCards?.[0];
    const stageClass = word.mastered ? "mastered" : card?.stage || "learning";
    return `
      <article class="word-item word-stage-${escapeHtml(stageClass)}" data-id="${word.id}">
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

  if (state.editingWordId) {
    saveEditedWord(payload);
    return;
  }

  const existing = state.words.find((word) => word.korean === korean);
  if (existing) {
    const duplicateAction = askDuplicateWordAction(existing);
    if (duplicateAction === "cancel") {
      toast("已取消保存，表单内容已保留。");
      return;
    }
    if (duplicateAction === "append") {
      appendToExistingWord(existing, payload);
      toast("已补充到原词条");
    } else {
      replaceExistingWord(existing, payload);
      toast("已替换原词条信息");
    }
  } else {
    const createdAt = nowIso();
    const newWord = {
      id: crypto.randomUUID(),
      ...payload,
      mastered: false,
      placementPending: false,
      createdAt,
      updatedAt: createdAt,
      reviewCards: [createKoToZhCard()],
    };
    state.words.push(newWord);
    addNewWordToDailyDeck(newWord);
    toast("已保存，已加入今日复习。");
  }

  persist();
  els.wordForm.reset();
  state.revealed = false;
  renderAll();
}

function saveEditedWord(payload) {
  const target = state.words.find((word) => word.id === state.editingWordId);
  if (!target) {
    resetWordFormMode();
    toast("没有找到要修改的词条");
    return;
  }

  const duplicate = state.words.find((word) => word.id !== target.id && word.korean === payload.korean);
  if (duplicate && !window.confirm("词库里已经有同名词条。仍然保存这次修改吗？")) {
    toast("已取消修改，表单内容已保留。");
    return;
  }

  replaceExistingWord(target, payload);
  persist();
  els.wordForm.reset();
  resetWordFormMode();
  state.revealed = false;
  renderAll();
  switchTab("library");
  toast("修改已保存");
}

function addNewWordToDailyDeck(word) {
  const deck = ensureDailyDeck();
  if (getDailyDeckCardIds(deck).length >= DAILY_CARD_MAX) return;
  const cardId = word.reviewCards?.[0]?.cardId;
  if (!cardId || getDailyDeckCardIds(deck).includes(cardId)) return;
  deck.expandedCardIds.push(cardId);
  saveDailyDeck(deck);
}

function askDuplicateWordAction(word) {
  const oldInfo = [
    `韩语词条：${word.korean || "未填写"}`,
    `中文释义：${word.meaning || "未填写"}`,
    `词性：${displayPartOfSpeech(word.partOfSpeech) || "未填写"}`,
    `发音：${word.pronunciation || "未填写"}`,
    `变形 / 派生：${word.forms || "未填写"}`,
    `备注：${word.notes || "未填写"}`,
  ].join("\n");
  const choice = window.prompt(
    `词库里已经有这个词：\n\n${oldInfo}\n\n请选择：\nA. 补充到原词条\nB. 替换原词条\nC. 取消\n\n请输入 A / B / C：`,
    "A",
  );
  const normalized = String(choice || "").trim().toUpperCase();
  if (normalized === "A") return "append";
  if (normalized === "B") return "replace";
  return "cancel";
}

function appendToExistingWord(existing, payload) {
  existing.meaning = appendUniqueText(existing.meaning, payload.meaning);
  existing.notes = appendText(existing.notes, payload.notes);
  existing.forms = appendUniqueText(existing.forms, payload.forms);
  if (!existing.partOfSpeech && payload.partOfSpeech) {
    existing.partOfSpeech = payload.partOfSpeech;
  }
  if (!existing.pronunciation && payload.pronunciation) {
    existing.pronunciation = payload.pronunciation;
  }
  existing.mastered = Boolean(existing.mastered);
  existing.updatedAt = nowIso();
}

function replaceExistingWord(existing, payload) {
  Object.assign(existing, payload);
  existing.mastered = Boolean(existing.mastered);
  existing.updatedAt = nowIso();
}

function appendUniqueText(oldValue = "", newValue = "") {
  const oldText = String(oldValue || "").trim();
  const newText = String(newValue || "").trim();
  if (!newText || oldText.includes(newText)) return oldText;
  return appendText(oldText, newText);
}

function appendText(oldValue = "", newValue = "") {
  const oldText = String(oldValue || "").trim();
  const newText = String(newValue || "").trim();
  if (!newText) return oldText;
  return oldText ? `${oldText}\n${newText}` : newText;
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
    lastAppliedReviewDate: "",
    reviewHistory: [],
  };
}

function revealCurrent(event) {
  releaseButtonFocus(event);
  state.revealed = true;
  renderReview();
  keepReviewControlsInReach();
}

function reviewCurrent(result, event) {
  releaseButtonFocus(event);
  if (refreshDailyDeckIfNeeded()) return;
  const entry = getCurrentReviewEntry();
  if (!entry) return;

  recordDailyDeckResult(cardKey(entry), result);
  if (canApplyLongTermReview(entry.card)) {
    applyReviewResult(entry.word, entry.card, result);
    entry.card.lastAppliedReviewDate = todayKey();
  }
  entry.word.updatedAt = nowIso();
  persist();
  state.revealed = false;
  state.cyclingCompletedDeck = false;
  const nextEntries = getReviewDisplayEntries();
  if (nextEntries.length > 1) {
    state.currentIndex = randomReviewIndex(nextEntries);
  } else {
    state.currentIndex = 0;
  }
  renderStats();
  renderReview();
  renderLibrary();
  keepReviewControlsInReach();
}

function recordDailyDeckResult(cardId, result) {
  const deck = ensureDailyDeck();
  if (!deck.completedCardIds.includes(cardId)) {
    deck.completedCardIds.push(cardId);
  }
  deck.finalResults[cardId] = result;
  saveDailyDeck(deck);
}

function canApplyLongTermReview(card) {
  return card.lastAppliedReviewDate !== todayKey();
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

  if (word.placementPending === true && card.direction === "ko_to_zh") {
    if (!word.mastered) {
      applyPlacementResult(word, card, result);
      updateMasteredStatus(word);
      return;
    }
    word.placementPending = false;
  }

  if (word.mastered) {
    applyMasteredReviewResult(word, card, result);
    return;
  }

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

function applyMasteredReviewResult(word, card, result) {
  if (result === "forgot") {
    word.mastered = false;
    card.stage = "review";
    card.intervalDays = 1;
    card.dueDate = daysFromNow(1);
    card.correctStreak = 0;
    card.wrongCount += 1;
    return;
  }

  if (result === "fuzzy") {
    word.mastered = false;
    card.stage = "review";
    card.intervalDays = 3;
    card.dueDate = daysFromNow(3);
    card.correctStreak = Math.max(0, (Number(card.correctStreak) || 0) - 1);
    return;
  }

  card.stage = "mastered";
  applyReviewStageResult(card, result);
}

function applyPlacementResult(word, card, result) {
  word.placementPending = false;
  if (result === "forgot") {
    card.stage = "learning";
    card.dueDate = daysFromNow(1);
    card.intervalDays = 1;
    card.correctStreak = 0;
    card.wrongCount += 1;
    return;
  }
  if (result === "fuzzy") {
    card.stage = "learning";
    card.dueDate = daysFromNow(3);
    card.intervalDays = 3;
    return;
  }
  if (result === "known") {
    card.stage = "review";
    card.dueDate = daysFromNow(14);
    card.intervalDays = 14;
    card.correctStreak = Math.max(Number(card.correctStreak) || 0, 1);
    return;
  }
  if (result === "easy") {
    card.stage = "review";
    card.dueDate = daysFromNow(30);
    card.intervalDays = 30;
    card.correctStreak = Math.max(Number(card.correctStreak) || 0, 2);
  }
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
    lastAppliedReviewDate: "",
    reviewHistory: [],
  };
}

function nextReviewCard() {
  if (refreshDailyDeckIfNeeded()) return;
  if (state.dueCards.length === 0) {
    renderReview();
    return;
  }
  const added = expandDailyDeck();
  if (added > 0) {
    state.cyclingCompletedDeck = false;
    const addedIndex = getReviewDisplayEntries().findIndex((entry) => cardKey(entry) === added);
    state.currentIndex = addedIndex >= 0 ? addedIndex : 0;
  } else {
    const displayEntries = getReviewDisplayEntries();
    if (displayEntries.length === 0) {
      state.cyclingCompletedDeck = true;
    }
    const nextEntries = getReviewDisplayEntries();
    if (nextEntries.length > 1) {
      state.currentIndex = randomReviewIndex(nextEntries);
    } else {
      state.currentIndex = 0;
    }
  }
  state.revealed = false;
  renderReview();
  keepReviewControlsInReach();
}

function randomReviewIndex(entries = getReviewDisplayEntries()) {
  if (entries.length <= 1) return 0;
  let nextIndex = state.currentIndex;
  while (nextIndex === state.currentIndex) {
    nextIndex = Math.floor(Math.random() * entries.length);
  }
  return nextIndex;
}

function refreshDailyDeckIfNeeded() {
  if (readDailyDeck().dateKey === todayKey()) return false;
  state.currentIndex = 0;
  state.revealed = false;
  state.cyclingCompletedDeck = false;
  rebuildDueCards();
  renderStats();
  renderReview();
  return true;
}

function expandDailyDeck() {
  const deck = ensureDailyDeck();
  if (getDailyDeckCardIds(deck).length >= DAILY_CARD_MAX) {
    toast("今日队列已经到 35 张上限");
    return "";
  }
  const existingKeys = new Set(getDailyDeckCardIds(deck));
  const addition = getDueCardEntries({ includeReviewedToday: true })
    .find((entry) => !existingKeys.has(cardKey(entry)));
  if (!addition) {
    toast("没有更多到期卡片可以加入");
    return "";
  }
  const addedCardId = cardKey(addition);
  deck.expandedCardIds.push(addedCardId);
  saveDailyDeck(deck);
  state.dueCards = getDailyDeckEntries(deck);
  state.dailyCardLimit = getDailyDeckCardIds(deck).length;
  toast("已补充 1 张到今日队列");
  return addedCardId;
}

function keepReviewControlsInReach() {
  if (!$("#reviewView")?.classList.contains("active")) return;
  const scrollToReviewActions = () => {
    const page = document.scrollingElement || document.documentElement;
    const actions = $(".review-actions");
    if (!actions) return;
    const actionsBottom = actions.getBoundingClientRect().bottom + window.scrollY;
    const targetTop = Math.max(0, actionsBottom - window.innerHeight + 96);
    page.scrollTop = targetTop;
    document.documentElement.scrollTop = targetTop;
    document.body.scrollTop = targetTop;
    window.scrollTo(0, targetTop);
  };
  [0, 16, 80, 180, 360, 700].forEach((delay) => {
    window.setTimeout(() => requestAnimationFrame(scrollToReviewActions), delay);
  });
}

function releaseButtonFocus(event) {
  event?.currentTarget?.blur?.();
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
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

function setLibrarySortOrder(order) {
  state.librarySortOrder = order;
  renderLibrary();
}

function speakKorean(word) {
  const utterance = new SpeechSynthesisUtterance(word);
  utterance.lang = "ko-KR";
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

function editWord(word) {
  state.editingWordId = word.id;
  els.wordInput.value = word.korean;
  els.meaningInput.value = word.meaning || "";
  els.noteInput.value = word.notes || "";
  els.posInput.value = word.partOfSpeech || "";
  els.pronunciationInput.value = word.pronunciation || "";
  els.formsInput.value = word.forms || "";
  els.wordFormTitle.textContent = "修改词条";
  els.wordSubmitButton.textContent = "保存修改";
  switchTab("entry");
  els.wordInput.focus();
}

function resetWordFormMode() {
  state.editingWordId = null;
  els.wordFormTitle.textContent = "录入新词";
  els.wordSubmitButton.textContent = "加入词库";
}

async function deleteWord(word) {
  if (!window.confirm(`确定删除「${word.korean}」吗？`)) return;
  state.words = state.words.filter((entry) => entry.id !== word.id);
  persist();
  state.revealed = false;
  renderAll();
  toast("已删除");

  if (state.supabase && state.user) {
    const { error } = await softDeleteCloudWord(word.id);
    if (error) {
      addPendingDelete(word.id);
      toast("本地已删除，云端删除失败，请稍后同步检查");
    } else {
      removePendingDelete(word.id);
    }
    return;
  }

  addPendingDelete(word.id);
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
      shouldCreateUser: true,
    },
  });

  if (error) {
    toast(`发送失败：${error.message}`);
    return;
  }
  toast("验证码已发送，请查看邮箱");
}

async function applyMagicLink() {
  if (!state.supabase) {
    toast("先保存云配置");
    return;
  }

  const email = els.syncEmailInput.value.trim();
  const token = els.magicLinkInput.value.trim();
  if (!email) {
    toast("先输入邮箱");
    return;
  }
  if (!token) {
    toast("先输入邮箱验证码");
    return;
  }

  try {
    const result = await state.supabase.auth.verifyOtp({
      email,
      token,
      type: "email",
    });

    if (result.error) throw result.error;
    state.user = result.data?.session?.user || result.data?.user || null;
    els.magicLinkInput.value = "";
    await refreshSession({ quiet: true });
    updateCloudStatus();
    toast(state.user ? "已登录云端" : "验证码已处理，请再点检查登录状态");
  } catch (error) {
    toast(`登录失败：${error.message}`);
  }
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
  const pendingDeletedIds = readPendingDeletes();
  if (words.length === 0 && pendingDeletedIds.length === 0) {
    toast("本地新版词库为空");
    return;
  }

  setSyncing(true, "正在同步到云端 v2...");
  const pendingDeleteError = await processPendingDeletes();
  if (pendingDeleteError) {
    setSyncing(false, `同步失败：待删除词条处理失败：${pendingDeleteError.message}`);
    return;
  }

  const rows = words.map((word) => toDbWord(word, state.user.id));
  const { error } = rows.length
    ? await state.supabase
      .from(SUPABASE_V2_TABLE)
      .upsert(rows, { onConflict: "id" })
    : { error: null };

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

async function processPendingDeletes() {
  const ids = readPendingDeletes();
  if (ids.length === 0) return null;

  const remaining = [];
  for (const id of ids) {
    const { error } = await softDeleteCloudWord(id);
    if (error) {
      remaining.push(id);
    }
  }
  savePendingDeletes(remaining);
  return remaining.length > 0 ? new Error("部分删除未完成") : null;
}

async function softDeleteCloudWord(id) {
  const timestamp = nowIso();
  return state.supabase
    .from(SUPABASE_V2_TABLE)
    .update({
      deleted_at: timestamp,
      updated_at: timestamp,
    })
    .eq("id", id)
    .eq("user_id", state.user.id);
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
    placement_pending: typeof word.placementPending === "boolean" ? word.placementPending : true,
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
    placement_pending: true,
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
    lastAppliedReviewDate: "",
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
    placementPending: typeof row.placement_pending === "boolean" ? row.placement_pending : true,
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
  let status = "ready";
  if (message) {
    els.syncStatus.textContent = message;
    status = state.syncing ? "syncing" : "ready";
  } else if (!state.cloudReady) {
    els.syncStatus.textContent = "未配置云端";
    status = "unconfigured";
  } else if (!state.user) {
    els.syncStatus.textContent = "云端已配置，未登录";
    status = "signed-out";
  } else {
    const lastSyncAt = localStorage.getItem(LAST_SYNC_KEY);
    els.syncStatus.textContent = lastSyncAt
      ? `已登录：${state.user.email || "当前账号"} · 上次同步 ${formatDateTime(lastSyncAt)}`
      : `已登录：${state.user.email || "当前账号"}`;
    status = lastSyncAt ? "synced" : "signed-in";
  }
  els.syncStatus.dataset.status = status;

  const canUseCloud = Boolean(state.supabase && state.user && !state.syncing);
  els.signOutButton.disabled = !state.user || state.syncing;
  els.pullCloudButton.disabled = !canUseCloud;
  els.pushCloudButton.disabled = !canUseCloud;
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
  $(".brand-header-image").src = tabName === "review" ? "./assets/banner-today.png" : "./assets/banner.png";
  window.scrollTo({ top: 0, left: 0, behavior: "auto" });
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
