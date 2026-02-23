const { ActivityType } = require('discord.js');
const { doc, getDoc, setDoc } = require('firebase/firestore');
const chalk = require('chalk');

async function generateAIStatus(client) {
    try {
        const userCount = client.guilds.cache.reduce((a, g) => a + g.memberCount, 0);
        const prompt = `あなたは「OrderlyCore」という名前のDiscordボットです。あなたの現在のユニークで面白いステータスを生成してください。

# 指示
- サーバー数 (${client.guilds.cache.size}個) や、総ユーザー数 (${userCount}人) などの動的な情報を含めることができます。
- 短く、キャッチーで、少しユーモラスなものが望ましいです。
- **絶対に絵文字を使用しないでください。**
- 必ずJSON形式で {"emoji": null, "state": "ステータスメッセージ"} の形式で出力してください。emojiは必ずnullにしてください。
- ステータスメッセージは30文字以内にしてください。`;

        const result = await client.geminiModel.generateContent(prompt);
        const text = result.response.text().replace(/```json|```/g, '').trim();
        return JSON.parse(text);
    } catch (error) {
        console.error(chalk.red('[ERROR] Geminiによるステータス生成に失敗:'), error);
        return { emoji: null, state: '[ERROR] AI Status Failure' };
    }
}

async function loadStatusSettings(db) {
    try {
        const settingsRef = doc(db, 'bot_settings', 'statuses');
        const docSnap = await getDoc(settingsRef);

        if (docSnap.exists() && docSnap.data().list) {
            return {
                list: docSnap.data().list,
                mode: docSnap.data().mode || 'custom'
            };
        } else {
            const defaultStatuses = [
                { emoji: null, state: '[OK] System Online' },
                { emoji: null, state: '[INFO] Type /help' },
                { emoji: null, state: '[SECURE] Active on ${serverCount} guilds' },
            ];
            await setDoc(settingsRef, { list: defaultStatuses, mode: 'custom' });
            return { list: defaultStatuses, mode: 'custom' };
        }
    } catch (error) {
        console.error(chalk.red('[ERROR] Firestoreからのステータス読み込みに失敗:'), error.message);
        return { list: [{ emoji: null, state: '[ERROR] Load Failure' }], mode: 'custom' };
    }
}

let statusInterval = null;

function startStatusRotation(client) {
    if (statusInterval) {
        clearInterval(statusInterval);
    }

    let i = 0;
    const updateStatus = async () => {
        if (!client.isReady()) return;

        const { list: dynamicStatuses, mode: statusMode } = await loadStatusSettings(client.db);
        let statusToShow;

        if (statusMode === 'ai') {
            statusToShow = await generateAIStatus(client);
        } else {
            if (dynamicStatuses && dynamicStatuses.length > 0) {
                const statusTemplate = dynamicStatuses[i];
                const statusState = statusTemplate.state
                    .replace(/\$\{serverCount\}/g, client.guilds.cache.size)
                    .replace(/\$\{userCount\}/g, client.guilds.cache.reduce((a, g) => a + g.memberCount, 0));
                statusToShow = { emoji: statusTemplate.emoji, state: statusState };
                i = (i + 1) % dynamicStatuses.length;
            } else {
                statusToShow = { emoji: null, state: 'Waiting for configuration' };
            }
        }

        if (statusToShow) {
            try {
                await client.user.setPresence({
                    activities: [{
                        name: 'customstatus',
                        type: ActivityType.Custom,
                        state: statusToShow.state,
                        emoji: statusToShow.emoji
                    }],
                    status: 'online'
                });
            } catch (error) {
                console.error(chalk.red('[Status Rotator] Failed to set presence:'), error);
            }
        }
    };

    updateStatus();
    statusInterval = setInterval(updateStatus, 60000);
}

module.exports = {
    generateAIStatus,
    loadStatusSettings,
    startStatusRotation
};
