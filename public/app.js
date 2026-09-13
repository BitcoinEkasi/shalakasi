// public/app.js
const API = '';
let token = sessionStorage.getItem('shalakasi_token');
let student = JSON.parse(sessionStorage.getItem('shalakasi_student') || 'null');
let currentSectionId = null;
let currentQuiz = [];
let quizIndex = 0;
let bookCache = null;
let reviewQuestions = [];
let reviewIndex = 0;
let reviewCorrectCount = 0;
let reviewChapter = null;

function authHeaders() {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

// Turns lines starting with "— " (used throughout the lesson content
// for lists) into a small styled ₿ bullet instead of a plain dash —
// a subtle recurring Bitcoin mark rather than recoloring everything.
function formatLessonText(text) {
  return text
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('—')) {
        return `<span class="btc-bullet">₿</span> ${trimmed.replace(/^—\s*/, '')}`;
      }
      return line;
    })
    .join('<br>');
}

// ---------- LOGIN ----------
document.getElementById('login-submit').addEventListener('click', doLogin);
document.getElementById('login-password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doLogin();
});

async function doLogin() {
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';

  if (!username || !password) {
    errEl.textContent = 'Enter your username and password.';
    return;
  }

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      errEl.textContent = data.error || 'Login failed.';
      return;
    }
    token = data.token;
    student = data.student;
    sessionStorage.setItem('shalakasi_token', token);
    sessionStorage.setItem('shalakasi_student', JSON.stringify(student));
    enterApp();
  } catch (err) {
    errEl.textContent = 'Could not reach the server. Check your connection.';
  }
}

document.getElementById('logout-btn').addEventListener('click', () => {
  sessionStorage.removeItem('shalakasi_token');
  sessionStorage.removeItem('shalakasi_student');
  token = null; student = null;
  stopPriceTicker();
  document.getElementById('app').classList.remove('active');
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('login-username').value = '';
  document.getElementById('login-password').value = '';
});

// ---------- APP SHELL ----------
function enterApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').classList.add('active');
  document.getElementById('student-name').textContent = student.full_name;
  loadNextSection();
  startPriceTicker();
}

// ---------- BTC/ZAR PRICE TICKER ----------
let priceTickerInterval = null;

function startPriceTicker() {
  fetchPrice();
  stopPriceTicker();
  priceTickerInterval = setInterval(fetchPrice, 60_000);
}

function stopPriceTicker() {
  if (priceTickerInterval) clearInterval(priceTickerInterval);
  priceTickerInterval = null;
}

async function fetchPrice() {
  const el = document.getElementById('price-ticker');
  if (!el) return;
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=zar&include_24hr_change=true');
    const data = await res.json();
    const price = data?.bitcoin?.zar;
    const change = data?.bitcoin?.zar_24h_change;
    if (!price) throw new Error('no price');

    const formattedPrice = 'R' + Math.round(price).toLocaleString('en-ZA');
    const changeClass = change >= 0 ? 'up' : 'down';
    const changeSign = change >= 0 ? '+' : '';
    const changeHtml = typeof change === 'number'
      ? `<span class="price-change ${changeClass}">${changeSign}${change.toFixed(1)}%</span>`
      : '';

    el.innerHTML = `<span class="btc-symbol">₿</span><span class="price-value">${formattedPrice}</span>${changeHtml}`;
  } catch (err) {
    el.innerHTML = `<span class="btc-symbol">₿</span><span class="price-value">—</span>`;
  }
}

document.querySelectorAll('.rail-btn').forEach((btn) => {
  btn.addEventListener('click', () => showView(btn.dataset.view));
});

function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  document.querySelectorAll('.rail-btn').forEach((b) => b.classList.remove('active'));
  document.querySelector(`.rail-btn[data-view="${name}"]`).classList.add('active');

  const titles = { course: 'Course', book: '<b>The Book</b>', dashboard: '<b>Your Progress</b>', live: '<b>Live Bitcoin Network</b>' };
  document.getElementById('topbar-title').innerHTML = titles[name];

  if (name === 'dashboard') loadDashboard();
  if (name === 'book') loadBook();
  if (name === 'live') startLiveNetworkDashboard(); else stopLiveNetworkDashboard();
}

// ---------- COURSE ----------
async function loadNextSection() {
  const res = await fetch('/api/curriculum', { headers: authHeaders(), cache: 'no-store' });
  if (res.status === 401) return forceLogout();
  const data = await res.json();

  // Chapter review gate: the first chapter (in order) that's fully
  // mastered but hasn't had its cumulative review attempted yet blocks
  // moving on to later chapters — this is what makes "answer everything
  // from every section" actually happen at the end of each chapter,
  // not just leave it optional.
  for (const ch of data.chapters) {
    const allMastered = ch.sections.length > 0 && ch.sections.every((s) => s.status === 'mastered');
    if (allMastered && !ch.review_passed) {
      loadChapterReview(ch);
      return;
    }
  }

  let target = null;
  outer: for (const ch of data.chapters) {
    for (const s of ch.sections) {
      if (s.status !== 'mastered') { target = { ...s, chapterNumber: ch.number, chapterTitle: ch.title }; break outer; }
    }
  }

  if (!target) {
    renderCertificate(data.chapters);
    return;
  }

  loadSection(target.id, target.chapterNumber, target.chapterTitle);
}

// A simple, deterministic-looking hex string for visual flavor on the
// certificate — styled like a block hash, but purely cosmetic. Not an
// actual blockchain anchor or cryptographic proof of anything; don't
// present it to students as more than a nice design detail.
function fakeCertHash(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) { h = (h * 31 + seed.charCodeAt(i)) >>> 0; }
  let hex = '';
  for (let i = 0; i < 16; i++) {
    h = (h * 1103515245 + 12345) >>> 0;
    hex += (h % 16).toString(16);
  }
  return hex;
}

function renderCertificate(chapters) {
  const totalChapters = chapters.length;
  const chaptersPassed = chapters.filter((c) => c.review_passed).length;
  const SATS_PER_CHAPTER = 500;
  const satsEarned = chaptersPassed * SATS_PER_CHAPTER;
  const today = new Date().toLocaleDateString('en-ZA', { year: 'numeric', month: 'long', day: 'numeric' });
  const hash = fakeCertHash(`${student.username}-${student.id}-${today}`);

  document.getElementById('course-content').innerHTML = `
    <div class="crumb">All chapters complete</div>
    <h1 class="section-title">You did it. 🎉</h1>

    <div class="cert-wrap">
      <div class="cert-card" id="cert-print-area">
        <div class="cert-top-bar"></div>
        <div class="cert-block-label">BLOCK — BITCOIN DIPLOMA GRADUATE</div>
        <div class="cert-name">${escapeHtmlDash(student.full_name)}</div>
        <div class="cert-sub">has completed the ShalaKasi Bitcoin Diploma</div>

        <div class="cert-stats">
          <div class="cert-stat"><div class="cert-stat-value">${chaptersPassed}/${totalChapters}</div><div class="cert-stat-label">Chapters mastered</div></div>
          <div class="cert-stat"><div class="cert-stat-value">⚡ ${satsEarned.toLocaleString()}</div><div class="cert-stat-label">Sats earned</div></div>
          <div class="cert-stat"><div class="cert-stat-value">${today}</div><div class="cert-stat-label">Completion date</div></div>
        </div>

        <div class="cert-hash">HASH · ${hash}</div>
        <div class="cert-footer">Bitcoin Ekasi &amp; Surfer Kids · Mossel Bay, South Africa</div>
      </div>

      <button class="continue-btn" id="cert-print-btn">Print certificate</button>
      <p class="cert-note">Talk to your facilitator about your official certificate and the Postgraduate track.</p>
    </div>
  `;

  document.getElementById('cert-print-btn').addEventListener('click', () => window.print());
}

async function loadSection(sectionId, chapterNumber, chapterTitle) {
  currentSectionId = sectionId;
  quizIndex = 0;

  const res = await fetch(`/api/sections/${sectionId}`, { headers: authHeaders() });
  if (res.status === 401) return forceLogout();
  const data = await res.json();
  currentQuiz = data.quiz || [];

  const el = document.getElementById('course-content');
  const ch = chapterNumber || data.section.chapters?.number;
  const chTitle = chapterTitle || data.section.chapters?.title;

  el.innerHTML = `
    <div class="crumb">Chapter ${ch} · ${chTitle} <span>· Section ${data.section.number}</span></div>
    <h1 class="section-title">${data.section.title}</h1>
    ${data.section.activity_title ? `<div class="activity-badge">✦ Activity: ${data.section.activity_title}</div>` : ''}
    <div class="body-text">${formatLessonText(data.section.content_md || 'Content for this section is being written by your facilitator — check back soon.')}</div>
    <div id="live-widget-slot"></div>
    <div id="pp-widget-slot"></div>
    <div id="checkpoint-slot"></div>
  `;

  loadLiveBitcoinWidget(data.section.number);
  loadPurchasingPowerWidget(data.section.number);

  renderCheckpoint();
}

// ---------- CHAPTER REVIEW ----------
// A cumulative test aggregating every checkpoint question from every
// section in a chapter, shown once all of that chapter's sections are
// mastered. Mandatory to go through, but the score doesn't block
// progress — it's shown honestly to the student either way.
async function loadChapterReview(chapter) {
  currentSectionId = null; // no single section is "current" during a review

  const res = await fetch(`/api/chapters/${chapter.id}/review`, { headers: authHeaders() });
  if (res.status === 401) return forceLogout();
  const data = await res.json();

  reviewQuestions = data.questions || [];
  reviewIndex = 0;
  reviewCorrectCount = 0;
  reviewChapter = { id: chapter.id, number: chapter.number, title: chapter.title };

  const el = document.getElementById('course-content');
  el.innerHTML = `
    <div class="crumb">Chapter ${chapter.number} · ${escapeHtmlDash(chapter.title)} <span>· Chapter Review</span></div>
    <h1 class="section-title">Let's check what stuck</h1>
    <div class="review-note">Before moving into the next chapter, let's go back through everything from Chapter ${chapter.number} — ${reviewQuestions.length} questions, pulled from every section you just worked through.</div>
    <div id="review-slot"></div>
  `;

  if (!reviewQuestions.length) {
    document.getElementById('review-slot').innerHTML = `<p class="no-quiz-note">No review questions available for this chapter yet. <button class="continue-btn" id="review-skip">Continue</button></p>`;
    document.getElementById('review-skip').addEventListener('click', async () => {
      await fetch(`/api/chapters/${chapter.id}/review/complete`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ score_percent: 100 }),
      });
      loadNextSection();
    });
    return;
  }

  renderReviewQuestion();
}

function renderReviewQuestion() {
  const slot = document.getElementById('review-slot');
  const q = reviewQuestions[reviewIndex];

  slot.innerHTML = `
    <div class="checkpoint-card">
      <div class="checkpoint-head">
        <div class="checkpoint-label">Review · ${reviewIndex + 1} of ${reviewQuestions.length}</div>
        <span class="pill-tag">from ${escapeHtmlDash(q.section_number)}</span>
      </div>
      <div class="checkpoint-q">${q.question}</div>
      <div class="quiz-options">${q.options.map((opt, i) => `<div class="quiz-opt" data-index="${i}">${opt}</div>`).join('')}</div>
      <div id="review-mining-slot"></div>
      <div id="review-decision-slot"></div>
    </div>`;

  document.querySelectorAll('#review-slot .quiz-opt').forEach((opt) => {
    opt.addEventListener('click', () => submitReviewAnswer(q.id, parseInt(opt.dataset.index, 10)));
  });
}

async function submitReviewAnswer(quizId, selectedIndex) {
  document.querySelectorAll('#review-slot .quiz-opt').forEach((o) => o.classList.add('disabled'));

  const miningSlot = document.getElementById('review-mining-slot');
  miningSlot.innerHTML = `
    <div class="mining-anim">
      <div class="mining-hash" id="review-mining-hash">0000000000000000</div>
      <div class="mining-label"><span class="mining-dot"></span> Checking your answer…</div>
    </div>`;
  const hashEl = document.getElementById('review-mining-hash');
  const hashChars = '0123456789abcdef';
  const hashInterval = setInterval(() => {
    if (!hashEl) return;
    let s = '';
    for (let i = 0; i < 16; i++) s += hashChars[Math.floor(Math.random() * hashChars.length)];
    hashEl.textContent = s;
  }, 60);

  let data;
  try {
    const minDelay = new Promise((resolve) => setTimeout(resolve, 600));
    const [res] = await Promise.all([
      fetch(`/api/chapters/${reviewChapter.id}/review/answer`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ quizId, selectedIndex }),
      }),
      minDelay,
    ]);
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    data = await res.json();
  } catch (err) {
    clearInterval(hashInterval);
    miningSlot.innerHTML = `
      <div class="mining-anim">
        <div class="mining-label" style="color:var(--dusk);">Couldn't reach the server — check your connection.</div>
      </div>
      <button class="continue-btn" id="review-retry-answer">Try again</button>`;
    document.getElementById('review-retry-answer').addEventListener('click', () => {
      document.querySelectorAll('#review-slot .quiz-opt').forEach((o) => o.classList.remove('disabled'));
      miningSlot.innerHTML = '';
    });
    return;
  }
  clearInterval(hashInterval);
  miningSlot.innerHTML = '';

  if (data.isCorrect) reviewCorrectCount += 1;

  document.querySelectorAll('#review-slot .quiz-opt').forEach((o) => {
    const idx = parseInt(o.dataset.index, 10);
    if (idx === data.correctIndex) o.classList.add('correct');
    else if (idx === selectedIndex) o.classList.add('incorrect');
  });

  reviewIndex += 1;
  const decisionSlot = document.getElementById('review-decision-slot');

  if (reviewIndex < reviewQuestions.length) {
    decisionSlot.innerHTML = `<button class="continue-btn" id="review-next">Next question</button>`;
    document.getElementById('review-next').addEventListener('click', renderReviewQuestion);
  } else {
    const scorePercent = Math.round((reviewCorrectCount / reviewQuestions.length) * 100);
    const completeRes = await fetch(`/api/chapters/${reviewChapter.id}/review/complete`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({ score_percent: scorePercent }),
    });
    const completeData = await completeRes.json();

    const el = document.getElementById('course-content');

    if (completeData.passed) {
      let rewardLine = 'Chapter complete!';
      if (completeData.reward?.status === 'paid') {
        rewardLine = `🎉 ${completeData.reward.amount_sats} sats sent to your wallet for finishing this chapter!`;
      } else if (completeData.reward?.status === 'no_match') {
        rewardLine = `Chapter complete! Your sats reward is on hold — your wallet isn't linked yet. Check with your facilitator to get that sorted.`;
      } else if (completeData.reward?.status === 'failed') {
        rewardLine = `Chapter complete! The sats reward hit a snag on our end — Your facilitator can sort that out manually.`;
      }

      el.innerHTML = `
        <div class="crumb">Chapter ${reviewChapter.number} · ${escapeHtmlDash(reviewChapter.title)} <span>· Chapter Review Complete</span></div>
        <h1 class="section-title">${scorePercent}% — you passed!</h1>
        <div class="review-note">${rewardLine}</div>
        <button class="continue-btn" id="review-continue">Continue to the next chapter</button>
      `;
      document.getElementById('review-continue').addEventListener('click', loadNextSection);
    } else {
      el.innerHTML = `
        <div class="crumb">Chapter ${reviewChapter.number} · ${escapeHtmlDash(reviewChapter.title)} <span>· Chapter Review</span></div>
        <h1 class="section-title">${scorePercent}% — not quite there yet</h1>
        <div class="review-note">You need 70% to pass and move on to the next chapter. Worth going back through the sections you're less sure of before trying again.</div>
        <button class="continue-btn" id="review-retry">Try the review again</button>
      `;
      document.getElementById('review-retry').addEventListener('click', () => loadChapterReview(reviewChapter));
    }
  }
}

// ---------- LIVE BITCOIN NETWORK WIDGET (Chapter 9) ----------
const MEMPOOL_WIDGET_SECTIONS = { '9.3.2': 'blocks', '9.4': 'mempool', '9.5': 'both' };

async function loadLiveBitcoinWidget(sectionNumber) {
  const mode = MEMPOOL_WIDGET_SECTIONS[sectionNumber];
  const slot = document.getElementById('live-widget-slot');
  if (!mode || !slot) return;

  slot.innerHTML = `<div class="live-widget"><div class="live-widget-loading">Fetching live Bitcoin network data…</div></div>`;

  try {
    const calls = [];
    if (mode === 'blocks' || mode === 'both') {
      calls.push(fetch('https://mempool.space/api/blocks/tip/height').then((r) => r.text()));
      calls.push(fetch('https://mempool.space/api/blocks/tip/hash').then((r) => r.text()));
    }
    if (mode === 'mempool' || mode === 'both') {
      calls.push(fetch('https://mempool.space/api/mempool').then((r) => r.json()));
      calls.push(fetch('https://mempool.space/api/v1/fees/recommended').then((r) => r.json()));
    }

    const results = await Promise.all(calls);
    let height, hash, mempoolStats, fees;
    if (mode === 'blocks') [height, hash] = results;
    if (mode === 'mempool') [mempoolStats, fees] = results;
    if (mode === 'both') [height, hash, mempoolStats, fees] = results;

    let html = `<div class="live-widget">
      <div class="live-widget-head"><span class="live-dot"></span> Live from the Bitcoin network right now</div>
      <div class="live-widget-grid">`;

    if (height !== undefined) {
      html += `<div class="live-stat"><div class="live-stat-label">Current block height</div><div class="live-stat-value">${Number(height).toLocaleString()}</div><div class="live-stat-sub">${hash.slice(0, 16)}…</div></div>`;
    }
    if (mempoolStats) {
      html += `<div class="live-stat"><div class="live-stat-label">Transactions waiting in the mempool</div><div class="live-stat-value">${Number(mempoolStats.count).toLocaleString()}</div><div class="live-stat-sub">${(mempoolStats.vsize / 1_000_000).toFixed(1)} MB of pending data</div></div>`;
    }
    if (fees) {
      html += `<div class="live-stat"><div class="live-stat-label">Fee for next-block confirmation</div><div class="live-stat-value">${fees.fastestFee} sat/vB</div><div class="live-stat-sub">Economy: ${fees.economyFee} sat/vB</div></div>`;
    }

    html += `</div><div class="live-widget-note">This is real, live data — not a screenshot. Reload the page in a few minutes and these numbers will have changed.</div></div>`;
    slot.innerHTML = html;
  } catch (err) {
    slot.innerHTML = `<div class="live-widget"><div class="live-widget-loading">Couldn't reach mempool.space right now — this needs an internet connection. The lesson content above still explains the concept either way.</div></div>`;
  }
}

// ---------- PURCHASING POWER COMPARISON (Chapter 5) ----------
// Real historical BTC/ZAR price from CoinGecko's free API, compared
// against R100 in cash eroded by an average South African inflation
// rate. The elapsed time is computed from whatever data CoinGecko
// actually returns (its free tier's history window can vary) rather
// than assuming a fixed "10 years," so the label is always accurate
// to the real data behind it.
const PP_WIDGET_SECTIONS = new Set(['5.1', '5.1.1']);
const SA_AVG_ANNUAL_INFLATION = 0.055; // ~5.5%/yr — Stats SA long-run average, used as a labeled estimate, not live data

async function loadPurchasingPowerWidget(sectionNumber) {
  const slot = document.getElementById('pp-widget-slot');
  if (!PP_WIDGET_SECTIONS.has(sectionNumber) || !slot) return;

  slot.innerHTML = `<div class="pp-widget"><div class="live-widget-loading">Fetching real historical Bitcoin price data…</div></div>`;

  try {
    const res = await fetch('https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=zar&days=3650');
    const data = await res.json();
    const prices = data.prices;
    if (!prices || !prices.length) throw new Error('no price data');

    const [earliestTs, earliestPrice] = prices[0];
    const [latestTs, latestPrice] = prices[prices.length - 1];
    const yearsElapsed = (latestTs - earliestTs) / (365.25 * 24 * 60 * 60 * 1000);
    const yearsLabel = yearsElapsed >= 1.5 ? `${Math.round(yearsElapsed)} years` : `${Math.round(yearsElapsed * 12)} months`;

    const btcUnitsBoughtThen = 100 / earliestPrice;
    const btcValueNow = btcUnitsBoughtThen * latestPrice;

    const cashValueTodayRealTerms = 100 / Math.pow(1 + SA_AVG_ANNUAL_INFLATION, yearsElapsed);

    const maxBar = Math.max(btcValueNow, 100); // cash side never exceeds R100 nominal, so bitcoin's bar is always the scale reference
    const cashBarPercent = Math.max((100 / maxBar) * 100, 4);
    const btcBarPercent = Math.max((btcValueNow / maxBar) * 100, 4);

    slot.innerHTML = `
      <div class="pp-widget">
        <div class="pp-head">R100, held ${yearsLabel} ago — where is it now?</div>
        <div class="pp-row">
          <div class="pp-label">Kept as cash</div>
          <div class="pp-bar-track"><div class="pp-bar-fill cash" style="width:${cashBarPercent}%">R${cashValueTodayRealTerms.toFixed(0)} of real buying power</div></div>
        </div>
        <div class="pp-row">
          <div class="pp-label">Converted to Bitcoin</div>
          <div class="pp-bar-track"><div class="pp-bar-fill btc" style="width:${btcBarPercent}%">R${btcValueNow.toLocaleString('en-ZA', { maximumFractionDigits: 0 })} today</div></div>
        </div>
        <div class="pp-note">The Bitcoin side uses real historical BTC/ZAR prices from CoinGecko — genuine data, not an illustration. The cash side is an estimate using South Africa's ~5.5% long-run average annual inflation, since no free live inflation-index API exists to pull that part in real time. This isn't investment advice — it's one real illustration of the inflation effect covered in the lesson above, over one specific historical period; past performance doesn't predict the future.</div>
      </div>`;
  } catch (err) {
    slot.innerHTML = `<div class="pp-widget"><div class="live-widget-loading">Couldn't fetch historical price data right now — this needs an internet connection. The lesson content above still explains the concept either way.</div></div>`;
  }
}

function renderCheckpoint() {
  const slot = document.getElementById('checkpoint-slot');
  if (!currentQuiz.length) {
    slot.innerHTML = `<p class="no-quiz-note">No checkpoint questions yet for this section — Your facilitator is still writing this one. <button class="continue-btn" id="skip-continue">Continue anyway</button></p>`;
    document.getElementById('skip-continue')?.addEventListener('click', async () => {
      await fetch(`/api/sections/${currentSectionId}/complete`, { method: 'POST', headers: authHeaders() });
      loadNextSection();
    });
    return;
  }
  if (quizIndex >= currentQuiz.length) {
    slot.innerHTML = `<p class="no-quiz-note">Checkpoint complete.</p>`;
    return;
  }

  const q = currentQuiz[quizIndex];
  slot.innerHTML = `
    <div class="checkpoint-card">
      <div class="checkpoint-head"><div class="checkpoint-label">Checkpoint · ${quizIndex + 1} of ${currentQuiz.length}</div></div>
      <div class="checkpoint-q">${q.question}</div>
      <div class="quiz-options">${q.options.map((opt, i) => `<div class="quiz-opt" data-index="${i}">${opt}</div>`).join('')}</div>
      <div id="mining-slot"></div>
      <div id="decision-slot"></div>
    </div>`;

  document.querySelectorAll('.quiz-opt').forEach((opt) => {
    opt.addEventListener('click', () => submitAnswer(q.id, parseInt(opt.dataset.index, 10)));
  });
}

async function submitAnswer(quizId, selectedIndex) {
  document.querySelectorAll('.quiz-opt').forEach((o) => o.classList.add('disabled'));

  const miningSlot = document.getElementById('mining-slot');
  miningSlot.innerHTML = `
    <div class="mining-anim">
      <div class="mining-hash" id="mining-hash">0000000000000000</div>
      <div class="mining-label"><span class="mining-dot"></span> Checking your answer…</div>
    </div>`;
  const hashEl = document.getElementById('mining-hash');
  const hashChars = '0123456789abcdef';
  const hashInterval = setInterval(() => {
    if (!hashEl) return;
    let s = '';
    for (let i = 0; i < 16; i++) s += hashChars[Math.floor(Math.random() * hashChars.length)];
    hashEl.textContent = s;
  }, 60);

  let data;
  try {
    const minDelay = new Promise((resolve) => setTimeout(resolve, 750));
    const [res] = await Promise.all([
      fetch(`/api/sections/${currentSectionId}/attempt`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ quizId, selectedIndex, responseTimeMs: null }),
      }),
      minDelay,
    ]);
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    data = await res.json();
  } catch (err) {
    clearInterval(hashInterval);
    miningSlot.innerHTML = `
      <div class="mining-anim">
        <div class="mining-label" style="color:var(--dusk);">Couldn't reach the server — check your connection.</div>
      </div>
      <button class="continue-btn" id="retry-answer">Try again</button>`;
    document.getElementById('retry-answer').addEventListener('click', () => {
      document.querySelectorAll('.quiz-opt').forEach((o) => o.classList.remove('disabled'));
      miningSlot.innerHTML = '';
    });
    return;
  }

  clearInterval(hashInterval);
  miningSlot.innerHTML = '';

  document.querySelectorAll('.quiz-opt').forEach((o) => {
    const idx = parseInt(o.dataset.index, 10);
    if (idx === data.correctIndex) o.classList.add('correct');
    else if (idx === selectedIndex) o.classList.add('incorrect');
  });

  quizIndex += 1;
  const decisionSlot = document.getElementById('decision-slot');

  if (quizIndex < currentQuiz.length) {
    decisionSlot.innerHTML = `<button class="continue-btn" id="next-q">Next question</button>`;
    document.getElementById('next-q').addEventListener('click', renderCheckpoint);
  } else if (data.decision) {
    decisionSlot.innerHTML = `
      <div class="decision-note">💡 <span>${data.decision.reasoning}</span></div>
      <button class="continue-btn" id="continue-btn">Continue</button>`;
    document.getElementById('continue-btn').addEventListener('click', loadNextSection);
  }
}

// ---------- BOOK (full curriculum reader) ----------
async function loadBook() {
  const el = document.getElementById('book-content');
  if (bookCache) { renderBook(bookCache); return; }

  el.innerHTML = `<p class="body-text">Loading the full Bitcoin Diploma…</p>`;
  const res = await fetch('/api/book', { headers: authHeaders() });
  if (res.status === 401) return forceLogout();
  const data = await res.json();
  bookCache = data;
  renderBook(data);
}

function renderBook(data) {
  const el = document.getElementById('book-content');

  const toc = data.chapters.map((ch) =>
    `<a href="#book-ch-${ch.number}">Chapter ${ch.number} — ${ch.title}</a>`
  ).join('');

  const chaptersHtml = data.chapters.map((ch) => `
    <div class="book-chapter" id="book-ch-${ch.number}">
      <div class="book-chapter-head">
        <div class="book-chapter-eyebrow">Chapter ${ch.number}</div>
        <div class="book-chapter-title">${ch.title}</div>
      </div>
      ${ch.sections.map((s) => `
        <div class="book-section">
          <div class="book-section-title"><span class="num">${s.number}</span> ${s.title}</div>
          ${s.activity_title ? `<div class="book-activity">✦ Activity: ${s.activity_title}</div>` : ''}
          <div class="book-body">${s.content_md ? formatLessonText(s.content_md) : '<i style="color:var(--text-faint)">Content for this section is still being written.</i>'}</div>
        </div>
      `).join('')}
    </div>
  `).join('');

  el.innerHTML = `
    <div class="book-title">The Bitcoin Diploma</div>
    <div class="book-sub">The full course, start to finish — read ahead, jump around, or come back to anything you've already covered.</div>
    <div class="book-toc"><h3>Contents</h3>${toc}</div>
    ${chaptersHtml}
  `;
}

// ---------- DASHBOARD ----------
// ---------- LIVE BITCOIN NETWORK (full-screen demo dashboard) ----------
let liveNetworkInterval = null;
let halvingTickInterval = null;
let halvingTargetMs = null; // estimated timestamp of the next halving, recalculated each data refresh

const BLOCKS_PER_HALVING = 210_000;
const AVG_SECONDS_PER_BLOCK = 600; // Bitcoin's ~10 minute target block time

function startLiveNetworkDashboard() {
  fetchLiveNetworkData();
  stopLiveNetworkDashboard();
  liveNetworkInterval = setInterval(fetchLiveNetworkData, 15_000);
  halvingTickInterval = setInterval(tickHalvingCountdown, 1000);
}

function stopLiveNetworkDashboard() {
  if (liveNetworkInterval) clearInterval(liveNetworkInterval);
  if (halvingTickInterval) clearInterval(halvingTickInterval);
  liveNetworkInterval = null;
  halvingTickInterval = null;
}

function formatCountdown(ms) {
  if (ms <= 0) return { d: 0, h: 0, m: 0, s: 0 };
  const totalSeconds = Math.floor(ms / 1000);
  return {
    d: Math.floor(totalSeconds / 86400),
    h: Math.floor((totalSeconds % 86400) / 3600),
    m: Math.floor((totalSeconds % 3600) / 60),
    s: totalSeconds % 60,
  };
}

// Ticks the countdown display every second between the 15s data refreshes,
// so it visibly counts down rather than jumping every 15 seconds.
function tickHalvingCountdown() {
  if (!halvingTargetMs) return;
  const el = document.getElementById('halving-countdown-value');
  if (!el) return;
  const { d, h, m, s } = formatCountdown(halvingTargetMs - Date.now());
  el.textContent = `${d}d ${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

async function fetchLiveNetworkData() {
  const el = document.getElementById('live-content');

  try {
    const [priceRes, heightRes, hashRes, mempoolRes, feesRes] = await Promise.all([
      fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=zar,usd&include_24hr_change=true'),
      fetch('https://mempool.space/api/blocks/tip/height'),
      fetch('https://mempool.space/api/blocks/tip/hash'),
      fetch('https://mempool.space/api/mempool'),
      fetch('https://mempool.space/api/v1/fees/recommended'),
    ]);
    const priceData = await priceRes.json();
    const height = await heightRes.text();
    const hash = await hashRes.text();
    const mempoolData = await mempoolRes.json();
    const fees = await feesRes.json();

    const zarPrice = priceData?.bitcoin?.zar;
    const usdPrice = priceData?.bitcoin?.usd;
    const change = priceData?.bitcoin?.zar_24h_change;
    const changeClass = change >= 0 ? 'up' : 'down';
    const changeSign = change >= 0 ? '+' : '';

    // Halving happens at every multiple of 210,000 blocks — estimate the
    // next one from the real current height and Bitcoin's ~10 min target
    // block time. This is a real calculation from real live data, not a
    // fixed date — it'll drift slightly as actual mining speed varies,
    // same as every other halving estimate you'll see anywhere.
    const currentHeight = Number(height);
    const nextHalvingBlock = Math.ceil((currentHeight + 1) / BLOCKS_PER_HALVING) * BLOCKS_PER_HALVING;
    const blocksRemaining = nextHalvingBlock - currentHeight;
    halvingTargetMs = Date.now() + blocksRemaining * AVG_SECONDS_PER_BLOCK * 1000;
    const initialCountdown = formatCountdown(halvingTargetMs - Date.now());

    el.innerHTML = `
      <div class="live-header">
        <div class="live-header-badge"><span class="live-dot"></span> LIVE</div>
        <h1 class="live-title">The Bitcoin Network</h1>
        <p class="live-sub">Not a simulation, not a screenshot — this is happening right now, refreshing every 15 seconds.</p>
      </div>

      <div class="live-grid">
        <div class="live-card live-card-wide">
          <div class="live-card-label">BTC / ZAR</div>
          <div class="live-card-value live-price">R${Math.round(zarPrice).toLocaleString('en-ZA')}</div>
          <div class="live-card-sub">
            <span class="price-change ${changeClass}">${changeSign}${change?.toFixed(2)}% (24h)</span>
            &nbsp;·&nbsp; $${Math.round(usdPrice).toLocaleString('en-US')} USD
          </div>
        </div>

        <div class="live-card halving-card live-card-wide">
          <div class="live-card-label">⚡ Next Bitcoin halving — estimated</div>
          <div class="live-card-value halving-value" id="halving-countdown-value">${initialCountdown.d}d ${String(initialCountdown.h).padStart(2, '0')}h ${String(initialCountdown.m).padStart(2, '0')}m ${String(initialCountdown.s).padStart(2, '0')}s</div>
          <div class="live-card-sub">Block ${nextHalvingBlock.toLocaleString()} · ${blocksRemaining.toLocaleString()} blocks away · mining reward cuts in half</div>
        </div>

        <div class="live-card">
          <div class="live-card-label">Current block height</div>
          <div class="live-card-value">${Number(height).toLocaleString()}</div>
          <div class="live-card-sub live-mono">${hash.slice(0, 24)}…</div>
        </div>

        <div class="live-card">
          <div class="live-card-label">Pending transactions</div>
          <div class="live-card-value">${Number(mempoolData.count).toLocaleString()}</div>
          <div class="live-card-sub">${(mempoolData.vsize / 1_000_000).toFixed(1)} MB waiting to confirm</div>
        </div>

        <div class="live-card">
          <div class="live-card-label">Fee — next block</div>
          <div class="live-card-value">${fees.fastestFee} <span class="live-unit">sat/vB</span></div>
          <div class="live-card-sub">Economy: ${fees.economyFee} sat/vB</div>
        </div>
      </div>

      <p class="live-footer">Source: CoinGecko &amp; mempool.space public APIs, fetched directly from this browser. Halving estimate calculated from real block height, not a fixed date.</p>
    `;
  } catch (err) {
    el.innerHTML = `
      <div class="live-header">
        <h1 class="live-title">The Bitcoin Network</h1>
      </div>
      <p class="body-text">Couldn't reach the live data sources right now — this needs an internet connection.</p>`;
  }
}

async function loadDashboard() {
  const res = await fetch('/api/curriculum', { headers: authHeaders(), cache: 'no-store' });
  const data = await res.json();
  const el = document.getElementById('dashboard-content');

  const totalSections = data.chapters.reduce((n, c) => n + c.sections.length, 0);
  const masteredSections = data.chapters.reduce((n, c) => n + c.sections.filter((s) => s.status === 'mastered').length, 0);
  const SATS_PER_CHAPTER = 500;
  const chaptersPassed = data.chapters.filter((c) => c.review_passed).length;
  const satsEarned = chaptersPassed * SATS_PER_CHAPTER;

  el.innerHTML = `
    <h1 class="dash-title">${student.full_name}'s progress</h1>
    <p class="dash-sub">${masteredSections} of ${totalSections} sections mastered · ShalaKasi is building this path as you go, not following a fixed order.</p>
    <div class="sats-earned-card">
      <div class="sats-earned-icon">⚡</div>
      <div>
        <div class="sats-earned-value">${satsEarned.toLocaleString()} sats earned</div>
        <div class="sats-earned-sub">${chaptersPassed} chapter${chaptersPassed === 1 ? '' : 's'} passed · 500 sats per chapter review</div>
      </div>
    </div>
    <div class="path-wrap" id="path-wrap">
      <svg class="path-svg" id="path-svg"></svg>
      ${data.chapters.map((ch, i) => {
        const chStatus = chapterStatus(ch);
        const side = i % 2 === 0 ? 'left' : 'right';
        return `
        <div class="path-node ${side}" data-chapter="${ch.number}">
          <div class="path-bubble ${chStatus}">
            <div class="path-bubble-bar"></div>
            <div class="path-coin ${chStatus}">₿</div>
            <div class="path-node-label"><span class="path-node-num">Chapter ${ch.number}</span>${escapeHtmlDash(ch.title)}</div>
            <div class="path-bubble-tail"></div>
          </div>
        </div>`;
      }).join('')}
    </div>
    ${data.chapters.map((ch) => `
      <div class="chapter-card" id="chapter-card-${ch.number}">
        <div class="chapter-card-head">
          <h3>Ch ${ch.number} · ${ch.title}</h3>
          <span>${ch.sections.filter((s) => s.status === 'mastered').length}/${ch.sections.length}</span>
        </div>
        <div class="chip-row">
          ${ch.sections.map((s) => `<div class="chip ${s.status}" title="${s.number} ${s.title} — ${s.status}">${s.number.split('.').pop()}</div>`).join('')}
        </div>
      </div>`).join('')}
  `;

  drawPathConnectors();
  attachPathNodeHandlers(data.chapters);
}

function chapterStatus(chapter) {
  const statuses = chapter.sections.map((s) => s.status);
  if (statuses.every((s) => s === 'mastered')) return 'mastered';
  if (statuses.some((s) => s !== 'locked')) return 'in_progress';
  return 'locked';
}

function escapeHtmlDash(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

// Draws a real dashed curve through each chapter node's actual on-screen
// position, rather than faking a zigzag with CSS alone — so it stays
// correct regardless of label length, screen width, or font size.
function drawPathConnectors() {
  const wrap = document.getElementById('path-wrap');
  const svg = document.getElementById('path-svg');
  const nodes = Array.from(wrap.querySelectorAll('.path-node'));
  if (!wrap || !svg || nodes.length < 2) return;

  const wrapRect = wrap.getBoundingClientRect();
  svg.setAttribute('width', wrapRect.width);
  svg.setAttribute('height', wrapRect.height);
  svg.setAttribute('viewBox', `0 0 ${wrapRect.width} ${wrapRect.height}`);

  const points = nodes.map((node) => {
    const coin = node.querySelector('.path-coin');
    const r = coin.getBoundingClientRect();
    return { x: r.left - wrapRect.left + r.width / 2, y: r.top - wrapRect.top + r.height / 2 };
  });

  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const midY = (prev.y + curr.y) / 2;
    // Smooth S-curve between alternating sides instead of a sharp zigzag corner.
    d += ` C ${prev.x} ${midY}, ${curr.x} ${midY}, ${curr.x} ${curr.y}`;
  }

  svg.innerHTML = `<path d="${d}" fill="none" stroke="#3A3F48" stroke-width="3" stroke-dasharray="2 10" stroke-linecap="round"/>`;
}

function attachPathNodeHandlers(chapters) {
  document.querySelectorAll('.path-node').forEach((node) => {
    node.addEventListener('click', () => {
      const chNumber = parseInt(node.dataset.chapter, 10);
      const chapter = chapters.find((c) => c.number === chNumber);
      if (!chapter) return;
      const card = document.getElementById(`chapter-card-${chNumber}`);
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });
}

window.addEventListener('resize', () => {
  if (document.getElementById('view-dashboard').classList.contains('active')) drawPathConnectors();
});

// ---------- BOOT ----------
function forceLogout() {
  sessionStorage.clear(); token = null; student = null;
  document.getElementById('app').classList.remove('active');
  document.getElementById('login-screen').style.display = 'flex';
}

if (token && student) {
  enterApp();
}
