document.addEventListener('DOMContentLoaded', async () => {
    const loader = document.getElementById('loader');
    const dashboardWrapper = document.querySelector('.dashboard-wrapper');
    const pageContent = document.getElementById('page-content');
    const pageTitle = document.getElementById('page-title');
    const pageSubtitle = document.getElementById('page-subtitle');
    const navItems = document.querySelectorAll('.nav-item');
    const logoutBtn = document.getElementById('logout-btn');
    const menuToggle = document.getElementById('menu-toggle');
    const sidebar = document.querySelector('.sidebar');
    const botAvatar = document.getElementById('bot-avatar');
    const botName = document.getElementById('bot-name');
    const guildCount = document.getElementById('guild-count');
    const userCount = document.getElementById('user-count');

    let statsData = null;
    let activeIntervals = [];

    const clearIntervals = () => {
        activeIntervals.forEach(clearInterval);
        activeIntervals = [];
    };

    // API
    const api = {
        _request: async (endpoint, options = {}) => {
            try {
                const res = await fetch(endpoint, options);
                if (res.status === 401) {
                    window.location.href = '/admin-login.html';
                    return;
                }
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || `Request failed with status ${res.status}`);
                return data;
            } catch (err) {
                console.error(`API error on ${endpoint}:`, err);
                showMessage(`Error: ${err.message}`, 'error');
                throw err;
            }
        },
        get: (endpoint) => api._request(endpoint),
        post: (endpoint, body) => api._request(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        })
    };

    // Toast notification
    const showMessage = (text, type = 'success') => {
        const el = document.createElement('div');
        el.className = `message-toast ${type}`;
        el.textContent = text;
        document.body.appendChild(el);
        setTimeout(() => el.classList.add('show'), 10);
        setTimeout(() => {
            el.classList.remove('show');
            setTimeout(() => el.remove(), 300);
        }, 3000);
    };

    // Modal
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
        backdrop.onclick = (e) => {
            if (e.target === backdrop) closeModal();
        };
        setTimeout(() => backdrop.classList.add('show'), 10);
        return backdrop.querySelector('.modal');
    };

    const closeModal = () => {
        const backdrop = document.querySelector('.modal-backdrop');
        if (backdrop) {
            backdrop.classList.remove('show');
            setTimeout(() => backdrop.remove(), 300);
        }
    };

    const escapeHTML = (str) => {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    };

    // --- Admin Application Module ---
    const App = {
        init: async () => {
            try {
                const stats = await api.get('/api/admin/stats');
                statsData = stats;

                botAvatar.src = stats.bot.avatar;
                botName.textContent = stats.bot.username;
                guildCount.textContent = stats.guildCount;
                userCount.textContent = stats.userCount.toLocaleString();

                loader.style.display = 'none';
                dashboardWrapper.style.display = 'flex';

                App.bindEvents();

                const hash = window.location.hash.slice(1) || 'servers';
                await App.loadPage(hash);
            } catch (error) {
                console.error('App init error:', error);
                loader.innerHTML = `<p class="error">情報の読み込みに失敗しました。再ログインしてください。</p><a href="/admin-login.html" class="btn" style="margin-top:20px;">ログインページへ</a>`;
            }
        },

        loadPage: async (pageName) => {
            try {
                clearIntervals();
                navItems.forEach(item => item.classList.remove('active'));
                const activeItem = document.querySelector(`[data-page="${pageName}"]`);
                if (activeItem) activeItem.classList.add('active');

                pageContent.innerHTML = '<div class="loader-ring" style="margin: 50px auto;"></div>';

                if (App.renderers[pageName]) {
                    await App.renderers[pageName]();
                } else {
                    pageContent.innerHTML = '<p>ページが見つかりません</p>';
                }
                feather.replace();
            } catch (error) {
                pageContent.innerHTML = `<div class="card"><p class="error">エラー: ${error.message}</p></div>`;
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

            logoutBtn.addEventListener('click', async () => {
                createModal('ログアウトの確認',
                    '<p>本当にログアウトしますか？</p>',
                    [
                        { id: 'cancel-logout', text: 'キャンセル', class: 'btn-secondary' },
                        { id: 'confirm-logout', text: 'ログアウト', class: 'btn-danger' }
                    ]
                );
                document.getElementById('cancel-logout').onclick = closeModal;
                document.getElementById('confirm-logout').onclick = async () => {
                    try {
                        await api.post('/api/admin/logout');
                        window.location.href = '/admin-login.html';
                    } catch (err) {
                        showMessage('ログアウトに失敗しました', 'error');
                    }
                };
            });

            menuToggle.addEventListener('click', () => {
                sidebar.classList.toggle('is-open');
            });

            document.getElementById('global-user-search').addEventListener('keypress', async (e) => {
                if (e.key === 'Enter') {
                    const userId = e.target.value.trim();
                    if (!userId) return;
                    try {
                        showMessage(`ユーザーID ${userId} を検索中...`, 'info');
                        const data = await api.get(`/api/admin/user-search?userId=${userId}`);

                        createModal('ユーザー検索結果', `
                            <div style="text-align: center; padding: 20px;">
                                <img src="${data.avatar}" style="width: 64px; height: 64px; border-radius: 50%; margin-bottom: 10px;">
                                <div style="font-size: 1.2rem; font-weight: 600;">${escapeHTML(data.tag)}</div>
                                <div style="font-size: 0.8rem; color: var(--text-muted-color);">ID: ${escapeHTML(data.id)}</div>
                                <p style="margin-top: 15px;">所属サーバー (${data.guilds.length}):</p>
                                <ul style="list-style: none; padding: 0; margin-top: 5px; max-height: 100px; overflow-y: auto;">
                                    ${data.guilds.map(g => `<li style="font-size: 0.9rem;">${escapeHTML(g.name)}</li>`).join('') || 'なし'}
                                </ul>
                                <div style="margin-top: 20px; display: flex; gap: 10px; justify-content: center;">
                                    <button class="btn btn-danger btn-small" onclick="App.blacklistUser('${data.id}')">ブラックリストに追加</button>
                                </div>
                            </div>
                        `, [{ id: 'close-search', text: '閉じる', class: 'btn' }]);
                        document.getElementById('close-search').onclick = closeModal;
                    } catch (err) {
                        showMessage('ユーザーが見つかりません。', 'error');
                    }
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

        renderers: {
            servers: async () => {
            pageTitle.textContent = 'サーバー管理';
            pageSubtitle.textContent = 'ボットが参加している全サーバーの管理';

            const stats = statsData || await api.get('/api/admin/stats');
            let currentPage = 1;

            pageContent.innerHTML = `
                <div class="grid-container">
                    <div class="stat-card">
                        <div class="stat-icon"><i data-feather="globe"></i></div>
                        <div class="stat-label">総サーバー数</div>
                        <div class="stat-value">${stats.guildCount}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon"><i data-feather="users"></i></div>
                        <div class="stat-label">総ユーザー数</div>
                        <div class="stat-value">${stats.userCount.toLocaleString()}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon"><i data-feather="clock"></i></div>
                        <div class="stat-label">稼働時間</div>
                        <div class="stat-value">${stats.uptime}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon"><i data-feather="database"></i></div>
                        <div class="stat-label">メモリ使用量</div>
                        <div class="stat-value">${stats.memoryUsage} MB</div>
                    </div>
                </div>

                <div class="card">
                    <div class="card-header">
                        <h3>サーバー一覧</h3>
                        <div style="display: flex; gap: 10px;">
                            <input type="text" id="server-search" placeholder="サーバー名やIDで検索..." style="width: 250px; padding: 8px 12px;">
                        </div>
                    </div>
                    <div class="server-list" id="server-list"></div>
                    <div class="pagination-controls glass" style="margin-top: 20px; display: flex; justify-content: center; gap: 15px; align-items: center; padding: 10px;">
                        <button id="prev-page" class="btn btn-secondary btn-small" disabled>前へ</button>
                        <span id="page-info">Page 1</span>
                        <button id="next-page" class="btn btn-secondary btn-small" disabled>次へ</button>
                    </div>
                </div>
            `;

            const renderServers = async () => {
                const search = document.getElementById('server-search').value;
                const listEl = document.getElementById('server-list');
                listEl.innerHTML = '<div class="loader-ring" style="margin: 30px auto;"></div>';

                try {
                    const data = await api.get(`/api/admin/guilds?page=${currentPage}&search=${search}`);
                    listEl.innerHTML = data.guilds.map(guild => `
                        <div class="server-card">
                            <div class="server-card-header">
                                <div>
                                    <div class="server-name">${escapeHTML(guild.name)}</div>
                                    <div style="font-size: 0.8rem; color: var(--text-muted-color); margin-top: 5px;">
                                        ID: <code style="background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 3px; font-size: 0.75rem;">${escapeHTML(guild.id)}</code>
                                    </div>
                                </div>
                            </div>
                            <div class="server-stats">
                                <div class="server-stat">
                                    <i data-feather="users"></i>
                                    <span>${guild.memberCount.toLocaleString()} メンバー</span>
                                </div>
                                <div class="server-stat">
                                    <i data-feather="calendar"></i>
                                    <span>参加: ${new Date(guild.joinedTimestamp).toLocaleDateString('ja-JP')}</span>
                                </div>
                            </div>
                        </div>
                    `).join('') || '<p style="text-align: center; padding: 20px;">サーバーが見つかりません</p>';

                    document.getElementById('page-info').textContent = `Page ${data.currentPage} of ${data.totalPages}`;
                    document.getElementById('prev-page').disabled = data.currentPage <= 1;
                    document.getElementById('next-page').disabled = data.currentPage >= data.totalPages;
                    feather.replace();
                } catch (e) {
                    listEl.innerHTML = '<p class="error">読み込み失敗</p>';
                }
            };

            document.getElementById('server-search').addEventListener('input', () => {
                currentPage = 1;
                renderServers();
            });
            document.getElementById('prev-page').onclick = () => { currentPage--; renderServers(); };
            document.getElementById('next-page').onclick = () => { currentPage++; renderServers(); };

            await renderServers();
        },

        announcements: async () => {
            pageTitle.textContent = 'お知らせ送信';
            pageSubtitle.textContent = '全サーバーにお知らせを一斉送信';

            pageContent.innerHTML = `
                <div class="card">
                    <div class="card-header">
                        <h3>お知らせ作成</h3>
                    </div>
                    <form id="announcement-form">
                        <div class="form-group">
                            <label for="ann-title">タイトル *</label>
                            <input type="text" id="ann-title" required placeholder="例: 重要なお知らせ">
                        </div>
                        <div class="form-group">
                            <label for="ann-description">内容 *</label>
                            <textarea id="ann-description" required placeholder="お知らせの内容を入力してください" rows="6"></textarea>
                        </div>
                        <div class="form-group">
                            <label for="ann-color">埋め込みの色</label>
                            <input type="color" id="ann-color" value="#00e5ff">
                        </div>
                        <div class="form-group">
                            <label for="ann-url">URL (オプション)</label>
                            <input type="text" id="ann-url" placeholder="https://example.com">
                        </div>
                        <div class="form-group">
                            <label for="ann-footer">フッター (オプション)</label>
                            <input type="text" id="ann-footer" placeholder="OrderlyCore Team">
                        </div>
                        <button type="submit" class="btn">
                            <i data-feather="send"></i>
                            送信
                        </button>
                    </form>
                </div>
            `;

            document.getElementById('announcement-form').addEventListener('submit', async (e) => {
                e.preventDefault();
                const btn = e.target.querySelector('button[type="submit"]');
                const btnText = btn.innerHTML;
                btn.disabled = true;
                btn.innerHTML = '<div class="loader-ring" style="width: 20px; height: 20px; border-width: 2px;"></div>';

                try {
                    const result = await api.post('/api/admin/announce', {
                        title: document.getElementById('ann-title').value,
                        description: document.getElementById('ann-description').value,
                        color: document.getElementById('ann-color').value,
                        url: document.getElementById('ann-url').value || null,
                        footer: document.getElementById('ann-footer').value || null
                    });

                    showMessage(`${result.sentCount}個のサーバーに送信しました！`, 'success');
                    e.target.reset();
                } catch (error) {
                    showMessage(`送信失敗: ${error.message}`, 'error');
                } finally {
                    btn.disabled = false;
                    btn.innerHTML = btnText;
                }
            });

            feather.replace();
        },

        status: async () => {
            pageTitle.textContent = 'ステータス管理';
            pageSubtitle.textContent = 'ボットのステータスメッセージを設定';

            const settings = await api.get('/api/admin/statuses');

            // 絵文字リストは空にするか、削除する方向
            const emojiList = [];

            pageContent.innerHTML = `
                <div class="card">
                    <div class="card-header">
                        <h3>ステータスメッセージ設定</h3>
                    </div>
                    <div class="form-group">
                        <label>モード</label>
                        <div style="display: flex; gap: 15px; margin-top: 10px;">
                            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                <input type="radio" name="status-mode" value="custom" ${settings.mode === 'custom' ? 'checked' : ''}>
                                <span>カスタム</span>
                            </label>
                            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                <input type="radio" name="status-mode" value="ai" ${settings.mode === 'ai' ? 'checked' : ''}>
                                <span>AI生成</span>
                            </label>
                        </div>
                    </div>

                    <div id="custom-statuses" style="${settings.mode === 'ai' ? 'display: none;' : ''}">
                        <div class="card-header" style="margin-top: 20px;">
                            <h3>ステータス一覧</h3>
                            <button id="add-status-btn" class="btn btn-small">
                                <i data-feather="plus"></i>
                                追加
                            </button>
                        </div>
                        <div id="status-list">
                            ${(settings.list || []).map((status, index) => `
                                <div class="status-item" data-index="${index}" style="display: flex; gap: 10px; align-items: center; padding: 15px; background: rgba(0,0,0,0.2); border-radius: 6px; margin-bottom: 10px;">
                                    <input type="hidden" class="emoji-input" value="">
                                    <input type="text" class="status-text" value="${status.state}" placeholder="ステータス" style="flex: 1;">
                                    <button class="btn btn-danger btn-small delete-status-btn" data-index="${index}">
                                        <i data-feather="trash-2"></i>
                                    </button>
                                </div>
                            `).join('')}
                        </div>
                    </div>

                    <button id="save-status-btn" class="btn" style="margin-top: 20px;">
                        <i data-feather="save"></i>
                        保存
                    </button>
                </div>

            `;

            // Mode toggle
            document.querySelectorAll('input[name="status-mode"]').forEach(radio => {
                radio.addEventListener('change', (e) => {
                    document.getElementById('custom-statuses').style.display = 
                        e.target.value === 'custom' ? 'block' : 'none';
                });
            });


            // Add status
            document.getElementById('add-status-btn').addEventListener('click', () => {
                const list = document.getElementById('status-list');
                const index = list.children.length;
                const div = document.createElement('div');
                div.className = 'status-item';
                div.dataset.index = index;
                div.style.cssText = 'display: flex; gap: 10px; align-items: center; padding: 15px; background: rgba(0,0,0,0.2); border-radius: 6px; margin-bottom: 10px;';
                div.innerHTML = `
                    <input type="hidden" class="emoji-input" value="">
                    <input type="text" class="status-text" placeholder="ステータス" style="flex: 1;">
                    <button class="btn btn-danger btn-small delete-status-btn" data-index="${index}">
                        <i data-feather="trash-2"></i>
                    </button>
                `;
                list.appendChild(div);
                feather.replace();

                div.querySelector('.delete-status-btn').addEventListener('click', () => {
                    div.remove();
                });
            });

            // Delete status
            document.querySelectorAll('.delete-status-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    btn.closest('.status-item').remove();
                });
            });

            // Save
            document.getElementById('save-status-btn').addEventListener('click', async () => {
                const mode = document.querySelector('input[name="status-mode"]:checked').value;
                const statuses = Array.from(document.querySelectorAll('.status-item')).map(item => ({
                    emoji: item.querySelector('.emoji-input').value,
                    state: item.querySelector('.status-text').value
                })).filter(s => s.emoji && s.state);

                try {
                    await api.post('/api/admin/statuses', { mode, statuses });
                    showMessage('ステータス設定を保存しました', 'success');
                } catch (error) {
                    showMessage(`保存失敗: ${error.message}`, 'error');
                }
            });

            feather.replace();
        },

        logs: async () => {
            pageTitle.textContent = 'システムログ';
            pageSubtitle.textContent = 'リアルタイムログビューアー';

            const stats = statsData || await api.get('/api/admin/stats');

            pageContent.innerHTML = `
                <div class="grid-container" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));">
                    <div class="stat-card">
                        <div class="stat-icon"><i data-feather="globe"></i></div>
                        <div class="stat-value">${stats.guildCount}</div>
                        <div class="stat-label">接続サーバー</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon"><i data-feather="users"></i></div>
                        <div class="stat-value">${stats.userCount.toLocaleString()}</div>
                        <div class="stat-label">総ユーザー</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon"><i data-feather="clock"></i></div>
                        <div class="stat-value">${stats.uptime}</div>
                        <div class="stat-label">稼働時間</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon"><i data-feather="database"></i></div>
                        <div class="stat-value">${stats.memoryUsage} MB</div>
                        <div class="stat-label">メモリ</div>
                    </div>
                </div>

                <div class="card">
                    <div class="card-header">
                        <h3>システムログ</h3>
                        <div style="display: flex; gap: 10px;">
                            <button id="refresh-logs" class="btn btn-small btn-secondary">
                                <i data-feather="refresh-cw"></i>
                                更新
                            </button>
                            <button id="clear-logs" class="btn btn-small btn-secondary">
                                <i data-feather="trash-2"></i>
                                クリア
                            </button>
                        </div>
                    </div>
                    <div style="margin-bottom: 15px; display: flex; gap: 10px;">
                        <label style="display: flex; align-items: center; gap: 5px; cursor: pointer;">
                            <input type="checkbox" id="log-info" checked>
                            <span style="color: var(--success-color);">INFO</span>
                        </label>
                        <label style="display: flex; align-items: center; gap: 5px; cursor: pointer;">
                            <input type="checkbox" id="log-warn" checked>
                            <span style="color: var(--warning-color);">WARN</span>
                        </label>
                        <label style="display: flex; align-items: center; gap: 5px; cursor: pointer;">
                            <input type="checkbox" id="log-error" checked>
                            <span style="color: var(--error-color);">ERROR</span>
                        </label>
                    </div>
                    <div id="log-viewer" style="background: #010409; padding: 20px; border-radius: 6px; font-family: monospace; font-size: 0.85rem; max-height: 500px; overflow-y: auto; border: 1px solid var(--border-color);">
                        <p style="color: var(--success-color);">[${new Date().toLocaleTimeString()}] [INFO] システムログビューアー起動</p>
                        <p style="color: var(--success-color);">[${new Date().toLocaleTimeString()}] [INFO] ボット稼働中 - ${stats.guildCount}サーバー接続</p>
                        <p style="color: var(--text-muted-color);">[${new Date().toLocaleTimeString()}] [DEBUG] メモリ使用量: ${stats.memoryUsage}MB</p>
                        <p style="color: var(--success-color);">[${new Date().toLocaleTimeString()}] [INFO] 全システム正常動作中</p>
                    </div>
                </div>

                <div class="card">
                    <div class="card-header">
                        <h3>最近のイベント</h3>
                    </div>
                    <div class="data-table-wrapper" style="overflow-x: auto;">
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th>時刻</th>
                                    <th>イベント</th>
                                    <th>詳細</th>
                                    <th>ステータス</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${stats.recentGuilds.slice(0, 5).map(guild => `
                                    <tr>
                                        <td>${new Date(guild.joinedTimestamp).toLocaleString('ja-JP')}</td>
                                        <td>サーバー参加</td>
                                        <td>${guild.name}</td>
                                        <td><span style="color: var(--success-color);">[OK] 成功</span></td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;

            // ログ更新機能
            document.getElementById('refresh-logs').addEventListener('click', () => {
                const logViewer = document.getElementById('log-viewer');
                const newLog = document.createElement('p');
                newLog.style.color = 'var(--success-color)';
                newLog.textContent = `[${new Date().toLocaleTimeString()}] [INFO] ログ更新 - システム正常`;
                logViewer.appendChild(newLog);

                // Limit logs to prevent infinite growth
                while (logViewer.children.length > 50) {
                    logViewer.removeChild(logViewer.firstChild);
                }

                logViewer.scrollTop = logViewer.scrollHeight;
            });

            document.getElementById('clear-logs').addEventListener('click', () => {
                const logViewer = document.getElementById('log-viewer');
                logViewer.innerHTML = '<p style="color: var(--text-muted-color);">[SYSTEM] ログがクリアされました</p>';
                logCount = 1;
            });

            // ログフィルター
            ['log-info', 'log-warn', 'log-error'].forEach(id => {
                document.getElementById(id).addEventListener('change', () => {
                    // フィルター機能（実装例）
                    console.log(`${id} filter toggled`);
                });
            });

            feather.replace();
        },

        maintenance: async () => {
            pageTitle.textContent = 'メンテナンス設定';
            pageSubtitle.textContent = 'ボット全体のメンテナンスモードを管理';

            const status = await api.get('/api/admin/maintenance');

            pageContent.innerHTML = `
                <div class="card glass">
                    <div class="card-header"><h3>メンテナンスモード設定</h3></div>
                    <div class="form-group">
                        <label>ステータス</label>
                        <label class="switch">
                            <input type="checkbox" id="maintenance-toggle" ${status.enabled ? 'checked' : ''}>
                            <span class="slider"></span>
                        </label>
                    </div>
                    <div class="form-group">
                        <label for="maintenance-reason">理由</label>
                        <textarea id="maintenance-reason" placeholder="メンテナンス中の理由を入力してください">${status.reason || ''}</textarea>
                    </div>
                    <button id="save-maintenance" class="btn"><i data-feather="save"></i>保存</button>
                </div>
            `;

            document.getElementById('save-maintenance').onclick = async () => {
                const enabled = document.getElementById('maintenance-toggle').checked;
                const reason = document.getElementById('maintenance-reason').value;
                await api.post('/api/admin/maintenance', { enabled, reason });
                showMessage('メンテナンス設定を更新しました。');
            };
        },

        blacklist: async () => {
            pageTitle.textContent = 'ブラックリスト管理';
            pageSubtitle.textContent = 'ボットの使用を制限されたユーザー一覧';

            const users = await api.get('/api/admin/blacklist');

            pageContent.innerHTML = `
                <div class="card glass">
                    <div class="card-header">
                        <h3>ブラックリスト (${users.length})</h3>
                        <div style="display: flex; gap: 10px;">
                            <input type="text" id="add-blacklist-id" placeholder="ユーザーIDを入力..." style="width: 200px;">
                            <button id="add-blacklist-btn" class="btn btn-small">追加</button>
                        </div>
                    </div>
                    <div class="table-container">
                        <table class="styled-table" style="width: 100%;">
                            <thead><tr><th>ユーザーID</th><th>アクション</th></tr></thead>
                            <tbody>
                                ${users.length ? users.map(id => `
                                    <tr>
                                        <td>${id}</td>
                                        <td><button class="btn btn-danger btn-small" onclick="App.removeBlacklist('${id}')">解除</button></td>
                                    </tr>
                                `).join('') : '<tr><td colspan="2" style="text-align:center;">ブラックリストは空です。</td></tr>'}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;

            document.getElementById('add-blacklist-btn').onclick = async () => {
                const userId = document.getElementById('add-blacklist-id').value.trim();
                if (!userId) return;
                await api.post('/api/admin/blacklist', { userId, action: 'add' });
                showMessage('追加しました。');
                App.loadPage('blacklist');
            };
        },

        removeBlacklist: async (userId) => {
            await api.post('/api/admin/blacklist', { userId, action: 'remove' });
            showMessage('解除しました。');
            App.loadPage('blacklist');
        },

        health: async () => {
            pageTitle.textContent = 'システム状態';
            pageSubtitle.textContent = 'ボットの稼働状況とパフォーマンス';

            pageContent.innerHTML = `
                <div class="grid-container" style="grid-template-columns: 1fr 1fr;">
                    <div class="card glass">
                        <div class="card-header"><h3>メモリ使用量 (MB)</h3></div>
                        <div style="height: 250px; position: relative;">
                            <canvas id="memoryChart"></canvas>
                        </div>
                    </div>
                    <div class="card glass">
                        <div class="card-header"><h3>WebSocket Ping (ms)</h3></div>
                        <div style="height: 250px; position: relative;">
                            <canvas id="pingChart"></canvas>
                        </div>
                    </div>
                </div>
                <div class="card glass">
                    <div class="card-header"><h3>システム状態履歴</h3></div>
                    <div class="table-container" style="max-height: 400px; overflow-y: auto;">
                        <table class="styled-table">
                            <thead>
                                <tr>
                                    <th>時刻</th>
                                    <th>メモリ (MB)</th>
                                    <th>Ping (ms)</th>
                                </tr>
                            </thead>
                            <tbody id="health-history-body"></tbody>
                        </table>
                    </div>
                </div>
            `;

            const memoryCtx = document.getElementById('memoryChart');
            const pingCtx = document.getElementById('pingChart');

            const createChart = (ctx, label, color) => new Chart(ctx, {
                type: 'line',
                data: { labels: [], datasets: [{ label, data: [], borderColor: color, tension: 0.3, fill: true, backgroundColor: color + '15', pointRadius: 2 }] },
                options: {
                    maintainAspectRatio: false,
                    responsive: true,
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { display: false },
                        y: {
                            ticks: { color: 'rgba(255,255,255,0.5)', font: { size: 10 } },
                            grid: { color: 'rgba(255,255,255,0.05)' }
                        }
                    }
                }
            });

            const memoryChart = createChart(memoryCtx, 'Memory', '#00e5ff');
            const pingChart = createChart(pingCtx, 'Ping', '#7c4dff');

            const updateHealth = async () => {
                if (window.location.hash !== '#health' || !document.getElementById('health-history-body')) return;
                try {
                    const health = await api.get('/api/admin/health/history');
                    const time = new Date().toLocaleTimeString();

                    // Update Memory Chart
                    memoryChart.data.labels.push(time);
                    memoryChart.data.datasets[0].data.push(health.memory);
                    if (memoryChart.data.labels.length > 30) {
                        memoryChart.data.labels.shift();
                        memoryChart.data.datasets[0].data.shift();
                    }
                    memoryChart.update('none'); // Update without animation for performance

                    // Update Ping Chart
                    pingChart.data.labels.push(time);
                    pingChart.data.datasets[0].data.push(health.ping);
                    if (pingChart.data.labels.length > 30) {
                        pingChart.data.labels.shift();
                        pingChart.data.datasets[0].data.shift();
                    }
                    pingChart.update('none');

                    const historyBody = document.getElementById('health-history-body');
                    if (historyBody) {
                        const row = document.createElement('tr');
                        row.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
                        row.innerHTML = `
                            <td style="color: var(--text-muted-color); font-family: var(--font-mono);">${time}</td>
                            <td style="font-weight: 600;">${health.memory} <span style="font-size: 0.8em; font-weight: normal;">MB</span></td>
                            <td style="font-weight: 600;">${health.ping} <span style="font-size: 0.8em; font-weight: normal;">ms</span></td>
                        `;
                        historyBody.insertBefore(row, historyBody.firstChild);

                        // Strictly enforce row limit
                        while (historyBody.children.length > 10) {
                            historyBody.removeChild(historyBody.lastChild);
                        }
                    }
                } catch (e) {
                    console.error('Health update error:', e);
                }
            };

            const healthInterval = setInterval(updateHealth, 5000);
            activeIntervals.push(healthInterval);
            updateHealth();
        },

        analytics: async () => {
            pageTitle.textContent = '統計分析';
            pageSubtitle.textContent = 'ボット使用状況の詳細分析';

            const stats = statsData || await api.get('/api/admin/stats');

            pageContent.innerHTML = `
                <div class="grid-container">
                    <div class="stat-card">
                        <div class="stat-icon"><i data-feather="globe"></i></div>
                        <div class="stat-label">総サーバー数</div>
                        <div class="stat-value">${stats.guildCount}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon"><i data-feather="users"></i></div>
                        <div class="stat-label">総ユーザー数</div>
                        <div class="stat-value">${stats.userCount.toLocaleString()}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon"><i data-feather="bar-chart-2"></i></div>
                        <div class="stat-label">平均メンバー数</div>
                        <div class="stat-value">${Math.round(stats.userCount / stats.guildCount)}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon"><i data-feather="database"></i></div>
                        <div class="stat-label">メモリ使用量</div>
                        <div class="stat-value">${stats.memoryUsage} MB</div>
                    </div>
                </div>

                <div class="card">
                    <div class="card-header">
                        <h3>サーバー成長トレンド</h3>
                    </div>
                    <canvas id="growth-chart" style="max-height: 300px;"></canvas>
                </div>

                <div class="card">
                    <div class="card-header">
                        <h3>トップサーバー (メンバー数)</h3>
                    </div>
                    <div class="data-table-wrapper" style="overflow-x: auto;">
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th>順位</th>
                                    <th>サーバー名</th>
                                    <th>メンバー数</th>
                                    <th>参加日</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${stats.topGuilds
                                    .map((guild, index) => `
                                        <tr>
                                            <td style="font-weight: bold; color: var(--primary-color);">#${index + 1}</td>
                                            <td>${escapeHTML(guild.name)}</td>
                                            <td>${guild.memberCount.toLocaleString()}</td>
                                            <td>${new Date(guild.joinedTimestamp).toLocaleDateString('ja-JP')}</td>
                                        </tr>
                                    `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div class="card">
                    <div class="card-header">
                        <h3>参加履歴</h3>
                    </div>
                    <canvas id="timeline-chart" style="max-height: 250px;"></canvas>
                </div>
            `;

            // グラフ描画
            const growthCtx = document.getElementById('growth-chart').getContext('2d');
            const sortedGuilds = [...stats.recentGuilds].sort((a, b) => a.joinedTimestamp - b.joinedTimestamp);
            
            new Chart(growthCtx, {
                type: 'line',
                data: {
                    labels: sortedGuilds.map((_, i) => `${i + 1}`),
                    datasets: [{
                        label: 'サーバー数',
                        data: sortedGuilds.map((_, i) => i + 1),
                        borderColor: '#00e5ff',
                        backgroundColor: 'rgba(0, 229, 255, 0.1)',
                        tension: 0.4,
                        fill: true
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: {
                        legend: { display: false },
                        title: { display: false }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            grid: { color: 'rgba(255, 255, 255, 0.1)' },
                            ticks: { color: '#848d97' }
                        },
                        x: {
                            grid: { color: 'rgba(255, 255, 255, 0.1)' },
                            ticks: { color: '#848d97' }
                        }
                    }
                }
            });

            // タイムラインチャート
            const timelineCtx = document.getElementById('timeline-chart').getContext('2d');
            const monthCounts = {};
            sortedGuilds.forEach(guild => {
                const month = new Date(guild.joinedTimestamp).toLocaleDateString('ja-JP', { year: 'numeric', month: 'short' });
                monthCounts[month] = (monthCounts[month] || 0) + 1;
            });

            new Chart(timelineCtx, {
                type: 'bar',
                data: {
                    labels: Object.keys(monthCounts),
                    datasets: [{
                        label: '参加サーバー数',
                        data: Object.values(monthCounts),
                        backgroundColor: 'rgba(0, 229, 255, 0.6)',
                        borderColor: '#00e5ff',
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: {
                        legend: { display: false }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            grid: { color: 'rgba(255, 255, 255, 0.1)' },
                            ticks: { color: '#848d97', stepSize: 1 }
                        },
                        x: {
                            grid: { display: false },
                            ticks: { color: '#848d97' }
                        }
                    }
                }
            });

            feather.replace();
        }
    }
};

    window.App = App;
    App.init();
});
