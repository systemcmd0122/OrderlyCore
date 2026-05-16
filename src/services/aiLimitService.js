const { ref, set, get, update } = require('firebase/database');
const chalk = require('chalk');

/**
 * AIレート制限情報を管理するサービス
 * Claude API 無料枠対応版
 * - RPM: 5 (全モデル共通)
 * - TPM: 10,000 (入力)
 * - 出力TPM: 4,000
 */

/**
 * レート制限情報を初期化
 * @param {import('firebase/database').Database} rtdb
 * @param {string} userId
 */
async function initializeUserLimit(rtdb, userId) {
    const userRef = ref(rtdb, `ai_rate_limits/${userId}`);
    const snapshot = await get(userRef);

    if (!snapshot.exists()) {
        await set(userRef, {
            totalRequests: 0,
            successRequests: 0,
            failedRequests: 0,
            rateLimitedCount: 0,
            lastRequestTime: null,
            lastRateLimitTime: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });
    }
}

/**
 * リクエスト成功時にカウンターを更新
 * @param {import('firebase/database').Database} rtdb
 * @param {string} userId
 */
async function recordSuccessRequest(rtdb, userId) {
    try {
        await initializeUserLimit(rtdb, userId);
        const updates = {
            [`ai_rate_limits/${userId}/successRequests`]: (await get(ref(rtdb, `ai_rate_limits/${userId}/successRequests`))).val() + 1 || 1,
            [`ai_rate_limits/${userId}/totalRequests`]: (await get(ref(rtdb, `ai_rate_limits/${userId}/totalRequests`))).val() + 1 || 1,
            [`ai_rate_limits/${userId}/lastRequestTime`]: new Date().toISOString(),
            [`ai_rate_limits/${userId}/updatedAt`]: new Date().toISOString()
        };
        await update(ref(rtdb), updates);
    } catch (error) {
        console.error(chalk.yellow('[AI Limit Service] Error recording success request:'), error.message);
    }
}

/**
 * リクエスト失敗時にカウンターを更新
 * @param {import('firebase/database').Database} rtdb
 * @param {string} userId
 * @param {boolean} isRateLimited - レート制限エラーかどうか
 */
async function recordFailedRequest(rtdb, userId, isRateLimited = false) {
    try {
        await initializeUserLimit(rtdb, userId);

        const baseData = {
            [`ai_rate_limits/${userId}/failedRequests`]: (await get(ref(rtdb, `ai_rate_limits/${userId}/failedRequests`))).val() + 1 || 1,
            [`ai_rate_limits/${userId}/totalRequests`]: (await get(ref(rtdb, `ai_rate_limits/${userId}/totalRequests`))).val() + 1 || 1,
            [`ai_rate_limits/${userId}/lastRequestTime`]: new Date().toISOString(),
            [`ai_rate_limits/${userId}/updatedAt`]: new Date().toISOString()
        };

        if (isRateLimited) {
            baseData[`ai_rate_limits/${userId}/rateLimitedCount`] = (await get(ref(rtdb, `ai_rate_limits/${userId}/rateLimitedCount`))).val() + 1 || 1;
            baseData[`ai_rate_limits/${userId}/lastRateLimitTime`] = new Date().toISOString();
        }

        await update(ref(rtdb), baseData);
    } catch (error) {
        console.error(chalk.yellow('[AI Limit Service] Error recording failed request:'), error.message);
    }
}

/**
 * ユーザーのレート制限情報を取得
 * @param {import('firebase/database').Database} rtdb
 * @param {string} userId
 * @returns {Promise<Object|null>}
 */
async function getUserLimitInfo(rtdb, userId) {
    try {
        await initializeUserLimit(rtdb, userId);
        const userRef = ref(rtdb, `ai_rate_limits/${userId}`);
        const snapshot = await get(userRef);

        if (snapshot.exists()) {
            return snapshot.val();
        }
        return null;
    } catch (error) {
        console.error(chalk.yellow('[AI Limit Service] Error fetching user limit info:'), error.message);
        return null;
    }
}

/**
 * グローバルのレート制限情報を取得
 * @param {import('firebase/database').Database} rtdb
 * @returns {Promise<Object>}
 */
async function getGlobalLimitInfo(rtdb) {
    try {
        const limitsRef = ref(rtdb, 'ai_rate_limits');
        const snapshot = await get(limitsRef);

        let totalUsers = 0;
        let totalRequests = 0;
        let totalSuccess = 0;
        let totalFailed = 0;
        let totalRateLimited = 0;
        const recentlyLimited = [];

        if (snapshot.exists()) {
            const data = snapshot.val();

            for (const [userId, userData] of Object.entries(data)) {
                totalUsers++;
                totalRequests += userData.totalRequests || 0;
                totalSuccess += userData.successRequests || 0;
                totalFailed += userData.failedRequests || 0;
                totalRateLimited += userData.rateLimitedCount || 0;

                if (userData.lastRateLimitTime) {
                    const limitTime = new Date(userData.lastRateLimitTime);
                    const now = new Date();
                    const timeDiffMinutes = (now - limitTime) / (1000 * 60);

                    if (timeDiffMinutes < 60) { // 最新1時間以内
                        recentlyLimited.push({
                            userId,
                            time: userData.lastRateLimitTime,
                            timeDiffMinutes: Math.round(timeDiffMinutes * 10) / 10
                        });
                    }
                }
            }

            recentlyLimited.sort((a, b) =>
                new Date(b.time) - new Date(a.time)
            );
        }

        return {
            totalUsers,
            totalRequests,
            totalSuccess,
            totalFailed,
            totalRateLimited,
            successRate: totalRequests > 0 ? Math.round((totalSuccess / totalRequests) * 1000) / 10 : 0,
            recentlyLimited: recentlyLimited.slice(0, 5)
        };
    } catch (error) {
        console.error(chalk.yellow('[AI Limit Service] Error fetching global limit info:'), error.message);
        return null;
    }
}

/**
 * Claude APIエラーがレート制限エラーかどうかを判定
 *
 * Claude APIのレート制限エラー:
 *   - HTTP 429 (RateLimitError) : RPM / TPM 超過
 *   - HTTP 529 (OverloadedError): サーバー過負荷
 *   - error.type === 'rate_limit_error'
 *
 * @param {Error} error
 * @returns {boolean}
 */
function isRateLimitError(error) {
    if (!error) return false;

    // Anthropic SDK は APIError を throw し、status と error.type を持つ
    const status = error.status;
    const errorType = error.error?.type || '';
    const message = (error.message || '').toLowerCase();

    return (
        status === 429 ||
        status === 529 ||
        errorType === 'rate_limit_error' ||
        errorType === 'overloaded_error' ||
        message.includes('rate limit') ||
        message.includes('rate_limit') ||
        message.includes('overloaded') ||
        message.includes('too many requests')
    );
}

module.exports = {
    initializeUserLimit,
    recordSuccessRequest,
    recordFailedRequest,
    getUserLimitInfo,
    getGlobalLimitInfo,
    isRateLimitError
};