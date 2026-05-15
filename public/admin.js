document.addEventListener('DOMContentLoaded', async () => {
    const loader       = document.getElementById('loader');
    const dashboardWrapper = document.querySelector('.dashboard-wrapper');
    const pageContent  = document.getElementById('page-content');
    const pageTitle    = document.getElementById('page-title');
    const pageSubtitle = document.getElementById('page-subtitle');
    const navItems     = document.querySelectorAll('.nav-item[data-page]');
    const logoutBtn    = document.getElementById('logout-btn');
    const menuToggle   = document.getElementById('menu-toggle');
    const sidebar      = document.querySelector('.sidebar');

    let statsData      = null;
    let activeIntervals = [];

    const clearIntervals = () => { activeIntervals.forEach(clearInterval); activeIntervals = []; };

    /* ─── API ────────────────────────────────────────────── */
    const api = {
        _request: async (endpoint, options = {}) => {
            try {
                const res  = await fetch(endpoint, options);
                if (res.status === 401) { window.location.href = '/admin-login.html'; return; }
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || `Request failed with status ${res.status}`);
                return data;
            } catch (err) {
                console.error(`API error on ${endpoint}:`, err);
                showMessage(`Error: ${err.message}`, 'error');
                throw err;
            }
        },
        get:  (ep)       => api._request(ep),
        post: (ep, body) => api._request(ep, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    };

    /* ─── Toast ──────────────────────────────────────────── */
    const showMessage = (text, type = 'success') => {
        const el = document.createElement('div');
        el.className = `message-toast ${type}`;
        el.textContent = text;
        document.body.appendChild(el);
        setTimeout(() => el.classList.add('show'), 10);
        setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3200);
    };

    /* ─── Modal ──────────────────────────────────────────── */
    const createModal = (title, content, footerButtons) => {
        closeModal();
        document.querySelector('#modal-container').innerHTML = `
            <div class="modal-backdrop">
                <div class="modal">
                    <div class="modal-header">
                        <h2>${title}</h2>
                        <button class="close-btn">&times;</button>
                    </div>
                    <div class="modal-body">${content}</div>
                    <div class="modal-footer">
                        ${footerButtons.map(btn => `<button id="${btn.id}" class="btn ${btn.class || ''}">${btn.text}</button>`).join('')}
                    </div>
                </div>
            </div>`;
        const backdrop = document.querySelector('.modal-backdrop');
        backdrop.querySelector('.close-btn').onclick = closeModal;
        backdrop.onclick = (e) => { if (e.target === backdrop) closeModal(); };
        setTimeout(() => backdrop.classList.add('show'), 10);
        return backdrop.querySelector('.modal');
    };

    const closeModal = () => {
        const backdrop = document.querySelector('.modal-backdrop');
        if (backdrop) { backdrop.classList.remove('show'); setTimeout(() => backdrop.remove(), 280); }
    };

    const escapeHTML = (str) => {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    };

    /* ─── Stat card helper ───────────────────────────────── */
    const statCard = (icon, label, value, colorClass = '') => `
        <div class="stat-card">
            <div class="stat-icon"><i data-feather="${icon}"></i></div>
            <div class="stat-info">
                <div class="stat-value ${colorClass}">${value}</div>
                <div class="stat-label">${label}</div>
            </div>
        </div>`;

    /* ─── Chart defaults ─────────────────────────────────── */
    const chartDefaults = {
        plugins: {
            legend: { labels: { color: 'rgba(160,168,204,0.8)', font: { size: 11 }, boxWidth: 10, usePointStyle: true } }
        },
        scales: {
            x: { ticks: { color: 'rgba(93,100,144,0.9)', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.03)', drawBorder: false } },
            y: { ticks: { color: 'rgba(93,100,144,0.9)', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)', drawBorder: false }, beginAtZero: true }
        }
    };

    /* ─── App ────────────────────────────────────────────── */
    const App = {
        init: async () => {
            try {
                const stats = await api.get('/api/admin/stats');
                statsData = stats;

                document.getElementById('bot-avatar').src   = stats.bot.avatar;
                document.getElementById('bot-name').textContent = stats.bot.username;
                document.getElementById('guild-count').textContent = stats.guildCount;
                document.getElementById('user-count').textContent  = stats.userCount.toLocaleString();

                loader.style.display = 'none';
                dashboardWrapper.style.display = 'flex';

                App.bindEvents();
                const hash = window.location.hash.slice(1) || 'servers';
                await App.loadPage(hash);
            } catch (error) {
                console.error('App init error:', error);
                loader.innerHTML = `
                    <div style="text-align:center;padding:32px;">
                        <p style="color:var(--error);font-weight:600;margin-bottom:14px;">情報の読み込みに失敗しました。</p>
                        <a href="/admin-login.html" class="btn" style="margin-top:16px;">ログインページへ</a>
                    </div>`;
            }
        },

        loadPage: async (pageName) => {
            try {
                clearIntervals();
                navItems.forEach(item => item.classList.remove('active'));
                const activeItem = document.querySelector(`[data-page="${pageName}"]`);
                if (activeItem) activeItem.classList.add('active');

                pageContent.innerHTML = '<div class="loader-ring" style="margin:60px auto;"></div>';

                if (App.renderers[pageName]) await App.renderers[pageName]();
                else pageContent.innerHTML = '<p style="text-align:center;padding:40px;color:var(--text-muted);">ページが見つかりません</p>';

                feather.replace();
            } catch (error) {
                pageContent.innerHTML = `<div class="card"><p style="color:var(--error);">エラー: ${escapeHTML(error.message)}</p></div>`;
            }
        },

        bindEvents: () => {
            navItems.forEach(item => {
                item.addEventListener('click', (e) => {
                    e.preventDefault();
                    const page = item.dataset.page;
                    App.loadPage(page);
                    window.location.hash = page;
                });
            });

            logoutBtn.addEventListener('click', () => {
                createModal('ログアウトの確認', '<p>本当にログアウトしますか？</p>',
                    [{ id: 'cancel-logout', text: 'キャンセル', class: 'btn-secondary' },
                     { id: 'confirm-logout', text: 'ログアウト', class: 'btn-danger' }]);
                document.getElementById('cancel-logout').onclick  = closeModal;
                document.getElementById('confirm-logout').onclick = async () => {
                    try { await api.post('/api/admin/logout'); window.location.href = '/admin-login.html'; }
                    catch (err) { showMessage('ログアウトに失敗しました', 'error'); }
                };
            });

            menuToggle.addEventListener('click', () => sidebar.classList.toggle('is-open'));

            document.getElementById('global-user-search').addEventListener('keypress', async (e) => {
                if (e.key !== 'Enter') return;
                const userId = e.target.value.trim();
                if (!userId) return;
                try {
                    const data = await api.get(`/api/admin/user-search?userId=${userId}`);
                    createModal('ユーザー検索結果', `
                        <div style="text-align:center;padding:10px 0;">
                            <img src="${data.avatar}" style="width:64px;height:64px;border-radius:50%;border:2px solid var(--border-base);margin-bottom:12px;">
                            <div style="font-size:1.1rem;font-weight:600;">${escapeHTML(data.tag)}</div>
                            <div style="font-size:0.8rem;color:var(--text-muted);font-family:var(--font-mono);margin-bottom:14px;">ID: ${escapeHTML(data.id)}</div>
                            <p style="color:var(--text-secondary);font-size:0.88rem;">所属サーバー (${data.guilds.length}):</p>
                            <ul style="list-style:none;padding:0;margin-top:8px;max-height:100px;overflow-y:auto;text-align:left;background:var(--bg-raised);border-radius:var(--r-sm);padding:8px 12px;">
                                ${data.guilds.map(g => `<li style="font-size:0.87rem;padding:3px 0;border-bottom:1px solid var(--border-subtle);">${escapeHTML(g.name)}</li>`).join('') || '<li style="color:var(--text-muted);">なし</li>'}
                            </ul>
                            <div style="margin-top:16px;">
                                <button class="btn btn-danger btn-small" id="bl-user-btn">ブラックリストに追加</button>
                            </div>
                        </div>`,
                        [{ id: 'close-search', text: '閉じる', class: 'btn-secondary' }]);
                    document.getElementById('close-search').onclick = closeModal;
                    document.getElementById('bl-user-btn').onclick  = () => App.blacklistUser(data.id);
                } catch (err) {
                    showMessage('ユーザーが見つかりません。', 'error');
                }
            });
        },

        blacklistUser: async (userId) => {
            try {
                await api.post('/api/admin/blacklist', { userId, action: 'add' });
                showMessage(`ユーザー ${userId} をブラックリストに追加しました。`);
                closeModal();
            } catch (err) {
                showMessage('追加に失敗しました', 'error');
            }
        },

        /* ─── Renderers ───────────────────────────────────── */
        renderers: {

            /* ─── Servers ──────────────────────────────────── */
            servers: async () => {
                pageTitle.textContent    = 'サーバー管理';
                pageSubtitle.textContent = 'ボットが参加している全サーバーの管理';

                const stats = statsData || await api.get('/api/admin/stats');
                let currentPage = 1;
                let lastUpdated = null;

                pageContent.innerHTML = `
                    <div class="grid-container" id="stats-grid">
                        ${statCard('globe',    '総サーバー数',  stats.guildCount)}
                        ${statCard('users',    '総ユーザー数',  stats.userCount.toLocaleString())}
                        ${statCard('clock',    '稼働時間',      stats.uptime)}
                        ${statCard('database', 'メモリ',        stats.memoryUsage + ' MB')}
                    </div>

                    <div class="card">
                        <div class="card-header">
                            <h3>サーバー一覧</h3>
                            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                                <input type="text" id="server-search" placeholder="名前やIDで検索..." style="width:220px;padding:8px 12px;">
                                <button id="refresh-servers-btn" class="btn btn-secondary btn-small" title="手動更新">
                                    <i data-feather="refresh-cw"></i>
                                </button>
                                <span id="last-updated-label" style="font-size:0.76rem;color:var(--text-muted);white-space:nowrap;"></span>
                            </div>
                        </div>
                        <div class="server-list" id="server-list"></div>
                        <div class="pagination-controls" style="margin-top:16px;">
                            <button id="prev-page" class="btn btn-secondary btn-small" disabled>← 前へ</button>
                            <span id="page-info" class="page-info">Page 1</span>
                            <button id="next-page" class="btn btn-secondary btn-small" disabled>次へ →</button>
                        </div>
                    </div>`;

                feather.replace();

                const updateLastUpdated = () => {
                    lastUpdated = new Date();
                    const el = document.getElementById('last-updated-label');
                    if (el) el.textContent = `最終更新: ${lastUpdated.toLocaleTimeString('ja-JP')}`;
                };

                const renderServers = async (silent = false) => {
                    const searchEl = document.getElementById('server-search');
                    const listEl   = document.getElementById('server-list');
                    if (!listEl) return;

                    const search = searchEl ? searchEl.value : '';

                    if (!silent) {
                        listEl.innerHTML = '<div class="loader-ring" style="margin:32px auto;"></div>';
                    }

                    try {
                        // 統計情報もリアルタイム更新
                        const [data, freshStats] = await Promise.all([
                            api.get(`/api/admin/guilds?page=${currentPage}&limit=20&search=${encodeURIComponent(search)}`),
                            api.get('/api/admin/stats')
                        ]);

                        statsData = freshStats;

                        // スタットカード更新
                        const statsGrid = document.getElementById('stats-grid');
                        if (statsGrid) {
                            statsGrid.innerHTML =
                                statCard('globe',    '総サーバー数',  freshStats.guildCount) +
                                statCard('users',    '総ユーザー数',  freshStats.userCount.toLocaleString()) +
                                statCard('clock',    '稼働時間',      freshStats.uptime) +
                                statCard('database', 'メモリ',        freshStats.memoryUsage + ' MB');
                            feather.replace();
                        }

                        // ヘッダーのサーバー/ユーザー数更新
                        const guildCountEl = document.getElementById('guild-count');
                        const userCountEl  = document.getElementById('user-count');
                        if (guildCountEl) guildCountEl.textContent = freshStats.guildCount;
                        if (userCountEl)  userCountEl.textContent  = freshStats.userCount.toLocaleString();

                        if (!listEl) return;

                        if (!data || !data.guilds || data.guilds.length === 0) {
                            listEl.innerHTML = '<p style="text-align:center;padding:32px;color:var(--text-muted);">サーバーが見つかりません</p>';
                        } else {
                            listEl.innerHTML = data.guilds.map(guild => `
                                <div class="server-card">
                                    <div class="server-card-header">
                                        <div style="display:flex;align-items:center;gap:12px;">
                                            ${guild.icon
                                                ? `<img src="${escapeHTML(guild.icon)}" alt="icon" style="width:40px;height:40px;border-radius:50%;border:2px solid var(--border-base);">`
                                                : `<div style="width:40px;height:40px;border-radius:50%;background:var(--bg-raised);border:2px solid var(--border-base);display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-weight:700;font-size:1rem;">${escapeHTML(guild.name.charAt(0))}</div>`
                                            }
                                            <div>
                                                <div class="server-name">${escapeHTML(guild.name)}</div>
                                                <div style="font-size:0.76rem;color:var(--text-muted);margin-top:3px;font-family:var(--font-mono);">${escapeHTML(guild.id)}</div>
                                            </div>
                                        </div>
                                        <div style="display:flex;gap:6px;">
                                            <button class="btn btn-danger btn-small leave-guild-btn" data-guild-id="${escapeHTML(guild.id)}" data-guild-name="${escapeHTML(guild.name)}" title="サーバーから退出">
                                                <i data-feather="log-out"></i>
                                            </button>
                                        </div>
                                    </div>
                                    <div class="server-stats">
                                        <div class="server-stat"><i data-feather="users"></i><span>${guild.memberCount.toLocaleString()} メンバー</span></div>
                                        <div class="server-stat"><i data-feather="calendar"></i><span>参加: ${new Date(guild.joinedTimestamp).toLocaleDateString('ja-JP')}</span></div>
                                    </div>
                                </div>
                            `).join('');

                            // 退出ボタンイベント
                            listEl.querySelectorAll('.leave-guild-btn').forEach(btn => {
                                btn.addEventListener('click', () => {
                                    const guildId   = btn.dataset.guildId;
                                    const guildName = btn.dataset.guildName;
                                    createModal(
                                        'サーバーから退出',
                                        `<p><strong>${escapeHTML(guildName)}</strong> からボットを退出させますか？</p><p style="color:var(--error);margin-top:8px;font-size:0.88rem;">[WARN] この操作は元に戻せません。</p>`,
                                        [
                                            { id: 'cancel-leave',  text: 'キャンセル', class: 'btn-secondary' },
                                            { id: 'confirm-leave', text: '退出する',   class: 'btn-danger' }
                                        ]
                                    );
                                    document.getElementById('cancel-leave').onclick  = closeModal;
                                    document.getElementById('confirm-leave').onclick = async () => {
                                        try {
                                            await api.post(`/api/admin/guilds/${guildId}/leave`);
                                            showMessage(`${guildName} から退出しました。`);
                                            closeModal();
                                            await renderServers();
                                        } catch (err) {
                                            showMessage(`退出失敗: ${err.message}`, 'error');
                                        }
                                    };
                                });
                            });
                        }

                        const pageInfoEl = document.getElementById('page-info');
                        const prevPageEl = document.getElementById('prev-page');
                        const nextPageEl = document.getElementById('next-page');
                        if (pageInfoEl) pageInfoEl.textContent = `Page ${data.currentPage} / ${data.totalPages}`;
                        if (prevPageEl) prevPageEl.disabled = data.currentPage <= 1;
                        if (nextPageEl) nextPageEl.disabled = data.currentPage >= data.totalPages;

                        feather.replace();
                        updateLastUpdated();
                    } catch (e) {
                        console.error('renderServers error:', e);
                        if (!silent && listEl) {
                            listEl.innerHTML = `<p style="color:var(--error);padding:16px;">読み込み失敗: ${escapeHTML(e.message)}</p>`;
                        }
                    }
                };

                // イベントバインド
                const searchInput = document.getElementById('server-search');
                if (searchInput) {
                    searchInput.addEventListener('input', () => { currentPage = 1; renderServers(); });
                }

                const prevBtn = document.getElementById('prev-page');
                const nextBtn = document.getElementById('next-page');
                if (prevBtn) prevBtn.onclick = () => { if (currentPage > 1) { currentPage--; renderServers(); } };
                if (nextBtn) nextBtn.onclick = () => { currentPage++; renderServers(); };

                const refreshBtn = document.getElementById('refresh-servers-btn');
                if (refreshBtn) refreshBtn.onclick = () => renderServers();

                // 初回レンダリング
                await renderServers();

                // リアルタイム更新（30秒ごと）
                const interval = setInterval(() => renderServers(true), 30000);
                activeIntervals.push(interval);
            },

            /* ─── Announcements ─────────────────────────────── */
            announcements: async () => {
                pageTitle.textContent    = 'お知らせ送信';
                pageSubtitle.textContent = '全サーバーにお知らせを一斉送信';

                pageContent.innerHTML = `
                    <div class="card">
                        <div class="card-header"><h3>お知らせ作成</h3></div>
                        <form id="announcement-form">
                            <div class="form-group">
                                <label for="ann-title">タイトル <span style="color:var(--error);">*</span></label>
                                <input type="text" id="ann-title" required placeholder="例: 重要なお知らせ">
                            </div>
                            <div class="form-group">
                                <label for="ann-description">内容 <span style="color:var(--error);">*</span></label>
                                <textarea id="ann-description" required placeholder="お知らせの内容を入力してください" rows="6"></textarea>
                            </div>
                            <div class="form-grid">
                                <div class="form-group">
                                    <label for="ann-color">埋め込みの色</label>
                                    <input type="color" id="ann-color" value="#00d9f5">
                                </div>
                                <div class="form-group">
                                    <label for="ann-url">URL (任意)</label>
                                    <input type="text" id="ann-url" placeholder="https://example.com">
                                </div>
                            </div>
                            <div class="form-group">
                                <label for="ann-footer">フッター (任意)</label>
                                <input type="text" id="ann-footer" placeholder="OrderlyCore Team">
                            </div>
                            <button type="submit" class="btn">
                                <i data-feather="send"></i> 送信
                            </button>
                        </form>
                    </div>`;
                feather.replace();

                document.getElementById('announcement-form').addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const btn     = e.target.querySelector('button[type="submit"]');
                    const btnHTML = btn.innerHTML;
                    btn.disabled = true;
                    btn.innerHTML = '<div class="loader-ring-small"></div>';

                    try {
                        const result = await api.post('/api/admin/announce', {
                            title:       document.getElementById('ann-title').value,
                            description: document.getElementById('ann-description').value,
                            color:       document.getElementById('ann-color').value,
                            url:         document.getElementById('ann-url').value   || null,
                            footer:      document.getElementById('ann-footer').value || null
                        });
                        showMessage(`${result.sentCount}個のサーバーに送信しました！`);
                        e.target.reset();
                    } catch (error) {
                        showMessage(`送信失敗: ${error.message}`, 'error');
                    } finally {
                        btn.disabled = false;
                        btn.innerHTML = btnHTML;
                    }
                    feather.replace();
                });
            },

            /* ─── Status ────────────────────────────────────── */
            status: async () => {
                pageTitle.textContent    = 'ステータス管理';
                pageSubtitle.textContent = 'ボットのステータスメッセージを設定';

                const settings = await api.get('/api/admin/statuses');

                pageContent.innerHTML = `
                    <div class="card">
                        <div class="card-header"><h3>ステータスメッセージ設定</h3></div>

                        <div class="form-group">
                            <label>モード</label>
                            <div style="display:flex;gap:20px;margin-top:8px;">
                                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                                    <input type="radio" name="status-mode" value="custom" ${settings.mode === 'custom' ? 'checked' : ''}>
                                    <span>カスタム</span>
                                </label>
                                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                                    <input type="radio" name="status-mode" value="ai" ${settings.mode === 'ai' ? 'checked' : ''}>
                                    <span>AI生成</span>
                                </label>
                            </div>
                        </div>

                        <div id="custom-statuses" ${settings.mode === 'ai' ? 'style="display:none;"' : ''}>
                            <div class="card-header" style="margin-top:16px;">
                                <h3>ステータス一覧</h3>
                                <button id="add-status-btn" class="btn btn-small">
                                    <i data-feather="plus"></i> 追加
                                </button>
                            </div>
                            <div id="status-list">
                                ${(settings.list || []).map((status, index) => `
                                    <div class="status-item" data-index="${index}">
                                        <input type="hidden" class="emoji-input" value="${escapeHTML(status.emoji || '')}">
                                        <input type="text" class="status-text" value="${escapeHTML(status.state)}" placeholder="ステータステキスト" style="flex:1;">
                                        <button class="btn btn-danger btn-small delete-status-btn">
                                            <i data-feather="trash-2"></i>
                                        </button>
                                    </div>
                                `).join('')}
                            </div>
                        </div>

                        <button id="save-status-btn" class="btn" style="margin-top:20px;">
                            <i data-feather="save"></i> 保存
                        </button>
                    </div>`;
                feather.replace();

                document.querySelectorAll('input[name="status-mode"]').forEach(radio => {
                    radio.addEventListener('change', (e) => {
                        document.getElementById('custom-statuses').style.display =
                            e.target.value === 'custom' ? 'block' : 'none';
                    });
                });

                document.getElementById('add-status-btn').addEventListener('click', () => {
                    const list  = document.getElementById('status-list');
                    const index = list.children.length;
                    const div   = document.createElement('div');
                    div.className = 'status-item';
                    div.dataset.index = index;
                    div.innerHTML = `
                        <input type="hidden" class="emoji-input" value="">
                        <input type="text" class="status-text" placeholder="ステータステキスト" style="flex:1;">
                        <button class="btn btn-danger btn-small delete-status-btn">
                            <i data-feather="trash-2"></i>
                        </button>`;
                    list.appendChild(div);
                    feather.replace();
                    div.querySelector('.delete-status-btn').addEventListener('click', () => div.remove());
                });

                document.querySelectorAll('.delete-status-btn').forEach(btn => {
                    btn.addEventListener('click', () => btn.closest('.status-item').remove());
                });

                document.getElementById('save-status-btn').addEventListener('click', async () => {
                    const mode     = document.querySelector('input[name="status-mode"]:checked').value;
                    const statuses = Array.from(document.querySelectorAll('.status-item'))
                        .map(item => ({ emoji: item.querySelector('.emoji-input').value, state: item.querySelector('.status-text').value }))
                        .filter(s => s.state);
                    try {
                        await api.post('/api/admin/statuses', { mode, statuses });
                        showMessage('ステータス設定を保存しました');
                    } catch (error) {
                        showMessage(`保存失敗: ${error.message}`, 'error');
                    }
                });
            },

            /* ─── Logs ──────────────────────────────────────── */
            logs: async () => {
                pageTitle.textContent    = 'システムログ';
                pageSubtitle.textContent = 'リアルタイムログビューアー';

                const stats = statsData || await api.get('/api/admin/stats');

                pageContent.innerHTML = `
                    <div class="grid-container">
                        ${statCard('globe',    '接続サーバー', stats.guildCount)}
                        ${statCard('users',    '総ユーザー',   stats.userCount.toLocaleString())}
                        ${statCard('clock',    '稼働時間',     stats.uptime)}
                        ${statCard('database', 'メモリ',       stats.memoryUsage + ' MB')}
                    </div>

                    <div class="card">
                        <div class="card-header">
                            <h3>システムログ</h3>
                            <div style="display:flex;gap:8px;align-items:center;">
                                <label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:0.82rem;">
                                    <input type="checkbox" id="log-info" checked>
                                    <span style="color:var(--success);">INFO</span>
                                </label>
                                <label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:0.82rem;">
                                    <input type="checkbox" id="log-warn" checked>
                                    <span style="color:var(--warning);">WARN</span>
                                </label>
                                <label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:0.82rem;">
                                    <input type="checkbox" id="log-error" checked>
                                    <span style="color:var(--error);">ERROR</span>
                                </label>
                                <button id="refresh-logs" class="btn btn-secondary btn-small"><i data-feather="refresh-cw"></i> 更新</button>
                                <button id="clear-logs"   class="btn btn-secondary btn-small"><i data-feather="trash-2"></i> クリア</button>
                            </div>
                        </div>
                        <div id="log-viewer">
                            <p style="color:var(--success);">[${new Date().toLocaleTimeString()}] [INFO] システムログビューアー起動</p>
                            <p style="color:var(--success);">[${new Date().toLocaleTimeString()}] [INFO] ボット稼働中 — ${stats.guildCount}サーバー接続</p>
                            <p style="color:var(--text-muted);">[${new Date().toLocaleTimeString()}] [DEBUG] メモリ使用量: ${stats.memoryUsage}MB</p>
                            <p style="color:var(--success);">[${new Date().toLocaleTimeString()}] [INFO] 全システム正常動作中</p>
                        </div>
                    </div>

                    <div class="card">
                        <div class="card-header"><h3>最近のイベント</h3></div>
                        <div class="table-container">
                            <table class="styled-table">
                                <thead><tr>
                                    <th>時刻</th><th>イベント</th><th>詳細</th><th>ステータス</th>
                                </tr></thead>
                                <tbody>
                                    ${stats.recentGuilds.slice(0, 5).map(guild => `
                                        <tr>
                                            <td style="font-family:var(--font-mono);font-size:0.82rem;">${new Date(guild.joinedTimestamp).toLocaleString('ja-JP')}</td>
                                            <td style="font-weight:500;">サーバー参加</td>
                                            <td>${escapeHTML(guild.name)}</td>
                                            <td><span style="color:var(--success);font-size:0.82rem;font-family:var(--font-mono);">[OK] 成功</span></td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>`;
                feather.replace();

                // リアルタイムログ更新（10秒ごと）
                const updateLogs = async () => {
                    const logViewer = document.getElementById('log-viewer');
                    if (!logViewer) return;
                    try {
                        const health = await api.get('/api/admin/health/history');
                        const p = document.createElement('p');
                        p.style.color = 'var(--success)';
                        p.textContent = `[${new Date().toLocaleTimeString()}] [INFO] Ping: ${health.ping}ms | Memory: ${health.memory}MB`;
                        logViewer.appendChild(p);
                        while (logViewer.children.length > 50) logViewer.removeChild(logViewer.firstChild);
                        logViewer.scrollTop = logViewer.scrollHeight;
                    } catch (e) { /* silent */ }
                };

                const logInterval = setInterval(updateLogs, 10000);
                activeIntervals.push(logInterval);

                document.getElementById('refresh-logs').addEventListener('click', () => updateLogs());

                document.getElementById('clear-logs').addEventListener('click', () => {
                    document.getElementById('log-viewer').innerHTML =
                        '<p style="color:var(--text-muted);">[SYSTEM] ログがクリアされました</p>';
                });
            },

            /* ─── Maintenance ───────────────────────────────── */
            maintenance: async () => {
                pageTitle.textContent    = 'メンテナンス設定';
                pageSubtitle.textContent = 'ボット全体のメンテナンスモードを管理';

                const status = await api.get('/api/admin/maintenance');

                pageContent.innerHTML = `
                    <div class="card">
                        <div class="card-header"><h3>メンテナンスモード設定</h3></div>
                        <div class="maintenance-status ${status.enabled ? 'active' : ''}">
                            <div style="flex:1;">
                                <div style="font-weight:600;margin-bottom:4px;" id="maintenance-status-text">
                                    ${status.enabled ? '[WARN] メンテナンス中' : '[OK] 通常稼働中'}
                                </div>
                                <div style="font-size:0.84rem;color:var(--text-muted);">
                                    メンテナンスモードが有効な場合、全ユーザーのコマンドがブロックされます。
                                </div>
                            </div>
                            <label class="switch">
                                <input type="checkbox" id="maintenance-toggle" ${status.enabled ? 'checked' : ''}>
                                <span class="slider"></span>
                            </label>
                        </div>
                        <div class="form-group">
                            <label for="maintenance-reason">理由 (メッセージ)</label>
                            <textarea id="maintenance-reason" placeholder="メンテナンス中の理由を入力してください" rows="4">${escapeHTML(status.reason || '')}</textarea>
                        </div>
                        <button id="save-maintenance" class="btn">
                            <i data-feather="save"></i> 保存
                        </button>
                    </div>`;
                feather.replace();

                document.getElementById('maintenance-toggle').addEventListener('change', (e) => {
                    const card = e.target.closest('.maintenance-status');
                    card.classList.toggle('active', e.target.checked);
                    document.getElementById('maintenance-status-text').textContent =
                        e.target.checked ? '[WARN] メンテナンス中' : '[OK] 通常稼働中';
                });

                document.getElementById('save-maintenance').onclick = async () => {
                    const enabled = document.getElementById('maintenance-toggle').checked;
                    const reason  = document.getElementById('maintenance-reason').value;
                    try {
                        await api.post('/api/admin/maintenance', { enabled, reason });
                        showMessage('メンテナンス設定を更新しました。');
                    } catch (err) {
                        showMessage(`保存失敗: ${err.message}`, 'error');
                    }
                };
            },

            /* ─── Blacklist ─────────────────────────────────── */
            blacklist: async () => {
                pageTitle.textContent    = 'ブラックリスト管理';
                pageSubtitle.textContent = 'ボットの使用を制限されたユーザー一覧';

                const users = await api.get('/api/admin/blacklist');

                pageContent.innerHTML = `
                    <div class="card">
                        <div class="card-header">
                            <h3>ブラックリスト <span style="font-size:0.82rem;color:var(--text-muted);font-weight:400;">(${users.length}件)</span></h3>
                            <div style="display:flex;gap:8px;align-items:center;">
                                <input type="text" id="add-blacklist-id" placeholder="ユーザーIDを入力..." style="width:200px;padding:8px 12px;">
                                <button id="add-blacklist-btn" class="btn btn-small">
                                    <i data-feather="plus"></i> 追加
                                </button>
                            </div>
                        </div>
                        <div class="table-container">
                            <table class="styled-table">
                                <thead><tr><th>ユーザーID</th><th style="width:100px;">操作</th></tr></thead>
                                <tbody>
                                    ${users.length
                                        ? users.map(id => `
                                            <tr>
                                                <td><code style="font-family:var(--font-mono);font-size:0.86rem;">${escapeHTML(id)}</code></td>
                                                <td><button class="btn btn-danger btn-small" data-user-id="${escapeHTML(id)}">解除</button></td>
                                            </tr>
                                        `).join('')
                                        : '<tr><td colspan="2" style="text-align:center;padding:24px;color:var(--text-muted);">ブラックリストは空です。</td></tr>'
                                    }
                                </tbody>
                            </table>
                        </div>
                    </div>`;
                feather.replace();

                document.getElementById('add-blacklist-btn').onclick = async () => {
                    const userId = document.getElementById('add-blacklist-id').value.trim();
                    if (!userId) return;
                    try {
                        await api.post('/api/admin/blacklist', { userId, action: 'add' });
                        showMessage('追加しました。');
                        App.loadPage('blacklist');
                    } catch (err) {
                        showMessage(`追加失敗: ${err.message}`, 'error');
                    }
                };

                document.querySelectorAll('[data-user-id]').forEach(btn => {
                    btn.onclick = async () => {
                        const userId = btn.dataset.userId;
                        try {
                            await api.post('/api/admin/blacklist', { userId, action: 'remove' });
                            showMessage('解除しました。');
                            App.loadPage('blacklist');
                        } catch (err) {
                            showMessage(`解除失敗: ${err.message}`, 'error');
                        }
                    };
                });
            },

            /* ─── Health ────────────────────────────────────── */
            health: async () => {
                pageTitle.textContent    = 'システム状態';
                pageSubtitle.textContent = 'ボットの稼働状況とパフォーマンス';

                pageContent.innerHTML = `
                    <div class="grid-container" style="grid-template-columns:1fr 1fr;">
                        <div class="card">
                            <div class="card-header"><h3>メモリ使用量 (MB)</h3></div>
                            <div style="height:220px;position:relative;">
                                <canvas id="memoryChart"></canvas>
                            </div>
                        </div>
                        <div class="card">
                            <div class="card-header"><h3>WebSocket Ping (ms)</h3></div>
                            <div style="height:220px;position:relative;">
                                <canvas id="pingChart"></canvas>
                            </div>
                        </div>
                    </div>
                    <div class="card">
                        <div class="card-header"><h3>リアルタイム履歴</h3></div>
                        <div class="table-container" style="max-height:400px;overflow-y:auto;">
                            <table class="styled-table">
                                <thead><tr><th>時刻</th><th>メモリ (MB)</th><th>Ping (ms)</th></tr></thead>
                                <tbody id="health-history-body"></tbody>
                            </table>
                        </div>
                    </div>`;

                const createChart = (ctxId, label, color) => new Chart(document.getElementById(ctxId), {
                    type: 'line',
                    data: { labels: [], datasets: [{ label, data: [], borderColor: color, tension: 0.4, fill: true, backgroundColor: color + '18', pointRadius: 2, borderWidth: 2 }] },
                    options: { maintainAspectRatio: false, responsive: true,
                        plugins: { legend: { display: false } },
                        scales: {
                            x: { display: false },
                            y: { ticks: { color: 'rgba(93,100,144,0.9)', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)', drawBorder: false } }
                        }
                    }
                });

                const memChart  = createChart('memoryChart', 'Memory', '#00d9f5');
                const pingChart = createChart('pingChart',   'Ping',   '#7c4dff');

                const updateHealth = async () => {
                    if (!document.getElementById('health-history-body')) return;
                    try {
                        const health = await api.get('/api/admin/health/history');
                        const time   = new Date().toLocaleTimeString();

                        [memChart, pingChart].forEach((chart, i) => {
                            const val = i === 0 ? health.memory : health.ping;
                            chart.data.labels.push(time);
                            chart.data.datasets[0].data.push(val);
                            if (chart.data.labels.length > 30) { chart.data.labels.shift(); chart.data.datasets[0].data.shift(); }
                            chart.update('none');
                        });

                        const histBody = document.getElementById('health-history-body');
                        if (histBody) {
                            const row = document.createElement('tr');
                            row.innerHTML = `
                                <td style="font-family:var(--font-mono);font-size:0.82rem;color:var(--text-muted);">${time}</td>
                                <td style="font-weight:600;">${health.memory} <span style="font-size:0.8em;font-weight:400;">MB</span></td>
                                <td style="font-weight:600;">${health.ping} <span style="font-size:0.8em;font-weight:400;">ms</span></td>`;
                            histBody.insertBefore(row, histBody.firstChild);
                            while (histBody.children.length > 12) histBody.removeChild(histBody.lastChild);
                        }
                    } catch (e) { console.error('Health update error:', e); }
                };

                const interval = setInterval(updateHealth, 5000);
                activeIntervals.push(interval);
                updateHealth();
            },

            /* ─── Analytics ─────────────────────────────────── */
            analytics: async () => {
                pageTitle.textContent    = '統計分析';
                pageSubtitle.textContent = 'ボット使用状況の詳細分析';

                const stats = await api.get('/api/admin/stats');
                statsData = stats;

                pageContent.innerHTML = `
                    <div class="grid-container">
                        ${statCard('globe',         '総サーバー数',     stats.guildCount)}
                        ${statCard('users',          '総ユーザー数',     stats.userCount.toLocaleString())}
                        ${statCard('bar-chart-2',    '平均メンバー数',   Math.round(stats.userCount / Math.max(1, stats.guildCount)))}
                        ${statCard('database',       'メモリ使用量',     stats.memoryUsage + ' MB')}
                    </div>

                    <div class="card">
                        <div class="card-header"><h3>サーバー成長トレンド</h3></div>
                        <div style="height:280px;position:relative;padding:10px 0;">
                            <canvas id="growth-chart"></canvas>
                        </div>
                    </div>

                    <div class="card">
                        <div class="card-header"><h3>トップサーバー (メンバー数)</h3></div>
                        <div class="table-container">
                            <table class="styled-table">
                                <thead><tr>
                                    <th>順位</th><th>サーバー名</th><th>メンバー数</th><th>参加日</th>
                                </tr></thead>
                                <tbody>
                                    ${(stats.topGuilds || stats.recentGuilds).map((guild, i) => `
                                        <tr>
                                            <td style="font-family:var(--font-mono);color:var(--cyan);font-weight:700;">#${i + 1}</td>
                                            <td style="font-weight:500;">${escapeHTML(guild.name)}</td>
                                            <td style="font-family:var(--font-mono);">${guild.memberCount.toLocaleString()}</td>
                                            <td style="font-size:0.86rem;color:var(--text-muted);">${new Date(guild.joinedTimestamp).toLocaleDateString('ja-JP')}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div class="card">
                        <div class="card-header"><h3>参加履歴 (月別)</h3></div>
                        <div style="height:220px;position:relative;padding:10px 0;">
                            <canvas id="timeline-chart"></canvas>
                        </div>
                    </div>`;

                const sortedGuilds = [...(stats.topGuilds || stats.recentGuilds)].sort((a, b) => a.joinedTimestamp - b.joinedTimestamp);

                new Chart(document.getElementById('growth-chart'), {
                    type: 'line',
                    data: {
                        labels: sortedGuilds.map((_, i) => `${i + 1}`),
                        datasets: [{ label: 'サーバー数', data: sortedGuilds.map((_, i) => i + 1),
                            borderColor: '#00d9f5', backgroundColor: 'rgba(0,217,245,0.08)',
                            tension: 0.4, fill: true, borderWidth: 2, pointRadius: 2 }]
                    },
                    options: { responsive: true, maintainAspectRatio: false,
                        plugins: { legend: { display: false } },
                        scales: { ...chartDefaults.scales }
                    }
                });

                const monthCounts = {};
                sortedGuilds.forEach(g => {
                    const month = new Date(g.joinedTimestamp).toLocaleDateString('ja-JP', { year: 'numeric', month: 'short' });
                    monthCounts[month] = (monthCounts[month] || 0) + 1;
                });

                new Chart(document.getElementById('timeline-chart'), {
                    type: 'bar',
                    data: {
                        labels: Object.keys(monthCounts),
                        datasets: [{ label: '参加サーバー数', data: Object.values(monthCounts),
                            backgroundColor: 'rgba(0,217,245,0.5)', borderColor: '#00d9f5', borderWidth: 1, borderRadius: 4 }]
                    },
                    options: { responsive: true, maintainAspectRatio: false,
                        plugins: { legend: { display: false } },
                        scales: { ...chartDefaults.scales }
                    }
                });

                // リアルタイム統計更新（60秒ごと）
                const analyticsInterval = setInterval(async () => {
                    try {
                        const freshStats = await api.get('/api/admin/stats');
                        statsData = freshStats;
                        const guildCountEl = document.getElementById('guild-count');
                        const userCountEl  = document.getElementById('user-count');
                        if (guildCountEl) guildCountEl.textContent = freshStats.guildCount;
                        if (userCountEl)  userCountEl.textContent  = freshStats.userCount.toLocaleString();
                    } catch (e) { /* silent */ }
                }, 60000);
                activeIntervals.push(analyticsInterval);
            }
        }
    };

    window.App = App;
    App.init();
});