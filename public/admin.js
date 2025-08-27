document.addEventListener('DOMContentLoaded', async () => {
    // DOM要素
    const loader = document.getElementById('loader');
    const dashboardWrapper = document.querySelector('.dashboard-wrapper');
    const pageContent = document.getElementById('page-content');
    const pageTitle = document.getElementById('page-title');
    const navItems = document.querySelectorAll('.nav-item');
    const logoutBtn = document.getElementById('logout-btn');
    const menuToggle = document.getElementById('menu-toggle');
    const sidebar = document.querySelector('.sidebar');
    const botAvatar = document.getElementById('bot-avatar');
    const botName = document.getElementById('bot-name');

    // APIリクエスト
    const api = {
        _request: async (endpoint, options = {}) => {
            try {
                const res = await fetch(endpoint, options);
                if (res.status === 401) { window.location.href = '/admin-login.html'; return; }
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || `Request failed with status ${res.status}`);
                return data;
            } catch (err) { console.error(`API request error:`, err); throw err; }
        },
        get: (endpoint) => api._request(endpoint),
        post: (endpoint, body) => api._request(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    };

    // 通知メッセージ
    const showMessage = (text, type = 'success') => {
        const el = document.createElement('div');
        el.className = `message-toast ${type}`;
        el.textContent = text;
        document.body.appendChild(el);
        setTimeout(() => el.classList.add('show'), 10);
        setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3000);
    };

    // ページ描画
    const renderers = {
        activity: async () => {
            pageTitle.textContent = 'ボットアクティビティ';
            pageContent.innerHTML = '<div class="loader-ring" style="margin: 40px auto;"></div>';
            try {
                const stats = await api.get('/api/admin/stats');
                botAvatar.src = stats.bot.avatar;
                botName.textContent = stats.bot.username;

                pageContent.innerHTML = `
                    <div class="grid-container" style="grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));">
                        <div class="card stat-card"><div class="stat-icon">💻</div><div class="stat-info"><div class="stat-value">${stats.guildCount.toLocaleString()}</div><div class="stat-label">導入サーバー数</div></div></div>
                        <div class="card stat-card"><div class="stat-icon">👥</div><div class="stat-info"><div class="stat-value">${stats.userCount.toLocaleString()}</div><div class="stat-label">総ユーザー数</div></div></div>
                        <div class="card stat-card"><div class="stat-icon">⏰</div><div class="stat-info"><div class="stat-value">${stats.uptime}</div><div class="stat-label">稼働時間</div></div></div>
                        <div class="card stat-card"><div class="stat-icon">💾</div><div class="stat-info"><div class="stat-value">${stats.memoryUsage} MB</div><div class="stat-label">メモリ使用量</div></div></div>
                    </div>
                     <div class="card">
                        <div class="card-header"><h3>最近参加したサーバー</h3></div>
                        <ul class="leaderboard">
                            ${stats.recentGuilds.map(g => `<li><span class="rank">${new Date(g.joinedTimestamp).toLocaleDateString()}</span><div class="user-info"><div class="user-name">${g.name}</div><div class="user-id">ID: ${g.id}</div></div><span class="stat">${g.memberCount.toLocaleString()}人</span></li>`).join('') || '<p>データなし</p>'}
                        </ul>
                    </div>
                `;
            } catch (error) {
                pageContent.innerHTML = `<p class="message error">統計データの読み込みに失敗しました: ${error.message}</p>`;
            }
        },
        announcements: () => {
            pageTitle.textContent = 'お知らせ管理';
            pageContent.innerHTML = `
                <form id="announcement-form">
                    <div class="card">
                        <div class="card-header"><h3>お知らせ作成</h3></div>
                        <div class="form-group"><label for="title">タイトル</label><input type="text" id="title" required></div>
                        <div class="form-group"><label for="description">内容 (Markdown対応)</label><textarea id="description" rows="10" required></textarea></div>
                        <div class="form-grid">
                           <div class="form-group"><label for="color">色 (16進数)</label><input type="text" id="color" value="#3498db"></div>
                           <div class="form-group"><label for="url">URL</label><input type="text" id="url" placeholder="https://..."></div>
                        </div>
                        <div class="form-group"><label for="footer">フッター</label><input type="text" id="footer" value="Overseerからのお知らせ"></div>
                    </div>
                    <button type="submit" class="btn">プレビューして送信確認</button>
                </form>
                 <div id="preview-container" style="margin-top: 20px;"></div>
            `;
            document.getElementById('announcement-form').addEventListener('submit', handleAnnouncementSubmit);
        },
        status: async () => {
            pageTitle.textContent = 'ステータス管理';
            pageContent.innerHTML = '<div class="loader-ring" style="margin: 40px auto;"></div>';
            try {
                const settings = await api.get('/api/admin/statuses');
                const statuses = settings.list || [];
                const mode = settings.mode || 'custom';

                pageContent.innerHTML = `
                    <div class="card">
                        <div class="card-header"><h3>ステータスモード選択</h3></div>
                        <div class="form-group">
                            <select id="status-mode-select">
                                <option value="custom">カスタムリスト</option>
                                <option value="ai">AI 自動生成</option>
                            </select>
                            <p class="form-hint">ボットのステータス表示方法を選択します。「AI 自動生成」を選択すると、下のカスタムリストは無視されます。</p>
                        </div>
                    </div>

                    <div id="custom-status-editor">
                        <div class="card">
                            <div class="card-header"><h3>カスタムステータス編集</h3></div>
                            <p class="form-hint">ボットが定期的に切り替えて表示するステータスを編集します。利用可能な変数: <code>\${serverCount}</code>, <code>\${userCount}</code></p>
                            <div id="status-list" style="margin-top: 20px;"></div>
                            <div style="margin-top: 20px; border-top: 1px solid var(--border-color); padding-top: 20px;">
                                <button id="add-status-btn" class="btn btn-secondary">ステータスを追加</button>
                            </div>
                        </div>
                    </div>
                    <button id="save-statuses-btn" class="btn">設定を保存</button>
                `;

                const statusModeSelect = document.getElementById('status-mode-select');
                statusModeSelect.value = mode;

                const customStatusEditor = document.getElementById('custom-status-editor');
                const toggleEditorVisibility = () => {
                    customStatusEditor.style.display = statusModeSelect.value === 'custom' ? 'block' : 'none';
                };

                toggleEditorVisibility();
                statusModeSelect.addEventListener('change', toggleEditorVisibility);

                renderStatusList(statuses);

                document.getElementById('add-status-btn').addEventListener('click', () => {
                    const list = document.getElementById('status-list');
                    const newItem = document.createElement('div');
                    newItem.className = 'status-item';
                    newItem.innerHTML = `
                        <input type="text" class="emoji-input" placeholder="絵文字" value="✅">
                        <input type="text" class="text-input" placeholder="ステータステキスト" value="新しいステータス">
                        <button class="btn btn-danger btn-small remove-status-btn">削除</button>
                    `;
                    list.appendChild(newItem);
                    newItem.querySelector('.remove-status-btn').addEventListener('click', (e) => e.target.closest('.status-item').remove());
                });

                document.getElementById('save-statuses-btn').addEventListener('click', handleSaveStatuses);

            } catch (error) {
                 pageContent.innerHTML = `<p class="message error">ステータスの読み込みに失敗しました: ${error.message}</p>`;
            }
        }
    };
    
    // ステータスリストの描画
    const renderStatusList = (statuses) => {
        const listEl = document.getElementById('status-list');
        listEl.innerHTML = statuses.map(status => `
            <div class="status-item">
                <input type="text" class="emoji-input" placeholder="絵文字" value="${status.emoji}">
                <input type="text" class="text-input" placeholder="ステータステキスト" value="${status.state}">
                <button class="btn btn-danger btn-small remove-status-btn">削除</button>
            </div>
        `).join('');

        listEl.querySelectorAll('.remove-status-btn').forEach(btn => {
            btn.addEventListener('click', (e) => e.target.closest('.status-item').remove());
        });
    };

    // ステータス保存処理
    const handleSaveStatuses = async (event) => {
        const btn = event.target;
        btn.disabled = true;
        btn.textContent = '保存中...';
        
        const mode = document.getElementById('status-mode-select').value;
        const statusItems = document.querySelectorAll('#status-list .status-item');
        const statuses = Array.from(statusItems).map(item => ({
            emoji: item.querySelector('.emoji-input').value.trim(),
            state: item.querySelector('.text-input').value.trim()
        })).filter(s => s.emoji && s.state);

        try {
            await api.post('/api/admin/statuses', { statuses, mode });
            showMessage('ステータス設定を保存しました。');
        } catch (error) {
            showMessage(`保存エラー: ${error.message}`, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = '設定を保存';
        }
    };

    // お知らせフォームの処理
    const handleAnnouncementSubmit = async (e) => {
        e.preventDefault();
        const form = e.target;
        const announcement = {
            title: form.querySelector('#title').value,
            description: form.querySelector('#description').value,
            color: form.querySelector('#color').value,
            url: form.querySelector('#url').value,
            footer: form.querySelector('#footer').value
        };

        // プレビュー表示
        document.getElementById('preview-container').innerHTML = `
            <div class="card">
                <div class="card-header"><h3>プレビュー</h3></div>
                <div style="background: #2b2d31; padding: 15px; border-radius: 8px;">
                    <div style="border-left: 4px solid ${announcement.color}; padding-left: 10px;">
                        <a href="${announcement.url || '#'}" style="color: #00a8fc; text-decoration: none; font-weight: bold; font-size: 1.2em;">${announcement.title}</a>
                        <p style="white-space: pre-wrap; margin-top: 5px;">${announcement.description.replace(/\n/g, '<br>')}</p>
                        <small style="color: #949ba4; font-size: 0.8em; margin-top: 10px; display: block;">${announcement.footer}</small>
                    </div>
                </div>
                <div style="margin-top: 20px; text-align: right;">
                    <button id="confirm-send" class="btn">全サーバーに送信する</button>
                </div>
            </div>
        `;

        document.getElementById('confirm-send').onclick = async (event) => {
            const btn = event.target;
            btn.disabled = true;
            btn.textContent = '送信中...';
            try {
                const result = await api.post('/api/admin/announce', announcement);
                showMessage(`お知らせを ${result.sentCount} サーバーに送信しました。`);
                 document.getElementById('preview-container').innerHTML = '';
                 form.reset();
            } catch (error) {
                showMessage(`送信エラー: ${error.message}`, 'error');
            } finally {
                btn.disabled = false;
                btn.textContent = '全サーバーに送信する';
            }
        };
    };

    // ナビゲーション
    const navigate = () => {
        if (window.innerWidth <= 768) sidebar.classList.remove('is-open');
        const page = window.location.hash.substring(1) || 'activity';
        navItems.forEach(item => item.classList.toggle('active', item.dataset.page === page));
        if (renderers[page]) renderers[page]();
        else pageContent.innerHTML = 'ページが見つかりません。';
        feather.replace();
    };

    // 初期化
    const init = async () => {
        try {
            await api.get('/api/admin/stats'); // 認証チェック
            loader.style.display = 'none';
            dashboardWrapper.style.display = 'flex';
            window.addEventListener('hashchange', navigate);
            navigate();
            logoutBtn.addEventListener('click', async () => { try { await api.post('/api/admin/logout'); window.location.href = '/admin-login.html'; } catch(err) { showMessage('ログアウト失敗', 'error'); } });
            menuToggle.addEventListener('click', () => sidebar.classList.toggle('is-open'));
        } catch (error) {
            window.location.href = '/admin-login.html';
        }
    };

    init();
});