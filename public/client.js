document.addEventListener('DOMContentLoaded', async () => {
    // DOM要素の取得
    const loader = document.getElementById('loader');
    const dashboardWrapper = document.querySelector('.dashboard-wrapper');
    const pageContent = document.getElementById('page-content');
    const pageTitle = document.getElementById('page-title');
    const navItems = document.querySelectorAll('.nav-item');
    const logoutBtn = document.getElementById('logout-btn');
    const menuToggle = document.getElementById('menu-toggle');
    const sidebar = document.querySelector('.sidebar');

    let guildInfo = null;
    let settingsCache = {};

    // --- Utility Functions ---

    // APIリクエストを統一的に扱うオブジェクト
    const api = {
        _request: async (endpoint, options = {}) => {
            try {
                const res = await fetch(endpoint, options);
                if (res.status === 401) { 
                    window.location.href = '/login'; 
                    return; 
                }
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || `Request failed with status ${res.status}`);
                return data;
            } catch (err) { 
                console.error(`API request error:`, err); 
                throw err; 
            }
        },
        get: (endpoint) => api._request(endpoint),
        post: (endpoint, body) => api._request(endpoint, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify(body) 
        }),
        put: (endpoint, body) => api._request(endpoint, { 
            method: 'PUT', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify(body) 
        }),
        delete: (endpoint) => api._request(endpoint, { method: 'DELETE' })
    };

    // 画面右下に通知メッセージ（トースト）を表示する関数
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

    // モーダルウィンドウを生成する関数
    const createModal = (title, content, footerButtons) => {
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

    // モーダルウィンドウを閉じる関数
    const closeModal = () => {
        const backdrop = document.querySelector('.modal-backdrop');
        if (backdrop) {
            backdrop.classList.remove('show');
            setTimeout(() => backdrop.remove(), 300);
        }
    };

    // カスタムセレクトボックス（Tom Select）を初期化する関数
    const initializeTomSelect = (selector, options = {}) => {
        const elements = typeof selector === 'string' ? document.querySelectorAll(selector) : [selector];
        elements.forEach(el => {
            if (el && el.tomselect) {
                el.tomselect.destroy();
            }
            if (el) {
                new TomSelect(el, { 
                    create: false, 
                    allowEmptyOption: true,
                    placeholder: el.getAttribute('placeholder') || 'Select...',
                    ...options 
                });
            }
        });
    };

    // --- Page Rendering ---
    const renderers = {
        dashboard: async () => {
            pageTitle.textContent = 'ダッシュボード';
            const settings = await api.get('/api/settings/guilds');
            pageContent.innerHTML = `
                <div class="grid-container" style="grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));">
                    <div class="card stat-card">
                        <div class="stat-icon">👥</div>
                        <div class="stat-info">
                            <div class="stat-value">${(guildInfo.memberCount || 0).toLocaleString()}</div>
                            <div class="stat-label">メンバー数</div>
                        </div>
                    </div>
                    <div class="card stat-card">
                        <div class="stat-icon">🤖</div>
                        <div class="stat-info">
                            <div class="stat-value">${(guildInfo.botCount || 0).toLocaleString()}</div>
                            <div class="stat-label">ボット数</div>
                        </div>
                    </div>
                    <div class="card stat-card">
                        <div class="stat-icon">📈</div>
                        <div class="stat-info">
                            <div class="stat-value">${(settings.statistics?.totalJoins || 0).toLocaleString()}</div>
                            <div class="stat-label">総参加者数</div>
                        </div>
                    </div>
                    <div class="card stat-card">
                        <div class="stat-icon">📉</div>
                        <div class="stat-info">
                            <div class="stat-value">${(settings.statistics?.totalLeaves || 0).toLocaleString()}</div>
                            <div class="stat-label">総退出者数</div>
                        </div>
                    </div>
                </div>`;
        },

        analytics: async () => {
            pageTitle.textContent = 'アナリティクス';
            pageContent.innerHTML = '<div class="loader-ring" style="margin: 40px auto;"></div>';
            const data = await api.get('/api/analytics/activity');

            pageContent.innerHTML = `
                <div class="card">
                    <div class="card-header">
                        <h3>メッセージ数ランキング</h3>
                    </div>
                    <ol id="leaderboard-list" class="leaderboard"></ol>
                </div>`;

            const listEl = document.getElementById('leaderboard-list');
            if (data.topUsers.length === 0) {
                listEl.innerHTML = `<p style="text-align:center; color: var(--text-muted-color);">まだランキングデータがありません。</p>`;
            } else {
                listEl.innerHTML = data.topUsers.map((user, i) => `
                    <li>
                        <span class="rank">#${i + 1}</span>
                        <div class="user-info">
                            <div class="user-name">${user.displayName || user.username}</div>
                            <div class="user-id">${user.userId}</div>
                        </div>
                        <span class="stat">${user.messageCount.toLocaleString()}</span>
                    </li>`).join('');
            }
        },

        roleboard: async () => {
            pageTitle.textContent = 'ロールボード管理';
            pageContent.innerHTML = `
                <div class="card">
                    <div class="card-header">
                        <h3>ロールボード一覧</h3>
                        <button id="add-roleboard-btn" class="btn">新規作成</button>
                    </div>
                    <div id="roleboard-list"></div>
                </div>`;
            await renderRoleboardList();
            document.getElementById('add-roleboard-btn').addEventListener('click', showAddRoleboardModal);
        },

        announcements: async () => {
            pageTitle.textContent = 'お知らせ設定';
            const settings = await api.get('/api/settings/guild_settings');
            settingsCache['guild_settings'] = settings;

            pageContent.innerHTML = `
                <form id="announcements-form">
                    <div class="card">
                        <div class="card-header">
                            <h3>ボットからのお知らせ受信</h3>
                        </div>
                        <div class="form-group">
                            <label for="announcementChannelId">受信チャンネル</label>
                            <select id="announcementChannelId" placeholder="チャンネルを選択しない（受信しない）">
                                <option value="">選択しない</option>
                                ${guildInfo.channels.filter(c => c.type === 0).map(o => `<option value="${o.id}">${o.name}</option>`).join('')}
                            </select>
                            <p class="form-hint">
                                ボットのアップデート情報や重要なお知らせなど、開発者からのお知らせを受信するチャンネルを指定します。
                                <br>
                                不要な場合は、チャンネルを選択しないでください。
                            </p>
                        </div>
                    </div>
                    <button type="submit" class="btn">設定を保存</button>
                </form>
            `;
            initializeTomSelect('#announcementChannelId', { items: [settings.announcementChannelId] });
            document.getElementById('announcements-form').addEventListener('submit', handleFormSubmit);
        },

        welcome: async () => {
            pageTitle.textContent = '参加・退出設定';
            const settings = await api.get('/api/settings/guilds');
            settingsCache['guilds'] = settings;
            const createSelectOptions = (options) => options.map(o => `<option value="${o.id}">${o.name}</option>`).join('');

            pageContent.innerHTML = `
                <form id="welcome-form">
                    <div class="card">
                        <div class="card-header"><h3>チャンネル設定</h3></div>
                        <div class="form-grid">
                            <div class="form-group">
                                <label for="welcomeChannelId">ウェルカムチャンネル</label>
                                <select id="welcomeChannelId" placeholder="チャンネルを選択...">
                                    <option value="">選択しない</option>
                                    ${createSelectOptions(guildInfo.channels.filter(c => c.type === 0))}
                                </select>
                            </div>
                            <div class="form-group">
                                <label for="goodbyeChannelId">お別れチャンネル</label>
                                <select id="goodbyeChannelId" placeholder="チャンネルを選択...">
                                    <option value="">選択しない</option>
                                    ${createSelectOptions(guildInfo.channels.filter(c => c.type === 0))}
                                </select>
                            </div>
                            <div class="form-group">
                                <label for="rulesChannelId">ルールチャンネル</label>
                                <select id="rulesChannelId" placeholder="チャンネルを選択...">
                                    <option value="">選択しない</option>
                                    ${createSelectOptions(guildInfo.channels.filter(c => c.type === 0))}
                                </select>
                            </div>
                        </div>
                    </div>
                    <div class="card">
                        <div class="card-header"><h3>機能設定</h3></div>
                        <div class="form-group">
                            <label for="welcomeRoleId">ウェルカムロール</label>
                            <select id="welcomeRoleId" placeholder="ロールを選択...">
                                <option value="">選択しない</option>
                                ${createSelectOptions(guildInfo.roles)}
                            </select>
                        </div>
                        <div class="form-group">
                            <label>ウェルカム時メンション</label>
                            <label class="switch">
                                <input type="checkbox" id="mentionOnWelcome" ${settings.mentionOnWelcome ? 'checked' : ''}>
                                <span class="slider"></span>
                            </label>
                        </div>
                        <div class="form-group">
                            <label>退出時DM送信</label>
                            <label class="switch">
                                <input type="checkbox" id="sendGoodbyeDM" ${settings.sendGoodbyeDM !== false ? 'checked' : ''}>
                                <span class="slider"></span>
                            </label>
                        </div>
                    </div>
                    <button type="submit" class="btn">設定を保存</button>
                </form>`;
            ['welcomeChannelId', 'goodbyeChannelId', 'rulesChannelId', 'welcomeRoleId'].forEach(id => 
                initializeTomSelect(`#${id}`, { items: [settings[id]] })
            );
            document.getElementById('welcome-form').addEventListener('submit', handleFormSubmit);
        },

        'welcome-message': async () => {
            pageTitle.textContent = 'ウェルカムメッセージ設定';
            const settings = await api.get('/api/settings/welcome-message');
            settingsCache['welcome-message'] = settings;
            pageContent.innerHTML = `
                <form id="welcome-message-form">
                    <div class="card">
                        <div class="card-header"><h3>メッセージ設定</h3></div>
                        <div class="form-group">
                            <label>カスタムウェルカムメッセージを有効化</label>
                            <label class="switch">
                                <input type="checkbox" id="welcome-enabled" ${settings.enabled ? 'checked' : ''}>
                                <span class="slider"></span>
                            </label>
                        </div>
                        <div class="form-group">
                            <label for="welcome-type">メッセージタイプ</label>
                            <select id="welcome-type">
                                <option value="default" ${settings.type === 'default' ? 'selected' : ''}>カスタム</option>
                                <option value="gemini" ${settings.type === 'gemini' ? 'selected' : ''}>AI (Gemini) 生成</option>
                            </select>
                        </div>
                    </div>
                    <div id="default-settings" style="display: ${settings.type === 'default' ? 'block' : 'none'};">
                        <div class="card">
                            <div class="card-header"><h3>メッセージ内容</h3></div>
                            <div class="form-group">
                                <label for="welcome-title">タイトル</label>
                                <input type="text" id="welcome-title" value="${settings.title || ''}">
                            </div>
                            <div class="form-group">
                                <label for="welcome-description">説明文</label>
                                <textarea id="welcome-description" rows="8">${settings.description || ''}</textarea>
                                <p class="form-hint">
                                    <b>変数:</b> <code>{user.name}</code>, <code>{user.displayName}</code>, <code>{user.mention}</code>, <code>{server.name}</code>, <code>{server.memberCount}</code>, <code>{rulesChannel}</code>
                                </p>
                            </div>
                            <div class="form-group">
                                <label for="welcome-imageUrl">画像URL</label>
                                <input type="text" id="welcome-imageUrl" placeholder="https://..." value="${settings.imageUrl || ''}">
                            </div>
                        </div>
                    </div>
                    <div id="gemini-settings" style="display: ${settings.type === 'gemini' ? 'block' : 'none'};">
                        <div class="card">
                            <div class="card-header"><h3>AIによるメッセージ生成</h3></div>
                            <p>AIがサーバー名、参加ユーザー名、総メンバー数に基づきユニークな歓迎メッセージを自動生成します。</p>
                        </div>
                    </div>
                    <button type="submit" class="btn">設定を保存</button>
                </form>`;

            initializeTomSelect('#welcome-type');

            document.getElementById('welcome-type').addEventListener('change', (e) => {
                document.getElementById('default-settings').style.display = e.target.value === 'default' ? 'block' : 'none';
                document.getElementById('gemini-settings').style.display = e.target.value === 'gemini' ? 'block' : 'none';
            });
            document.getElementById('welcome-message-form').addEventListener('submit', handleFormSubmit);
        },

        autorole: async () => {
            pageTitle.textContent = 'Bot 自動ロール設定';
            const settings = await api.get('/api/settings/guild_settings');
            settingsCache['guild_settings'] = settings;
            pageContent.innerHTML = `
                <form id="autorole-form">
                    <div class="card">
                        <div class="card-header"><h3>Bot用ロール</h3></div>
                        <div class="form-group">
                            <label for="botAutoroleId">自動付与ロール</label>
                            <select id="botAutoroleId" placeholder="ロールを選択...">
                                <option value="">選択しない</option>
                                ${guildInfo.roles.map(o => `<option value="${o.id}">${o.name}</option>`).join('')}
                            </select>
                            <p class="form-hint">新しいBotが参加した際、選択したロールが自動付与されます。</p>
                        </div>
                    </div>
                    <button type="submit" class="btn">設定を保存</button>
                </form>`;
            initializeTomSelect('#botAutoroleId', { items: [settings.botAutoroleId] });
            document.getElementById('autorole-form').addEventListener('submit', handleFormSubmit);
        },

        automod: async () => {
            pageTitle.textContent = 'オートモッド設定';
            const settings = await api.get('/api/settings/guild_settings');
            settingsCache['guild_settings'] = settings;
            const automod = settings.automod || { ngWords: [], blockInvites: true };
            pageContent.innerHTML = `
                <form id="automod-form">
                    <div class="card">
                        <div class="card-header"><h3>NGワードフィルター</h3></div>
                        <div class="form-group">
                            <label for="ngWords">NGワード (カンマ区切り)</label>
                            <textarea id="ngWords" rows="4" placeholder="word1,word2">${(automod.ngWords || []).join(',')}</textarea>
                        </div>
                    </div>
                    <div class="card">
                        <div class="card-header"><h3>招待リンクフィルター</h3></div>
                        <div class="form-group">
                            <label>招待リンクをブロック</label>
                            <label class="switch">
                                <input type="checkbox" id="blockInvites" ${automod.blockInvites !== false ? 'checked' : ''}>
                                <span class="slider"></span>
                            </label>
                        </div>
                    </div>
                    <button type="submit" class="btn">設定を保存</button>
                </form>`;
            document.getElementById('automod-form').addEventListener('submit', handleFormSubmit);
        },

        logging: async () => {
            pageTitle.textContent = 'ログ設定';
            const settings = await api.get('/api/settings/guild_settings');
            settingsCache['guild_settings'] = settings;
            pageContent.innerHTML = `
                <form id="logging-form">
                    <div class="card">
                        <div class="card-header"><h3>監査ログ</h3></div>
                        <div class="form-group">
                            <label for="auditLogChannel">監査ログチャンネル</label>
                            <select id="auditLogChannel" placeholder="チャンネルを選択...">
                                <option value="">選択しない</option>
                                ${guildInfo.channels.filter(c => c.type === 0).map(o => `<option value="${o.id}">${o.name}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                    <button type="submit" class="btn">設定を保存</button>
                </form>`;
            initializeTomSelect('#auditLogChannel', { items: [settings.auditLogChannel] });
            document.getElementById('logging-form').addEventListener('submit', handleFormSubmit);
        },

        leveling: async () => {
            pageTitle.textContent = 'レベリング設定';
            const settings = await api.get('/api/settings/guild_settings');
            settingsCache['guild_settings'] = settings;
            const levelingSettings = settings.leveling || { roleRewards: [] };
            pageContent.innerHTML = `
                <form id="leveling-form">
                    <div class="card">
                        <div class="card-header"><h3>レベルアップ通知</h3></div>
                        <div class="form-group">
                            <label for="levelUpChannel">通知チャンネル</label>
                            <select id="levelUpChannel" placeholder="レベルアップしたチャンネルに通知">
                                <option value="">レベルアップしたチャンネルに通知</option>
                                ${guildInfo.channels.filter(c => c.type === 0).map(o => `<option value="${o.id}">${o.name}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                    <div class="card">
                        <div class="card-header"><h3>ロール報酬</h3></div>
                        <div id="role-rewards-list"></div>
                        <div class="form-group" style="margin-top:20px; border-top:1px solid var(--border-color); padding-top:20px;">
                            <label>新しい報酬を追加</label>
                            <div class="form-grid" style="align-items:flex-end;">
                                <input type="number" id="reward-level" placeholder="レベル" min="1">
                                <select id="reward-role-id" placeholder="ロールを選択...">
                                    <option value="">選択してください</option>
                                    ${guildInfo.roles.map(o => `<option value="${o.id}">${o.name}</option>`).join('')}
                                </select>
                                <button type="button" id="add-reward-btn" class="btn">追加</button>
                            </div>
                        </div>
                    </div>
                    <button type="submit" class="btn">設定を保存</button>
                </form>`;
            initializeTomSelect('#levelUpChannel', { items: [settings.levelUpChannel] });
            initializeTomSelect('#reward-role-id');
            
            const renderRoleRewards = () => {
                const listEl = document.getElementById('role-rewards-list');
                if (!levelingSettings.roleRewards || levelingSettings.roleRewards.length === 0) { 
                    listEl.innerHTML = '<p style="text-align:center; color: var(--text-muted-color);">ロール報酬はまだ設定されていません。</p>'; 
                    return; 
                }
                listEl.innerHTML = levelingSettings.roleRewards
                    .sort((a, b) => a.level - b.level)
                    .map((reward, index) => `
                        <div class="role-item" data-index="${index}">
                            <div class="role-info">
                                <span class="role-name">Lv. ${reward.level}</span>
                                <span class="role-genre-tag">${guildInfo.roles.find(r=>r.id===reward.roleId)?.name || '不明'}</span>
                            </div>
                            <button type="button" class="btn btn-danger btn-small remove-reward-btn">&times;</button>
                        </div>`).join('');
                listEl.querySelectorAll('.remove-reward-btn').forEach(btn => { 
                    btn.onclick = (e) => { 
                        levelingSettings.roleRewards.splice(parseInt(e.target.closest('.role-item').dataset.index, 10), 1); 
                        renderRoleRewards(); 
                    }; 
                });
            };
            renderRoleRewards();
            
            document.getElementById('add-reward-btn').onclick = () => {
                const level = parseInt(document.getElementById('reward-level').value, 10);
                const roleId = document.getElementById('reward-role-id').value;
                if (!level || !roleId || level < 1) {
                    return showMessage('有効なレベルとロールを選択してください。', 'error');
                }
                if (levelingSettings.roleRewards.some(r => r.level === level)) {
                    return showMessage(`レベル ${level} の報酬は既に存在します。`, 'error');
                }
                levelingSettings.roleRewards.push({ level, roleId });
                renderRoleRewards();
                document.getElementById('reward-level').value = '';
                document.getElementById('reward-role-id').tomselect.clear();
            };
            
            document.getElementById('leveling-form').addEventListener('submit', (e) => { 
                e.preventDefault(); 
                handleFormSubmit(e, { 
                    levelUpChannel: document.getElementById('levelUpChannel').value || null, 
                    leveling: levelingSettings 
                }); 
            });
        },

        ai: async () => {
            pageTitle.textContent = 'AI設定';
            const settings = await api.get('/api/settings/guild_settings');
            settingsCache['guild_settings'] = settings;
            const aiConfig = settings.ai || { mentionReplyEnabled: true, aiPersonalityPrompt: '' };
            pageContent.innerHTML = `
                <form id="ai-form">
                    <div class="card">
                        <div class="card-header"><h3>メンション応答機能</h3></div>
                        <div class="form-group">
                            <label>メンションへの自動応答</label>
                            <label class="switch">
                                <input type="checkbox" id="mentionReplyEnabled" ${aiConfig.mentionReplyEnabled ? 'checked' : ''}>
                                <span class="slider"></span>
                            </label>
                            <p class="form-hint">BotにメンションするとAIが返信します。</p>
                        </div>
                    </div>
                    <div class="card">
                        <div class="card-header"><h3>AIのペルソナ設定</h3></div>
                        <div class="form-group">
                            <label for="aiPersonalityPrompt">AIへの指示（プロンプト）</label>
                            <textarea id="aiPersonalityPrompt" rows="8" placeholder="例：あなたは猫のキャラクターです。語尾に「にゃん」を付けてください。">${aiConfig.aiPersonalityPrompt || ''}</textarea>
                            <p class="form-hint">AIの性格や口調を指定できます。空欄の場合はフレンドリーなアシスタントになります。</p>
                        </div>
                    </div>
                    <button type="submit" class="btn">設定を保存</button>
                </form>`;
            document.getElementById('ai-form').addEventListener('submit', handleFormSubmit);
        },
    };

    // --- Roleboard Functions ---
    const renderRoleboardList = async () => {
        const listEl = document.getElementById('roleboard-list');
        listEl.innerHTML = '<div class="loader-ring" style="margin: 20px auto;"></div>';
        try {
            const boards = await api.get('/api/roleboards');
            if (boards.length === 0) { 
                listEl.innerHTML = '<p style="text-align: center; color: var(--text-muted-color);">まだロールボードが作成されていません。</p>'; 
                return; 
            }
            listEl.innerHTML = boards.map(board => `
                <div class="card">
                    <div class="card-header">
                        <h3>${board.title}</h3>
                        <div>
                            <button class="btn btn-secondary btn-small edit-roleboard-btn" data-id="${board.id}">編集</button>
                            <button class="btn btn-danger btn-small delete-roleboard-btn" data-id="${board.id}">削除</button>
                        </div>
                    </div>
                    <p>${board.description}</p>
                    <p><strong>ロール数:</strong> ${Object.keys(board.roles || {}).length}</p>
                </div>`).join('');
            listEl.querySelectorAll('.edit-roleboard-btn').forEach(btn => 
                btn.onclick = (e) => showEditRoleboardModal(e.target.dataset.id)
            );
            listEl.querySelectorAll('.delete-roleboard-btn').forEach(btn => 
                btn.onclick = (e) => confirmDeleteRoleboard(e.target.dataset.id)
            );
        } catch (error) { 
            listEl.innerHTML = `<p class="message error">読込失敗: ${error.message}</p>`; 
        }
    };

    const showAddRoleboardModal = () => {
        const modal = createModal('新しいロールボードを作成', `
            <div class="form-group">
                <label for="modal-title">タイトル</label>
                <input type="text" id="modal-title" required>
            </div>
            <div class="form-group">
                <label for="modal-description">説明</label>
                <textarea id="modal-description"></textarea>
            </div>
            <div class="form-group">
                <label for="modal-color">埋め込みの色</label>
                <div class="color-input-wrapper">
                    <input type="color" id="modal-color-picker" value="#5865F2">
                    <input type="text" id="modal-color-text" value="#5865F2">
                </div>
            </div>`, 
            [{id: 'save-new-board', text: '作成', class: 'btn'}]
        );
        
        const colorPicker = modal.querySelector('#modal-color-picker');
        const colorText = modal.querySelector('#modal-color-text');
        colorPicker.oninput = () => colorText.value = colorPicker.value;
        colorText.oninput = () => {
            if (/^#[0-9A-F]{6}$/i.test(colorText.value)) {
                colorPicker.value = colorText.value;
            }
        };
        
        document.getElementById('save-new-board').onclick = async () => {
            const title = modal.querySelector('#modal-title').value.trim();
            if (!title) {
                return showMessage('タイトルは必須です。', 'error');
            }
            try { 
                await api.post('/api/roleboards', { 
                    title, 
                    description: modal.querySelector('#modal-description').value.trim(), 
                    color: colorText.value 
                }); 
                showMessage('ロールボードを作成しました。'); 
                closeModal(); 
                await renderRoleboardList(); 
            } catch (error) { 
                showMessage(`作成エラー: ${error.message}`, 'error'); 
            }
        };
    };

    const showEditRoleboardModal = async (boardId) => {
        try {
            const boards = await api.get('/api/roleboards');
            const board = boards.find(b => b.id === boardId);
            if (!board) {
                return showMessage('ボードが見つかりません', 'error');
            }
            
            const modal = createModal('ロールボードを編集', `
                <div class="form-grid">
                    <div class="form-group">
                        <label>タイトル</label>
                        <input type="text" id="edit-title" value="${board.title || ''}">
                    </div>
                    <div class="form-group">
                        <label>色</label>
                        <div class="color-input-wrapper">
                            <input type="color" id="edit-color-picker" value="#${(board.color || 0x5865F2).toString(16).padStart(6, '0').toUpperCase()}">
                            <input type="text" id="edit-color-text" value="#${(board.color || 0x5865F2).toString(16).padStart(6, '0').toUpperCase()}">
                        </div>
                    </div>
                </div>
                <div class="form-group">
                    <label>説明</label>
                    <textarea id="edit-desc">${board.description || ''}</textarea>
                </div>
                <hr style="border-color: var(--border-color); margin: 20px 0;">
                <h4>ロール管理</h4>
                <div id="modal-role-list"></div>
                <div class="form-group" style="margin-top: 20px; border-top: 1px solid var(--border-color); padding-top: 20px;">
                    <label>ロールを追加</label>
                    <div style="display: flex; gap: 10px; align-items: flex-end;">
                        <select id="add-role-select" style="flex: 2;" placeholder="ロールを選択...">
                            <option value="">ロールを選択...</option>
                            ${guildInfo.roles.map(r => `<option value="${r.id}">${r.name}</option>`).join('')}
                        </select>
                        <input type="text" id="add-role-genre" placeholder="ジャンル" style="flex: 1;">
                        <button id="add-role-btn" class="btn">追加</button>
                    </div>
                </div>`, 
                [{id: 'save-board-changes', text: '保存', class: 'btn'}]
            );
            
            const colorPicker = modal.querySelector('#edit-color-picker');
            const colorText = modal.querySelector('#edit-color-text');
            colorPicker.oninput = () => colorText.value = colorPicker.value.toUpperCase();
            colorText.oninput = () => {
                if (/^#[0-9A-F]{6}$/i.test(colorText.value)) {
                    colorPicker.value = colorText.value;
                }
            };
            
            // ローカルボードのコピーを作成
            const localBoard = JSON.parse(JSON.stringify(board));
            
            const selectEl = modal.querySelector('#add-role-select');
            initializeTomSelect(selectEl);
            
            const renderModalRoleList = () => {
                const listEl = document.getElementById('modal-role-list');
                const roles = localBoard.roles || {};
                if (Object.keys(roles).length === 0) { 
                    listEl.innerHTML = '<p style="text-align: center; color: var(--text-muted-color);">まだロールが追加されていません。</p>'; 
                    return; 
                }
                listEl.innerHTML = Object.entries(roles).map(([id, data]) => `
                    <div class="role-item" data-id="${id}">
                        <div class="role-info">
                            <span class="role-name">${data.name}</span>
                            <span class="role-genre-tag">${data.genre}</span>
                        </div>
                        <button class="btn btn-danger btn-small remove-role-btn">&times;</button>
                    </div>`).join('');
            };
            renderModalRoleList();
            
            modal.querySelector('#add-role-btn').onclick = () => {
                const roleId = selectEl.tomselect.getValue();
                const genre = modal.querySelector('#add-role-genre').value.trim();
                const role = guildInfo.roles.find(r => r.id === roleId);
                
                if (!roleId || !genre || !role) {
                    return showMessage('ロールとジャンルを選択・入力してください', 'error');
                }
                
                localBoard.roles = localBoard.roles || {};
                if (localBoard.roles[roleId]) {
                    return showMessage('このロールは既に追加されています。', 'warning');
                }
                
                localBoard.roles[roleId] = { 
                    name: role.name, 
                    genre, 
                    emoji: null 
                };
                
                localBoard.genres = localBoard.genres || {};
                if (!localBoard.genres[genre]) {
                    localBoard.genres[genre] = [];
                }
                if (!localBoard.genres[genre].includes(roleId)) {
                    localBoard.genres[genre].push(roleId);
                }
                
                renderModalRoleList();
                modal.querySelector('#add-role-genre').value = '';
                selectEl.tomselect.clear();
            };
            
            modal.querySelector('#modal-role-list').onclick = e => {
                if (e.target.classList.contains('remove-role-btn')) {
                    const roleId = e.target.closest('.role-item').dataset.id;
                    const roleGenre = localBoard.roles[roleId].genre;
                    
                    delete localBoard.roles[roleId];
                    
                    if (localBoard.genres?.[roleGenre]) {
                        localBoard.genres[roleGenre] = localBoard.genres[roleGenre].filter(id => id !== roleId);
                        if (localBoard.genres[roleGenre].length === 0) {
                            delete localBoard.genres[roleGenre];
                        }
                    }
                    renderModalRoleList();
                }
            };
            
            document.getElementById('save-board-changes').onclick = async () => {
                const title = modal.querySelector('#edit-title').value.trim();
                if (!title) {
                    return showMessage('タイトルは必須です。', 'error');
                }
                
                try { 
                    await api.put(`/api/roleboards/${boardId}`, { 
                        title, 
                        description: modal.querySelector('#edit-desc').value.trim(), 
                        color: parseInt(colorText.value.replace('#', ''), 16), 
                        roles: localBoard.roles, 
                        genres: localBoard.genres 
                    }); 
                    showMessage('ロールボードを更新しました。'); 
                    closeModal(); 
                    await renderRoleboardList(); 
                } catch (error) { 
                    showMessage(`更新エラー: ${error.message}`, 'error'); 
                }
            };
        } catch (error) {
            showMessage(`エラー: ${error.message}`, 'error');
        }
    };

    const confirmDeleteRoleboard = (boardId) => {
        createModal('削除の確認', `
            <p>本当にこのロールボードを削除しますか？この操作は取り消せません。</p>`, 
            [
                {id: 'cancel-delete', text: 'キャンセル', class: 'btn-secondary'}, 
                {id: 'confirm-delete', text: '削除', class: 'btn-danger'}
            ]
        );
        document.getElementById('cancel-delete').onclick = closeModal;
        document.getElementById('confirm-delete').onclick = async () => {
            try { 
                await api.delete(`/api/roleboards/${boardId}`); 
                showMessage('ロールボードを削除しました。'); 
                closeModal(); 
                await renderRoleboardList(); 
            } catch (error) { 
                showMessage(`削除エラー: ${error.message}`, 'error'); 
            }
        };
    };

    // --- Form Handling ---
    const handleFormSubmit = async (e, directSettings = null) => {
        e.preventDefault();
        const form = e.target;
        const btn = form.querySelector('button[type="submit"]');
        const btnText = btn.textContent;
        btn.disabled = true; 
        btn.textContent = '保存中...';
        
        const page = new URL(location.href).hash.substring(1);
        let settings, collection;
        
        try {
            if (directSettings) { 
                collection = 'guild_settings'; 
                settings = directSettings; 
            } else {
                switch(page) {
                    case 'welcome': 
                        collection = 'guilds'; 
                        settings = { 
                            welcomeChannelId: form.querySelector('#welcomeChannelId').value || null, 
                            goodbyeChannelId: form.querySelector('#goodbyeChannelId').value || null, 
                            rulesChannelId: form.querySelector('#rulesChannelId').value || null, 
                            welcomeRoleId: form.querySelector('#welcomeRoleId').value || null, 
                            mentionOnWelcome: form.querySelector('#mentionOnWelcome').checked, 
                            sendGoodbyeDM: form.querySelector('#sendGoodbyeDM').checked 
                        }; 
                        break;
                    case 'welcome-message': 
                        await api.post(`/api/settings/welcome-message`, { 
                            enabled: form.querySelector('#welcome-enabled').checked, 
                            type: form.querySelector('#welcome-type').value, 
                            title: form.querySelector('#welcome-title').value, 
                            description: form.querySelector('#welcome-description').value, 
                            imageUrl: form.querySelector('#welcome-imageUrl').value 
                        }); 
                        showMessage('設定を保存しました。'); 
                        btn.disabled = false; 
                        btn.textContent = btnText; 
                        return;
                    case 'announcements': 
                        collection = 'guild_settings'; 
                        settings = { 
                            announcementChannelId: form.querySelector('#announcementChannelId').value || null 
                        }; 
                        break;
                    case 'autorole': 
                        collection = 'guild_settings'; 
                        settings = { 
                            botAutoroleId: form.querySelector('#botAutoroleId').value || null 
                        }; 
                        break;
                    case 'automod': 
                        collection = 'guild_settings'; 
                        settings = { 
                            automod: { 
                                ngWords: form.querySelector('#ngWords').value.split(',').map(w => w.trim()).filter(Boolean), 
                                blockInvites: form.querySelector('#blockInvites').checked 
                            }
                        }; 
                        break;
                    case 'logging': 
                        collection = 'guild_settings'; 
                        settings = { 
                            auditLogChannel: form.querySelector('#auditLogChannel').value || null 
                        }; 
                        break;
                    case 'ai': 
                        collection = 'guild_settings'; 
                        settings = { 
                            ai: { 
                                mentionReplyEnabled: form.querySelector('#mentionReplyEnabled').checked, 
                                aiPersonalityPrompt: form.querySelector('#aiPersonalityPrompt').value 
                            }
                        }; 
                        break;
                    default: 
                        btn.disabled = false; 
                        btn.textContent = btnText; 
                        return;
                }
            }
            await api.post(`/api/settings/${collection}`, settings);
            showMessage('設定を保存しました。');
        } catch (error) { 
            showMessage(`保存エラー: ${error.message}`, 'error'); 
        } finally { 
            btn.disabled = false; 
            btn.textContent = btnText; 
        }
    };

    // --- Navigation ---
    const navigate = async () => {
        if (window.innerWidth <= 768) {
            sidebar.classList.remove('is-open');
        }
        
        const page = window.location.hash.substring(1) || 'dashboard';
        navItems.forEach(item => item.classList.toggle('active', item.dataset.page === page));
        pageContent.innerHTML = '<div class="loader-ring" style="margin: 40px auto;"></div>';
        
        if (renderers[page]) {
            try { 
                await renderers[page](); 
            } catch(error) { 
                console.error('Page render error:', error);
                pageContent.innerHTML = `<p class="message error show">ページ読込失敗: ${error.message}</p>`; 
            }
        } else { 
            pageContent.innerHTML = `<p class="message error show">ページが見つかりません。</p>`; 
        }
        
        // Feather icons refresh
        if (window.feather) {
            feather.replace();
        }
    };

    // --- Initialization ---
    const init = async () => {
        try {
            guildInfo = await api.get('/api/guild-info');
            document.getElementById('server-icon').src = guildInfo.icon || 'https://cdn.discordapp.com/embed/avatars/0.png';
            document.getElementById('server-name').textContent = guildInfo.name;
            
            loader.style.display = 'none';
            dashboardWrapper.style.display = 'flex';
            
            window.addEventListener('hashchange', navigate);
            await navigate();
            
            logoutBtn.addEventListener('click', async () => { 
                try { 
                    await api.post('/api/logout'); 
                    window.location.href = '/login'; 
                } catch(err) { 
                    showMessage('ログアウト失敗', 'error'); 
                } 
            });
            
            menuToggle.addEventListener('click', () => {
                sidebar.classList.toggle('is-open');
            });
            
        } catch (error) {
            console.error('Init error:', error);
            loader.innerHTML = `<p class="message error">読込失敗。再ログインしてください。</p><a href="/login" class="btn">ログインページへ</a>`;
        }
    };

    init();
});