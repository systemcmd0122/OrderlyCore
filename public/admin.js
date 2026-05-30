document.addEventListener('DOMContentLoaded', async () => {
    const pageArea = document.getElementById('page-area');
    const pageTitle = document.getElementById('admin-page-title');
    const botBadge = document.getElementById('bot-info-badge');
    const loader = document.getElementById('admin-loader');
    const content = document.getElementById('admin-content');
    const navLinks = document.querySelectorAll('.nav-link[data-page]');

    const api = {
        _request: async (ep, opt = {}) => {
            const res = await fetch(ep, opt);
            if (res.status === 401) { window.location.href = '/admin-login.html'; return; }
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Admin API Error');
            return data;
        },
        get: (ep) => api._request(ep),
        post: (ep, body) => api._request(ep, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        })
    };

    const App = {
        init: async () => {
            try {
                const stats = await api.get('/api/admin/stats');
                botBadge.innerHTML = `<img src="${stats.bot.avatar}" width="20" class="rounded-circle me-2"> ${stats.bot.username}`;

                window.onhashchange = App.handleRoute;
                await App.handleRoute();

                loader.style.display = 'none';
                content.style.display = 'block';
            } catch (err) {
                loader.innerHTML = `<div class="alert alert-danger mx-auto" style="max-width:400px;">認証エラーまたは情報の取得に失敗しました。</div>`;
            }
        },

        handleRoute: async () => {
            const page = window.location.hash.substring(1) || 'stats';
            navLinks.forEach(l => l.classList.toggle('active', l.dataset.page === page));
            pageArea.innerHTML = '<div class="text-center p-5"><div class="spinner-border text-primary border-3" role="status"></div></div>';

            if (App.renderers[page]) await App.renderers[page]();
            else pageArea.innerHTML = '<div class="alert alert-warning">ページが見つかりません。</div>';
        },

        renderers: {
            stats: async () => {
                pageTitle.textContent = 'システム状況';
                const stats = await api.get('/api/admin/stats');
                pageArea.innerHTML = `
                    <div class="row g-4 mb-4">
                        <div class="col-md-3">
                            <div class="card p-3 border-0 shadow-sm text-center">
                                <div class="text-secondary small fw-bold mb-1">ギルド数</div>
                                <div class="h3 fw-bold mb-0">${stats.guildCount}</div>
                            </div>
                        </div>
                        <div class="col-md-3">
                            <div class="card p-3 border-0 shadow-sm text-center">
                                <div class="text-secondary small fw-bold mb-1">総ユーザー数</div>
                                <div class="h3 fw-bold mb-0">${stats.userCount.toLocaleString()}</div>
                            </div>
                        </div>
                        <div class="col-md-3">
                            <div class="card p-3 border-0 shadow-sm text-center">
                                <div class="text-secondary small fw-bold mb-1">Uptime</div>
                                <div class="h3 fw-bold mb-0 text-primary">${stats.uptime}</div>
                            </div>
                        </div>
                        <div class="col-md-3">
                            <div class="card p-3 border-0 shadow-sm text-center">
                                <div class="text-secondary small fw-bold mb-1">Memory</div>
                                <div class="h3 fw-bold mb-0">${stats.memoryUsage} MB</div>
                            </div>
                        </div>
                    </div>
                    <div class="card border-0 shadow-sm p-4">
                        <h6 class="fw-bold mb-3">トップサーバー (メンバー数順)</h6>
                        <div class="table-responsive">
                            <table class="table table-hover align-middle small mb-0">
                                <thead><tr><th>サーバー</th><th>メンバー</th><th>ID</th></tr></thead>
                                <tbody>
                                    ${stats.topGuilds.map(g => `
                                        <tr>
                                            <td><img src="${g.icon}" width="24" class="rounded me-2"> ${g.name}</td>
                                            <td>${g.memberCount}</td>
                                            <td class="text-secondary small">${g.id}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                `;
            },

            guilds: async () => {
                pageTitle.textContent = 'サーバー一覧';
                const data = await api.get('/api/admin/guilds');
                pageArea.innerHTML = `
                    <div class="card border-0 shadow-sm p-4">
                        <div class="table-responsive">
                            <table class="table table-hover align-middle small">
                                <thead class="table-light"><tr><th>アイコン</th><th>名前</th><th>メンバー</th><th>オーナーID</th><th>操作</th></tr></thead>
                                <tbody>
                                    ${data.guilds.map(g => `
                                        <tr>
                                            <td><img src="${g.icon}" width="32" class="rounded"></td>
                                            <td class="fw-bold">${g.name}</td>
                                            <td>${g.memberCount}</td>
                                            <td class="text-secondary small">${g.ownerId}</td>
                                            <td><button class="btn btn-outline-danger btn-sm leave-guild" data-id="${g.id}">退出</button></td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                `;
                document.querySelectorAll('.leave-guild').forEach(btn => btn.onclick = async () => {
                    if (confirm('本当にこのサーバーから退出しますか？')) {
                        await api.post(`/api/admin/guilds/${btn.dataset.id}/leave`);
                        alert('退出しました');
                        App.renderers.guilds();
                    }
                });
            },

            announce: async () => {
                pageTitle.textContent = '全体お知らせ';
                pageArea.innerHTML = `
                    <div class="card border-0 shadow-sm p-4" style="max-width: 600px;">
                        <form id="announce-form">
                            <div class="mb-3"><label class="form-label small fw-bold">タイトル</label><input type="text" id="ann-title" class="form-control" required></div>
                            <div class="mb-3"><label class="form-label small fw-bold">内容</label><textarea id="ann-desc" class="form-control" rows="5" required></textarea></div>
                            <div class="mb-3"><label class="form-label small fw-bold">カラー (HEX)</label><input type="text" id="ann-color" class="form-control" value="#5865F2"></div>
                            <button type="submit" class="btn btn-primary w-100 fw-bold">配信開始</button>
                        </form>
                    </div>
                `;
                document.getElementById('announce-form').onsubmit = async (e) => {
                    e.preventDefault();
                    if (!confirm('全サーバーのお知らせチャンネルへ配信します。よろしいですか？')) return;
                    await api.post('/api/admin/announce', {
                        title: document.getElementById('ann-title').value,
                        description: document.getElementById('ann-desc').value,
                        color: document.getElementById('ann-color').value
                    });
                    alert('配信完了');
                };
            },

            maintenance: async () => {
                pageTitle.textContent = 'メンテナンス設定';
                const status = await api.get('/api/admin/maintenance');
                pageArea.innerHTML = `
                    <div class="card border-0 shadow-sm p-4" style="max-width: 500px;">
                        <div class="form-check form-switch mb-3">
                            <input class="form-check-input" type="checkbox" id="maint-enabled" ${status.enabled ? 'checked' : ''}>
                            <label class="form-check-label fw-bold" for="maint-enabled">メンテナンスモードを有効化</label>
                        </div>
                        <div class="mb-3">
                            <label class="form-label small fw-bold">理由</label>
                            <input type="text" id="maint-reason" class="form-control" value="${status.reason || ''}" placeholder="システム更新のため...">
                        </div>
                        <button id="save-maint" class="btn btn-dark w-100">設定を適用</button>
                    </div>
                `;
                document.getElementById('save-maint').onclick = async () => {
                    await api.post('/api/admin/maintenance', {
                        enabled: document.getElementById('maint-enabled').checked,
                        reason: document.getElementById('maint-reason').value
                    });
                    alert('適用しました');
                };
            }
        }
    };

    App.init();
});
