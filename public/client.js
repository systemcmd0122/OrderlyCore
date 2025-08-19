document.addEventListener('DOMContentLoaded', async () => {
    const loader = document.getElementById('loader');
    const dashboardWrapper = document.querySelector('.dashboard-wrapper');
    const pageContent = document.getElementById('page-content');
    const pageTitle = document.getElementById('page-title');
    const navItems = document.querySelectorAll('.nav-item');
    const logoutBtn = document.getElementById('logout-btn');

    let guildInfo = null;
    let settingsCache = {};

    // --- Utility Functions ---
    const api = {
        get: async (endpoint) => {
            const res = await fetch(endpoint);
            if (!res.ok) {
                if (res.status === 401) window.location.href = '/login';
                throw new Error(`API Error: ${res.statusText}`);
            }
            return res.json();
        },
        post: async (endpoint, body) => {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!res.ok) throw new Error((await res.json()).error);
            return res.json();
        },
        put: async (endpoint, body) => {
             const res = await fetch(endpoint, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!res.ok) throw new Error((await res.json()).error);
            return res.json();
        },
        delete: async (endpoint) => {
            const res = await fetch(endpoint, { method: 'DELETE' });
            if (!res.ok) throw new Error((await res.json()).error);
            return res.json();
        }
    };

    const showMessage = (text, type = 'success') => {
        const el = document.createElement('div');
        el.className = `message ${type}`;
        el.textContent = text;
        document.body.appendChild(el);
        setTimeout(() => el.classList.add('show'), 10);
        setTimeout(() => {
            el.classList.remove('show');
            setTimeout(() => el.remove(), 300);
        }, 3000);
    };

    const createModal = (title, content, footerButtons) => {
        const modalId = `modal-${Date.now()}`;
        const modalHTML = `
            <div class="modal-backdrop" id="${modalId}-backdrop">
                <div class="modal" id="${modalId}">
                    <div class="modal-header">
                        <h2>${title}</h2>
                        <button class="close-btn">&times;</button>
                    </div>
                    <div class="modal-body">
                        ${content}
                    </div>
                    <div class="modal-footer">
                        ${footerButtons.map(btn => `<button id="${btn.id}" class="btn ${btn.class || ''}">${btn.text}</button>`).join('')}
                    </div>
                </div>
            </div>
        `;
        document.getElementById('modal-container').innerHTML = modalHTML;
        
        const backdrop = document.getElementById(`${modalId}-backdrop`);
        backdrop.querySelector('.close-btn').onclick = () => closeModal(backdrop);
        
        setTimeout(() => backdrop.classList.add('show'), 10);
        
        return document.getElementById(modalId);
    };

    const closeModal = (backdrop) => {
        if (!backdrop) backdrop = document.querySelector('.modal-backdrop');
        if (backdrop) {
            backdrop.classList.remove('show');
            setTimeout(() => backdrop.remove(), 300);
        }
    };
    
    // --- Page Rendering ---
    const renderers = {
        dashboard: async () => {
            pageTitle.textContent = 'ダッシュボード';
            const settings = await api.get('/api/settings/guilds');
            
            pageContent.innerHTML = `
                <div class="grid-container">
                    <div class="card stat-card">
                        <div class="stat-icon">👥</div>
                        <div class="stat-info">
                            <div class="stat-value">${guildInfo.memberCount.toLocaleString()}</div>
                            <div class="stat-label">メンバー数</div>
                        </div>
                    </div>
                    <div class="card stat-card">
                        <div class="stat-icon">🤖</div>
                        <div class="stat-info">
                            <div class="stat-value">${guildInfo.botCount.toLocaleString()}</div>
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
                </div>
            `;
        },
        welcome: async () => {
            pageTitle.textContent = 'ウェルカム設定';
            const settings = await api.get('/api/settings/guilds');
            settingsCache['guilds'] = settings;
            
            const createSelect = (id, options, selected) => `
                <select id="${id}">
                    <option value="">未設定</option>
                    ${options.map(o => `<option value="${o.id}" ${o.id === selected ? 'selected' : ''}>${o.name}</option>`).join('')}
                </select>`;
            
            pageContent.innerHTML = `
                <form id="welcome-form">
                    <div class="card">
                        <div class="card-header"><h3>チャンネル設定</h3></div>
                        <div class="grid-container">
                            <div class="form-group">
                                <label for="welcomeChannelId">ウェルカムチャンネル</label>
                                ${createSelect('welcomeChannelId', guildInfo.channels.filter(c => c.type === 0), settings.welcomeChannelId)}
                            </div>
                            <div class="form-group">
                                <label for="goodbyeChannelId">お別れチャンネル</label>
                                ${createSelect('goodbyeChannelId', guildInfo.channels.filter(c => c.type === 0), settings.goodbyeChannelId)}
                            </div>
                             <div class="form-group">
                                <label for="rulesChannelId">ルールチャンネル</label>
                                ${createSelect('rulesChannelId', guildInfo.channels.filter(c => c.type === 0), settings.rulesChannelId)}
                            </div>
                        </div>
                    </div>
                    <div class="card">
                        <div class="card-header"><h3>機能設定</h3></div>
                         <div class="form-group">
                            <label for="welcomeRoleId">ウェルカムロール</label>
                            ${createSelect('welcomeRoleId', guildInfo.roles, settings.welcomeRoleId)}
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
                </form>
            `;
            document.getElementById('welcome-form').addEventListener('submit', handleFormSubmit);
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
                </div>
            `;
            
            await renderRoleboardList();

            document.getElementById('add-roleboard-btn').addEventListener('click', showAddRoleboardModal);
        },
        automod: async() => {
             pageTitle.textContent = 'オートモッド設定';
             const settings = await api.get('/api/settings/guild_settings');
             settingsCache['guild_settings'] = settings;
             const automod = settings.automod || {};

             pageContent.innerHTML = `
                <form id="automod-form">
                    <div class="card">
                        <div class="card-header"><h3>NGワードフィルター</h3></div>
                        <div class="form-group">
                            <label for="ngWords">NGワード (カンマ区切り)</label>
                            <textarea id="ngWords" name="ngWords" rows="4">${(automod.ngWords || []).join(',')}</textarea>
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
                </form>
             `;
             document.getElementById('automod-form').addEventListener('submit', handleFormSubmit);
        },
        logging: async () => {
            pageTitle.textContent = 'ログ設定';
            const settings = await api.get('/api/settings/guild_settings');
            settingsCache['guild_settings'] = settings;

            const createSelect = (id, options, selected) => `
                <select id="${id}">
                    <option value="">未設定</option>
                    ${options.map(o => `<option value="${o.id}" ${o.id === selected ? 'selected' : ''}>#${o.name}</option>`).join('')}
                </select>`;

            pageContent.innerHTML = `
                 <form id="logging-form">
                    <div class="card">
                        <div class="card-header"><h3>監査ログ</h3></div>
                        <div class="form-group">
                            <label for="auditLogChannel">監査ログチャンネル</label>
                            ${createSelect('auditLogChannel', guildInfo.channels.filter(c => c.type === 0), settings.auditLogChannel)}
                        </div>
                    </div>
                     <button type="submit" class="btn">設定を保存</button>
                </form>
            `;
            document.getElementById('logging-form').addEventListener('submit', handleFormSubmit);
        },
        leveling: async () => {
            pageTitle.textContent = 'レベリング設定';
            const settings = await api.get('/api/settings/guild_settings');
            settingsCache['guild_settings'] = settings;
             const createSelect = (id, options, selected) => `
                <select id="${id}">
                    <option value="">未設定 (レベルアップしたチャンネルに通知)</option>
                    ${options.map(o => `<option value="${o.id}" ${o.id === selected ? 'selected' : ''}>#${o.name}</option>`).join('')}
                </select>`;
            pageContent.innerHTML = `
                <form id="leveling-form">
                    <div class="card">
                        <div class="card-header"><h3>レベルアップ通知</h3></div>
                        <div class="form-group">
                            <label for="levelUpChannel">通知チャンネル</label>
                            ${createSelect('levelUpChannel', guildInfo.channels.filter(c => c.type === 0), settings.levelUpChannel)}
                            <p style="font-size: 0.9em; color: var(--text-muted-color); margin-top: 10px;">
                                設定しない場合、ユーザーがレベルアップしたチャンネルに直接通知が送信されます。
                            </p>
                        </div>
                    </div>
                     <button type="submit" class="btn">設定を保存</button>
                </form>
            `;
             document.getElementById('leveling-form').addEventListener('submit', handleFormSubmit);
        }
    };
    
    const renderRoleboardList = async () => {
        const listEl = document.getElementById('roleboard-list');
        const boards = await api.get('/api/roleboards');
        if (boards.length === 0) {
            listEl.innerHTML = '<p>まだロールボードが作成されていません。</p>';
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
            </div>
        `).join('');

        listEl.querySelectorAll('.edit-roleboard-btn').forEach(btn => btn.onclick = (e) => showEditRoleboardModal(e.target.dataset.id));
        listEl.querySelectorAll('.delete-roleboard-btn').forEach(btn => btn.onclick = (e) => confirmDeleteRoleboard(e.target.dataset.id));
    };


    // --- Modal Handlers ---
    const showAddRoleboardModal = () => {
        const content = `
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
            </div>
        `;
        const modal = createModal('新しいロールボードを作成', content, [{id: 'save-new-board', text: '作成', class: 'btn'}]);
        
        const colorPicker = modal.querySelector('#modal-color-picker');
        const colorText = modal.querySelector('#modal-color-text');
        colorPicker.oninput = () => colorText.value = colorPicker.value;
        colorText.oninput = () => colorPicker.value = colorText.value;

        document.getElementById('save-new-board').onclick = async () => {
            const title = modal.querySelector('#modal-title').value;
            if (!title) return showMessage('タイトルは必須です。', 'error');
            
            try {
                await api.post('/api/roleboards', {
                    title,
                    description: modal.querySelector('#modal-description').value,
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
        const board = (await api.get('/api/roleboards')).find(b => b.id === boardId);
        if (!board) return showMessage('ボードが見つかりません', 'error');

        const roleOptions = guildInfo.roles.map(r => `<option value="${r.id}">${r.name}</option>`).join('');

        const content = `
            <div class="grid-container" style="align-items: flex-end;">
                 <div class="form-group" style="flex-grow: 1;">
                    <label>タイトル</label> <input type="text" id="edit-title" value="${board.title}">
                </div>
                <div class="form-group">
                    <label>色</label> 
                    <div class="color-input-wrapper">
                        <input type="color" id="edit-color-picker" value="#${(board.color || 0).toString(16).padStart(6, '0')}">
                        <input type="text" id="edit-color-text" value="#${(board.color || 0).toString(16).padStart(6, '0')}">
                    </div>
                </div>
            </div>
             <div class="form-group">
                <label>説明</label> <textarea id="edit-desc">${board.description}</textarea>
            </div>
            <hr style="border-color: var(--border-color); margin: 20px 0;">
            <h4>ロール管理</h4>
            <div id="modal-role-list"></div>
            <div class="form-group" style="margin-top: 20px; border-top: 1px solid var(--border-color); padding-top: 20px;">
                <label>ロールを追加</label>
                <div style="display: flex; gap: 10px; align-items: flex-end;">
                    <select id="add-role-select" style="flex: 2;">${roleOptions}</select>
                    <input type="text" id="add-role-genre" placeholder="ジャンル" style="flex: 1;">
                    <button id="add-role-btn" class="btn">追加</button>
                </div>
            </div>
        `;

        const modal = createModal('ロールボードを編集', content, [{id: 'save-board-changes', text: '保存', class: 'btn'}]);
        
        const colorPicker = modal.querySelector('#edit-color-picker');
        const colorText = modal.querySelector('#edit-color-text');
        colorPicker.oninput = () => colorText.value = colorPicker.value;
        colorText.oninput = () => colorPicker.value = colorText.value;

        await renderRoleListInModal(board.roles || {});
        
        modal.querySelector('#add-role-btn').onclick = async () => {
            const roleId = modal.querySelector('#add-role-select').value;
            const genre = modal.querySelector('#add-role-genre').value;
            const role = guildInfo.roles.find(r => r.id === roleId);

            if (!roleId || !genre || !role) return showMessage('ロールとジャンルを選択・入力してください', 'error');

            board.roles = board.roles || {};
            if (board.roles[roleId]) return showMessage('このロールは既に追加されています。', 'warning');

            board.roles[roleId] = { name: role.name, genre, emoji: null };
            
            board.genres = board.genres || {};
            if (!board.genres[genre]) board.genres[genre] = [];
            if (!board.genres[genre].includes(roleId)) board.genres[genre].push(roleId);

            await renderRoleListInModal(board.roles);
            modal.querySelector('#add-role-genre').value = '';
        };

        modal.querySelector('#modal-role-list').addEventListener('click', e => {
            if (e.target.classList.contains('remove-role-btn')) {
                const roleItem = e.target.closest('.role-item');
                const roleId = roleItem.dataset.id;
                const roleGenre = board.roles[roleId].genre;

                delete board.roles[roleId];
                if (board.genres && board.genres[roleGenre]) {
                    board.genres[roleGenre] = board.genres[roleGenre].filter(id => id !== roleId);
                    if (board.genres[roleGenre].length === 0) delete board.genres[roleGenre];
                }
                roleItem.remove();
            }
        });
        
        document.getElementById('save-board-changes').onclick = async () => {
             try {
                await api.put(`/api/roleboards/${boardId}`, {
                    title: modal.querySelector('#edit-title').value,
                    description: modal.querySelector('#edit-desc').value,
                    color: parseInt(colorText.value.replace('#', ''), 16),
                    roles: board.roles,
                    genres: board.genres
                });
                showMessage('ロールボードを更新しました。');
                closeModal();
                await renderRoleboardList();
            } catch (error) {
                showMessage(`更新エラー: ${error.message}`, 'error');
            }
        };
    };
    
    const renderRoleListInModal = (roles) => {
        const listEl = document.getElementById('modal-role-list');
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
                <div class="role-actions">
                    <button class="btn btn-danger btn-small remove-role-btn">&times;</button>
                </div>
            </div>
        `).join('');
    };

    const confirmDeleteRoleboard = (boardId) => {
         const content = `<p>本当にこのロールボードを削除しますか？この操作は取り消せません。</p>`;
         createModal('削除の確認', content, [
            {id: 'cancel-delete', text: 'キャンセル', class: 'btn-secondary'},
            {id: 'confirm-delete', text: '削除', class: 'btn-danger'}
         ]);
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

    // --- Event Handlers & Routing ---
    const handleFormSubmit = async (e) => {
        e.preventDefault();
        const form = e.target;
        const page = new URL(location.href).hash.substring(1);
        let settings;
        let collection;

        switch(page) {
            case 'welcome':
                collection = 'guilds';
                settings = {
                    ...settingsCache[collection],
                    welcomeChannelId: form.querySelector('#welcomeChannelId').value || null,
                    goodbyeChannelId: form.querySelector('#goodbyeChannelId').value || null,
                    rulesChannelId: form.querySelector('#rulesChannelId').value || null,
                    welcomeRoleId: form.querySelector('#welcomeRoleId').value || null,
                    mentionOnWelcome: form.querySelector('#mentionOnWelcome').checked,
                    sendGoodbyeDM: form.querySelector('#sendGoodbyeDM').checked,
                };
                break;
            case 'automod':
                 collection = 'guild_settings';
                 settings = {
                     ...settingsCache[collection],
                     automod: {
                        ngWords: form.querySelector('#ngWords').value.split(',').map(w => w.trim()).filter(Boolean),
                        blockInvites: form.querySelector('#blockInvites').checked
                     }
                 };
                 break;
            case 'logging':
                collection = 'guild_settings';
                settings = {
                    ...settingsCache[collection],
                    auditLogChannel: form.querySelector('#auditLogChannel').value || null
                };
                break;
            case 'leveling':
                 collection = 'guild_settings';
                 settings = {
                     ...settingsCache[collection],
                     levelUpChannel: form.querySelector('#levelUpChannel').value || null
                 };
                 break;
            default:
                return;
        }

        try {
            await api.post(`/api/settings/${collection}`, settings);
            showMessage('設定を保存しました。');
            settingsCache[collection] = settings; // キャッシュ更新
        } catch (error) {
            showMessage(`保存エラー: ${error.message}`, 'error');
        }
    };
    
    const navigate = async () => {
        const page = window.location.hash.substring(1) || 'dashboard';
        navItems.forEach(item => {
            item.classList.toggle('active', item.dataset.page === page);
        });
        
        pageContent.innerHTML = '<div class="loader-ring" style="margin: 40px auto;"></div>'; // Show loading spinner
        
        if (renderers[page]) {
            try {
                await renderers[page]();
            } catch(error) {
                pageContent.innerHTML = `<p class="message error">ページの読み込みに失敗しました: ${error.message}</p>`;
            }
        } else {
            pageContent.innerHTML = `<p class="message error">ページが見つかりません。</p>`;
        }
    };
    
    // --- Initialization ---
    const init = async () => {
        try {
            guildInfo = await api.get('/api/guild-info');

            document.getElementById('server-icon').src = guildInfo.icon || '';
            document.getElementById('server-name').textContent = guildInfo.name;
            
            loader.style.display = 'none';
            dashboardWrapper.style.display = 'flex';
            
            window.addEventListener('hashchange', navigate);
            await navigate();

            logoutBtn.addEventListener('click', async () => {
                await api.post('/api/logout', {});
                window.location.href = '/login';
            });

        } catch (error) {
            console.error('Initialization failed:', error);
            // 401エラーの場合はapi.get内でリダイレクトされる
            loader.innerHTML = `<p class="message error">ダッシュボードの読み込みに失敗しました。再ログインしてください。</p><a href="/login" class="btn">ログインページへ</a>`;
        }
    };

    init();
});