document.addEventListener('DOMContentLoaded', async () => {
    // DOM elements
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
    let isDirty = false;
    let currentChart = null;

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
                console.error(`API request error on ${endpoint}:`, err);
                showMessage(`Error: ${err.message}`, 'error');
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

    const showMessage = (text, type = 'success') => {
        const el = document.createElement('div');
        el.className = `message-toast ${type}`;
        el.textContent = text;
        document.body.appendChild(el);
        setTimeout(() => el.classList.add('show'), 10);
        setTimeout(() => {
            el.classList.remove('show');
            setTimeout(() => el.remove(), 300);
        }, 3200);
    };

    // Modal creation function
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

    // Modal close function
    const closeModal = () => {
        const backdrop = document.querySelector('.modal-backdrop');
        if (backdrop) {
            backdrop.classList.remove('show');
            setTimeout(() => backdrop.remove(), 300);
        }
    };

    // Tom Select initialization
    const initializeTomSelect = (selector, options = {}) => {
        const elements = typeof selector === 'string' ? document.querySelectorAll(selector) : [selector];
        elements.forEach(el => {
            if (el && el.tomselect) {
                el.tomselect.destroy();
            }
            if (el) {
                const select = new TomSelect(el, {
                    create: false,
                    allowEmptyOption: true,
                    placeholder: el.getAttribute('placeholder') || 'Select...',
                    dropdownParent: 'body',
                    onDropdownOpen: function ($dropdown) {
                        const control = this.control;
                        const controlRect = control.getBoundingClientRect();

                        // ドロップダウンをbodyに直接配置
                        $dropdown.style.position = 'fixed';
                        $dropdown.style.zIndex = '9999';

                        // コントロールの幅に合わせる（最小幅は200px）
                        let width = Math.max(controlRect.width, 200);
                        $dropdown.style.width = width + 'px';
                        $dropdown.style.minWidth = '200px';

                        // 縦位置の計算
                        const dropdownHeight = Math.min($dropdown.scrollHeight, 300);
                        const spaceBelow = window.innerHeight - controlRect.bottom;
                        const spaceAbove = controlRect.top;

                        if (spaceBelow >= dropdownHeight + 4) {
                            // 下に表示
                            $dropdown.style.top = (controlRect.bottom + 4) + 'px';
                            $dropdown.style.bottom = 'auto';
                            $dropdown.style.maxHeight = Math.min(300, spaceBelow - 8) + 'px';
                        } else if (spaceAbove >= dropdownHeight + 4) {
                            // 上に表示
                            $dropdown.style.bottom = (window.innerHeight - controlRect.top + 4) + 'px';
                            $dropdown.style.top = 'auto';
                            $dropdown.style.maxHeight = Math.min(300, spaceAbove - 8) + 'px';
                        } else {
                            // スペースが足りない場合は下に表示して高さを調整
                            $dropdown.style.top = (controlRect.bottom + 4) + 'px';
                            $dropdown.style.bottom = 'auto';
                            $dropdown.style.maxHeight = (spaceBelow - 8) + 'px';
                        }

                        // 横位置の調整（左端に合わせる）
                        let left = controlRect.left;

                        // 右端がはみ出す場合の調整
                        if (left + width > window.innerWidth - 8) {
                            left = window.innerWidth - width - 8;
                        }

                        // 左端がはみ出す場合の調整
                        if (left < 8) {
                            left = 8;
                        }

                        $dropdown.style.left = left + 'px';
                    },
                    ...options
                });

                // グローバルクリックイベントの設定
                document.addEventListener('click', (e) => {
                    const dropdown = select.dropdown;
                    if (dropdown && !select.control.contains(e.target) && !dropdown.contains(e.target)) {
                        select.close();
                    }
                });
            }
        });
    };

    const trackChanges = (formSelector) => {
        const form = document.querySelector(formSelector);
        if (form) {
            const setDirty = () => {
                isDirty = true;
                console.log('Changes detected, isDirty set to true.');
            };
            form.addEventListener('input', setDirty);
            form.addEventListener('change', setDirty);
        }
    };

    const resetDirtyState = () => {
        isDirty = false;
        console.log('isDirty reset to false.');
    };

    // --- Dashboard Application Module ---
    const escapeHTML = (str) => {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    };

    const App = {
        state: {
            currentPage: 'dashboard',
            isInitialLoad: true
        },

        init: async () => {
            try {
                guildInfo = await api.get('/api/guild-info');
                document.getElementById('server-icon').src = guildInfo.icon || 'https://cdn.discordapp.com/embed/avatars/0.png';
                document.getElementById('server-name').textContent = guildInfo.name;

                loader.style.display = 'none';
                dashboardWrapper.style.display = 'flex';

                window.addEventListener('hashchange', App.handleRoute, false);
                await App.handleRoute();

                App.bindGlobalEvents();
            } catch (error) {
                console.error('App init error:', error);
                loader.innerHTML = `<p class="message error" style="background-color: var(--error); color: white; padding: 15px; border-radius: var(--radius-md); text-align: center;">情報の読み込みに失敗しました。再ログインしてください。</p><a href="/login" class="btn" style="margin-top:20px;">ログインページへ</a>`;
            }
        },

        handleRoute: async (event) => {
            const proceed = async () => {
                resetDirtyState();
                if (window.innerWidth <= 768) {
                    sidebar.classList.remove('is-open');
                }

                const page = window.location.hash.substring(1) || 'dashboard';
                App.state.currentPage = page;

                navItems.forEach(item => item.classList.toggle('active', item.dataset.page === page));
                pageContent.innerHTML = '<div class="loader-ring" style="margin: 40px auto;"></div>';

                if (App.renderers[page]) {
                    try {
                        await App.renderers[page]();
                    } catch (error) {
                        console.error(`Render error on ${page}:`, error);
                        pageContent.innerHTML = `<p class="message error show" style="background-color: var(--error); color: white; padding: 15px; border-radius: var(--radius-md); text-align: center;">ページの読み込みに失敗しました: ${error.message}</p>`;
                    }
                } else {
                    pageContent.innerHTML = `<p class="message error show" style="background-color: var(--error); color: white; padding: 15px; border-radius: var(--radius-md); text-align: center;">ページが見つかりません。</p>`;
                }

                feather.replace();
                window.scrollTo(0, 0);
            };

            if (isDirty) {
                if (event && event.type === 'hashchange') {
                    event.preventDefault();
                    const oldHash = event.oldURL.split('#')[1] || 'dashboard';
                    history.pushState(null, null, `#${oldHash}`);
                }

                createModal('未保存の変更があります',
                    '<p>ページを移動すると、保存されていない変更は失われます。本当に移動しますか？</p>',
                    [
                        { id: 'cancel-nav', text: 'キャンセル', class: 'btn-secondary' },
                        { id: 'confirm-nav', text: '移動する', class: 'btn-danger' }
                    ]
                );
                document.getElementById('cancel-nav').onclick = closeModal;
                document.getElementById('confirm-nav').onclick = () => {
                    closeModal();
                    if (event) {
                        const newHash = new URL(event.newURL).hash;
                        window.location.hash = newHash;
                    }
                    proceed();
                };
            } else {
                proceed();
            }
        },

        bindGlobalEvents: () => {
            logoutBtn.addEventListener('click', () => {
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
                        isDirty = false;
                        await api.post('/api/logout');
                        window.location.href = '/login';
                    } catch (err) {
                        showMessage('ログアウトに失敗しました', 'error');
                    }
                };
            });

            menuToggle.addEventListener('click', () => {
                sidebar.classList.toggle('is-open');
            });

            window.addEventListener('beforeunload', (e) => {
                if (isDirty) {
                    e.preventDefault();
                    e.returnValue = '';
                    return '';
                }
            });
        },

        renderers: {
            dashboard: async () => {
                pageTitle.textContent = 'ダッシュボード';
                pageContent.innerHTML = '<div class="loader-ring" style="margin: 40px auto;"></div>';
                const [settings, trends] = await Promise.all([
                    api.get('/api/settings/guilds'),
                    api.get('/api/analytics/trends')
                ]);

                const recentLogs = await api.get('/api/audit-logs?limit=5');

                pageContent.innerHTML = `
                <div class="grid-container" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));">
                    <div class="stat-card">
                        <div class="stat-icon"><i data-feather="users"></i></div>
                        <div class="stat-info">
                            <div class="stat-value text-primary">${(guildInfo.memberCount || 0).toLocaleString()}</div>
                            <div class="stat-label">メンバー</div>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon" style="background:rgba(124,77,255,0.1);color:#bc8cff;"><i data-feather="cpu"></i></div>
                        <div class="stat-info">
                            <div class="stat-value text-secondary">${(guildInfo.botCount || 0).toLocaleString()}</div>
                            <div class="stat-label">ボット</div>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon" style="background:rgba(0,230,118,0.1);color:var(--success);"><i data-feather="user-plus"></i></div>
                        <div class="stat-info">
                            <div class="stat-value text-success">${(settings.statistics?.totalJoins || 0).toLocaleString()}</div>
                            <div class="stat-label">合計参加数</div>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon" style="background:rgba(255,77,106,0.1);color:var(--error);"><i data-feather="user-minus"></i></div>
                        <div class="stat-info">
                            <div class="stat-value text-danger">${(settings.statistics?.totalLeaves || 0).toLocaleString()}</div>
                            <div class="stat-label">合計退出数</div>
                        </div>
                    </div>
                </div>

                <div class="grid-container" style="grid-template-columns: 2fr 1fr; margin-top: 24px; gap: 24px;">
                    <div class="card">
                        <div class="card-header"><h3>サーバー成長トレンド</h3></div>
                        <div style="height: 300px; position: relative; padding: 10px;">
                            <canvas id="trendChart"></canvas>
                        </div>
                    </div>
                    <div class="card">
                        <div class="card-header"><h3>クイックメニュー</h3></div>
                        <div style="display: flex; flex-direction: column; gap: 12px; padding: 5px;">
                            <a href="#announcements" class="btn btn-secondary btn-small w-full text-left justify-start"><i data-feather="bell" style="width:16px;"></i> お知らせ設定</a>
                            <a href="#tickets" class="btn btn-secondary btn-small w-full text-left justify-start"><i data-feather="life-buoy" style="width:16px;"></i> チケット管理</a>
                            <a href="#commands" class="btn btn-secondary btn-small w-full text-left justify-start"><i data-feather="settings" style="width:16px;"></i> コマンド設定</a>
                            <a href="#members" class="btn btn-secondary btn-small w-full text-left justify-start"><i data-feather="users" style="width:16px;"></i> メンバーリスト</a>
                        </div>
                    </div>
                </div>

                <div class="card" style="margin-top: 24px;">
                    <div class="card-header"><h3>最新の監査ログ</h3></div>
                    <div class="table-container" style="background: transparent; border: none;">
                        <table class="styled-table">
                            <thead>
                                <tr style="background: rgba(0,0,0,0.1);">
                                    <th>日時</th>
                                    <th>アクション</th>
                                    <th>ユーザー</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${recentLogs.logs.slice(0, 5).map(log => `
                                    <tr style="border-bottom: 1px solid rgba(255,255,255,0.03);">
                                        <td style="color: var(--text-secondary); font-size: 0.9em;">${new Date(log.timestamp.seconds * 1000).toLocaleString()}</td>
                                        <td style="font-weight: 500;">${escapeHTML(log.eventType)}</td>
                                        <td style="color: var(--accent);">${escapeHTML(log.executorTag || 'System')}</td>
                                    </tr>
                                `).join('') || '<tr><td colspan="3" style="text-align:center;">表示可能なログはありません。</td></tr>'}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;

                feather.replace();

                // Render Trend Chart
                const ctx = document.getElementById('trendChart').getContext('2d');
                const dates = Object.keys(trends);
                new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: dates,
                        datasets: [
                            {
                                label: '参加者',
                                data: dates.map(d => trends[d].joins),
                                borderColor: '#00e676',
                                borderWidth: 2,
                                pointRadius: 3,
                                pointBackgroundColor: '#00e676',
                                tension: 0.4,
                                fill: true,
                                backgroundColor: 'rgba(0, 230, 118, 0.06)'
                            },
                            {
                                label: '退出者',
                                data: dates.map(d => trends[d].leaves),
                                borderColor: '#ff4d6a',
                                borderWidth: 2,
                                pointRadius: 3,
                                pointBackgroundColor: '#ff4d6a',
                                tension: 0.4,
                                fill: true,
                                backgroundColor: 'rgba(255, 77, 106, 0.06)'
                            }
                        ]
                    },
                    options: {
                        maintainAspectRatio: false,
                        responsive: true,
                        plugins: {
                            legend: {
                                display: true,
                                position: 'top',
                                labels: { color: 'rgba(160,168,204,0.85)', boxWidth: 10, usePointStyle: true, font: { size: 11 } }
                            }
                        },
                        scales: {
                            x: {
                                ticks: { color: 'rgba(93,100,144,0.9)', maxRotation: 0, font: { size: 10 } },
                                grid: { color: 'rgba(255,255,255,0.03)', drawBorder: false }
                            },
                            y: {
                                ticks: { color: 'rgba(93,100,144,0.9)', font: { size: 10 } },
                                grid: { color: 'rgba(255,255,255,0.04)', drawBorder: false },
                                beginAtZero: true
                            }
                        }
                    }
                });
            },

            // =====【ここから変更】=====
            members: async () => {
                pageTitle.textContent = 'メンバー管理';
                pageContent.innerHTML = `
                <div class="card">
                    <div class="card-header"><h3>サーバーメンバー</h3></div>
                    <div class="filter-bar" style="border:none; background: rgba(255,255,255,0.02); margin-bottom: 24px;">
                        <div class="form-group">
                             <label for="member-search">検索</label>
                            <input type="text" id="member-search" placeholder="名前やユーザーID...">
                        </div>
                        <div class="form-group">
                             <label for="role-filter">ロール絞り込み</label>
                            <select id="role-filter" placeholder="すべてのロール">
                                <option value="">すべてのロール</option>
                                ${guildInfo.roles.map(r => `<option value="${r.id}">${r.name}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                    <div class="table-container" style="background: transparent; border: none;">
                        <table class="styled-table">
                            <thead>
                                <tr style="background: rgba(0,0,0,0.1);">
                                    <th data-sort="displayName">ユーザー <span class="sort-indicator"></span></th>
                                    <th>ロール</th>
                                    <th data-sort="joinedAt">参加日 <span class="sort-indicator"></span></th>
                                    <th data-sort="messageCount">統計 <span class="sort-indicator"></span></th>
                                    <th>操作</th>
                                </tr>
                            </thead>
                            <tbody id="members-table-body"></tbody>
                        </table>
                    </div>
                    <div class="pagination-controls" style="border:none; background: rgba(255,255,255,0.02); margin-top: 24px;">
                        <button id="prev-page" class="btn btn-secondary btn-small" disabled>前</button>
                        <span id="page-info" class="page-info"></span>
                        <button id="next-page" class="btn btn-secondary btn-small" disabled>次</button>
                    </div>
                </div>`;
                initializeTomSelect('#role-filter');

                let currentPage = 1;
                let currentSort = { by: 'displayName', order: 'asc' };

                const fetchAndRenderMembers = async () => {
                    const search = document.getElementById('member-search').value;
                    const roleFilter = document.getElementById('role-filter').value;
                    document.getElementById('members-table-body').innerHTML = '<tr><td colspan="5" style="text-align:center;"><div class="loader-ring"></div></td></tr>';

                    const data = await api.get(`/api/members?page=${currentPage}&search=${search}&sortBy=${currentSort.by}&sortOrder=${currentSort.order}&roleFilter=${roleFilter}`);
                    const { members, totalPages } = data;

                    const tableBody = document.getElementById('members-table-body');
                    if (members.length === 0) {
                        tableBody.innerHTML = '<tr><td colspan="5" style="text-align:center;">メンバーが見つかりません。</td></tr>';
                    } else {
                        tableBody.innerHTML = members.map(member => `
                        <tr data-member-id="${member.id}">
                            <td>
                                <div class="user-cell">
                                    <img src="${member.avatar}" alt="avatar">
                                    <div class="user-details">
                                        <span class="display-name">${escapeHTML(member.displayName)}</span>
                                        <span class="username">${escapeHTML(member.username)}</span>
                                    </div>
                                </div>
                            </td>
                            <td>${member.roles.map(r => `<span class="role-tag" style="border-left: 3px solid ${r.color};">${escapeHTML(r.name)}</span>`).join('')}</td>
                            <td>${new Date(member.joinedAt).toLocaleDateString()}</td>
                            <td>
                                <div><i data-feather="message-square" style="width:1em;height:1em;"></i> ${member.messageCount.toLocaleString()}</div>
                                <div><i data-feather="alert-triangle" style="width:1em;height:1em;"></i> ${member.warnCount}</div>
                            </td>
                            <td class="actions-cell">
                                <button class="btn btn-secondary btn-small manage-roles-btn"><i data-feather="shield"></i></button>
                                <button class="btn btn-danger btn-small kick-btn"><i data-feather="user-x"></i></button>
                                <button class="btn btn-danger btn-small ban-btn"><i data-feather="x-octagon"></i></button>
                            </td>
                        </tr>
                    `).join('');
                    }
                    feather.replace();
                    addMemberActionListeners();

                    document.getElementById('page-info').textContent = `Page ${currentPage} of ${totalPages}`;
                    document.getElementById('prev-page').disabled = currentPage <= 1;
                    document.getElementById('next-page').disabled = currentPage >= totalPages;
                };

                document.getElementById('prev-page').onclick = () => { if (currentPage > 1) { currentPage--; fetchAndRenderMembers(); } };
                document.getElementById('next-page').onclick = () => { currentPage++; fetchAndRenderMembers(); };
                document.getElementById('member-search').oninput = () => { currentPage = 1; fetchAndRenderMembers(); };
                document.getElementById('role-filter').onchange = () => { currentPage = 1; fetchAndRenderMembers(); };

                document.querySelectorAll('.styled-table thead th[data-sort]').forEach(th => {
                    th.onclick = () => {
                        const sortBy = th.dataset.sort;
                        if (currentSort.by === sortBy) {
                            currentSort.order = currentSort.order === 'asc' ? 'desc' : 'asc';
                        } else {
                            currentSort.by = sortBy;
                            currentSort.order = 'asc';
                        }
                        fetchAndRenderMembers();
                    };
                });
                fetchAndRenderMembers();
            },

            auditLog: async () => {
                pageTitle.textContent = '監査ログ';
                const formatLogDetails = (log) => {
                    const { eventType, details } = log;
                    let content = '';
                    switch (eventType) {
                        case 'MessageDelete':
                            content = `<strong>チャンネル:</strong> <#${details.channelId}>\n<div class="log-content">${details.content}</div>`;
                            break;
                        case 'MessageUpdate':
                            content = `<strong>チャンネル:</strong> <#${details.channelId}>\n<strong>変更前:</strong><div class="log-content">${details.before}</div><strong>変更後:</strong><div class="log-content">${details.after}</div>`;
                            break;
                        case 'NicknameUpdate':
                            content = `<strong>変更前:</strong> ${details.before}\n<strong>変更後:</strong> ${details.after}`;
                            break;
                        case 'RoleAdd':
                        case 'RoleRemove':
                            content = `<strong>ロール:</strong> ${details.roleName}`;
                            break;
                        default:
                            content = `<pre>${JSON.stringify(details, null, 2)}</pre>`;
                    }
                    return `<div class="log-details">${content}</div>`;
                };

                pageContent.innerHTML = `
                <div class="card">
                    <div class="card-header"><h3>操作履歴</h3></div>
                     <div class="filter-bar" style="border:none; background: rgba(255,255,255,0.02); margin-bottom: 24px;">
                         <div class="form-group">
                            <input type="text" id="log-user-search" placeholder="ユーザー名やタグ...">
                        </div>
                        <div class="form-group">
                            <select id="log-type-filter">
                                <option value="">すべてのアクション</option>
                                <option value="MessageDelete">メッセージ削除</option>
                                <option value="MessageUpdate">メッセージ編集</option>
                                <option value="NicknameUpdate">ニックネーム変更</option>
                                <option value="RoleAdd">ロール付与</option>
                                <option value="RoleRemove">ロール剥奪</option>
                            </select>
                        </div>
                    </div>
                     <div class="table-container" style="background: transparent; border: none;">
                        <table class="styled-table">
                            <thead>
                                <tr style="background: rgba(0,0,0,0.1);">
                                    <th>日時</th>
                                    <th>アクション</th>
                                    <th>実行者</th>
                                    <th>対象</th>
                                    <th>詳細</th>
                                </tr>
                            </thead>
                            <tbody id="logs-table-body"></tbody>
                        </table>
                    </div>
                    <div class="pagination-controls" style="border:none; background: rgba(255,255,255,0.02); margin-top: 24px;">
                        <button id="prev-page" class="btn btn-secondary btn-small" disabled>前</button>
                        <span id="page-info" class="page-info"></span>
                        <button id="next-page" class="btn btn-secondary btn-small" disabled>次</button>
                    </div>
                </div>`;
                initializeTomSelect('#log-type-filter');

                let currentPage = 1;
                const fetchAndRenderLogs = async () => {
                    const user = document.getElementById('log-user-search').value;
                    const eventType = document.getElementById('log-type-filter').value;
                    document.getElementById('logs-table-body').innerHTML = '<tr><td colspan="5" style="text-align:center;"><div class="loader-ring"></div></td></tr>';

                    const data = await api.get(`/api/audit-logs?page=${currentPage}&user=${user}&eventType=${eventType}`);
                    const { logs, totalPages } = data;

                    const tableBody = document.getElementById('logs-table-body');
                    if (logs.length === 0) {
                        tableBody.innerHTML = '<tr><td colspan="5" style="text-align:center;">ログが見つかりません。</td></tr>';
                    } else {
                        tableBody.innerHTML = logs.map(log => `
                        <tr>
                            <td>${new Date(log.timestamp.seconds * 1000).toLocaleString()}</td>
                            <td>${log.eventType}</td>
                            <td>${log.executorTag || 'N/A'}</td>
                            <td>${log.targetTag || 'N/A'}</td>
                            <td>${formatLogDetails(log)}</td>
                        </tr>
                    `).join('');
                    }
                    document.getElementById('page-info').textContent = `Page ${currentPage} of ${totalPages}`;
                    document.getElementById('prev-page').disabled = currentPage <= 1;
                    document.getElementById('next-page').disabled = currentPage >= totalPages;
                };

                document.getElementById('prev-page').onclick = () => { if (currentPage > 1) { currentPage--; fetchAndRenderLogs(); } };
                document.getElementById('next-page').onclick = () => { currentPage++; fetchAndRenderLogs(); };
                document.getElementById('log-user-search').oninput = () => { currentPage = 1; fetchAndRenderLogs(); };
                document.getElementById('log-type-filter').onchange = () => { currentPage = 1; fetchAndRenderLogs(); };
                fetchAndRenderLogs();
            },

            analytics: async () => {
                pageTitle.textContent = 'アナリティクス';
                pageContent.innerHTML = `
                <div class="grid-container" style="grid-template-columns: 2fr 1fr; gap: 30px;">
                    <div class="card">
                        <div class="card-header"><h3>時間帯別アクティビティ</h3></div>
                        <div class="chart-container"><canvas id="activityChart"></canvas></div>
                    </div>
                     <div class="card">
                        <div class="card-header"><h3>ロール分布</h3></div>
                        <div class="chart-container"><canvas id="roleChart"></canvas></div>
                    </div>
                </div>
                 <div class="card">
                    <div class="card-header"><h3>メッセージ数ランキング (TOP 10)</h3></div>
                    <ol id="leaderboard-list" class="leaderboard"></ol>
                </div>`;

                if (currentChart) currentChart.destroy();
                const data = await api.get('/api/analytics/activity');

                // Leaderboard
                const listEl = document.getElementById('leaderboard-list');
                if (data.topUsers.length === 0) {
                    listEl.innerHTML = `<p style="text-align:center; color: var(--text-muted);">まだランキングデータがありません。</p>`;
                } else {
                    listEl.innerHTML = data.topUsers.map((user, i) => `
                    <li>
                        <span class="rank">#${i + 1}</span>
                        <div class="user-info">
                            <div class="user-name">${user.displayName || user.username}</div>
                            <div class="user-id">${user.userId}</div>
                        </div>
                        <span class="stat">${user.messageCount.toLocaleString()} メッセージ</span>
                    </li>`).join('');
                }

                // Activity Chart
                const activityCtx = document.getElementById('activityChart').getContext('2d');
                new Chart(activityCtx, {
                    type: 'bar',
                    data: {
                        labels: Array.from({ length: 24 }, (_, i) => `${i}:00`),
                        datasets: [{
                            label: 'メッセージ数',
                            data: data.activityByHour,
                            backgroundColor: 'rgba(0, 217, 245, 0.45)',
                            borderColor: '#00d9f5',
                            borderWidth: 1,
                            borderRadius: 3
                        }]
                    },
                    options: {
                        maintainAspectRatio: false, scales: {
                            y: { beginAtZero: true, ticks: { color: 'rgba(93,100,144,0.9)', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)', drawBorder: false } },
                            x: { ticks: { color: 'rgba(93,100,144,0.9)', font: { size: 9 } }, grid: { display: false } }
                        }, plugins: { legend: { display: false } }
                    }
                });

                // Role Chart
                const roleCtx = document.getElementById('roleChart').getContext('2d');
                new Chart(roleCtx, {
                    type: 'doughnut',
                    data: {
                        labels: data.roleDistribution.map(r => r.name),
                        datasets: [{
                            label: 'メンバー数',
                            data: data.roleDistribution.map(r => r.count),
                            backgroundColor: data.roleDistribution.map(r => r.color),
                            borderWidth: 2,
                            borderColor: 'rgba(7,11,26,0.8)'
                        }]
                    },
                    options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: 'rgba(160,168,204,0.85)', font: { size: 10 }, boxWidth: 10 } } } }
                });
            },
            // =====【ここまで変更】=====

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
                trackChanges('#announcements-form');
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
                        <div class="form-grid">
                            <div class="form-group">
                                <label>参加時メンション</label>
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
                    </div>
                    <button type="submit" class="btn">設定を保存</button>
                </form>`;
                ['welcomeChannelId', 'goodbyeChannelId', 'rulesChannelId', 'welcomeRoleId'].forEach(id =>
                    initializeTomSelect(`#${id}`, { items: [settings[id]] })
                );
                document.getElementById('welcome-form').addEventListener('submit', handleFormSubmit);
                trackChanges('#welcome-form');
            },

            // =====【ここから変更】=====
            'welcome-message': async () => {
                pageTitle.textContent = 'ウェルカムメッセージ設定';
                const settings = await api.get('/api/settings/welcome-message');
                settingsCache['welcome-message'] = settings;

                const updatePreview = () => {
                    const type = document.getElementById('welcome-type').value;
                    const title = document.getElementById('welcome-title').value;
                    const desc = document.getElementById('welcome-description').value;
                    const imageUrl = document.getElementById('welcome-imageUrl').value;
                    const color = document.getElementById('welcome-color-picker').value;

                    const previewTitle = document.getElementById('preview-title');
                    const previewDesc = document.getElementById('preview-desc');
                    const previewThumb = document.getElementById('preview-thumb');
                    const previewImage = document.getElementById('preview-image');
                    const previewSidebar = document.querySelector('.discord-embed-preview .embed-sidebar');

                    const dummyData = {
                        'user.name': 'TestUser',
                        'user.displayName': 'テストユーザー',
                        'user.mention': '@テストユーザー',
                        'server.name': guildInfo.name,
                        'server.memberCount': guildInfo.memberCount.toLocaleString(),
                        'rulesChannel': '#rules'
                    };

                    const replaceVars = (text) => text.replace(/{(\w+\.\w+)}/g, (match, key) => dummyData[key] || match);

                    if (type === 'gemini') {
                        previewTitle.textContent = 'AIによる自動生成';
                        previewDesc.textContent = 'AIがサーバー名やユーザー名を使って、ユニークな歓迎メッセージを自動で作成します。';
                        previewImage.style.display = 'none';
                    } else {
                        previewTitle.textContent = replaceVars(title);
                        previewDesc.textContent = replaceVars(desc);
                        previewImage.src = imageUrl;
                        previewImage.style.display = imageUrl ? 'block' : 'none';
                    }
                    previewSidebar.style.backgroundColor = color;
                };

                pageContent.innerHTML = `
                <div class="welcome-message-layout">
                    <form id="welcome-message-form">
                        <div class="card">
                            <div class="card-header"><h3>メッセージ設定</h3></div>
                            <div class="form-group">
                                <label>カスタムウェルカムメッセージを有効化</label>
                                <label class="switch"><input type="checkbox" id="welcome-enabled" ${settings.enabled ? 'checked' : ''}><span class="slider"></span></label>
                            </div>
                            <div class="form-group">
                                <label for="welcome-type">メッセージタイプ</label>
                                <select id="welcome-type">
                                    <option value="default" ${settings.type === 'default' ? 'selected' : ''}>カスタム</option>
                                    <option value="gemini" ${settings.type === 'gemini' ? 'selected' : ''}>AI (Gemini) 生成</option>
                                </select>
                            </div>
                        </div>
                        <div id="default-settings">
                            <div class="card">
                                <div class="card-header"><h3>メッセージ内容</h3></div>
                                <div class="form-group">
                                    <label for="welcome-title">タイトル</label>
                                    <input type="text" id="welcome-title" value="${settings.title || ''}">
                                </div>
                                <div class="form-group">
                                    <label for="welcome-description">説明文</label>
                                    <textarea id="welcome-description" rows="6">${settings.description || ''}</textarea>
                                    <p class="form-hint"><b>変数:</b> <code>{user.displayName}</code>, <code>{user.mention}</code>, <code>{server.name}</code>, <code>{server.memberCount}</code>, <code>{rulesChannel}</code></p>
                                </div>
                                <div class="form-grid">
                                    <div class="form-group">
                                        <label for="welcome-imageUrl">画像URL</label>
                                        <input type="text" id="welcome-imageUrl" placeholder="https://..." value="${settings.imageUrl || ''}">
                                    </div>
                                    <div class="form-group">
                                        <label for="modal-color">埋め込みの色</label>
                                        <div class="color-input-wrapper">
                                            <input type="color" id="welcome-color-picker" value="${settings.color || '#00FF00'}">
                                            <input type="text" id="welcome-color-text" value="${settings.color || '#00FF00'}">
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <button type="submit" class="btn">設定を保存</button>
                    </form>
                    <div class="card">
                         <div class="card-header"><h3>リアルタイムプレビュー</h3></div>
                         <div class="discord-embed-preview">
                            <div class="embed-sidebar"></div>
                            <div class="embed-content">
                                <div class="embed-author" style="display:flex; align-items:center; gap:8px;">
                                    <img id="preview-thumb" src="https://cdn.discordapp.com/embed/avatars/0.png" style="width:24px; height:24px; border-radius:50%;">
                                    <span>Overseer Bot</span>
                                </div>
                                <div id="preview-title" class="embed-title"></div>
                                <div id="preview-desc" class="embed-description"></div>
                                <img id="preview-image" src="" class="embed-thumbnail" style="display:none; max-width:100%; border-radius:6px;">
                            </div>
                         </div>
                    </div>
                </div>`;

                initializeTomSelect('#welcome-type');

                const form = document.getElementById('welcome-message-form');
                const toggleSettingsVisibility = () => {
                    document.getElementById('default-settings').style.display = document.getElementById('welcome-type').value === 'default' ? 'block' : 'none';
                    updatePreview();
                };

                form.addEventListener('input', updatePreview);
                form.addEventListener('change', toggleSettingsVisibility);

                const colorPicker = form.querySelector('#welcome-color-picker');
                const colorText = form.querySelector('#welcome-color-text');
                colorPicker.oninput = () => { colorText.value = colorPicker.value.toUpperCase(); updatePreview(); };
                colorText.oninput = () => { if (/^#[0-9A-F]{6}$/i.test(colorText.value)) { colorPicker.value = colorText.value; updatePreview(); } };

                toggleSettingsVisibility();
                document.getElementById('welcome-message-form').addEventListener('submit', handleFormSubmit);
                trackChanges('#welcome-message-form');
            },
            // =====【ここまで変更】=====


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
                trackChanges('#autorole-form');
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
                trackChanges('#automod-form');
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
                trackChanges('#logging-form');
            },

            'vc-log': async () => {
                pageTitle.textContent = 'VCログ設定';
                const settings = await api.get('/api/settings/guild_settings');
                settingsCache['guild_settings'] = settings;
                let mappings = settings.voiceChannelMappings || {};

                // 古い形式（文字列）から新しい形式（オブジェクト）へ自動変換
                Object.keys(mappings).forEach(vcId => {
                    if (typeof mappings[vcId] === 'string') {
                        mappings[vcId] = {
                            textChannelId: mappings[vcId],
                            silent: true,
                            deleteAfter: true
                        };
                    }
                });

                const renderMappings = () => {
                    const listEl = document.getElementById('vc-log-mapping-list');
                    if (Object.keys(mappings).length === 0) {
                        listEl.innerHTML = '<p style="text-align:center; color: var(--text-muted);">まだVCログ設定がありません。</p>';
                        return;
                    }
                    listEl.innerHTML = Object.entries(mappings).map(([vcId, config]) => {
                        const vc = guildInfo.channels.find(c => c.id === vcId);
                        const tc = guildInfo.channels.find(c => c.id === config.textChannelId);
                        if (!vc || !tc) return '';

                        const silent = config.silent !== false;
                        const deleteAfter = config.deleteAfter !== false;

                        return `
                        <div class="vc-log-mapping-item" data-vc-id="${vcId}">
                            <div class="vc-log-mapping-config">
                                <div class="vc-log-mapping-channels">
                                    <div class="channel-name"><i data-feather="mic"></i><span>${vc.name}</span></div>
                                    <i data-feather="arrow-right"></i>
                                    <div class="channel-name"><i data-feather="message-square"></i><span>${tc.name}</span></div>
                                </div>
                                <div class="vc-log-mapping-options">
                                    <label class="checkbox-label">
                                        <input type="checkbox" class="silent-toggle" ${silent ? 'checked' : ''}>
                                        <span>[SILENT] サイレント</span>
                                    </label>
                                    <label class="checkbox-label">
                                        <input type="checkbox" class="delete-toggle" ${deleteAfter ? 'checked' : ''}>
                                        <span>[REMOVE] 自動削除</span>
                                    </label>
                                </div>
                            </div>
                            <button class="btn btn-danger btn-small remove-mapping-btn">&times;</button>
                        </div>
                    `;
                    }).join('');
                    feather.replace();

                    listEl.querySelectorAll('.vc-log-mapping-item').forEach(item => {
                        const vcId = item.dataset.vcId;
                        const silentToggle = item.querySelector('.silent-toggle');
                        const deleteToggle = item.querySelector('.delete-toggle');

                        silentToggle.onchange = () => {
                            mappings[vcId].silent = silentToggle.checked;
                            isDirty = true;
                        };

                        deleteToggle.onchange = () => {
                            mappings[vcId].deleteAfter = deleteToggle.checked;
                            isDirty = true;
                        };

                        item.querySelector('.remove-mapping-btn').onclick = (e) => {
                            delete mappings[vcId];
                            renderMappings();
                            isDirty = true;
                        };
                    });
                };

                pageContent.innerHTML = `
                <form id="vc-log-form">
                    <div class="card">
                        <div class="card-header"><h3>現在の設定</h3></div>
                        <div id="vc-log-mapping-list" class="vc-log-mapping-list"></div>
                    </div>
                    <div class="card">
                        <div class="card-header"><h3>新しい設定を追加</h3></div>
                        <div class="form-group" style="margin-bottom: 16px;">
                            <p class="form-hint">デフォルト設定: サイレント送信、自動削除</p>
                        </div>
                        <div class="form-grid" style="margin-bottom: 16px;">
                            <div class="form-group">
                                <label for="voice-channel-select">ボイスチャンネル</label>
                                <select id="voice-channel-select" placeholder="VCを選択..."></select>
                            </div>
                            <div class="form-group">
                                <label for="text-channel-select">ログ送信先チャンネル</label>
                                <select id="text-channel-select" placeholder="TCを選択..."></select>
                            </div>
                        </div>
                        <button type="button" id="add-mapping-btn" class="btn btn-secondary">マッピングを追加</button>
                    </div>
                    <button type="submit" class="btn">設定を保存</button>
                </form>
                <style>
                    .vc-log-mapping-item { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 16px; background: rgba(0,0,0,0.1); border-radius: var(--radius-md); margin-bottom: 12px; }
                    .vc-log-mapping-config { flex: 1; }
                    .vc-log-mapping-channels { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
                    .channel-name { display: flex; align-items: center; gap: 8px; font-weight: 500; }
                    .channel-name i { width: 16px; height: 16px; }
                    .vc-log-mapping-options { display: flex; gap: 16px; flex-wrap: wrap; }
                    .checkbox-label { display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; }
                    .checkbox-label input { cursor: pointer; }
                    .checkbox-label span { font-size: 0.9em; color: var(--text-secondary); }
                </style>`;

                const voiceChannels = guildInfo.channels.filter(c => c.type === 2);
                const textChannels = guildInfo.channels.filter(c => c.type === 0);

                initializeTomSelect('#voice-channel-select', { options: voiceChannels.map(c => ({ value: c.id, text: c.name })) });
                initializeTomSelect('#text-channel-select', { options: textChannels.map(c => ({ value: c.id, text: c.name })) });

                renderMappings();

                document.getElementById('add-mapping-btn').onclick = () => {
                    const vcSelect = document.getElementById('voice-channel-select').tomselect;
                    const tcSelect = document.getElementById('text-channel-select').tomselect;
                    const vcId = vcSelect.getValue();
                    const tcId = tcSelect.getValue();

                    if (!vcId || !tcId) {
                        showMessage('両方のチャンネルを選択してください。', 'error');
                        return;
                    }

                    // デフォルト設定で新規マッピングを追加
                    mappings[vcId] = {
                        textChannelId: tcId,
                        silent: true,
                        deleteAfter: true
                    };
                    renderMappings();
                    vcSelect.clear();
                    tcSelect.clear();
                    isDirty = true;
                };

                document.getElementById('vc-log-form').addEventListener('submit', (e) => {
                    e.preventDefault();
                    handleFormSubmit(e, { voiceChannelMappings: mappings });
                });
                trackChanges('#vc-log-form');
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
                        <div class="form-group" style="margin-top:20px; border-top:1px solid var(--border); padding-top:20px;">
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
                        listEl.innerHTML = '<p style="text-align:center; color: var(--text-muted);">ロール報酬はまだ設定されていません。</p>';
                        return;
                    }
                    listEl.innerHTML = levelingSettings.roleRewards
                        .sort((a, b) => a.level - b.level)
                        .map((reward, index) => `
                        <div class="role-item" data-index="${index}">
                            <div class="role-info">
                                <span class="role-name">Lv. ${reward.level}</span>
                                <span class="role-genre-tag">${guildInfo.roles.find(r => r.id === reward.roleId)?.name || '不明'}</span>
                            </div>
                            <button type="button" class="btn btn-danger btn-small remove-reward-btn">&times;</button>
                        </div>`).join('');
                    listEl.querySelectorAll('.remove-reward-btn').forEach(btn => {
                        btn.onclick = (e) => {
                            levelingSettings.roleRewards.splice(parseInt(e.target.closest('.role-item').dataset.index, 10), 1);
                            renderRoleRewards();
                            isDirty = true;
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
                    isDirty = true;
                };

                document.getElementById('leveling-form').addEventListener('submit', (e) => {
                    e.preventDefault();
                    handleFormSubmit(e, {
                        levelUpChannel: document.getElementById('levelUpChannel').value || null,
                        leveling: levelingSettings
                    });
                });
                trackChanges('#leveling-form');
            },

            tickets: async () => {
                pageTitle.textContent = 'チケットシステム設定';
                const settings = await api.get('/api/settings/tickets');

                pageContent.innerHTML = `
                <form id="tickets-form">
                    <div class="card">
                        <div class="card-header"><h3>基本設定</h3></div>
                        <div class="form-group">
                            <label>チケットシステムを有効化</label>
                            <label class="switch"><input type="checkbox" id="ticket-enabled" ${settings.enabled ? 'checked' : ''}><span class="slider"></span></label>
                        </div>
                        <div class="form-grid">
                            <div class="form-group">
                                <label for="ticket-category">チケット作成カテゴリ</label>
                                <select id="ticket-category" placeholder="カテゴリを選択...">
                                    <option value="">選択しない</option>
                                    ${guildInfo.channels.filter(c => c.type === 4).map(o => `<option value="${o.id}">${o.name}</option>`).join('')}
                                </select>
                            </div>
                            <div class="form-group">
                                <label for="ticket-role">サポート担当ロール</label>
                                <select id="ticket-role" placeholder="ロールを選択...">
                                    <option value="">選択しない</option>
                                    ${guildInfo.roles.map(o => `<option value="${o.id}">${o.name}</option>`).join('')}
                                </select>
                            </div>
                        </div>
                    </div>
                    <div class="card">
                        <div class="card-header"><h3>メッセージ設定</h3></div>
                        <div class="form-group">
                            <label for="ticket-title">チケットパネルのタイトル</label>
                            <input type="text" id="ticket-title" value="${settings.title || 'お問い合わせ'}">
                        </div>
                        <div class="form-group">
                            <label for="ticket-desc">チケットパネルの説明</label>
                            <textarea id="ticket-desc" rows="4">${settings.description || '下のボタンをクリックしてチケットを作成してください。'}</textarea>
                        </div>
                    </div>
                    <button type="submit" class="btn">設定を保存</button>
                </form>
            `;

                initializeTomSelect('#ticket-category', { items: [settings.categoryId] });
                initializeTomSelect('#ticket-role', { items: [settings.supportRoleId] });

                document.getElementById('tickets-form').onsubmit = async (e) => {
                    e.preventDefault();
                    const data = {
                        enabled: document.getElementById('ticket-enabled').checked,
                        categoryId: document.getElementById('ticket-category').value,
                        supportRoleId: document.getElementById('ticket-role').value,
                        title: document.getElementById('ticket-title').value,
                        description: document.getElementById('ticket-desc').value
                    };
                    await api.post('/api/settings/tickets', data);
                    showMessage('チケット設定を保存しました。');
                    resetDirtyState();
                };
                trackChanges('#tickets-form');
            },

            commands: async () => {
                pageTitle.textContent = 'コマンド管理';
                const disabledCommands = await api.get('/api/settings/commands');

                // コマンドリスト (本来はAPIから取得すべきだが、固定でも可)
                const commands = [
                    { id: 'ping', name: 'Ping', category: 'General' },
                    { id: 'help', name: 'Help', category: 'General' },
                    { id: 'rank', name: 'Rank', category: 'Leveling' },
                    { id: 'profile-card', name: 'Profile Card', category: 'Leveling' },
                    { id: 'warn', name: 'Warn', category: 'Moderation' },
                    { id: 'roleboard', name: 'Roleboard', category: 'Utility' },
                    { id: 'feedback', name: 'Feedback', category: 'Utility' }
                ];

                pageContent.innerHTML = `
                <div class="card">
                    <div class="card-header"><h3>コマンドの有効/無効化</h3></div>
                    <p class="form-hint" style="margin-bottom: 20px;">無効化したコマンドはサーバー内で使用できなくなります。</p>
                    <div class="command-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px;">
                        ${commands.map(cmd => `
                            <div class="glass-card" style="padding: 16px; display: flex; justify-content: space-between; align-items: center;">
                                <div>
                                    <div style="font-weight: 600;">/${cmd.id}</div>
                                    <div style="font-size: 0.8rem; color: var(--text-muted);">${cmd.category}</div>
                                </div>
                                <label class="switch">
                                    <input type="checkbox" class="command-toggle" data-command="${cmd.id}" ${!disabledCommands.includes(cmd.id) ? 'checked' : ''}>
                                    <span class="slider"></span>
                                </label>
                            </div>
                        `).join('')}
                    </div>
                    <button id="save-commands-btn" class="btn" style="margin-top: 32px;">設定を保存</button>
                </div>
            `;

                document.getElementById('save-commands-btn').onclick = async () => {
                    const disabled = Array.from(document.querySelectorAll('.command-toggle'))
                        .filter(i => !i.checked)
                        .map(i => i.dataset.command);

                    await api.post('/api/settings/commands', { disabledCommands: disabled });
                    showMessage('コマンド設定を保存しました。');
                    resetDirtyState();
                };

                document.querySelectorAll('.command-toggle').forEach(el => el.onchange = () => isDirty = true);
            },

            ai: async () => {
                pageTitle.textContent = 'AI設定';
                const settings = await api.get('/api/settings/guild_settings');
                settingsCache['guild_settings'] = settings;
                const aiConfig = settings.ai || { mentionReplyEnabled: true, aiPersonalityPrompt: '' };
                const personaTemplates = [
                    {
                        name: '猫アシスタント',
                        prompt: 'あなたは「Overseer」という名前の、猫になりきっているアシスタントAIです。\n' +
                            '# あなたの役割\n' +
                            '- 語尾には必ず「にゃん」や「にゃ」をつけてください。\n' +
                            '- 一人称は「吾輩」です。\n' +
                            '- ユーザーのことは「ご主人様」と呼んでください。\n' +
                            '- 少し気まぐれですが、親切に回答してください。'
                    },
                    {
                        name: '執事AI',
                        prompt: 'あなたは「Overseer」という名前の、非常に丁寧で有能な執事AIです。\n' +
                            '# あなたの役割\n' +
                            '- 常に敬語を使い、丁寧な言葉遣いを徹底してください。\n' +
                            '- 一人称は「私（わたくし）」です。\n' +
                            '- ユーザーのことは「様」付けで呼んでください。（例: 〇〇様）\n' +
                            '- どんな質問にも冷静沈着かつ的確に答えてください。'
                    },
                    {
                        name: '武士',
                        prompt: 'あなたは「Overseer」という名前の、古風な武士のようなAIです。\n' +
                            '# あなたの役割\n' +
                            '- 語尾は「～でござる」「～せぬか？」など、武士のような口調にしてください。\n' +
                            '- 一人称は「拙者」です。\n' +
                            '- ユーザーのことは「殿」と呼んでください。\n' +
                            '- 義理堅く、誠実に回答してください。'
                    },
                    {
                        name: '陽気な相棒',
                        prompt: 'あなたは「Overseer」という名前の、非常に陽気でフレンドリーなAIです。\n' +
                            '# あなたの役割\n' +
                            '- 明るく、タメ口のような親しみやすい口調で話してください。\n' +
                            '- 一人称は「オレ」です。\n' +
                            '- ユーザーのことは呼び捨てか「相棒」と呼んでください。\n' +
                            '- 時々ジョークを交えながら、楽しく会話を盛り上げてください。'
                    }
                ];

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
                        
                        <div class="form-group" style="margin-top:20px; border-top:1px solid var(--border); padding-top:20px;">
                            <label>ペルソナ設定アシスタント</label>
                            <p class="form-hint">クリックすると、テンプレートを上のテキストエリアに挿入します。</p>
                            <div id="persona-templates" class="persona-templates-container">
                                ${personaTemplates.map(template => `<button type="button" class="btn btn-secondary btn-small" data-prompt="${template.prompt.replace(/"/g, '&quot;')}">${template.name}</button>`).join('')}
                            </div>
                        </div>

                    </div>
                    <button type="submit" class="btn">設定を保存</button>
                </form>`;

                document.querySelectorAll('#persona-templates button').forEach(button => {
                    button.addEventListener('click', () => {
                        const prompt = button.getAttribute('data-prompt');
                        const textarea = document.getElementById('aiPersonalityPrompt');
                        textarea.value = prompt;
                        textarea.dispatchEvent(new Event('input', { bubbles: true }));
                    });
                });
                document.getElementById('ai-form').addEventListener('submit', handleFormSubmit);
                trackChanges('#ai-form');
            }
        }
    };

    // --- Roleboard Functions ---
    const renderRoleboardList = async () => {
        const listEl = document.getElementById('roleboard-list');
        listEl.innerHTML = '<div class="loader-ring" style="margin: 20px auto;"></div>';
        try {
            const boards = await api.get('/api/roleboards');
            if (boards.length === 0) {
                listEl.innerHTML = '<p style="text-align: center; color: var(--text-muted);">まだロールボードが作成されていません。</p>';
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
            </div>
            <div class="form-group">
                <label for="modal-password">
                    パスワード保護（オプション）
                    <small style="color: var(--text-muted); display: block; margin-top: 4px;">
                        パスワードを設定すると、ユーザーはロール付与時にパスワード入力が必須になります。
                    </small>
                </label>
                <input type="password" id="modal-password" placeholder="パスワード（最大128文字）" maxlength="128">
            </div>`,
            [{ id: 'save-new-board', text: '作成', class: 'btn' }]
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
                    color: colorText.value,
                    password: modal.querySelector('#modal-password').value.trim() || null
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
                <div class="form-group">
                    <label for="edit-password">
                        パスワード保護
                        <small style="color: var(--text-muted); display: block; margin-top: 4px;">
                            ユーザーがロール付与時にパスワード入力が必須になります。空欄で無効化。
                        </small>
                    </label>
                    <input type="password" id="edit-password" value="${board.password || ''}" placeholder="パスワード（最大128文字、空欄で無効化）" maxlength="128">
                </div>
                <hr style="border-color: var(--border); margin: 20px 0;">
                <h4>ロール管理</h4>
                <div id="modal-role-list"></div>
                <div class="form-group" style="margin-top: 20px; border-top: 1px solid var(--border); padding-top: 20px;">
                    <label>ロールを追加</label>
                    <div class="add-role-grid">
                        <div class="form-group">
                            <select id="add-role-select" placeholder="ロールを選択...">
                                <option value="">ロールを選択...</option>
                                ${guildInfo.roles.map(r => `<option value="${r.id}">${r.name}</option>`).join('')}
                            </select>
                        </div>
                        <div class="form-group">
                           <input type="text" id="add-role-genre" placeholder="ジャンル">
                        </div>
                         <div class="form-group add-role-btn-wrapper">
                            <button id="add-role-btn" class="btn">追加</button>
                        </div>
                    </div>
                </div>`,
                [{ id: 'save-board-changes', text: '保存', class: 'btn' }]
            );

            const colorPicker = modal.querySelector('#edit-color-picker');
            const colorText = modal.querySelector('#edit-color-text');
            colorPicker.oninput = () => colorText.value = colorPicker.value.toUpperCase();
            colorText.oninput = () => {
                if (/^#[0-9A-F]{6}$/i.test(colorText.value)) {
                    colorPicker.value = colorText.value;
                }
            };

            const localBoard = JSON.parse(JSON.stringify(board));

            const selectEl = modal.querySelector('#add-role-select');
            initializeTomSelect(selectEl);

            const renderModalRoleList = () => {
                const listEl = document.getElementById('modal-role-list');
                const roles = localBoard.roles || {};
                if (Object.keys(roles).length === 0) {
                    listEl.innerHTML = '<p style="text-align: center; color: var(--text-muted);">まだロールが追加されていません。</p>';
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

                localBoard.roles[roleId] = { name: role.name, genre, emoji: null };

                localBoard.genres = localBoard.genres || {};
                if (!localBoard.genres[genre]) localBoard.genres[genre] = [];
                if (!localBoard.genres[genre].includes(roleId)) localBoard.genres[genre].push(roleId);

                renderModalRoleList();
                modal.querySelector('#add-role-genre').value = '';
                selectEl.tomselect.clear();
            };

            modal.querySelector('#modal-role-list').onclick = e => {
                if (e.target.classList.contains('remove-role-btn')) {
                    const roleItem = e.target.closest('.role-item');
                    const roleId = roleItem.dataset.id;
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
                if (!title) return showMessage('タイトルは必須です。', 'error');

                try {
                    await api.put(`/api/roleboards/${boardId}`, {
                        title,
                        description: modal.querySelector('#edit-desc').value.trim(),
                        color: parseInt(colorText.value.replace('#', ''), 16),
                        password: modal.querySelector('#edit-password').value.trim() || null,
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
                { id: 'cancel-delete', text: 'キャンセル', class: 'btn-secondary' },
                { id: 'confirm-delete', text: '削除', class: 'btn-danger' }
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
                switch (page) {
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
                            imageUrl: form.querySelector('#welcome-imageUrl').value,
                            color: form.querySelector('#welcome-color-text').value,
                        });
                        showMessage('設定を保存しました。');
                        resetDirtyState();
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
            resetDirtyState();
        } catch (error) {
            showMessage(`保存エラー: ${error.message}`, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = btnText;
        }
    };


    // --- Member Actions ---
    const addMemberActionListeners = () => {
        document.querySelectorAll('.manage-roles-btn').forEach(btn => btn.onclick = handleManageRoles);
        document.querySelectorAll('.kick-btn').forEach(btn => btn.onclick = handleKickMember);
        document.querySelectorAll('.ban-btn').forEach(btn => btn.onclick = handleBanMember);
    };

    const handleManageRoles = async (e) => {
        const memberId = e.target.closest('tr').dataset.memberId;
        // APIから再取得する代わりにキャッシュを利用する（ただし、大規模な変更がある場合は再取得が望ましい）
        // For simplicity, we assume the initial fetch is recent enough.
        // const members = await api.get('/api/members');
        // const member = members.find(m => m.id === memberId);
        const memberRow = document.querySelector(`tr[data-member-id="${memberId}"]`);
        const memberName = memberRow.querySelector('.display-name').textContent;
        const currentRoles = Array.from(memberRow.querySelectorAll('.role-tag')).map(tag => {
            const role = guildInfo.roles.find(r => r.name === tag.textContent);
            return role ? role.id : null;
        }).filter(Boolean);


        const modal = createModal(`ロール管理: ${memberName}`, `
            <div class="form-group">
                <label>ロールを編集</label>
                <select id="roles-select" multiple placeholder="ロールを選択...">
                    ${guildInfo.roles.map(r => `<option value="${r.id}">${r.name}</option>`).join('')}
                </select>
            </div>`,
            [{ id: 'save-roles', text: '保存', class: 'btn' }]
        );
        initializeTomSelect('#roles-select', {
            items: currentRoles
        });

        document.getElementById('save-roles').onclick = async () => {
            const selectedRoles = document.getElementById('roles-select').tomselect.getValue();
            try {
                await api.put(`/api/members/${memberId}/roles`, { roles: selectedRoles });
                showMessage('ロールを更新しました。');
                closeModal();
                // テーブル全体ではなく、該当行だけ更新することも可能だが、再描画が確実
                document.querySelector(`.nav-item[data-page="members"]`).click();
            } catch (error) {
                showMessage('ロールの更新に失敗しました。', 'error');
            }
        };
    };

    const handleKickMember = (e) => {
        const memberId = e.target.closest('tr').dataset.memberId;
        createModal('メンバーをキック', `
            <p>本当にこのメンバーをキックしますか？</p>
            <div class="form-group" style="margin-top:15px;"><label>理由 (任意)</label><input type="text" id="kick-reason"></div>`,
            [{ id: 'confirm-kick', text: 'キック', class: 'btn-danger' }]
        );
        document.getElementById('confirm-kick').onclick = async () => {
            const reason = document.getElementById('kick-reason').value;
            try {
                await api.post(`/api/members/${memberId}/kick`, { reason });
                showMessage('メンバーをキックしました。');
                closeModal();
                document.querySelector(`.nav-item[data-page="members"]`).click();
            } catch (error) {
                showMessage('キックに失敗しました。', 'error');
            }
        };
    };

    const handleBanMember = (e) => {
        const memberId = e.target.closest('tr').dataset.memberId;
        createModal('メンバーをBAN', `
            <p>本当にこのメンバーをサーバーからBANしますか？この操作は取り消せません。</p>
            <div class="form-group" style="margin-top:15px;"><label>理由 (任意)</label><input type="text" id="ban-reason"></div>`,
            [{ id: 'confirm-ban', text: 'BAN', class: 'btn-danger' }]
        );
        document.getElementById('confirm-ban').onclick = async () => {
            const reason = document.getElementById('ban-reason').value;
            try {
                await api.post(`/api/members/${memberId}/ban`, { reason });
                showMessage('メンバーをBANしました。');
                closeModal();
                document.querySelector(`.nav-item[data-page="members"]`).click();
            } catch (error) {
                showMessage('BANに失敗しました。', 'error');
            }
        };
    };


    App.init();
});