document.addEventListener('DOMContentLoaded', async () => {
    const summaryArea = document.getElementById('collections-summary');
    const dataArea = document.getElementById('collection-data-area');
    const collectionSelect = document.getElementById('collection-select');

    let currentCollection = '';
    let currentPage = 1;

    const api = {
        _request: async (endpoint, options = {}) => {
            try {
                const res = await fetch(endpoint, options);
                if (res.status === 401) { window.location.href = '/login'; return; }
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'API Error');
                return data;
            } catch (err) {
                console.error(err);
                alert(err.message);
                throw err;
            }
        },
        get: (ep) => api._request(ep),
        delete: (ep) => api._request(ep, { method: 'DELETE' })
    };

    const loadSummary = async () => {
        const counts = await api.get('/api/data-manager/collections');
        const labels = {
            levels: 'レベル',
            warnings: '警告',
            audit_logs: '監査ログ',
            quotes: '引用',
            roleboards: 'ロール',
            tickets: 'チケット'
        };
        const icons = {
            levels: 'bi-award',
            warnings: 'bi-exclamation-triangle',
            audit_logs: 'bi-journal-text',
            quotes: 'bi-chat-quote',
            roleboards: 'bi-grid-3x3-gap',
            tickets: 'bi-ticket-perforated'
        };

        summaryArea.innerHTML = Object.entries(counts).map(([col, count]) => `
            <div class="col-md-4 col-lg-2">
                <div class="card h-100 p-3 text-center shadow-sm border-0">
                    <div class="text-secondary mb-2"><i class="bi ${icons[col] || 'bi-database'} fs-4"></i></div>
                    <div class="h4 fw-bold mb-0">${count.toLocaleString()}</div>
                    <div class="small text-secondary text-uppercase fw-bold mt-1" style="font-size: 0.65rem;">${labels[col] || col}</div>
                </div>
            </div>
        `).join('');
    };

    const loadData = async (col, page = 1) => {
        currentCollection = col;
        currentPage = page;
        dataArea.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-primary" role="status"></div></div>';

        try {
            const res = await api.get(`/api/data-manager/${col}?page=${page}&limit=10`);

            if (res.data.length === 0) {
                dataArea.innerHTML = '<div class="alert alert-light text-center py-5 border">データが見つかりませんでした。</div>';
                return;
            }

            dataArea.innerHTML = `
                <div class="d-flex justify-content-between align-items-center mb-3">
                    <button class="btn btn-danger btn-sm px-3" id="delete-all-btn"><i class="bi bi-trash3 me-1"></i>すべて削除</button>
                    <div class="small text-secondary fw-bold">合計: ${res.totalItems}件</div>
                </div>
                <div class="table-responsive">
                    <table class="table table-hover align-middle small border-top">
                        <thead class="table-light">
                            <tr>
                                <th style="width: 250px;">ID</th>
                                <th>データ内容 (JSON)</th>
                                <th class="text-end">操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${res.data.map(item => `
                                <tr>
                                    <td><code class="text-secondary">${item.id}</code></td>
                                    <td><pre class="mb-0">${JSON.stringify(item, null, 2)}</pre></td>
                                    <td class="text-end">
                                        <button class="btn btn-outline-danger btn-sm border-0 delete-item-btn" data-id="${item.id}">
                                            <i class="bi bi-trash"></i>
                                        </button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                <div class="d-flex justify-content-between align-items-center mt-4">
                    <button id="prev-page" class="btn btn-sm btn-outline-secondary px-3" ${page <= 1 ? 'disabled' : ''}>前へ</button>
                    <span class="small fw-bold text-secondary">${page} / ${res.totalPages}</span>
                    <button id="next-page" class="btn btn-sm btn-outline-secondary px-3" ${page >= res.totalPages ? 'disabled' : ''}>次へ</button>
                </div>
            `;

            document.getElementById('prev-page').onclick = () => loadData(col, page - 1);
            document.getElementById('next-page').onclick = () => loadData(col, page + 1);

            document.querySelectorAll('.delete-item-btn').forEach(btn => btn.onclick = async () => {
                if (confirm('このデータを削除してもよろしいですか？')) {
                    await api.delete(`/api/data-manager/${col}/${btn.dataset.id}`);
                    loadData(col, page);
                    loadSummary();
                }
            });

            document.getElementById('delete-all-btn').onclick = async () => {
                if (confirm(`【警告】${col} コレクションの全データを削除します。この操作は取り消せません。本当によろしいですか？`)) {
                    await api.delete(`/api/data-manager/${col}`);
                    loadData(col, 1);
                    loadSummary();
                }
            };

        } catch (err) {
            dataArea.innerHTML = `<div class="alert alert-danger">読込エラー: ${err.message}</div>`;
        }
    };

    new TomSelect(collectionSelect, {
        onChange: (val) => {
            if (val) loadData(val, 1);
            else dataArea.innerHTML = '<div class="text-center py-5 text-secondary">コレクションを選択するとデータが表示されます。</div>';
        }
    });

    loadSummary();
});
