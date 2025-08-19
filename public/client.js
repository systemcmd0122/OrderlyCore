document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('settings-form');
    const messageEl = document.getElementById('message');
    const logoutBtn = document.getElementById('logout-btn');
    const header = document.querySelector('.header h1');
    const guildIconEl = document.createElement('img');
    guildIconEl.className = 'guild-icon';
    if(header) header.prepend(guildIconEl);


    // 設定を読み込んでフォームに反映
    const loadDashboard = async () => {
        try {
            // 1. セッション情報を取得
            const sessionRes = await fetch('/api/session');
            if (!sessionRes.ok) {
                // セッションがない場合 (未ログイン)、ログインページにリダイレクト
                if (sessionRes.status === 401) window.location.href = '/login';
                return;
            }
            const sessionData = await sessionRes.json();
            
            // ヘッダーにサーバー名とアイコンを表示
            if(header) header.textContent = `${sessionData.guildName} の設定`;
            if(guildIconEl && sessionData.guildIcon) guildIconEl.src = sessionData.guildIcon;
            if(header) header.prepend(guildIconEl);

            // 2. 設定情報を取得
            const settingsRes = await fetch(`/api/settings`);
            if (!settingsRes.ok) {
                throw new Error('設定の読み込みに失敗しました。');
            }
            const settings = await settingsRes.json();
            
            // 3. フォームに値を設定
            document.getElementById('auditLogChannel').value = settings.auditLogChannel || '';
            document.getElementById('levelUpChannel').value = settings.levelUpChannel || '';
            
            if(settings.automod){
                document.getElementById('blockInvites').checked = settings.automod.blockInvites === true;
                document.getElementById('ngWords').value = (settings.automod.ngWords || []).join(',');
            }

        } catch (error) {
            messageEl.textContent = error.message;
            messageEl.className = 'message error';
        }
    };
    
    // ダッシュボードページの場合のみデータを読み込む
    if (window.location.pathname.startsWith('/dashboard')) {
       loadDashboard();
    }


    // 設定を保存
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        messageEl.textContent = '保存中...';
        messageEl.className = 'message';

        const formData = new FormData(form);
        const settings = {
            auditLogChannel: formData.get('auditLogChannel').trim(),
            levelUpChannel: formData.get('levelUpChannel').trim(),
            automod: {
                blockInvites: document.getElementById('blockInvites').checked,
                ngWords: formData.get('ngWords').split(',').map(w => w.trim()).filter(Boolean)
            }
        };

        try {
            const response = await fetch(`/api/settings`, { // URLからguildIdを削除
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings)
            });

            const data = await response.json();

            if (response.ok) {
                messageEl.textContent = data.message;
                messageEl.className = 'message success';
            } else {
                messageEl.textContent = `エラー: ${data.error}`;
                messageEl.className = 'message error';
            }
        } catch (error) {
            messageEl.textContent = 'サーバーとの通信に失敗しました。';
            messageEl.className = 'message error';
        }
    });

    // ログアウト処理
    logoutBtn.addEventListener('click', async () => {
        await fetch('/api/logout', { method: 'POST' });
        window.location.href = '/login';
    });

    // login.html のスクリプトも修正が必要
    const loginForm = document.getElementById('login-form');
    if(loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const token = document.getElementById('token').value;
            const loginMessageEl = document.getElementById('message');
            loginMessageEl.textContent = '認証中...';
            loginMessageEl.className = 'message';

            try {
                const response = await fetch('/api/verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token })
                });

                const data = await response.json();

                if (response.ok) {
                    loginMessageEl.textContent = 'ログイン成功！ダッシュボードに移動します...';
                    loginMessageEl.className = 'message success';
                    window.location.href = '/dashboard';
                } else {
                    loginMessageEl.textContent = `エラー: ${data.error || '不明なエラーが発生しました。'}`;
                    loginMessageEl.className = 'message error';
                }
            } catch (error) {
                loginMessageEl.textContent = 'サーバーとの通信に失敗しました。';
                loginMessageEl.className = 'message error';
            }
        });
    }
});
