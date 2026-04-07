/**
 * ゴミ分別けんさくアプリ
 * - Fuse.js + 部分一致のハイブリッド検索
 * - インクリメンタルサジェスト
 * - IME（日本語入力）対応
 * - 全状態をhashで管理（ホーム / 検索結果 / 袋詳細）→ ブラウザの戻るで自然に遡れる
 */

(function () {
  'use strict';

  // ===== 要素取得 =====
  const $ = (id) => document.getElementById(id);
  const searchInput = $('search-input');
  const clearButton = $('clear-button');
  const suggestionsEl = $('suggestions');
  const initialView = $('initial-view');
  const searchResultEl = $('search-result');
  const quickButtonsEl = $('quick-buttons');
  const legendListEl = $('legend-list');

  // ===== カナ⇄ひらがな変換 =====
  const toHiragana = (str) =>
    str.replace(/[\u30a1-\u30f6]/g, (m) => String.fromCharCode(m.charCodeAt(0) - 0x60));
  const toKatakana = (str) =>
    str.replace(/[\u3041-\u3096]/g, (m) => String.fromCharCode(m.charCodeAt(0) + 0x60));

  // ===== Fuse.js 初期化 =====
  const fuseOptions = {
    keys: [
      { name: 'n', weight: 0.6 },
      { name: 'k', weight: 0.3 },
      { name: 'a', weight: 0.4 },
    ],
    threshold: 0.45,
    distance: 100,
    minMatchCharLength: 1,
    ignoreLocation: true,
    includeScore: true,
    shouldSort: true,
  };
  const fuse = new Fuse(window.GOMI_DATA, fuseOptions);

  // ===== 検索関数（ハイブリッド型） =====
  function search(query) {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const hira = toHiragana(trimmed);
    const kata = toKatakana(trimmed);
    const seen = new Set();
    const results = [];

    const add = (item) => {
      if (!seen.has(item.n)) {
        seen.add(item.n);
        results.push(item);
      }
    };

    // 1) 完全一致（最優先）
    window.GOMI_DATA.forEach((item) => {
      if (
        item.n === trimmed ||
        item.k === hira ||
        (item.a && (item.a.includes(trimmed) || item.a.includes(kata)))
      ) {
        add(item);
      }
    });

    // 2) 双方向部分一致
    window.GOMI_DATA.forEach((item) => {
      if (seen.has(item.n)) return;
      const hits =
        item.n.includes(trimmed) ||
        trimmed.includes(item.n) ||
        item.k.includes(hira) ||
        hira.includes(item.k) ||
        (item.a &&
          item.a.some(
            (a) => a.includes(trimmed) || trimmed.includes(a) || a.includes(kata)
          ));
      if (hits) add(item);
    });

    // 3) Fuse.js のあいまい検索
    fuse.search(trimmed).forEach(({ item }) => add(item));
    if (trimmed !== hira) {
      fuse.search(hira).forEach(({ item }) => add(item));
    }

    return results;
  }

  // ===== サジェスト描画 =====
  function renderSuggestions(query) {
    const results = search(query);
    if (results.length === 0) {
      suggestionsEl.hidden = true;
      suggestionsEl.innerHTML = '';
      return;
    }
    const top = results.slice(0, 8);
    suggestionsEl.innerHTML = top
      .map(
        (item) =>
          `<li class="suggestion-item" data-name="${escapeHtml(item.n)}">
            <span class="suggestion-name">${escapeHtml(item.n)}</span>
            <span class="suggestion-bags">${renderBagDots(item)}</span>
          </li>`
      )
      .join('');
    suggestionsEl.hidden = false;
  }

  // ===== 検索結果描画 =====
  function renderSearchResult(query) {
    const results = search(query);

    initialView.hidden = true;
    searchResultEl.hidden = false;

    if (results.length === 0) {
      searchResultEl.innerHTML = `
        <div class="no-result">
          ${renderBackButtons()}
          <p class="no-result-title">該当する品目が見つかりませんでした</p>
          <p class="no-result-text">
            別の言い方を試してみてください。<br>
            それでも見つからない場合は、役場か南空知公衆衛生組合（0123-88-3900）にお問い合わせください。
          </p>
        </div>
      `;
      bindBackButtons();
      window.scrollTo({ top: 0 });
      return;
    }

    const main = results[0];
    const subCandidates = results.slice(1, 8);

    let html = renderBackButtons();
    html += renderItemCard(main, true);

    if (subCandidates.length > 0) {
      html += `<div class="sub-section">
        <h3 class="sub-title">他の候補</h3>
        <ul class="sub-list">
          ${subCandidates
            .map(
              (item) =>
                `<li class="sub-item" data-name="${escapeHtml(item.n)}">
                  <span class="sub-item-name">${escapeHtml(item.n)}</span>
                  <span class="sub-bags">${renderBagDots(item)}</span>
                </li>`
            )
            .join('')}
        </ul>
      </div>`;
    }

    searchResultEl.innerHTML = html;

    // サブ候補クリックで再検索（hash変更）
    searchResultEl.querySelectorAll('.sub-item').forEach((el) => {
      el.addEventListener('click', () => {
        const name = el.dataset.name;
        navigate(`search/${encodeURIComponent(name)}`);
      });
    });

    bindBackButtons();
    window.scrollTo({ top: 0 });
  }

  // ===== 戻るボタン群 =====
  function renderBackButtons() {
    return `
      <div class="back-bar">
        <button type="button" class="back-btn back-btn-prev" id="back-prev">← 戻る</button>
        <button type="button" class="back-btn back-btn-home" id="back-home">🏠 ホーム</button>
      </div>
    `;
  }

  function bindBackButtons() {
    const prev = document.getElementById('back-prev');
    if (prev) {
      prev.addEventListener('click', () => {
        // 履歴があれば前のページへ。なければホームへ
        if (window.history.length > 1 && window.__appHasNavigated) {
          history.back();
        } else {
          navigate('');
        }
      });
    }
    const home = document.getElementById('back-home');
    if (home) {
      home.addEventListener('click', () => {
        navigate('');
      });
    }
  }

  // ===== 品目カード描画 =====
  function renderItemCard(item, isMain) {
    const partsHtml = item.p
      .map((part) => {
        const cls = window.CLASSIFICATION[part.b];
        if (!cls) return '';
        return `
          <div class="part-card" style="background-color:${cls.bagColor};color:${cls.textColor};">
            ${part.pt ? `<div class="part-name">${escapeHtml(part.pt)}</div>` : ''}
            <div class="part-classification">
              <span class="part-icon">${cls.icon}</span>
              <span class="part-label">${cls.label}</span>
            </div>
            <div class="part-bag">${cls.bagName}</div>
            ${part.note ? `<div class="part-note">⚠ ${escapeHtml(part.note)}</div>` : ''}
            <a href="#bag/${encodeURIComponent(part.b)}" class="part-detail-link" style="color:${cls.textColor};">この袋の詳しい出し方 →</a>
          </div>
        `;
      })
      .join('');

    return `
      <article class="item-card ${isMain ? 'item-card-main' : ''}">
        <h2 class="item-name">${escapeHtml(item.n)}</h2>
        ${item.p.length > 1 ? '<p class="item-multi-note">部品ごとに分別してください</p>' : ''}
        <div class="parts-grid">${partsHtml}</div>
      </article>
    `;
  }

  // ===== 袋ごとの色ドット表示 =====
  function renderBagDots(item) {
    const seen = new Set();
    const dots = [];
    item.p.forEach((part) => {
      if (seen.has(part.b)) return;
      seen.add(part.b);
      const cls = window.CLASSIFICATION[part.b];
      if (cls) {
        dots.push(
          `<span class="bag-dot" style="background-color:${cls.bagColor};border:1px solid rgba(0,0,0,0.06);" title="${cls.label}"></span>`
        );
      }
    });
    return dots.join('');
  }

  // ===== HTMLエスケープ =====
  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ===== 袋詳細ページ描画 =====
  function renderBagPage(bagKey) {
    const cls = window.CLASSIFICATION[bagKey];
    if (!cls) {
      navigate('');
      return;
    }

    initialView.hidden = true;
    searchResultEl.hidden = false;

    // 該当品目を抽出
    const matchedItems = window.GOMI_DATA.filter((item) =>
      item.p.some((p) => p.b === bagKey)
    );

    // ソート: 品目全体が該当するものを優先 → 50音順
    matchedItems.sort((a, b) => {
      const aFull = a.p.length === 1 && a.p[0].b === bagKey && !a.p[0].pt;
      const bFull = b.p.length === 1 && b.p[0].b === bagKey && !b.p[0].pt;
      if (aFull && !bFull) return -1;
      if (!aFull && bFull) return 1;
      const aCount = a.p.filter((p) => p.b === bagKey).length;
      const bCount = b.p.filter((p) => p.b === bagKey).length;
      if (aCount !== bCount) return bCount - aCount;
      return a.k.localeCompare(b.k, 'ja');
    });

    let html = renderBackButtons();

    // ヘッダー（袋の見出し）
    html += `
      <div class="bag-page-header" style="background-color:${cls.bagColor};color:${cls.textColor};">
        <div class="bag-page-icon">${cls.icon}</div>
        <h2 class="bag-page-title">${escapeHtml(cls.label)}</h2>
        <p class="bag-page-bagname">${escapeHtml(cls.bagName)}</p>
        ${cls.capacity ? `<p class="bag-page-capacity">容量：${escapeHtml(cls.capacity)}</p>` : ''}
      </div>
    `;

    // 出し方ガイド
    html += `<section class="howto-section">`;
    if (cls.summary) {
      html += `<p class="howto-summary">${escapeHtml(cls.summary)}</p>`;
    }
    if (cls.points && cls.points.length) {
      html += `
        <h3 class="howto-heading">📌 出し方のポイント</h3>
        <ul class="howto-list">
          ${cls.points.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}
        </ul>
      `;
    }
    if (cls.ng && cls.ng.length) {
      html += `
        <h3 class="howto-heading howto-heading-ng">🚫 注意・NG事項</h3>
        <ul class="howto-list howto-list-ng">
          ${cls.ng.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}
        </ul>
      `;
    }
    if (cls.note) {
      html += `<p class="howto-note">💡 ${escapeHtml(cls.note)}</p>`;
    }
    html += `</section>`;

    // 外部リンク
    if (cls.links && cls.links.length) {
      html += `<section class="links-section">`;
      html += `<h3 class="links-heading">🔗 関連リンク</h3>`;
      html += `<ul class="links-list">`;
      cls.links.forEach((link) => {
        html += `
          <li class="link-item">
            <a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">
              <span class="link-title">${escapeHtml(link.title)} ↗</span>
              ${link.desc ? `<span class="link-desc">${escapeHtml(link.desc)}</span>` : ''}
            </a>
          </li>
        `;
      });
      html += `</ul>`;
      html += `</section>`;
    }

    // 該当品目一覧
    html += `<section class="items-section">`;
    html += `<h3 class="items-heading">📋 この項目に該当する品目（${matchedItems.length}件）</h3>`;
    if (matchedItems.length === 0) {
      html += `<p class="items-empty">該当する品目がありません</p>`;
    } else {
      html += `<ul class="items-list">`;
      matchedItems.forEach((item) => {
        const matchedParts = item.p.filter((p) => p.b === bagKey);
        const partInfo = matchedParts
          .map((p) => {
            const parts = [];
            if (p.pt) parts.push(`<em>${escapeHtml(p.pt)}</em>`);
            if (p.note) parts.push(`<small>${escapeHtml(p.note)}</small>`);
            return parts.join(' ');
          })
          .filter(Boolean)
          .join(' / ');

        html += `
          <li class="bag-item" data-name="${escapeHtml(item.n)}">
            <div class="bag-item-name">${escapeHtml(item.n)}</div>
            ${partInfo ? `<div class="bag-item-detail">${partInfo}</div>` : ''}
          </li>
        `;
      });
      html += `</ul>`;
    }
    html += `</section>`;

    searchResultEl.innerHTML = html;

    // 品目クリックで検索結果ページへ（hash変更）
    searchResultEl.querySelectorAll('.bag-item').forEach((el) => {
      el.addEventListener('click', () => {
        const name = el.dataset.name;
        navigate(`search/${encodeURIComponent(name)}`);
      });
    });

    bindBackButtons();
    window.scrollTo({ top: 0 });
  }

  // ===== ホーム表示 =====
  function renderHome() {
    searchInput.value = '';
    clearButton.hidden = true;
    suggestionsEl.hidden = true;
    searchResultEl.hidden = true;
    initialView.hidden = false;
    window.scrollTo({ top: 0 });
  }

  // ===== ナビゲーション（hashを変える） =====
  function navigate(hash) {
    window.__appHasNavigated = true;
    if (location.hash === '#' + hash || (location.hash === '' && hash === '')) {
      // 同じhashなら再描画だけ
      handleRoute();
      return;
    }
    location.hash = hash;
  }

  // ===== ハッシュルーティング =====
  function handleRoute() {
    const hash = location.hash.slice(1);

    if (hash.startsWith('bag/')) {
      // 詳細ページでは検索バーをクリア
      searchInput.value = '';
      clearButton.hidden = true;
      suggestionsEl.hidden = true;
      const key = decodeURIComponent(hash.slice(4));
      renderBagPage(key);
    } else if (hash.startsWith('search/')) {
      const query = decodeURIComponent(hash.slice(7));
      searchInput.value = query;
      clearButton.hidden = !query;
      suggestionsEl.hidden = true;
      renderSearchResult(query);
    } else {
      // ホーム
      renderHome();
    }
  }

  window.addEventListener('hashchange', handleRoute);

  // ===== クイックボタン =====
  const QUICK_ITEMS = [
    'ペットボトル',
    'スプレー缶',
    '紙おむつ',
    '蛍光管',
    '乾電池',
    '傘',
    '電子レンジ',
    'カミソリ',
    'カップめん',
    '生ごみ',
    '段ボール',
    '鍋',
  ];

  function renderQuickButtons() {
    quickButtonsEl.innerHTML = QUICK_ITEMS.map(
      (name) =>
        `<button type="button" class="quick-btn" data-name="${escapeHtml(name)}">${escapeHtml(name)}</button>`
    ).join('');
    quickButtonsEl.querySelectorAll('.quick-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const name = btn.dataset.name;
        navigate(`search/${encodeURIComponent(name)}`);
      });
    });
  }

  // ===== 凡例 =====
  function renderLegend() {
    const order = ['生', '赤', '青', '茶', '灰', '白', '紙資源', '電池', '蛍光', '粗大', '直接青', '直接粗', '不可'];
    legendListEl.innerHTML = order
      .map((key) => {
        const cls = window.CLASSIFICATION[key];
        if (!cls) return '';
        return `
          <li class="legend-item" data-bag="${key}">
            <span class="legend-swatch" style="background-color:${cls.bagColor};color:${cls.textColor};">${cls.icon}</span>
            <span class="legend-label">
              <strong>${cls.label}</strong>
              <span class="legend-bag">${cls.bagName}</span>
            </span>
            <span class="legend-arrow">→</span>
          </li>
        `;
      })
      .join('');

    legendListEl.querySelectorAll('.legend-item').forEach((el) => {
      el.addEventListener('click', () => {
        const key = el.dataset.bag;
        navigate(`bag/${encodeURIComponent(key)}`);
      });
    });
  }

  // ===== IME対応 =====
  let isComposing = false;

  searchInput.addEventListener('compositionstart', () => {
    isComposing = true;
  });

  searchInput.addEventListener('compositionend', (e) => {
    isComposing = false;
    const query = e.target.value;
    clearButton.hidden = !query;
    if (query.trim()) {
      renderSuggestions(query);
    } else {
      suggestionsEl.hidden = true;
    }
  });

  searchInput.addEventListener('input', (e) => {
    const query = e.target.value;
    clearButton.hidden = !query;
    if (isComposing) return;

    if (!query.trim()) {
      suggestionsEl.hidden = true;
      // ホームに戻すかは hash の状態次第（直接的には変更しない）
      return;
    }
    renderSuggestions(query);
  });

  // Enterで検索結果表示
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !isComposing) {
      e.preventDefault();
      const query = searchInput.value.trim();
      if (query) {
        suggestionsEl.hidden = true;
        navigate(`search/${encodeURIComponent(query)}`);
        searchInput.blur();
      }
    }
  });

  // サジェストクリック
  suggestionsEl.addEventListener('click', (e) => {
    const li = e.target.closest('.suggestion-item');
    if (!li) return;
    const name = li.dataset.name;
    suggestionsEl.hidden = true;
    navigate(`search/${encodeURIComponent(name)}`);
    searchInput.blur();
  });

  // クリアボタン
  clearButton.addEventListener('click', () => {
    searchInput.value = '';
    clearButton.hidden = true;
    suggestionsEl.hidden = true;
    if (location.hash) {
      navigate('');
    }
    searchInput.focus();
  });

  // 検索エリア外クリックでサジェストを閉じる
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-section')) {
      suggestionsEl.hidden = true;
    }
  });

  // ===== 初期描画 =====
  renderQuickButtons();
  renderLegend();
  handleRoute();

  console.log(`[ゴミ分別けんさく] ${window.GOMI_DATA.length} 品目を読み込みました`);
})();
