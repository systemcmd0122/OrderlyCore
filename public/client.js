document.addEventListener('DOMContentLoaded', async () => {
    // DOM elements
    const loader = document.getElementById('loader');
    const pageContent = document.getElementById('page-content');
    const pageTitle = document.getElementById('page-title');
    const navLinks = document.querySelectorAll('.nav-link[data-page]');
    const logoutBtn = document.getElementById('logout-btn');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');

    let guildInfo = null;
    let isDirty = false;

    // API helper
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
                console.error(`API error:`, err);
                showToast(err.message, 'danger');
                throw err;
            }
        },
        get: (ep) => api._request(ep),
        post: (ep, body) => api._request(ep, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }),
        put: (ep, body) => api._request(ep, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }),
        delete: (ep) => api._request(ep, { method: 'DELETE' })
    };

    // UI helpers
    const showToast = (message, type = 'success') => {
        const toastContainer = document.createElement('div');
        toastContainer.className = 'toast-container position-fixed bottom-0 end-0 p-3';
        toastContainer.style.zIndex = '2000';
        toastContainer.innerHTML = `
            <div class="toast align-items-center text-white bg-${type} border-0" role="alert" aria-live="assertive" aria-atomic="true">
                <div class="d-flex">
                    <div class="toast-body">${message}</div>
                    <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
                </div>
            </div>
        `;
        document.body.appendChild(toastContainer);
        const toastEl = toastContainer.querySelector('.toast');
        const bsToast = new bootstrap.Toast(toastEl);
        bsToast.show();
        toastEl.addEventListener('hidden.bs.toast', () => toastContainer.remove());
    };

    const confirmAction = (title, message, btnText, btnClass = 'btn-primary') => {
        return new Promise((resolve) => {
            const modalId = 'confirm-modal-' + Date.now();
            const modalHtml = `
                <div class="modal fade" id="${modalId}" tabindex="-1" aria-hidden="true">
                    <div class="modal-dialog modal-dialog-centered">
                        <div class="modal-content border-0 shadow">
                            <div class="modal-header border-bottom-0">
                                <h5 class="modal-title fw-bold">${title}</h5>
                                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                            </div>
                            <div class="modal-body text-secondary">${message}</div>
                            <div class="modal-footer border-top-0">
                                <button type="button" class="btn btn-light" data-bs-dismiss="modal">キャンセル</button>
                                <button type="button" class="btn ${btnClass}" id="${modalId}-confirm">${btnText}</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            document.body.insertAdjacentHTML('beforeend', modalHtml);
            const modalEl = document.getElementById(modalId);
            const bsModal = new bootstrap.Modal(modalEl);
            bsModal.show();

            document.getElementById(`${modalId}-confirm`).onclick = () => {
                bsModal.hide();
                resolve(true);
            };
            modalEl.addEventListener('hidden.bs.modal', () => {
                modalEl.remove();
                resolve(false);
            });
        });
    };

    const initializeTomSelect = (selector, options = {}) => {
        const els = typeof selector === 'string' ? document.querySelectorAll(selector) : [selector];
        els.forEach(el => {
            if (el.tomselect) el.tomselect.destroy();
            new TomSelect(el, {
                placeholder: '選択してください...',
                plugins: ['remove_button'],
                ...options
            });
        });
    };

    const trackChanges = (formSelector) => {
        const form = document.querySelector(formSelector);
        if (form) {
            form.querySelectorAll('input, select, textarea').forEach(input => {
                input.addEventListener('change', () => isDirty = true);
                input.addEventListener('input', () => isDirty = true);
            });
        }
    };

    const escapeHTML = (str) => {
        if (!str) return '';
        return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
    };

    // App core
    const App = {
        init: async () => {
            try {
                guildInfo = await api.get('/api/guild-info');
                document.getElementById('server-icon').src = guildInfo.icon || 'https://cdn.discordapp.com/embed/avatars/0.png';
                document.getElementById('server-name').textContent = guildInfo.name;

                window.addEventListener('hashchange', App.handleRoute);
                await App.handleRoute();

                // UI event bindings
                sidebarToggle?.addEventListener('click', () => {
                    sidebar.classList.toggle('show');
                    overlay.classList.toggle('show');
                });
                overlay?.addEventListener('click', () => {
                    sidebar.classList.remove('show');
                    overlay.classList.remove('show');
                });

                logoutBtn.addEventListener('click', async () => {
                    if (await confirmAction('ログアウト', '本当にログアウトしますか？', 'ログアウト', 'btn-danger')) {
                        await api.post('/api/logout');
                        window.location.href = '/login';
                    }
                });

                window.addEventListener('beforeunload', (e) => {
                    if (isDirty) {
                        e.preventDefault();
                        e.returnValue = '';
                    }
                });

                loader.style.display = 'none';
            } catch (err) {
                console.error('App init failed:', err);
                loader.innerHTML = `
                    <div class="text-center p-4">
                        <div class="alert alert-danger mb-4">情報の読み込みに失敗しました。</div>
                        <a href="/login" class="btn btn-primary">ログインへ</a>
                    </div>
                `;
            }
        },

        handleRoute: async () => {
            const page = window.location.hash.substring(1) || 'dashboard';

            if (isDirty) {
                if (!await confirmAction('未保存の変更', 'ページを離れると変更が失われます。移動しますか？', '移動する', 'btn-warning')) {
                    history.pushState(null, null, `#${App.currentPage || 'dashboard'}`);
                    return;
                }
            }

            isDirty = false;
            App.currentPage = page;
            navLinks.forEach(link => link.classList.toggle('active', link.dataset.page === page));

            if (window.innerWidth < 992) {
                sidebar.classList.remove('show');
                overlay.classList.remove('show');
            }

            pageContent.innerHTML = '<div class="d-flex justify-content-center p-5"><div class="spinner-border text-primary" role="status"></div></div>';

            try {
                if (App.renderers[page]) {
                    await App.renderers[page]();
                } else {
                    pageContent.innerHTML = '<div class="alert alert-warning text-center">ページが見つかりません。</div>';
                }
            } catch (err) {
                console.error(`Render error for ${page}:`, err);
                pageContent.innerHTML = `<div class="alert alert-danger text-center">エラーが発生しました: ${err.message}</div>`;
            }
        },

        renderers: {
            dashboard: async () => {
                pageTitle.textContent = 'ダッシュボード';
                const [settings, trends, recentLogs] = await Promise.all([
                    api.get('/api/settings/guilds'),
                    api.get('/api/analytics/trends'),
                    api.get('/api/audit-logs?limit=5')
                ]);

                pageContent.innerHTML = `
                    <div class="row g-4 mb-4">
                        <div class="col-6 col-md-3">
                            <div class="card h-100 border-0 shadow-sm">
                                <div class="stat-card">
                                    <div class="stat-icon bg-primary shadow-sm"><i class="bi bi-people"></i></div>
                                    <div>
                                        <div class="h4 mb-0 fw-bold">${(guildInfo.memberCount || 0).toLocaleString()}</div>
                                        <div class="small text-secondary">メンバー</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="col-6 col-md-3">
                            <div class="card h-100 border-0 shadow-sm">
                                <div class="stat-card">
                                    <div class="stat-icon bg-info shadow-sm"><i class="bi bi-robot"></i></div>
                                    <div>
                                        <div class="h4 mb-0 fw-bold">${(guildInfo.botCount || 0).toLocaleString()}</div>
                                        <div class="small text-secondary">ボット</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="col-6 col-md-3">
                            <div class="card h-100 border-0 shadow-sm">
                                <div class="stat-card">
                                    <div class="stat-icon bg-success shadow-sm"><i class="bi bi-person-plus"></i></div>
                                    <div>
                                        <div class="h4 mb-0 fw-bold">${(settings.statistics?.totalJoins || 0).toLocaleString()}</div>
                                        <div class="small text-secondary">合計参加数</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="col-6 col-md-3">
                            <div class="card h-100 border-0 shadow-sm">
                                <div class="stat-card">
                                    <div class="stat-icon bg-danger shadow-sm"><i class="bi bi-person-minus"></i></div>
                                    <div>
                                        <div class="h4 mb-0 fw-bold">${(settings.statistics?.totalLeaves || 0).toLocaleString()}</div>
                                        <div class="small text-secondary">合計退出数</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="row g-4">
                        <div class="col-lg-8">
                            <div class="card p-4 border-0 shadow-sm h-100">
                                <h6 class="fw-bold mb-4">サーバー成長トレンド (30日間)</h6>
                                <div style="height: 300px;"><canvas id="trendChart"></canvas></div>
                            </div>
                        </div>
                        <div class="col-lg-4">
                            <div class="card p-4 border-0 shadow-sm h-100">
                                <h6 class="fw-bold mb-4">最新の監査ログ</h6>
                                <div class="list-group list-group-flush small">
                                    ${recentLogs.logs.slice(0, 5).map(log => `
                                        <div class="list-group-item px-0 border-secondary-subtle py-3">
                                            <div class="d-flex justify-content-between mb-1">
                                                <span class="badge bg-light text-dark fw-bold">${escapeHTML(log.eventType)}</span>
                                                <span class="text-secondary opacity-75">${new Date(log.timestamp.seconds * 1000).toLocaleDateString()}</span>
                                            </div>
                                            <div class="text-secondary small">実行者: ${escapeHTML(log.executorTag || 'System')}</div>
                                        </div>
                                    `).join('') || '<div class="text-center py-4 text-secondary">ログがありません。</div>'}
                                </div>
                                <a href="#auditLog" class="btn btn-light btn-sm mt-auto">すべてのログを表示</a>
                            </div>
                        </div>
                    </div>
                `;

                const ctx = document.getElementById('trendChart')?.getContext('2d');
                if (ctx) {
                    const dates = Object.keys(trends);
                    new Chart(ctx, {
                        type: 'line',
                        data: {
                            labels: dates,
                            datasets: [
                                { label: '参加者', data: dates.map(d => trends[d].joins), borderColor: '#198754', tension: 0.4, fill: false },
                                { label: '退出者', data: dates.map(d => trends[d].leaves), borderColor: '#dc3545', tension: 0.4, fill: false }
                            ]
                        },
                        options: { maintainAspectRatio: false, responsive: true, plugins: { legend: { position: 'bottom' } } }
                    });
                }
            },

            members: async () => {
                pageTitle.textContent = 'メンバー管理';
                pageContent.innerHTML = `
                    <div class="card border-0 shadow-sm p-4">
                        <div class="row g-3 mb-4">
                            <div class="col-md-6">
                                <div class="input-group">
                                    <span class="input-group-text bg-white border-end-0"><i class="bi bi-search"></i></span>
                                    <input type="text" id="member-search" class="form-control border-start-0" placeholder="メンバー名またはIDで検索...">
                                </div>
                            </div>
                            <div class="col-md-6">
                                <select id="role-filter" class="form-select">
                                    <option value="">すべてのロール</option>
                                    ${guildInfo.roles.map(r => `<option value="${r.id}">${r.name}</option>`).join('')}
                                </select>
                            </div>
                        </div>
                        <div class="table-responsive">
                            <table class="table table-hover align-middle small">
                                <thead class="table-light">
                                    <tr>
                                        <th>ユーザー</th>
                                        <th>ロール</th>
                                        <th>参加日</th>
                                        <th class="text-end">操作</th>
                                    </tr>
                                </thead>
                                <tbody id="members-table-body"></tbody>
                            </table>
                        </div>
                        <div class="d-flex justify-content-between align-items-center mt-4">
                            <button id="prev-page" class="btn btn-sm btn-outline-secondary px-3">前へ</button>
                            <span id="page-info" class="fw-bold small text-secondary"></span>
                            <button id="next-page" class="btn btn-sm btn-outline-secondary px-3">次へ</button>
                        </div>
                    </div>
                `;

                initializeTomSelect('#role-filter');

                let currentPage = 1;
                const fetchAndRender = async () => {
                    const search = document.getElementById('member-search').value;
                    const roleFilter = document.getElementById('role-filter').value;
                    const data = await api.get(`/api/members?page=${currentPage}&search=${search}&roleFilter=${roleFilter}`);

                    const tbody = document.getElementById('members-table-body');
                    tbody.innerHTML = data.members.map(m => `
                        <tr>
                            <td>
                                <div class="d-flex align-items-center gap-3">
                                    <img src="${m.avatar}" width="38" height="38" class="rounded-circle shadow-sm">
                                    <div>
                                        <div class="fw-bold">${escapeHTML(m.displayName)}</div>
                                        <div class="text-secondary small opacity-75">@${escapeHTML(m.username)}</div>
                                    </div>
                                </div>
                            </td>
                            <td>
                                <div class="d-flex flex-wrap gap-1">
                                    ${m.roles.map(r => `<span class="badge rounded-pill text-dark border border-secondary-subtle fw-normal py-1" style="background-color: #f8f9fa;">${escapeHTML(r.name)}</span>`).join('')}
                                </div>
                            </td>
                            <td>${new Date(m.joinedAt).toLocaleDateString()}</td>
                            <td class="text-end">
                                <div class="btn-group btn-group-sm shadow-sm">
                                    <button class="btn btn-white border manage-roles-btn" data-id="${m.id}" title="ロール編集"><i class="bi bi-shield text-primary"></i></button>
                                    <button class="btn btn-white border kick-btn" data-id="${m.id}" title="キック"><i class="bi bi-person-x text-danger"></i></button>
                                </div>
                            </td>
                        </tr>
                    `).join('') || '<tr><td colspan="4" class="text-center py-5 text-secondary">条件に一致するメンバーはいません</td></tr>';

                    document.getElementById('page-info').textContent = `ページ ${data.currentPage} / ${data.totalPages}`;
                    document.getElementById('prev-page').disabled = data.currentPage <= 1;
                    document.getElementById('next-page').disabled = data.currentPage >= data.totalPages;

                    document.querySelectorAll('.manage-roles-btn').forEach(btn => btn.onclick = async () => {
                        const mid = btn.dataset.id;
                        const m = data.members.find(u => u.id === mid);
                        const curRoles = m.roles.map(r => r.id);

                        const modalId = 'roles-modal-' + Date.now();
                        const modalHtml = `
                            <div class="modal fade" id="${modalId}" tabindex="-1">
                                <div class="modal-dialog">
                                    <div class="modal-content border-0 shadow">
                                        <div class="modal-header">
                                            <h5 class="modal-title fw-bold">ロール管理: ${escapeHTML(m.displayName)}</h5>
                                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                                        </div>
                                        <div class="modal-body p-4">
                                            <label class="form-label small fw-bold mb-2">割り当てるロール</label>
                                            <select id="roles-select" multiple></select>
                                        </div>
                                        <div class="modal-footer border-0">
                                            <button type="button" class="btn btn-light" data-bs-dismiss="modal">キャンセル</button>
                                            <button type="button" class="btn btn-primary px-4" id="${modalId}-save">保存</button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        `;
                        document.body.insertAdjacentHTML('beforeend', modalHtml);
                        const roleSelect = document.getElementById('roles-select');
                        roleSelect.innerHTML = guildInfo.roles.map(r => `<option value="${r.id}" ${curRoles.includes(r.id) ? 'selected' : ''}>${r.name}</option>`).join('');

                        initializeTomSelect(roleSelect);
                        const bsModal = new bootstrap.Modal(document.getElementById(modalId));
                        bsModal.show();
                        document.getElementById(`${modalId}-save`).onclick = async () => {
                            const newRoles = roleSelect.tomselect.getValue();
                            await api.put(`/api/members/${mid}/roles`, { roles: newRoles });
                            showToast('ロールを更新しました');
                            bsModal.hide();
                            fetchAndRender();
                        };
                    });

                    document.querySelectorAll('.kick-btn').forEach(btn => btn.onclick = async () => {
                        if (await confirmAction('キック', '本当にこのメンバーをキックしますか？', 'キックする', 'btn-danger')) {
                            await api.post(`/api/members/${btn.dataset.id}/kick`);
                            showToast('キックしました');
                            fetchAndRender();
                        }
                    });
                };

                document.getElementById('prev-page').onclick = () => { currentPage--; fetchAndRender(); };
                document.getElementById('next-page').onclick = () => { currentPage++; fetchAndRender(); };
                document.getElementById('member-search').oninput = () => { currentPage = 1; fetchAndRender(); };
                document.getElementById('role-filter').onchange = () => { currentPage = 1; fetchAndRender(); };

                fetchAndRender();
            },

            auditLog: async () => {
                pageTitle.textContent = '監査ログ';
                pageContent.innerHTML = `
                    <div class="card border-0 shadow-sm p-4">
                        <div class="row g-3 mb-4">
                            <div class="col-md-6">
                                <select id="log-type-filter" class="form-select">
                                    <option value="">すべてのアクション</option>
                                    <option value="MemberJoin">参加</option>
                                    <option value="MemberLeave">退出</option>
                                    <option value="MessageDelete">メッセージ削除</option>
                                    <option value="MessageUpdate">メッセージ編集</option>
                                </select>
                            </div>
                            <div class="col-md-6 text-md-end">
                                <button id="refresh-logs" class="btn btn-outline-secondary btn-sm px-3"><i class="bi bi-arrow-clockwise me-1"></i>更新</button>
                            </div>
                        </div>
                        <div class="table-responsive">
                            <table class="table table-hover align-middle small">
                                <thead class="table-light">
                                    <tr>
                                        <th>日時</th>
                                        <th>イベント</th>
                                        <th>実行者</th>
                                        <th>詳細</th>
                                    </tr>
                                </thead>
                                <tbody id="logs-table-body"></tbody>
                            </table>
                        </div>
                        <div class="d-flex justify-content-between align-items-center mt-4">
                            <button id="prev-page" class="btn btn-sm btn-outline-secondary px-3">前へ</button>
                            <span id="page-info" class="fw-bold small text-secondary"></span>
                            <button id="next-page" class="btn btn-sm btn-outline-secondary px-3">次へ</button>
                        </div>
                    </div>
                `;

                let currentPage = 1;
                const fetchAndRender = async () => {
                    const eventType = document.getElementById('log-type-filter').value;
                    const data = await api.get(`/api/audit-logs?page=${currentPage}&eventType=${eventType}`);
                    const tbody = document.getElementById('logs-table-body');

                    tbody.innerHTML = data.logs.map(log => `
                        <tr>
                            <td class="text-secondary" style="width: 160px;">${new Date(log.timestamp.seconds * 1000).toLocaleString('ja-JP')}</td>
                            <td style="width: 140px;"><span class="badge bg-light text-dark border">${escapeHTML(log.eventType)}</span></td>
                            <td style="width: 180px;">${escapeHTML(log.executorTag || 'System')}</td>
                            <td><div class="text-truncate" style="max-width: 300px;">${escapeHTML(JSON.stringify(log.details))}</div></td>
                        </tr>
                    `).join('') || '<tr><td colspan="4" class="text-center py-5">ログがありません</td></tr>';

                    document.getElementById('page-info').textContent = `ページ ${data.currentPage} / ${data.totalPages}`;
                    document.getElementById('prev-page').disabled = data.currentPage <= 1;
                    document.getElementById('next-page').disabled = data.currentPage >= data.totalPages;
                };

                document.getElementById('prev-page').onclick = () => { currentPage--; fetchAndRender(); };
                document.getElementById('next-page').onclick = () => { currentPage++; fetchAndRender(); };
                document.getElementById('log-type-filter').onchange = () => { currentPage = 1; fetchAndRender(); };
                document.getElementById('refresh-logs').onclick = fetchAndRender;

                fetchAndRender();
            },

            welcome: async () => {
                pageTitle.textContent = '参加・退出設定';
                const settings = await api.get('/api/settings/guilds');

                pageContent.innerHTML = `
                    <form id="welcome-form">
                        <div class="card border-0 shadow-sm p-4 mb-4">
                            <h6 class="fw-bold mb-4">チャンネル設定</h6>
                            <div class="row g-4">
                                <div class="col-md-6">
                                    <label class="form-label fw-bold small">ウェルカムチャンネル</label>
                                    <select id="welcomeChannelId" class="form-select">
                                        <option value="">選択しない</option>
                                        ${guildInfo.channels.filter(c => c.type === 0).map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
                                    </select>
                                    <div class="form-text small">メンバーが参加した時にメッセージを送信するチャンネルです。</div>
                                </div>
                                <div class="col-md-6">
                                    <label class="form-label fw-bold small">お別れチャンネル</label>
                                    <select id="goodbyeChannelId" class="form-select">
                                        <option value="">選択しない</option>
                                        ${guildInfo.channels.filter(c => c.type === 0).map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
                                    </select>
                                    <div class="form-text small">メンバーが退出した時にメッセージを送信するチャンネルです。</div>
                                </div>
                            </div>
                        </div>
                        <div class="card border-0 shadow-sm p-4 mb-4">
                            <h6 class="fw-bold mb-4">機能設定</h6>
                            <div class="mb-4">
                                <label class="form-label fw-bold small">自動付与ロール</label>
                                <select id="welcomeRoleId" class="form-select">
                                    <option value="">選択しない</option>
                                    ${guildInfo.roles.map(r => `<option value="${r.id}">${r.name}</option>`).join('')}
                                </select>
                                <div class="form-text small">新規メンバーに自動的に付与されるロールです。</div>
                            </div>
                            <div class="form-check form-switch p-0 d-flex justify-content-between align-items-center mb-3">
                                <label class="form-check-label fw-bold small" for="mentionOnWelcome">参加時にメンションする</label>
                                <input class="form-check-input" type="checkbox" id="mentionOnWelcome" ${settings.mentionOnWelcome ? 'checked' : ''}>
                            </div>
                            <div class="form-check form-switch p-0 d-flex justify-content-between align-items-center">
                                <label class="form-check-label fw-bold small" for="sendGoodbyeDM">退出時にDMを送信する</label>
                                <input class="form-check-input" type="checkbox" id="sendGoodbyeDM" ${settings.sendGoodbyeDM !== false ? 'checked' : ''}>
                            </div>
                        </div>
                        <button type="submit" class="btn btn-primary px-5 shadow-sm">設定を保存</button>
                    </form>
                `;

                initializeTomSelect(['#welcomeChannelId', '#goodbyeChannelId', '#welcomeRoleId'], {
                    items: [settings.welcomeChannelId, settings.goodbyeChannelId, settings.welcomeRoleId]
                });

                trackChanges('#welcome-form');
                document.getElementById('welcome-form').onsubmit = async (e) => {
                    e.preventDefault();
                    const data = {
                        welcomeChannelId: document.getElementById('welcomeChannelId').value,
                        goodbyeChannelId: document.getElementById('goodbyeChannelId').value,
                        welcomeRoleId: document.getElementById('welcomeRoleId').value,
                        mentionOnWelcome: document.getElementById('mentionOnWelcome').checked,
                        sendGoodbyeDM: document.getElementById('sendGoodbyeDM').checked
                    };
                    await api.post('/api/settings/guilds', data);
                    showToast('設定を保存しました');
                    isDirty = false;
                };
            },

            'welcome-message': async () => {
                pageTitle.textContent = '歓迎メッセージ設定';
                const settings = await api.get('/api/settings/welcome-message');

                const updatePreview = () => {
                    const type = document.getElementById('welcome-type').value;
                    const preview = document.getElementById('welcome-preview');
                    const color = document.getElementById('welcome-color').value;

                    document.getElementById('custom-fields-area').classList.toggle('d-none', type === 'gemini');

                    if (type === 'gemini') {
                        preview.innerHTML = `
                            <div class="discord-preview border-start shadow-sm" style="border-width: 5px !important; border-color: ${color} !important;">
                                <div class="fw-bold mb-1">AI自動生成メッセージ</div>
                                <div class="small opacity-75">AIがメンバーに合わせたユニークな歓迎メッセージを生成します。</div>
                            </div>
                        `;
                    } else {
                        const title = document.getElementById('welcome-title').value || 'Welcome!';
                        const desc = document.getElementById('welcome-description').value || 'サーバーへようこそ。';
                        preview.innerHTML = `
                            <div class="discord-preview border-start shadow-sm" style="border-width: 5px !important; border-color: ${color} !important;">
                                <div class="fw-bold mb-1">${escapeHTML(title)}</div>
                                <div class="small opacity-75" style="white-space: pre-wrap;">${escapeHTML(desc)}</div>
                            </div>
                        `;
                    }
                };

                pageContent.innerHTML = `
                    <div class="row g-4">
                        <div class="col-lg-7">
                            <form id="welcome-message-form" class="card border-0 shadow-sm p-4 h-100">
                                <div class="form-check form-switch mb-4 p-0 d-flex justify-content-between align-items-center">
                                    <label class="form-check-label fw-bold" for="welcome-enabled">メッセージ機能を有効にする</label>
                                    <input class="form-check-input" type="checkbox" id="welcome-enabled" ${settings.enabled ? 'checked' : ''}>
                                </div>
                                <div class="mb-4">
                                    <label class="form-label small fw-bold">メッセージ作成方式</label>
                                    <select id="welcome-type" class="form-select">
                                        <option value="default" ${settings.type === 'default' ? 'selected' : ''}>カスタムメッセージ</option>
                                        <option value="gemini" ${settings.type === 'gemini' ? 'selected' : ''}>AI生成 (Gemini)</option>
                                    </select>
                                </div>
                                <div id="custom-fields-area">
                                    <div class="mb-4">
                                        <label class="form-label small fw-bold">タイトル</label>
                                        <input type="text" id="welcome-title" class="form-control" value="${escapeHTML(settings.title)}">
                                    </div>
                                    <div class="mb-4">
                                        <label class="form-label small fw-bold">説明文</label>
                                        <textarea id="welcome-description" class="form-control" rows="5">${escapeHTML(settings.description)}</textarea>
                                        <div class="form-text small opacity-75 mt-2">
                                            利用可能な変数: <code>{user.displayName}</code>, <code>{user.mention}</code>, <code>{server.name}</code>
                                        </div>
                                    </div>
                                </div>
                                <div class="mb-4">
                                    <label class="form-label small fw-bold">埋め込みカラー</label>
                                    <input type="color" id="welcome-color" class="form-control form-control-color w-100" value="${settings.color || '#5865F2'}">
                                </div>
                                <button type="submit" class="btn btn-primary w-100 mt-auto shadow-sm">設定を保存</button>
                            </form>
                        </div>
                        <div class="col-lg-5">
                            <div class="card border-0 shadow-sm p-4">
                                <h6 class="fw-bold mb-4">プレビュー (イメージ)</h6>
                                <div id="welcome-preview"></div>
                                <div class="mt-4 p-3 bg-light rounded small text-secondary">
                                    <i class="bi bi-info-circle me-2"></i>プレビューは実際の Discord 上の表示と若干異なる場合があります。
                                </div>
                            </div>
                        </div>
                    </div>
                `;

                const form = document.getElementById('welcome-message-form');
                form.querySelectorAll('input, select, textarea').forEach(el => el.oninput = updatePreview);
                updatePreview();
                trackChanges('#welcome-message-form');

                form.onsubmit = async (e) => {
                    e.preventDefault();
                    const data = {
                        enabled: document.getElementById('welcome-enabled').checked,
                        type: document.getElementById('welcome-type').value,
                        title: document.getElementById('welcome-title').value,
                        description: document.getElementById('welcome-description').value,
                        color: document.getElementById('welcome-color').value
                    };
                    await api.post('/api/settings/welcome-message', data);
                    showToast('メッセージ設定を保存しました');
                    isDirty = false;
                };
            },

            tickets: async () => {
                pageTitle.textContent = 'チケットシステム';
                const settings = await api.get('/api/settings/tickets');
                pageContent.innerHTML = `
                    <form id="tickets-form" class="card border-0 shadow-sm p-4">
                        <div class="form-check form-switch mb-4 p-0 d-flex justify-content-between align-items-center">
                            <label class="form-check-label fw-bold" for="ticket-enabled">機能を有効にする</label>
                            <input class="form-check-input" type="checkbox" id="ticket-enabled" ${settings.enabled ? 'checked' : ''}>
                        </div>
                        <div class="row g-4 mb-4">
                            <div class="col-md-6">
                                <label class="form-label small fw-bold">チケット作成カテゴリ</label>
                                <select id="ticket-category" class="form-select">
                                    <option value="">選択しない</option>
                                    ${guildInfo.channels.filter(c => c.type === 4).map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
                                </select>
                            </div>
                            <div class="col-md-6">
                                <label class="form-label small fw-bold">サポート担当ロール</label>
                                <select id="ticket-role" class="form-select">
                                    <option value="">選択しない</option>
                                    ${guildInfo.roles.map(r => `<option value="${r.id}">${r.name}</option>`).join('')}
                                </select>
                            </div>
                        </div>
                        <div class="mb-4">
                            <label class="form-label small fw-bold">パネルのタイトル</label>
                            <input type="text" id="ticket-title" class="form-control" value="${escapeHTML(settings.title || 'お問い合わせ')}">
                        </div>
                        <div class="mb-4">
                            <label class="form-label small fw-bold">パネルの説明文</label>
                            <textarea id="ticket-description" class="form-control" rows="3">${escapeHTML(settings.description || '')}</textarea>
                        </div>
                        <button type="submit" class="btn btn-primary px-5 shadow-sm">設定を保存</button>
                    </form>
                `;
                initializeTomSelect(['#ticket-category', '#ticket-role'], {
                    items: [settings.categoryId, settings.supportRoleId]
                });
                trackChanges('#tickets-form');
                document.getElementById('tickets-form').onsubmit = async (e) => {
                    e.preventDefault();
                    const data = {
                        enabled: document.getElementById('ticket-enabled').checked,
                        categoryId: document.getElementById('ticket-category').value,
                        supportRoleId: document.getElementById('ticket-role').value,
                        title: document.getElementById('ticket-title').value,
                        description: document.getElementById('ticket-description').value
                    };
                    await api.post('/api/settings/tickets', data);
                    showToast('チケット設定を保存しました');
                    isDirty = false;
                };
            },

            automod: async () => {
                pageTitle.textContent = 'オートモッド設定';
                const settings = await api.get('/api/settings/guild_settings');
                const automod = settings.automod || { ngWords: [], blockInvites: true };

                pageContent.innerHTML = `
                    <form id="automod-form">
                        <div class="card border-0 shadow-sm p-4 mb-4">
                            <h6 class="fw-bold mb-4">NGワードフィルター</h6>
                            <div class="mb-2">
                                <label class="form-label small fw-bold">NGワード (カンマ区切り)</label>
                                <textarea id="ngWords" class="form-control" rows="4" placeholder="word1, word2, ...">${(automod.ngWords || []).join(', ')}</textarea>
                            </div>
                            <div class="form-text small">ここに入力した単語を含むメッセージは自動的に削除されます。</div>
                        </div>
                        <div class="card border-0 shadow-sm p-4 mb-4">
                            <h6 class="fw-bold mb-4">スパム防止</h6>
                            <div class="form-check form-switch p-0 d-flex justify-content-between align-items-center">
                                <label class="form-check-label fw-bold small" for="blockInvites">サーバー招待リンクを禁止する</label>
                                <input class="form-check-input" type="checkbox" id="blockInvites" ${automod.blockInvites !== false ? 'checked' : ''}>
                            </div>
                        </div>
                        <button type="submit" class="btn btn-primary px-5 shadow-sm">設定を保存</button>
                    </form>
                `;
                trackChanges('#automod-form');
                document.getElementById('automod-form').onsubmit = async (e) => {
                    e.preventDefault();
                    const data = {
                        automod: {
                            ngWords: document.getElementById('ngWords').value.split(',').map(s => s.trim()).filter(Boolean),
                            blockInvites: document.getElementById('blockInvites').checked
                        }
                    };
                    await api.post('/api/settings/guild_settings', data);
                    showToast('オートモッド設定を保存しました');
                    isDirty = false;
                };
            },

            leveling: async () => {
                pageTitle.textContent = 'レベリング設定';
                const settings = await api.get('/api/settings/guild_settings');
                const leveling = settings.leveling || { roleRewards: [] };

                pageContent.innerHTML = `
                    <form id="leveling-form">
                        <div class="card border-0 shadow-sm p-4 mb-4">
                            <h6 class="fw-bold mb-4">通知設定</h6>
                            <div class="mb-1">
                                <label class="form-label small fw-bold">レベルアップ通知チャンネル</label>
                                <select id="levelUpChannel" class="form-select">
                                    <option value="">レベルアップしたチャンネルに通知</option>
                                    ${guildInfo.channels.filter(c => c.type === 0).map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
                                </select>
                            </div>
                        </div>
                        <div class="card border-0 shadow-sm p-4 mb-4">
                            <h6 class="fw-bold mb-4">ロール報酬</h6>
                            <div id="role-rewards-list" class="mb-4"></div>
                            <div class="p-3 bg-light rounded border">
                                <div class="row g-3 align-items-end">
                                    <div class="col-md-4">
                                        <label class="form-label small fw-bold">達成レベル</label>
                                        <input type="number" id="reward-level" class="form-control" min="1" placeholder="例: 5">
                                    </div>
                                    <div class="col-md-5">
                                        <label class="form-label small fw-bold">付与するロール</label>
                                        <select id="reward-role-id" class="form-select"></select>
                                    </div>
                                    <div class="col-md-3">
                                        <button type="button" id="add-reward-btn" class="btn btn-secondary w-100">追加</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <button type="submit" class="btn btn-primary px-5 shadow-sm">設定を保存</button>
                    </form>
                `;

                const roleRewards = [...leveling.roleRewards];
                const renderRewards = () => {
                    const list = document.getElementById('role-rewards-list');
                    if (roleRewards.length === 0) {
                        list.innerHTML = '<div class="text-center py-4 text-secondary small">ロール報酬が設定されていません。</div>';
                        return;
                    }
                    list.innerHTML = `
                        <div class="list-group list-group-flush border rounded">
                            ${roleRewards.sort((a,b) => a.level - b.level).map((r, i) => `
                                <div class="list-group-item d-flex justify-content-between align-items-center py-3">
                                    <div>
                                        <span class="badge bg-primary me-2">Lv. ${r.level}</span>
                                        <span class="fw-bold">${escapeHTML(guildInfo.roles.find(role => role.id === r.roleId)?.name || '削除されたロール')}</span>
                                    </div>
                                    <button type="button" class="btn btn-sm btn-outline-danger border-0 remove-reward" data-index="${i}"><i class="bi bi-trash"></i></button>
                                </div>
                            `).join('')}
                        </div>
                    `;
                    list.querySelectorAll('.remove-reward').forEach(btn => btn.onclick = () => {
                        roleRewards.splice(btn.dataset.index, 1);
                        renderRewards();
                        isDirty = true;
                    });
                };

                const roleSelect = document.getElementById('reward-role-id');
                roleSelect.innerHTML = '<option value="">選択...</option>' + guildInfo.roles.map(r => `<option value="${r.id}">${r.name}</option>`).join('');
                initializeTomSelect(roleSelect);
                initializeTomSelect('#levelUpChannel', { items: [settings.levelUpChannel] });

                renderRewards();
                trackChanges('#leveling-form');

                document.getElementById('add-reward-btn').onclick = () => {
                    const level = parseInt(document.getElementById('reward-level').value);
                    const roleId = roleSelect.tomselect.getValue();
                    if (!level || !roleId) return showToast('レベルとロールを入力してください', 'warning');
                    if (roleRewards.some(r => r.level === level)) return showToast('このレベルの報酬は既に存在します', 'warning');
                    roleRewards.push({ level, roleId });
                    renderRewards();
                    isDirty = true;
                };

                document.getElementById('leveling-form').onsubmit = async (e) => {
                    e.preventDefault();
                    await api.post('/api/settings/guild_settings', {
                        levelUpChannel: document.getElementById('levelUpChannel').value || null,
                        leveling: { roleRewards }
                    });
                    showToast('レベリング設定を保存しました');
                    isDirty = false;
                };
            },

            ai: async () => {
                pageTitle.textContent = 'AI設定';
                const settings = await api.get('/api/settings/guild_settings');
                const ai = settings.ai || { mentionReplyEnabled: true, aiPersonalityPrompt: '' };

                pageContent.innerHTML = `
                    <form id="ai-form">
                        <div class="card border-0 shadow-sm p-4 mb-4">
                            <h6 class="fw-bold mb-4">メンション応答</h6>
                            <div class="form-check form-switch p-0 d-flex justify-content-between align-items-center">
                                <label class="form-check-label fw-bold small" for="mentionReplyEnabled">メンションされた際にAIが自動で返信する</label>
                                <input class="form-check-input" type="checkbox" id="mentionReplyEnabled" ${ai.mentionReplyEnabled ? 'checked' : ''}>
                            </div>
                        </div>
                        <div class="card border-0 shadow-sm p-4 mb-4">
                            <h6 class="fw-bold mb-4">AIの性格・指示</h6>
                            <div class="mb-3">
                                <label class="form-label small fw-bold">システムプロンプト (指示)</label>
                                <textarea id="aiPersonalityPrompt" class="form-control" rows="8" placeholder="例: あなたは親切な猫型ロボットです。語尾に「ニャ」を付けて話してください。">${escapeHTML(ai.aiPersonalityPrompt)}</textarea>
                            </div>
                            <div class="p-3 bg-light rounded border small text-secondary">
                                <i class="bi bi-lightbulb me-2 text-warning"></i>AIの口調や知識、守るべきルールを指定できます。
                            </div>
                        </div>
                        <button type="submit" class="btn btn-primary px-5 shadow-sm">設定を保存</button>
                    </form>
                `;
                trackChanges('#ai-form');
                document.getElementById('ai-form').onsubmit = async (e) => {
                    e.preventDefault();
                    await api.post('/api/settings/guild_settings', {
                        ai: {
                            mentionReplyEnabled: document.getElementById('mentionReplyEnabled').checked,
                            aiPersonalityPrompt: document.getElementById('aiPersonalityPrompt').value
                        }
                    });
                    showToast('AI設定を保存しました');
                    isDirty = false;
                };
            },

            roleboard: async () => {
                pageTitle.textContent = 'ロールボード';
                const boards = await api.get('/api/roleboards');

                pageContent.innerHTML = `
                    <div class="card border-0 shadow-sm p-4 mb-4">
                        <div class="d-flex justify-content-between align-items-center mb-4">
                            <h6 class="fw-bold mb-0">作成済みのパネル</h6>
                            <button class="btn btn-primary btn-sm px-3" id="create-roleboard">新規作成</button>
                        </div>
                        <div class="row g-3" id="roleboard-list"></div>
                    </div>
                `;

                const list = document.getElementById('roleboard-list');
                if (boards.length === 0) {
                    list.innerHTML = '<div class="col-12 text-center py-5 text-secondary small">ロールボードがまだありません。</div>';
                } else {
                    list.innerHTML = boards.map(b => `
                        <div class="col-md-6">
                            <div class="card h-100 border p-3 shadow-none">
                                <div class="d-flex justify-content-between align-items-start mb-2">
                                    <h6 class="fw-bold mb-1">${escapeHTML(b.title)}</h6>
                                    <div class="dropdown">
                                        <button class="btn btn-light btn-sm" data-bs-toggle="dropdown"><i class="bi bi-three-dots-vertical"></i></button>
                                        <ul class="dropdown-menu dropdown-menu-end shadow border-0">
                                            <li><a class="dropdown-item edit-board" href="javascript:void(0)" data-id="${b.id}">編集</a></li>
                                            <li><hr class="dropdown-divider"></li>
                                            <li><a class="dropdown-item text-danger delete-board" href="javascript:void(0)" data-id="${b.id}">削除</a></li>
                                        </ul>
                                    </div>
                                </div>
                                <div class="small text-secondary mb-3 text-truncate-2">${escapeHTML(b.description)}</div>
                                <div class="mt-auto d-flex gap-2">
                                    <span class="badge bg-light text-dark border fw-normal">${Object.keys(b.roles || {}).length} ロール</span>
                                </div>
                            </div>
                        </div>
                    `).join('');
                }

                document.getElementById('create-roleboard').onclick = () => App.showRoleboardModal();
                list.querySelectorAll('.edit-board').forEach(btn => btn.onclick = () => App.showRoleboardModal(btn.dataset.id));
                list.querySelectorAll('.delete-board').forEach(btn => btn.onclick = async () => {
                    if (await confirmAction('削除の確認', 'このロールボードを削除しますか？', '削除する', 'btn-danger')) {
                        await api.delete(`/api/roleboards/${btn.dataset.id}`);
                        showToast('削除しました');
                        App.renderers.roleboard();
                    }
                });
            },

            'vc-log': async () => {
                pageTitle.textContent = 'VCログ設定';
                const settings = await api.get('/api/settings/guild_settings');
                const mappings = settings.voiceChannelMappings || {};

                pageContent.innerHTML = `
                    <div class="card border-0 shadow-sm p-4 mb-4">
                        <h6 class="fw-bold mb-4">VC入退出の通知設定</h6>
                        <div id="vc-mappings-list" class="mb-4"></div>
                        <div class="p-3 bg-light rounded border">
                            <div class="row g-3 align-items-end">
                                <div class="col-md-4">
                                    <label class="form-label small fw-bold">ボイスチャンネル</label>
                                    <select id="vc-select" class="form-select">
                                        ${guildInfo.channels.filter(c => c.type === 2).map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
                                    </select>
                                </div>
                                <div class="col-md-5">
                                    <label class="form-label small fw-bold">通知先チャンネル</label>
                                    <select id="tc-select" class="form-select">
                                        ${guildInfo.channels.filter(c => c.type === 0).map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
                                    </select>
                                </div>
                                <div class="col-md-3">
                                    <button type="button" id="add-mapping-btn" class="btn btn-secondary w-100">追加</button>
                                </div>
                            </div>
                        </div>
                    </div>
                    <button id="save-vc-logs" class="btn btn-primary px-5 shadow-sm">設定を保存</button>
                `;

                const currentMappings = { ...mappings };
                const render = () => {
                    const list = document.getElementById('vc-mappings-list');
                    const entries = Object.entries(currentMappings);
                    if (entries.length === 0) {
                        list.innerHTML = '<div class="text-center py-4 text-secondary small">設定がありません。</div>';
                        return;
                    }
                    list.innerHTML = `
                        <div class="list-group list-group-flush border rounded">
                            ${entries.map(([vcId, config]) => `
                                <div class="list-group-item d-flex justify-content-between align-items-center py-3">
                                    <div>
                                        <i class="bi bi-mic-fill text-secondary me-2"></i>
                                        <span class="fw-bold">${escapeHTML(guildInfo.channels.find(c => c.id === vcId)?.name || '削除されたVC')}</span>
                                        <i class="bi bi-arrow-right mx-2 text-secondary"></i>
                                        <i class="bi bi-chat-text-fill text-secondary me-1"></i>
                                        <span>${escapeHTML(guildInfo.channels.find(c => c.id === (config.textChannelId || config))?.name || '削除されたTC')}</span>
                                    </div>
                                    <button class="btn btn-sm btn-outline-danger border-0 remove-mapping" data-vc="${vcId}"><i class="bi bi-trash"></i></button>
                                </div>
                            `).join('')}
                        </div>
                    `;
                    list.querySelectorAll('.remove-mapping').forEach(btn => btn.onclick = () => {
                        delete currentMappings[btn.dataset.vc];
                        render();
                        isDirty = true;
                    });
                };

                initializeTomSelect(['#vc-select', '#tc-select']);
                render();

                document.getElementById('add-mapping-btn').onclick = () => {
                    const vcId = document.getElementById('vc-select').tomselect.getValue();
                    const tcId = document.getElementById('tc-select').tomselect.getValue();
                    if (!vcId || !tcId) return;
                    currentMappings[vcId] = tcId;
                    render();
                    isDirty = true;
                };

                document.getElementById('save-vc-logs').onclick = async () => {
                    await api.post('/api/settings/guild_settings', { voiceChannelMappings: currentMappings });
                    showToast('VCログ設定を保存しました');
                    isDirty = false;
                };
            }
        },

        showRoleboardModal: async (id = null) => {
            const boards = await api.get('/api/roleboards');
            const b = id ? boards.find(x => x.id === id) : { title: '', description: '', roles: {} };

            const modalId = 'rb-modal-' + Date.now();
            const modalHtml = `
                <div class="modal fade" id="${modalId}" tabindex="-1">
                    <div class="modal-dialog modal-lg">
                        <div class="modal-content border-0 shadow">
                            <div class="modal-header">
                                <h5 class="modal-title fw-bold">${id ? '編集' : '新規作成'}</h5>
                                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                            </div>
                            <div class="modal-body p-4">
                                <div class="mb-3">
                                    <label class="form-label fw-bold small">タイトル</label>
                                    <input type="text" id="rb-title" class="form-control" value="${escapeHTML(b.title)}">
                                </div>
                                <div class="mb-3">
                                    <label class="form-label fw-bold small">説明文</label>
                                    <textarea id="rb-desc" class="form-control" rows="3">${escapeHTML(b.description)}</textarea>
                                </div>
                                <hr class="my-4">
                                <div class="d-flex justify-content-between align-items-center mb-3">
                                    <h6 class="fw-bold mb-0 small">ロール設定</h6>
                                    <button class="btn btn-outline-primary btn-sm" id="rb-add-role-row">ロール追加</button>
                                </div>
                                <div id="rb-roles-area" class="mb-3"></div>
                            </div>
                            <div class="modal-footer border-0">
                                <button type="button" class="btn btn-light" data-bs-dismiss="modal">キャンセル</button>
                                <button type="button" class="btn btn-primary px-5" id="${modalId}-save">保存</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            document.body.insertAdjacentHTML('beforeend', modalHtml);
            const roles = { ...b.roles };

            const renderRoleRows = () => {
                const area = document.getElementById('rb-roles-area');
                const entries = Object.entries(roles);
                if (entries.length === 0) {
                    area.innerHTML = '<div class="text-center py-3 text-secondary small bg-light rounded">ロールが追加されていません。</div>';
                    return;
                }
                area.innerHTML = entries.map(([rid, data], idx) => `
                    <div class="row g-2 mb-2 align-items-center role-row" data-id="${rid}">
                        <div class="col-6">
                            <select class="form-select form-select-sm rb-role-select" data-prev="${rid}">
                                ${guildInfo.roles.map(r => `<option value="${r.id}" ${r.id === rid ? 'selected' : ''}>${r.name}</option>`).join('')}
                            </select>
                        </div>
                        <div class="col-4">
                            <input type="text" class="form-control form-control-sm rb-role-genre" value="${escapeHTML(data.genre)}" placeholder="ジャンル名">
                        </div>
                        <div class="col-2 text-end">
                            <button class="btn btn-sm btn-outline-danger border-0 rb-del-role"><i class="bi bi-trash"></i></button>
                        </div>
                    </div>
                `).join('');

                area.querySelectorAll('.rb-del-role').forEach(btn => btn.onclick = (e) => {
                    const row = e.target.closest('.role-row');
                    delete roles[row.dataset.id];
                    renderRoleRows();
                });
            };

            renderRoleRows();

            document.getElementById('rb-add-role-row').onclick = () => {
                const firstRole = guildInfo.roles[0]?.id;
                if (!firstRole || roles[firstRole]) return;
                roles[firstRole] = { name: guildInfo.roles[0].name, genre: 'Default', emoji: null };
                renderRoleRows();
            };

            const bsModal = new bootstrap.Modal(document.getElementById(modalId));
            bsModal.show();

            document.getElementById(`${modalId}-save`).onclick = async () => {
                const finalRoles = {};
                const genres = {};
                document.querySelectorAll('.role-row').forEach(row => {
                    const rid = row.querySelector('.rb-role-select').value;
                    const genre = row.querySelector('.rb-role-genre').value || 'Default';
                    const name = guildInfo.roles.find(r => r.id === rid)?.name || 'Unknown';
                    finalRoles[rid] = { name, genre, emoji: null };
                    if (!genres[genre]) genres[genre] = [];
                    genres[genre].push(rid);
                });

                const data = {
                    title: document.getElementById('rb-title').value,
                    description: document.getElementById('rb-desc').value,
                    roles: finalRoles,
                    genres: genres,
                    color: 0x5865F2 // Default
                };

                if (id) await api.put(`/api/roleboards/${id}`, data);
                else await api.post('/api/roleboards', data);

                showToast('保存しました');
                bsModal.hide();
                App.renderers.roleboard();
            };
        }
    };

    App.init();
});
