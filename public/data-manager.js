document.addEventListener('DOMContentLoaded', async () => {
    const loader = document.getElementById('loader');
    const dashboardWrapper = document.querySelector('.dashboard-wrapper');
    const logoutBtn = document.getElementById('logout-btn');
    const menuToggle = document.getElementById('menu-toggle');
    const sidebar = document.querySelector('.sidebar');
    const collectionSelect = document.getElementById('collection-select');
    const collectionData = document.getElementById('collection-data');
    const collectionsOverview = document.getElementById('collections-overview');

    const api = {
        _request: async (endpoint, options = {}) => {
            try {
                const res = await fetch(endpoint, options);
                if (res.status === 401) {
                    console.log('Unauthorized, redirecting to login...');
                    window.location.href = '/login';
                    throw new Error('Unauthorized');
                }
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || `Request failed with status ${res.status}`);
                return data;
            } catch (err) {
                console.error(`API request error on ${endpoint}:`, err);
                if (err.message !== 'Unauthorized') {
                    showMessage(`Error: ${err.message}`, 'error');
                }
                throw err;
            }
        },
        get: (endpoint) => api._request(endpoint),
        post: (endpoint, body) => api._request(endpoint, {
            method: 'POST',
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
        }, 3000);
    };

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

    const loadCollectionsOverview = async () => {
        try {
            console.log('Fetching collections overview...');
            const data = await api.get('/api/data-manager/collections');
            console.log('Collections data received:', data);
            
            const collectionNames = {
                levels: 'レベルデータ',
                warnings: '警告データ',
                audit_logs: '監査ログ',
                quotes: '引用データ',
                roleboards: 'ロールボード'
            };

            collectionsOverview.innerHTML = Object.entries(data).map(([name, count]) => `
                <div class="stat-card" style="padding: 20px;">
                    <div class="stat-label">${collectionNames[name] || name}</div>
                    <div class="stat-value">${count.toLocaleString()}</div>
                    <div class="stat-label" style="font-size: 0.9em; color: var(--text-muted-color);">件</div>
                </div>
            `).join('');
            
            console.log('Collections overview rendered');
        } catch (error) {
            console.error('Error loading collections overview:', error);
            collectionsOverview.innerHTML = `<p class="message error">読込失敗: ${error.message}</p>`;
            throw error;
        }
    };

    const loadCollectionData = async (collectionName) => {
        if (!collectionName) {
            collectionData.innerHTML = '<p style="text-align: center; color: var(--text-muted-color);">コレクションを選択してください</p>';
            return;
        }

        collectionData.innerHTML = '<div class="loader-ring" style="margin: 20px auto;"></div>';

        try {
            const result = await api.get(`/api/data-manager/${collectionName}`);
            
            if (result.data.length === 0) {
                collectionData.innerHTML = '<p style="text-align: center; color: var(--text-muted-color);">データがありません</p>';
                return;
            }

            const deleteAllBtn = `<button id="delete-all-btn" class="btn btn-danger" style="margin-bottom: 15px;">全て削除</button>`;
            
            collectionData.innerHTML = deleteAllBtn + `
                <div style="overflow-x: auto;">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>データ</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${result.data.map(item => `
                                <tr>
                                    <td style="font-family: monospace; font-size: 0.85em;">${item.id}</td>
                                    <td><pre style="max-width: 600px; overflow-x: auto; font-size: 0.85em;">${JSON.stringify(item, null, 2)}</pre></td>
                                    <td>
                                        <button class="btn btn-danger btn-small delete-item-btn" data-id="${item.id}">削除</button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                <p style="text-align: center; margin-top: 15px; color: var(--text-muted-color);">
                    ${result.totalItems}件中 ${result.data.length}件を表示
                </p>
            `;

            // 削除ボタンのイベントリスナー
            document.querySelectorAll('.delete-item-btn').forEach(btn => {
                btn.onclick = () => deleteItem(collectionName, btn.dataset.id);
            });

            document.getElementById('delete-all-btn').onclick = () => deleteAllItems(collectionName);

        } catch (error) {
            collectionData.innerHTML = `<p class="message error">読込失敗: ${error.message}</p>`;
        }
    };

    const deleteItem = async (collectionName, itemId) => {
        createModal('削除の確認',
            '<p>このデータを削除してもよろしいですか？</p><p style="color: var(--error-color);">この操作は取り消せません。</p>',
            [
                { id: 'cancel-delete', text: 'キャンセル', class: 'btn-secondary' },
                { id: 'confirm-delete', text: '削除', class: 'btn-danger' }
            ]
        );
        document.getElementById('cancel-delete').onclick = closeModal;
        document.getElementById('confirm-delete').onclick = async () => {
            try {
                await api.delete(`/api/data-manager/${collectionName}/${itemId}`);
                showMessage('データを削除しました');
                closeModal();
                await loadCollectionData(collectionName);
                await loadCollectionsOverview();
            } catch (error) {
                showMessage(`削除失敗: ${error.message}`, 'error');
            }
        };
    };

    const deleteAllItems = async (collectionName) => {
        createModal('全削除の確認',
            '<p>このコレクションの全データを削除してもよろしいですか？</p><p style="color: var(--error-color); font-weight: bold;">[WARN] この操作は取り消せません！</p>',
            [
                { id: 'cancel-delete-all', text: 'キャンセル', class: 'btn-secondary' },
                { id: 'confirm-delete-all', text: '全て削除', class: 'btn-danger' }
            ]
        );
        document.getElementById('cancel-delete-all').onclick = closeModal;
        document.getElementById('confirm-delete-all').onclick = async () => {
            try {
                const result = await api.delete(`/api/data-manager/${collectionName}`);
                showMessage(`${result.count}件のデータを削除しました`);
                closeModal();
                await loadCollectionData(collectionName);
                await loadCollectionsOverview();
            } catch (error) {
                showMessage(`削除失敗: ${error.message}`, 'error');
            }
        };
    };

    const init = async () => {
        try {
            console.log('Initializing data manager...');
            
            // ギルド情報を取得
            console.log('Fetching guild info...');
            const guildInfo = await api.get('/api/guild-info');
            console.log('Guild info received:', guildInfo);
            
            document.getElementById('server-name').textContent = guildInfo.name;
            document.getElementById('server-icon').src = guildInfo.icon || '/image_fc291c.png';

            // コレクション概要を読み込み
            console.log('Loading collections overview...');
            await loadCollectionsOverview();
            console.log('Collections overview loaded');

            // ローダーを非表示にしてダッシュボードを表示
            loader.style.display = 'none';
            dashboardWrapper.style.display = 'flex';

            // イベントリスナーを設定
            collectionSelect.addEventListener('change', (e) => {
                console.log('Collection selected:', e.target.value);
                loadCollectionData(e.target.value);
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
                        await api.post('/api/logout', {});
                        window.location.href = '/login';
                    } catch (err) {
                        console.error('Logout error:', err);
                        showMessage('ログアウトに失敗しました', 'error');
                    }
                };
            });

            menuToggle.addEventListener('click', () => {
                sidebar.classList.toggle('is-open');
            });

            console.log('Data manager initialized successfully');

        } catch (error) {
            console.error('Initialization error:', error);
            loader.innerHTML = `
                <p class="message error" style="background-color: var(--error-color); color: white; padding: 15px; border-radius: 8px; text-align: center;">
                    情報の読み込みに失敗しました。<br>
                    エラー: ${error.message}
                </p>
                <a href="/login" class="btn" style="margin-top:20px; display: inline-block;">ログインページへ</a>
                <a href="/dashboard" class="btn btn-secondary" style="margin-top:20px; display: inline-block; margin-left: 10px;">ダッシュボードに戻る</a>
            `;
        }
    };

    init();
});
