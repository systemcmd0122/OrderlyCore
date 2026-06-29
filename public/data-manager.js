document.addEventListener('DOMContentLoaded', async () => {
    const loader              = document.getElementById('loader');
    const dashboardWrapper    = document.querySelector('.dashboard-wrapper');
    const logoutBtn           = document.getElementById('logout-btn');
    const menuToggle          = document.getElementById('menu-toggle');
    const sidebar             = document.querySelector('.sidebar');
    const collectionSelect    = document.getElementById('collection-select');
    const collectionData      = document.getElementById('collection-data');
    const collectionsOverview = document.getElementById('collections-overview');

    // 現在表示中のコレクション・ページを追跡
    let currentCollection = '';
    let currentPage       = 1;
    let autoRefreshInterval = null;
    let isRefreshing      = false;

    /* ─── API ─────────────────────────────────────────────────── */
    const api = {
        _request: async (endpoint, options = {}) => {
            try {
                const res  = await fetch(endpoint, options);
                if (res.status === 401) { window.location.href = '/login'; throw new Error('Unauthorized'); }
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || `Request failed with status ${res.status}`);
                return data;
            } catch (err) {
                console.error(`API error on ${endpoint}:`, err);
                if (err.message !== 'Unauthorized') showMessage(`Error: ${err.message}`, 'error');
                throw err;
            }
        },
        get:    (ep)       => api._request(ep),
        post:   (ep, body) => api._request(ep, { method: 'POST',   headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
        delete: (ep)       => api._request(ep, { method: 'DELETE' })
    };

    /* ─── Toast ───────────────────────────────────────────────── */
    const showMessage = (text, type = 'success') => {
        const el = document.createElement('div');
        el.className = `message-toast ${type}`;
        el.textContent = text;
        document.body.appendChild(el);
        setTimeout(() => el.classList.add('show'), 10);
        setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3200);
    };

    /* ─── Modal ───────────────────────────────────────────────── */
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
        if (backdrop) {
            backdrop.classList.remove('show');
            setTimeout(() => backdrop.remove(), 280);
        }
    };

    /* ─── Collections Overview ────────────────────────────────── */
    const COLLECTION_LABELS = {
        levels:     'レベル',
        warnings:   '警告',
        audit_logs: '監査ログ',
        quotes:     '引用',
        roleboards: 'ロール',
        tickets:    'チケット'
    };

    const COLLECTION_ICONS = {
        levels:     'trending-up',
        warnings:   'alert-triangle',
        audit_logs: 'list',
        quotes:     'message-square',
        roleboards: 'grid',
        tickets:    'life-buoy'
    };

    const COLLECTION_COLORS = {
        levels:     'var(--cyan)',
        warnings:   'var(--warning)',
        audit_logs: 'var(--violet)',
        quotes:     'var(--success)',
        roleboards: 'var(--primary)',
        tickets:    'var(--error)'
    };

    // 最終更新ラベル更新
    const updateLastRefreshedLabel = () => {
        const el = document.getElementById('last-refreshed-label');
        if (el) el.textContent = `最終更新: ${new Date().toLocaleTimeString('ja-JP')}`;
    };

    const loadCollectionsOverview = async (silent = false) => {
        try {
            const data = await api.get('/api/data-manager/collections');

            const newHtml = Object.entries(data).map(([name, count]) => `
                <div class="stat-card overview-card" data-collection="${name}" style="flex-direction:column;text-align:center;padding:18px 14px;cursor:pointer;transition:all 0.15s;">
                    <div class="stat-icon" style="margin:0 auto 10px;background:rgba(0,0,0,0.2);color:${COLLECTION_COLORS[name] || 'var(--primary)'};">
                        <i data-feather="${COLLECTION_ICONS[name] || 'database'}"></i>
                    </div>
                    <div class="stat-value" style="font-size:1.6rem;">${count.toLocaleString()}</div>
                    <div class="stat-label">${COLLECTION_LABELS[name] || name}</div>
                </div>
            `).join('');

            if (!silent || collectionsOverview.innerHTML === '') {
                collectionsOverview.innerHTML = newHtml;
            } else {
                // サイレント更新: 数値だけ更新（チラつき防止）
                Object.entries(data).forEach(([name, count]) => {
                    const card = collectionsOverview.querySelector(`[data-collection="${name}"] .stat-value`);
                    if (card) card.textContent = count.toLocaleString();
                });
            }

            feather.replace();

            // カードクリックでそのコレクションを選択
            collectionsOverview.querySelectorAll('.overview-card').forEach(card => {
                card.addEventListener('click', () => {
                    const col = card.dataset.collection;
                    if (collectionSelect) {
                        collectionSelect.value = col;
                        // TomSelectの場合
                        if (collectionSelect.tomselect) {
                            collectionSelect.tomselect.setValue(col);
                        }
                    }
                    currentCollection = col;
                    currentPage = 1;
                    loadCollectionData(col, 1);
                });
            });

            updateLastRefreshedLabel();
        } catch (error) {
            if (!silent) {
                collectionsOverview.innerHTML = `<p style="color:var(--error);padding:16px;">読込失敗: ${error.message}</p>`;
            }
        }
    };

    /* ─── Collection Data Viewer ──────────────────────────────── */
    const loadCollectionData = async (collectionName, page = 1, silent = false) => {
        if (!collectionName) {
            collectionData.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:24px 0;">コレクションを選択してください</p>';
            return;
        }

        currentCollection = collectionName;
        currentPage = page;

        if (!silent) {
            collectionData.innerHTML = '<div class="loader-ring" style="margin:24px auto;"></div>';
        }

        try {
            const result = await api.get(`/api/data-manager/${collectionName}?page=${page}&limit=20`);

            if (!result || !result.data) {
                collectionData.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:24px 0;">データの取得に失敗しました</p>';
                return;
            }

            if (result.data.length === 0 && page === 1) {
                collectionData.innerHTML = `
                    <div style="text-align:center;padding:40px;color:var(--text-muted);">
                        <i data-feather="inbox" style="width:48px;height:48px;opacity:0.3;margin-bottom:12px;"></i>
                        <p>このコレクションにデータはありません</p>
                    </div>`;
                feather.replace();
                return;
            }

            const newHtml = `
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <button id="delete-all-btn" class="btn btn-danger btn-small">
                            <i data-feather="trash-2"></i> 全削除
                        </button>
                        <span style="font-size:0.8rem;color:var(--text-muted);">合計: ${result.totalItems.toLocaleString()}件</span>
                    </div>
                    <div class="pagination-controls" style="margin:0;padding:10px 16px;">
                        <button class="btn btn-secondary btn-small" id="prev-page" ${page <= 1 ? 'disabled' : ''}>← 前</button>
                        <span class="page-info">${page} / ${result.totalPages}</span>
                        <button class="btn btn-secondary btn-small" id="next-page" ${page >= result.totalPages ? 'disabled' : ''}>次 →</button>
                    </div>
                </div>
                <div class="table-container">
                    <table class="styled-table">
                        <thead>
                            <tr>
                                <th style="width:200px;">ID</th>
                                <th>データ</th>
                                <th style="width:80px;">操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${result.data.map(item => `
                                <tr>
                                    <td><code style="font-family:var(--font-mono);font-size:0.78em;color:var(--text-muted);">${escapeHTML(item.id)}</code></td>
                                    <td>
                                        <pre style="max-width:540px;overflow:auto;font-size:0.76em;padding:10px 12px;background:var(--bg-void);border-radius:var(--r-xs);border:1px solid var(--border-subtle);color:var(--text-secondary);white-space:pre-wrap;word-break:break-all;">${escapeHTML(JSON.stringify(item, null, 2))}</pre>
                                    </td>
                                    <td>
                                        <button class="btn btn-danger btn-small delete-item-btn" data-id="${escapeHTML(item.id)}">削除</button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;

            collectionData.innerHTML = newHtml;
            feather.replace();

            document.getElementById('prev-page').onclick = () => loadCollectionData(collectionName, page - 1);
            document.getElementById('next-page').onclick = () => loadCollectionData(collectionName, page + 1);

            document.querySelectorAll('.delete-item-btn').forEach(btn => {
                btn.onclick = () => deleteItem(collectionName, btn.dataset.id, page);
            });

            document.getElementById('delete-all-btn').onclick = () => deleteAllItems(collectionName);

        } catch (error) {
            if (!silent) {
                collectionData.innerHTML = `<p style="color:var(--error);padding:16px;">読込失敗: ${error.message}</p>`;
            }
        }
    };

    const escapeHTML = (str) => {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    };

    /* ─── Delete actions ──────────────────────────────────────── */
    const deleteItem = async (collectionName, itemId, page = 1) => {
        createModal('削除の確認',
            '<p>このデータを削除してもよろしいですか？</p><p style="color:var(--error);margin-top:8px;font-size:0.88rem;">[WARN] この操作は取り消せません。</p>',
            [
                { id: 'cancel-delete',  text: 'キャンセル', class: 'btn-secondary' },
                { id: 'confirm-delete', text: '削除する',   class: 'btn-danger' }
            ]
        );
        document.getElementById('cancel-delete').onclick  = closeModal;
        document.getElementById('confirm-delete').onclick = async () => {
            const btn = document.getElementById('confirm-delete');
            btn.disabled = true;
            btn.textContent = '削除中...';
            try {
                await api.delete(`/api/data-manager/${collectionName}/${itemId}`);
                showMessage('データを削除しました');
                closeModal();
                await Promise.all([
                    loadCollectionData(collectionName, page),
                    loadCollectionsOverview(true)
                ]);
            } catch (error) {
                showMessage(`削除失敗: ${error.message}`, 'error');
                btn.disabled = false;
                btn.textContent = '削除する';
            }
        };
    };

    const deleteAllItems = async (collectionName) => {
        const label = COLLECTION_LABELS[collectionName] || collectionName;
        createModal('全削除の確認',
            `<p><strong>${escapeHTML(label)}</strong> コレクションの<strong>全データ</strong>を削除してもよろしいですか？</p><p style="color:var(--error);margin-top:10px;font-weight:600;">[WARN] この操作は絶対に取り消せません！</p>`,
            [
                { id: 'cancel-delete-all',  text: 'キャンセル', class: 'btn-secondary' },
                { id: 'confirm-delete-all', text: '全て削除',   class: 'btn-danger' }
            ]
        );
        document.getElementById('cancel-delete-all').onclick  = closeModal;
        document.getElementById('confirm-delete-all').onclick = async () => {
            const btn = document.getElementById('confirm-delete-all');
            btn.disabled = true;
            btn.textContent = '削除中...';
            try {
                const result = await api.delete(`/api/data-manager/${collectionName}`);
                showMessage(`${result.count}件のデータを削除しました`);
                closeModal();
                currentPage = 1;
                await Promise.all([
                    loadCollectionData(collectionName, 1),
                    loadCollectionsOverview(true)
                ]);
            } catch (error) {
                showMessage(`削除失敗: ${error.message}`, 'error');
                btn.disabled = false;
                btn.textContent = '全て削除';
            }
        };
    };

    /* ─── Auto Refresh ────────────────────────────────────────── */
    const startAutoRefresh = () => {
        if (autoRefreshInterval) clearInterval(autoRefreshInterval);

        autoRefreshInterval = setInterval(async () => {
            if (isRefreshing) return;
            isRefreshing = true;
            try {
                await loadCollectionsOverview(true);
                if (currentCollection) {
                    await loadCollectionData(currentCollection, currentPage, true);
                }
            } catch (e) {
                console.warn('Auto refresh error:', e);
            } finally {
                isRefreshing = false;
            }
        }, 15000); // 15秒ごとに自動更新
    };

    const stopAutoRefresh = () => {
        if (autoRefreshInterval) {
            clearInterval(autoRefreshInterval);
            autoRefreshInterval = null;
        }
    };

    // ページ離脱時にクリア
    window.addEventListener('beforeunload', stopAutoRefresh);

    /* ─── Init ────────────────────────────────────────────────── */
    const init = async () => {
        try {
            const guildInfo = await api.get('/api/guild-info');
            document.getElementById('server-name').textContent = guildInfo.name;
            document.getElementById('server-icon').src = guildInfo.icon || '/image_fc291c.png';

            await loadCollectionsOverview();

            loader.style.display   = 'none';
            dashboardWrapper.style.display = 'flex';

            // 手動更新ボタン
            const refreshBtn = document.getElementById('refresh-btn');
            if (refreshBtn) {
                refreshBtn.addEventListener('click', async () => {
                    refreshBtn.disabled = true;
                    refreshBtn.innerHTML = '<div class="loader-ring-small"></div>';
                    try {
                        await loadCollectionsOverview();
                        if (currentCollection) {
                            await loadCollectionData(currentCollection, currentPage);
                        }
                        showMessage('データを更新しました');
                    } catch (e) {
                        showMessage('更新失敗', 'error');
                    } finally {
                        refreshBtn.disabled = false;
                        refreshBtn.innerHTML = '<i data-feather="refresh-cw"></i> 更新';
                        feather.replace();
                    }
                });
            }

            // コレクション選択
            if (collectionSelect) {
                collectionSelect.addEventListener('change', (e) => {
                    currentPage = 1;
                    loadCollectionData(e.target.value);
                });
            }

            // ログアウト
            if (logoutBtn) {
                logoutBtn.addEventListener('click', () => {
                    createModal('ログアウトの確認',
                        '<p>本当にログアウトしますか？</p>',
                        [
                            { id: 'cancel-logout',  text: 'キャンセル', class: 'btn-secondary' },
                            { id: 'confirm-logout', text: 'ログアウト', class: 'btn-danger' }
                        ]
                    );
                    document.getElementById('cancel-logout').onclick  = closeModal;
                    document.getElementById('confirm-logout').onclick = async () => {
                        try {
                            await api.post('/api/logout', {});
                            window.location.href = '/login';
                        } catch (err) {
                            showMessage('ログアウトに失敗しました', 'error');
                        }
                    };
                });
            }

            // サイドバートグル
            if (menuToggle) {
                menuToggle.addEventListener('click', () => sidebar.classList.toggle('is-open'));
            }

            // リアルタイム自動更新開始
            startAutoRefresh();

        } catch (error) {
            console.error('Init error:', error);
            loader.innerHTML = `
                <div style="text-align:center;padding:24px;">
                    <p style="color:var(--error);font-weight:600;margin-bottom:16px;">情報の読み込みに失敗しました。</p>
                    <p style="color:var(--text-muted);font-size:0.88rem;margin-bottom:20px;">エラー: ${error.message}</p>
                    <a href="/login"     class="btn"              style="margin:0 6px;">ログインページへ</a>
                    <a href="/dashboard" class="btn btn-secondary" style="margin:0 6px;">ダッシュボードに戻る</a>
                </div>
            `;
        }
    };

    init();
});