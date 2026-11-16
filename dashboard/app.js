// Token Launch Radar — the board page. Reads window.RADAR from ../data.js
// (written by main.ts from the same model that writes board.json, so the
// page and the board can never disagree), then renders a sortable,
// filterable board, a per-protocol detail view with the model's arithmetic
// and the farm plan, the calibration set of protocols already trading, and
// the category multiples the model used. No network: every byte is local.
//
// Views are addressable for sharing and screenshots: ?cat=Lending&watch=1
// filters the board, ?p=<slug> opens a protocol's detail view.

(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) { document.getElementById('statsLine').textContent = 'data.js did not load: run main.ts first.'; return; }

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  };
  var usd = function (v) {
    if (v == null) return '—';
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + v;
  };
  var pct = function (v) {
    if (v == null) return '<span class="flat">n/r</span>';
    var cls = v > 0.05 ? 'pos' : v < -0.05 ? 'neg' : 'flat';
    return '<span class="' + cls + '">' + (v > 0 ? '+' : '') + v.toFixed(1) + '%</span>';
  };
  var mult = function (v) { return '×' + v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '.0'); };

  // ---------- state ----------
  var params = new URLSearchParams(window.location.search);
  var state = {
    q: params.get('q') || '',
    cat: params.get('cat') || '',
    chain: params.get('chain') || '',
    min: Number(params.get('min') || 0),
    watch: params.get('watch') === '1',
    sort: params.get('sort') || 'rank',
    dir: params.get('dir') === 'desc' ? -1 : 1,
    detail: params.get('p') || '',
  };
  if (params.get('sort')) state.dir = params.get('dir') === 'asc' ? 1 : -1;

  var bySlug = {};
  DATA.rows.forEach(function (r) { bySlug[r.slug] = r; });

  // ---------- header ----------
  $('statsLine').innerHTML =
    '<strong>' + DATA.stats.board_rows + '</strong> pre-token protocols ranked · ' +
    '<strong>' + DATA.stats.watchlist + '</strong> <span class="star">★</span> on the $' + (DATA.floor_usd / 1e6) + 'M watchlist<br>' +
    'Snapshot of ' + esc(DATA.as_of) + ' · ' + DATA.stats.protocols + ' protocols · model ' + esc(DATA.model_version);
  $('sourceLine').textContent = DATA.source;

  // ---------- filter options ----------
  var cats = {}, chains = {};
  DATA.rows.forEach(function (r) {
    cats[r.category || 'Uncategorised'] = true;
    r.chains.forEach(function (c) { chains[c] = true; });
  });
  Object.keys(cats).sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; $('cat').appendChild(o);
  });
  Object.keys(chains).sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; $('chain').appendChild(o);
  });
  $('q').value = state.q;
  $('cat').value = state.cat;
  $('chain').value = state.chain;
  $('min').value = String(state.min);
  $('watch').checked = state.watch;

  function syncUrl() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.cat) p.set('cat', state.cat);
    if (state.chain) p.set('chain', state.chain);
    if (state.min) p.set('min', String(state.min));
    if (state.watch) p.set('watch', '1');
    if (state.sort !== 'rank') { p.set('sort', state.sort); p.set('dir', state.dir === 1 ? 'asc' : 'desc'); }
    if (state.detail) p.set('p', state.detail);
    var qs = p.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : ''));
  }

  // ---------- board ----------
  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.rows.filter(function (r) {
      if (state.watch && !r.watchlist) return false;
      if (state.cat && (r.category || 'Uncategorised') !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) === -1) return false;
      if (r.implied_value_usd < state.min) return false;
      if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.indexOf(q) === -1) return false;
      return true;
    });
    var key = state.sort, dir = state.dir;
    var value = function (r) {
      switch (key) {
        case 'name': return r.name.toLowerCase();
        case 'category': return (r.category || '').toLowerCase();
        case 'chains': return r.chains.length;
        case 'tvl_usd': return r.tvl_usd;
        case 'change_7d': return r.change_7d == null ? -Infinity : r.change_7d;
        case 'implied_value_usd': return r.implied_value_usd;
        case 'ratio': return r.implied_value_usd / r.tvl_usd;
        default: return r.rank;
      }
    };
    rows.sort(function (a, b) {
      var va = value(a), vb = value(b);
      if (va < vb) return -dir;
      if (va > vb) return dir;
      return a.rank - b.rank;
    });
    return rows;
  }

  function classChip(r) {
    if (r.product_class === 'protocol') return '<span class="chip">protocol</span>';
    return '<span class="chip ' + esc(r.product_class.replace(' ', '')) + '">' + esc(r.product_class) + '</span>';
  }

  function renderBoard() {
    var rows = visibleRows();
    $('countLine').textContent = 'Showing ' + rows.length + ' of ' + DATA.rows.length + ' protocols';
    var html = rows.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '"' + (r.rank <= 3 ? ' class="top3"' : '') + '>' +
        '<td class="num">' + r.rank + '</td>' +
        '<td class="name">' + (r.watchlist ? '<span class="star" title="On the house watchlist">★</span> ' : '') + esc(r.name) +
        '<span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || 'Uncategorised') + '</td>' +
        '<td class="num" title="' + esc(r.chains.join(', ')) + '">' + r.chains.length + '</td>' +
        '<td class="num">' + usd(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num implied">' + usd(r.implied_value_usd) + '</td>' +
        '<td class="num">' + (r.implied_value_usd / r.tvl_usd).toFixed(2) + '×</td>' +
        '<td>' + classChip(r) + '</td></tr>';
    }).join('');
    $('boardBody').innerHTML = html || '<tr><td colspan="9">No protocol matches these filters. Loosen one and the radar sweeps again.</td></tr>';
    var heads = document.querySelectorAll('#board th.sortable');
    heads.forEach(function (th) {
      var label = th.textContent.replace(/ [▲▼]$/, '');
      th.innerHTML = esc(label) + (th.dataset.sort === state.sort ? ' <span class="arrow">' + (state.dir === 1 ? '▲' : '▼') + '</span>' : '');
    });
  }

  // ---------- detail ----------
  function factorRow(what, small, factor, isTotal, amount) {
    return '<div class="row' + (isTotal ? ' total' : '') + '"><div class="what">' + what +
      (small ? '<small>' + small + '</small>' : '') + '</div>' +
      '<div class="factor">' + (isTotal ? esc(amount) : mult(factor)) + '</div></div>';
  }

  function renderDetail() {
    var box = $('detail');
    var r = state.detail ? bySlug[state.detail] : null;
    if (!r) { box.hidden = true; box.innerHTML = ''; return; }
    var ageText = r.age_days == null ? 'not reported' : (r.age_days / 365.25).toFixed(1) + ' years (since ' + esc(r.listed_at) + ')';
    var momentumNote = r.change_7d == null ? 'seven-day change not reported — neutral' : 'seven-day TVL change ' + (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%';
    var maturityNote = r.age_days == null ? 'no listing date in the record — neutral' : 'tracked with no token for ' + ageText;
    var multipleNote = r.category_peers > 0
      ? 'median of ' + r.category_peers + ' tokenised ' + esc(r.category || 'Uncategorised') + ' peers in the snapshot'
      : 'no tokenised peers in this category — the global median of ' + DATA.global_multiple.toFixed(3) + ' is used';
    var classNote = r.product_class === 'asset product'
      ? 'a wrapper or staking product of an asset that already trades: a token could claim the fees, not the assets'
      : r.product_class === 'bridge conduit' ? 'a bridge conduit: its TVL is other protocols’ assets in transit, and a token would capture fees on the flow, not the stock'
      : r.product_class === 'versioned' ? 'a versioned deployment beside its flagship: value would be split'
      : r.product_class === 'exchange' ? 'an exchange: the category multiple already prices revenue tokens, so no class cut'
      : 'a protocol in its own right: the full figure stands';
    box.innerHTML =
      '<button class="back" id="backBtn">← Back to the board</button>' +
      '<h2>' + (r.watchlist ? '<span class="star">★</span> ' : '') + esc(r.name) + '</h2>' +
      '<p class="sub">' + esc(r.category || 'Uncategorised') + ' · rank #' + r.rank + ' of ' + DATA.rows.length +
      ' · live on ' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + ': ' + esc(r.chains.slice(0, 6).join(', ')) + (r.chains.length > 6 ? '…' : '') + '</p>' +
      '<div class="stat-grid">' +
      '<div class="stat"><div class="k">Implied value</div><div class="v amber">' + usd(r.implied_value_usd) + '</div></div>' +
      '<div class="stat"><div class="k">TVL</div><div class="v">' + usd(r.tvl_usd) + '</div></div>' +
      '<div class="stat"><div class="k">7-day change</div><div class="v">' + (r.change_7d == null ? 'n/r' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%') + '</div></div>' +
      '<div class="stat"><div class="k">Tracked, no token</div><div class="v">' + ageText + '</div></div>' +
      '<div class="stat"><div class="k">Product class</div><div class="v">' + esc(r.product_class) + '</div></div>' +
      '<div class="stat"><div class="k">Watchlist</div><div class="v">' + (r.watchlist ? '★ yes' : 'below the floor') + '</div></div>' +
      '</div>' +
      '<h3>How the model gets ' + usd(r.implied_value_usd) + '</h3>' +
      '<div class="breakdown">' +
      factorRow('TVL, the base figure', 'total value locked in the snapshot', 0, true, usd(r.tvl_usd)) +
      factorRow('Category multiple', multipleNote, r.category_multiple, false) +
      factorRow('Momentum', momentumNote, r.momentum_factor, false) +
      factorRow('Maturity', maturityNote, r.maturity_factor, false) +
      factorRow('Class factor', classNote, r.class_factor, false) +
      factorRow('Implied value of a launch', 'this board’s own claim, not a prediction', 0, true, usd(r.implied_value_usd)) +
      '</div>' +
      '<h3>The farm plan</h3>' +
      '<ol class="plan">' + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
      '<p class="detail-note">' + esc(r.name) + ' records no token in the DefiLlama snapshot of ' + esc(DATA.as_of) +
      ' — that is a statement about the record, not the world. The implied value assumes a launch priced like its category’s trading peers; whether and when a token is issued is the protocol’s decision alone.</p>';
    box.hidden = false;
    $('backBtn').addEventListener('click', function () {
      state.detail = '';
      syncUrl();
      renderDetail();
      $('boardWrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------- calibration + multiples ----------
  $('liveBody').innerHTML = DATA.live.map(function (r) {
    return '<tr><td class="name">' + esc(r.name) + '</td><td>' + esc(r.symbol || '—') + '</td><td>' + esc(r.category || 'Uncategorised') + '</td>' +
      '<td class="num">' + usd(r.tvl_usd) + '</td><td class="num">' + usd(r.mcap_usd) + '</td><td class="num">' + usd(r.model_value_usd) + '</td></tr>';
  }).join('');
  $('multBody').innerHTML = DATA.category_multiples.map(function (c) {
    return '<tr><td>' + esc(c.category) + '</td><td class="num">' + c.peers + '</td><td class="num">' + c.multiple.toFixed(3) + '×</td></tr>';
  }).join('');

  // ---------- events ----------
  $('q').addEventListener('input', function () { state.q = this.value; syncUrl(); renderBoard(); });
  $('cat').addEventListener('change', function () { state.cat = this.value; syncUrl(); renderBoard(); });
  $('chain').addEventListener('change', function () { state.chain = this.value; syncUrl(); renderBoard(); });
  $('min').addEventListener('change', function () { state.min = Number(this.value); syncUrl(); renderBoard(); });
  $('watch').addEventListener('change', function () { state.watch = this.checked; syncUrl(); renderBoard(); });
  document.querySelectorAll('#board th.sortable').forEach(function (th) {
    th.addEventListener('click', function () {
      var key = th.dataset.sort;
      if (state.sort === key) state.dir = -state.dir;
      else { state.sort = key; state.dir = key === 'name' || key === 'category' ? 1 : -1; }
      syncUrl();
      renderBoard();
    });
  });
  $('boardBody').addEventListener('click', function (ev) {
    var tr = ev.target.closest('tr[data-slug]');
    if (!tr) return;
    state.detail = tr.dataset.slug;
    syncUrl();
    renderDetail();
  });

  renderBoard();
  renderDetail();
})();
