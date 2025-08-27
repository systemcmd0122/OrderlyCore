document.addEventListener('DOMContentLoaded', async () => {
    // DOM要素
    const loader = document.getElementById('loader');
    const adminPanel = document.querySelector('.admin-panel-wrapper');
    const pageContent = document.getElementById('page-content');
    const navItems = document.querySelectorAll('.nav-item');
    const logoutBtn = document.getElementById('logout-btn');
    const terminalBody = document.getElementById('terminal-body');
    const headerTitle = document.getElementById('header-title');
    const botAvatar = document.getElementById('bot-avatar');
    const botName = document.getElementById('bot-name');
    const botNameHeader = document.getElementById('bot-name-header');

    // APIリクエスト
    const api = {
        _request: async (endpoint, options = {}) => {
            try {
                const res = await fetch(endpoint, options);
                if (res.status === 401) { window.location.href = '/admin-login.html'; return; }
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || `Request failed with status ${res.status}`);
                return data;
            } catch (err) {
                showMessage(`API Request Error: ${err.message}`, 'error');
                throw err;
            }
        },
        get: (endpoint) => api._request(endpoint),
        post: (endpoint, body) => api._request(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    };

    // 通知メッセージ
    const showMessage = (text, type = 'success') => {
        const container = document.getElementById('toast-container');
        const el = document.createElement('div');
        el.className = `toast ${type}`;
        el.textContent = text;
        container.appendChild(el);
        setTimeout(() => {
            el.style.opacity = '0';
            el.style.transform = 'translateY(20px)';
            setTimeout(() => el.remove(), 500);
        }, 3000);
    };

    const renderToTerminal = (command, content) => {
        const line = document.createElement('div');
        line.innerHTML = `<div class="line prompt-line"><span class="prompt">root@overseer:~#</span><span class="command-text">${command}</span></div>`;
        const output = document.createElement('div');
        output.className = 'command-output';
        output.innerHTML = content;

        pageContent.innerHTML = '';
        pageContent.appendChild(line);
        
        const loaderLine = document.createElement('div');
        loaderLine.className = 'line text-loading';
        loaderLine.textContent = 'Executing...';
        pageContent.appendChild(loaderLine);
        
        terminalBody.scrollTop = terminalBody.scrollHeight;

        setTimeout(() => {
            loaderLine.remove();
            pageContent.appendChild(output);
            feather.replace();
            terminalBody.scrollTop = terminalBody.scrollHeight;
        }, 300 + Math.random() * 200);
    };

    // ページ描画ロジック
    const renderers = {
        'fetch-activity': async () => {
            headerTitle.textContent = "overseer-admin-panel --view ./activity_stats";
            const stats = await api.get('/api/admin/stats');
            botAvatar.src = stats.bot.avatar;
            botName.textContent = stats.bot.username;
            botNameHeader.textContent = stats.bot.username;
            
            const content = `
                <div class="grid-container">
                    <div class="card stat-card"><div class="stat-icon">💻</div><div><div class="stat-value">${stats.guildCount.toLocaleString()}</div><div class="stat-label">導入サーバー数</div></div></div>
                    <div class="card stat-card"><div class="stat-icon">👥</div><div><div class="stat-value">${stats.userCount.toLocaleString()}</div><div class="stat-label">総ユーザー数</div></div></div>
                    <div class="card stat-card"><div class="stat-icon">⏰</div><div><div class="stat-value">${stats.uptime}</div><div class="stat-label">稼働時間</div></div></div>
                    <div class="card stat-card"><div class="stat-icon">💾</div><div><div class="stat-value">${stats.memoryUsage} MB</div><div class="stat-label">メモリ使用量</div></div></div>
                </div>
                <div class="card">
                    <div class="card-header"><h3>最近参加したサーバー</h3></div>
                    <ul class="leaderboard">
                        ${stats.recentGuilds.map(g => `<li><span class="rank">${new Date(g.joinedTimestamp).toLocaleDateString()}</span><div class="user-info"><div class="user-name">${g.name}</div><div class="user-id">ID: ${g.id}</div></div><span class="stat">${g.memberCount.toLocaleString()}人</span></li>`).join('') || '<p>データなし</p>'}
                    </ul>
                </div>
            `;
            renderToTerminal('./activity_stats', content);
        },
        'manage-announcements': () => {
            headerTitle.textContent = "overseer-admin-panel --edit ./announcements";
            const content = `
                <form id="announcement-form">
                    <div class="card">
                        <div class="card-header"><h3>お知らせ作成</h3></div>
                        <div class="form-group"><label for="title">タイトル</label><input type="text" id="title" required></div>
                        <div class="form-group"><label for="description">内容 (Markdown対応)</label><textarea id="description" rows="8" required></textarea></div>
                        <div class="form-grid">
                           <div class="form-group"><label for="color">色 (HEX)</label><input type="text" id="color" value="#3498db"></div>
                           <div class="form-group"><label for="url">URL</label><input type="text" id="url" placeholder="https://..."></div>
                        </div>
                        <div class="form-group"><label for="footer">フッター</label><input type="text" id="footer" value="Overseerからのお知らせ"></div>
                    </div>
                    <button type="submit" class="btn">プレビューして送信確認</button>
                </form>
                 <div id="preview-container" style="margin-top: 20px;"></div>
            `;
            renderToTerminal('./announcements', content);
            document.getElementById('announcement-form').addEventListener('submit', handleAnnouncementSubmit);
        },
        'manage-status': async () => {
            headerTitle.textContent = "overseer-admin-panel --edit ./bot_status";
            const settings = await api.get('/api/admin/statuses');
            const statuses = settings.list || [];
            const mode = settings.mode || 'custom';
            
            const content = `
                <div class="card">
                    <div class="card-header"><h3>ステータスモード選択</h3></div>
                    <div class="form-group">
                        <select id="status-mode-select">
                            <option value="custom" ${mode === 'custom' ? 'selected' : ''}>カスタムリスト</option>
                            <option value="ai" ${mode === 'ai' ? 'selected' : ''}>AI 自動生成</option>
                        </select>
                        <p class="form-hint">ボットのステータス表示方法を選択します。「AI 自動生成」を選択すると、下のカスタムリストは無視されます。</p>
                    </div>
                </div>
                <div id="custom-status-editor" style="display: ${mode === 'custom' ? 'block' : 'none'};">
                    <div class="card">
                        <div class="card-header"><h3>カスタムステータス編集</h3></div>
                        <p class="form-hint">利用可能な変数: <code>\${serverCount}</code>, <code>\${userCount}</code></p>
                        <div id="status-list" style="margin-top: 20px;"></div>
                        <div style="margin-top: 20px; border-top: 1px solid var(--border-color); padding-top: 20px;">
                            <button id="add-status-btn" class="btn btn-secondary">ステータスを追加</button>
                        </div>
                    </div>
                </div>
                <button id="save-statuses-btn" class="btn">設定を保存</button>
            `;
            renderToTerminal('./bot_status', content);
            
            document.getElementById('status-mode-select').addEventListener('change', (e) => {
                document.getElementById('custom-status-editor').style.display = e.target.value === 'custom' ? 'block' : 'none';
            });
            
            renderStatusList(statuses); // 最初にリストを描画
            
            document.getElementById('add-status-btn').addEventListener('click', () => {
                const list = document.getElementById('status-list');
                const newItem = document.createElement('div');
                newItem.className = 'status-item';
                newItem.innerHTML = `
                    <input type="text" class="emoji-input" placeholder="絵文字" value="✅">
                    <input type="text" class="text-input" placeholder="ステータステキスト" value="新しいステータス">
                    <button class="btn btn-danger btn-small remove-status-btn"><i data-feather="trash-2"></i></button>
                `;
                list.appendChild(newItem);
                feather.replace(); // ★ 修正点: アイコンを再描画
                newItem.querySelector('.remove-status-btn').addEventListener('click', (e) => {
                    e.target.closest('.status-item').remove();
                });
            });
            
            document.getElementById('save-statuses-btn').addEventListener('click', handleSaveStatuses);
        }
    };
    
    // ★ 修正点: ステータスリストの描画関数
    const renderStatusList = (statuses) => {
        const listEl = document.getElementById('status-list');
        if (!listEl) return; // 要素が存在しない場合は何もしない
        
        listEl.innerHTML = ''; // 一旦空にする
        if (statuses && statuses.length > 0) {
            statuses.forEach(status => {
                const item = document.createElement('div');
                item.className = 'status-item';
                item.innerHTML = `
                    <input type="text" class="emoji-input" placeholder="絵文字" value="${status.emoji || ''}">
                    <input type="text" class="text-input" placeholder="ステータステキスト" value="${status.state || ''}">
                    <button class="btn btn-danger btn-small remove-status-btn"><i data-feather="trash-2"></i></button>
                `;
                item.querySelector('.remove-status-btn').addEventListener('click', (e) => {
                    e.target.closest('.status-item').remove();
                });
                listEl.appendChild(item);
            });
        }
        feather.replace(); // 描画後にアイコンを有効化
    };

    const handleSaveStatuses = async (event) => {
        const btn = event.target;
        btn.disabled = true;
        btn.textContent = '保存中...';
        const mode = document.getElementById('status-mode-select').value;
        const statusItems = document.querySelectorAll('#status-list .status-item');
        const statuses = Array.from(statusItems).map(item => ({
            emoji: item.querySelector('.emoji-input').value.trim(),
            state: item.querySelector('.text-input').value.trim()
        })).filter(s => s.state); // stateが空でないものだけを保存
        try {
            await api.post('/api/admin/statuses', { statuses, mode });
            showMessage('ステータス設定を保存しました。');
        } finally {
            btn.disabled = false;
            btn.textContent = '設定を保存';
        }
    };

    const handleAnnouncementSubmit = (e) => {
        e.preventDefault();
        const form = e.target;
        const announcement = {
            title: form.querySelector('#title').value,
            description: form.querySelector('#description').value,
            color: form.querySelector('#color').value,
            url: form.querySelector('#url').value,
            footer: form.querySelector('#footer').value
        };
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
            } finally {
                btn.disabled = false;
                btn.textContent = '全サーバーに送信する';
            }
        };
    };

    const navigate = (e) => {
        e.preventDefault();
        const target = e.currentTarget;
        const command = target.dataset.command;

        navItems.forEach(item => item.classList.remove('active'));
        target.classList.add('active');

        if (renderers[command]) {
            renderers[command]();
        }
    };

    const init = async () => {
        try {
            await api.get('/api/admin/stats');
            loader.style.display = 'none';
            adminPanel.style.display = 'flex';
            feather.replace();

            navItems.forEach(item => {
                if(item.id !== 'logout-btn') {
                    item.addEventListener('click', navigate);
                }
            });
            
            logoutBtn.addEventListener('click', async () => {
                try {
                    await api.post('/api/admin/logout');
                    window.location.href = '/admin-login.html';
                } catch(err) {
                    showMessage('ログアウト失敗', 'error');
                }
            });
            
            renderers['fetch-activity']();
        } catch (error) {
            window.location.href = '/admin-login.html';
        }
    };

    init();
});