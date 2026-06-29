const { Events } = require('discord.js');
const chalk = require('chalk');
const { doc, getDoc, setDoc, updateDoc } = require('firebase/firestore');
const https = require('https');
const http = require('http');
const { recordSuccessRequest, recordFailedRequest, isRateLimitError } = require('../src/services/aiLimitService');

// 会話履歴をメモリキャッシュで管理
const conversationCache = new Map();
const CONVERSATION_TIMEOUT = 10 * 60 * 1000; // 10分間
const MAX_HISTORY_LENGTH = 10; // 最大10往復分の履歴を保持

/**
 * 会話履歴を取得または初期化
 * @param {string} userId - ユーザーID
 * @param {string} channelId - チャンネルID
 * @returns {Array} - 会話履歴 [{role: 'user'|'assistant', content: string}]
 */
function getConversationHistory(userId, channelId) {
    const key = `${channelId}_${userId}`;

    if (conversationCache.has(key)) {
        const data = conversationCache.get(key);

        // タイムアウトチェック
        if (Date.now() - data.lastActivity > CONVERSATION_TIMEOUT) {
            console.log(chalk.gray(`[Conversation] Expired history for user ${userId}`));
            conversationCache.delete(key);
            return [];
        }

        return data.history;
    }

    return [];
}

/**
 * 会話履歴を保存
 * @param {string} userId - ユーザーID
 * @param {string} channelId - チャンネルID
 * @param {string} userMessage - ユーザーメッセージ
 * @param {string} aiResponse - AI応答
 */
function saveConversationHistory(userId, channelId, userMessage, aiResponse) {
    const key = `${channelId}_${userId}`;
    let history = getConversationHistory(userId, channelId);

    // 新しいやり取りを追加
    history.push({
        role: 'user',
        content: userMessage
    });
    history.push({
        role: 'assistant',
        content: aiResponse
    });

    // 履歴が長すぎる場合は古いものから削除
    if (history.length > MAX_HISTORY_LENGTH * 2) {
        history = history.slice(-MAX_HISTORY_LENGTH * 2);
    }

    conversationCache.set(key, {
        history,
        lastActivity: Date.now()
    });

    console.log(chalk.blue(`[Conversation] Saved history for user ${userId} (${history.length / 2} turns)`));
}

/**
 * 会話履歴をクリア
 * @param {string} userId - ユーザーID
 * @param {string} channelId - チャンネルID
 */
function clearConversationHistory(userId, channelId) {
    const key = `${channelId}_${userId}`;
    conversationCache.delete(key);
    console.log(chalk.yellow(`[Conversation] Cleared history for user ${userId}`));
}

/**
 * 定期的に古い会話履歴をクリーンアップ
 */
setInterval(() => {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, data] of conversationCache.entries()) {
        if (now - data.lastActivity > CONVERSATION_TIMEOUT) {
            conversationCache.delete(key);
            cleanedCount++;
        }
    }

    if (cleanedCount > 0) {
        console.log(chalk.gray(`[Conversation] Cleaned up ${cleanedCount} expired conversations`));
    }
}, 5 * 60 * 1000); // 5分ごとにクリーンアップ

/**
 * 検索クエリを最適化（日本語・英語の自動判定と最適化）
 * @param {string} query - 元のクエリ
 * @returns {string} - 最適化されたクエリ
 */
function optimizeSearchQuery(query) {
    // ノイズワードを削除
    const noiseWords = ['について', 'に関して', '教えて', 'ください', 'って', 'とは', 'what', 'how', 'why', 'when', 'where', 'is', 'are', 'the', 'a', 'an'];
    let optimized = query;

    noiseWords.forEach(word => {
        const regex = new RegExp(`\\b${word}\\b`, 'gi');
        optimized = optimized.replace(regex, '');
    });

    // 余分な空白を削除
    optimized = optimized.replace(/\s+/g, ' ').trim();

    // 時系列キーワードの追加（最新情報が必要な場合）
    const currentYear = new Date().getFullYear();
    const timeKeywords = ['最新', '今', '現在', 'latest', 'current', 'now', String(currentYear), String(currentYear + 1)];
    const hasTimeKeyword = timeKeywords.some(kw => query.toLowerCase().includes(kw));

    if (hasTimeKeyword && !optimized.includes(String(currentYear))) {
        optimized += ` ${currentYear}`;
    }

    console.log(chalk.cyan(`[Search] Optimized query: "${query}" → "${optimized}"`));
    return optimized;
}

/**
 * 高度なWeb検索 - 複数ソースから取得
 * @param {string} query - 検索クエリ
 * @returns {Promise<Array>} - 検索結果の配列 [{title, snippet, url, source}]
 */
async function performWebSearch(query) {
    const optimizedQuery = optimizeSearchQuery(query);
    const searchPromises = [];

    // 1. DuckDuckGo Instant Answer API
    searchPromises.push(searchDuckDuckGo(optimizedQuery));

    // 2. DuckDuckGo HTML Scraping (フォールバック)
    searchPromises.push(searchDuckDuckGoHTML(optimizedQuery));

    try {
        const results = await Promise.allSettled(searchPromises);
        const allResults = [];

        // 成功した検索結果をマージ
        results.forEach((result, index) => {
            if (result.status === 'fulfilled' && Array.isArray(result.value)) {
                allResults.push(...result.value);
            }
        });

        // 重複を削除（URLベース）
        const uniqueResults = [];
        const seenUrls = new Set();

        for (const result of allResults) {
            if (result.url && !seenUrls.has(result.url)) {
                seenUrls.add(result.url);
                uniqueResults.push(result);
            }
        }

        // 最大8件に制限
        const finalResults = uniqueResults.slice(0, 8);

        console.log(chalk.green(`[Web Search] Total results: ${finalResults.length} (from ${allResults.length} sources)`));
        return finalResults;

    } catch (error) {
        console.error(chalk.red('[Web Search] Error:'), error.message);
        return [];
    }
}

/**
 * DuckDuckGo Instant Answer API検索
 * @param {string} query - 検索クエリ
 * @returns {Promise<Array>} - 検索結果
 */
function searchDuckDuckGo(query) {
    return new Promise((resolve) => {
        try {
            const encodedQuery = encodeURIComponent(query);
            const url = `https://api.duckduckgo.com/?q=${encodedQuery}&format=json&no_html=1&skip_disambig=1`;

            const request = https.get(url, { timeout: 8000 }, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        const results = [];

                        // Abstract(要約)
                        if (parsed.Abstract && parsed.AbstractText) {
                            results.push({
                                title: parsed.Heading || 'DuckDuckGo Instant Answer',
                                snippet: parsed.AbstractText,
                                url: parsed.AbstractURL || '',
                                source: 'DDG-API'
                            });
                        }

                        // Definition(定義)
                        if (parsed.Definition && parsed.DefinitionSource) {
                            results.push({
                                title: 'Definition: ' + (parsed.Heading || query),
                                snippet: parsed.Definition,
                                url: parsed.DefinitionURL || '',
                                source: 'DDG-API'
                            });
                        }

                        // Related Topics
                        if (parsed.RelatedTopics && Array.isArray(parsed.RelatedTopics)) {
                            parsed.RelatedTopics.forEach((topic) => {
                                if (results.length >= 5) return;

                                if (topic.Text && topic.FirstURL) {
                                    results.push({
                                        title: topic.Text.split(' - ')[0] || 'Related Topic',
                                        snippet: topic.Text,
                                        url: topic.FirstURL,
                                        source: 'DDG-API'
                                    });
                                } else if (topic.Topics && Array.isArray(topic.Topics)) {
                                    topic.Topics.forEach(subTopic => {
                                        if (results.length >= 5) return;
                                        if (subTopic.Text && subTopic.FirstURL) {
                                            results.push({
                                                title: subTopic.Text.split(' - ')[0] || 'Topic',
                                                snippet: subTopic.Text,
                                                url: subTopic.FirstURL,
                                                source: 'DDG-API'
                                            });
                                        }
                                    });
                                }
                            });
                        }

                        // Results
                        if (parsed.Results && Array.isArray(parsed.Results)) {
                            parsed.Results.forEach((result) => {
                                if (results.length >= 5) return;
                                if (result.Text && result.FirstURL) {
                                    results.push({
                                        title: result.Text.split(' - ')[0] || 'Result',
                                        snippet: result.Text,
                                        url: result.FirstURL,
                                        source: 'DDG-API'
                                    });
                                }
                            });
                        }

                        console.log(chalk.cyan(`[DDG-API] Found ${results.length} results`));
                        resolve(results);

                    } catch (parseError) {
                        console.error(chalk.yellow('[DDG-API] Parse error:'), parseError.message);
                        resolve([]);
                    }
                });
            });

            request.on('error', (err) => {
                console.error(chalk.yellow('[DDG-API] Request error:'), err.message);
                resolve([]);
            });

            request.on('timeout', () => {
                console.error(chalk.yellow('[DDG-API] Timeout'));
                request.destroy();
                resolve([]);
            });

        } catch (err) {
            console.error(chalk.yellow('[DDG-API] Error:'), err.message);
            resolve([]);
        }
    });
}

/**
 * DuckDuckGo HTML スクレイピング検索（強化版）
 * @param {string} query - 検索クエリ
 * @returns {Promise<Array>} - 検索結果
 */
function searchDuckDuckGoHTML(query) {
    return new Promise((resolve) => {
        try {
            const encodedQuery = encodeURIComponent(query);
            const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

            const request = https.get(url, {
                timeout: 10000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Referer': 'https://duckduckgo.com/'
                }
            }, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk.toString();
                });

                res.on('end', () => {
                    try {
                        const results = parseHTMLResults(data);
                        console.log(chalk.cyan(`[DDG-HTML] Found ${results.length} results`));
                        resolve(results);
                    } catch (parseError) {
                        console.error(chalk.yellow('[DDG-HTML] Parse error:'), parseError.message);
                        resolve([]);
                    }
                });
            });

            request.on('error', (err) => {
                console.error(chalk.yellow('[DDG-HTML] Request error:'), err.message);
                resolve([]);
            });

            request.on('timeout', () => {
                console.error(chalk.yellow('[DDG-HTML] Timeout'));
                request.destroy();
                resolve([]);
            });

        } catch (err) {
            console.error(chalk.yellow('[DDG-HTML] Error:'), err.message);
            resolve([]);
        }
    });
}

/**
 * HTML検索結果をパース（改良版）
 * @param {string} html - HTMLコンテンツ
 * @returns {Array} - パースされた検索結果
 */
function parseHTMLResults(html) {
    const results = [];

    try {
        // より堅牢な正規表現パターン
        const resultPattern = /<div class="result__body">[\s\S]*?<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

        let match;
        let count = 0;

        while ((match = resultPattern.exec(html)) !== null && count < 10) {
            const url = match[1]?.trim() || '';
            const title = match[2]?.replace(/<[^>]*>/g, '').trim() || '';
            const snippet = match[3]?.replace(/<[^>]*>/g, '').trim() || '';

            if (url && title) {
                // URLデコード
                let decodedUrl = url;
                try {
                    // DuckDuckGoのリダイレクトURLから実際のURLを抽出
                    if (url.includes('uddg=')) {
                        const uddgMatch = url.match(/uddg=([^&]*)/);
                        if (uddgMatch) {
                            decodedUrl = decodeURIComponent(uddgMatch[1]);
                        }
                    }
                } catch (e) {
                    // デコード失敗時は元のURLを使用
                }

                results.push({
                    title: cleanText(title),
                    snippet: cleanText(snippet) || title,
                    url: decodedUrl,
                    source: 'DDG-HTML'
                });
                count++;
            }
        }

        // 別のパターンも試す（フォールバック）
        if (results.length === 0) {
            const altPattern = /<a[^>]*class="result__url"[^>]*href="([^"]*)"[^>]*>[\s\S]*?<\/a>[\s\S]*?<h2[^>]*>([\s\S]*?)<\/h2>[\s\S]*?<div[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/div>/gi;

            while ((match = altPattern.exec(html)) !== null && results.length < 10) {
                const url = match[1]?.trim() || '';
                const title = match[2]?.replace(/<[^>]*>/g, '').trim() || '';
                const snippet = match[3]?.replace(/<[^>]*>/g, '').trim() || '';

                if (url && title) {
                    results.push({
                        title: cleanText(title),
                        snippet: cleanText(snippet) || title,
                        url: url,
                        source: 'DDG-HTML-ALT'
                    });
                }
            }
        }

    } catch (error) {
        console.error(chalk.red('[HTML Parse] Error:'), error.message);
    }

    return results;
}

/**
 * テキストをクリーンアップ
 * @param {string} text - クリーンアップするテキスト
 * @returns {string} - クリーンアップされたテキスト
 */
function cleanText(text) {
    if (!text) return '';

    return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * 検索結果を整形してプロンプトに組み込む形式に変換
 * @param {Array} results - 検索結果の配列
 * @returns {string} - 整形された検索結果テキスト
 */
function formatSearchResults(results) {
    if (!results || results.length === 0) {
        return '';
    }

    let formatted = '### [SEARCH_RESULTS] 最新のウェブ検索結果\n\n';

    results.forEach((result, index) => {
        formatted += `**[RESULT_${index + 1}] ${result.title}**\n`;
        formatted += `${result.snippet}\n`;
        if (result.url) {
            formatted += `[SOURCE] ${result.url}\n`;
        }
        formatted += '\n';
    });

    return formatted;
}

/**
 * Web検索が必要かどうかを判断（改良版）
 * @param {string} message - ユーザーメッセージ
 * @returns {boolean} - 検索が必要ならtrue
 */
function shouldPerformWebSearch(message) {
    const lowerMessage = message.toLowerCase();

    // 明示的な検索キーワード
    const searchKeywords = [
        '検索', 'さがして', '探して', '調べて', 'ググって',
        'search', 'find', 'look up', 'google',
        '最新', '今', '現在', 'latest', 'current', 'now',
        'ニュース', 'news', '情報', 'info',
        '価格', 'price', '値段', '相場',
        '天気', 'weather', '気温', 'temperature',
        'いつ', 'when', 'どこ', 'where',
        '何', 'what', 'どう', 'how',
        'まとめ', 'summary', '一覧', 'list',
        'ランキング', 'ranking', 'トップ', 'top',
        '比較', 'compare', '違い', 'difference',
        'レビュー', 'review', '評価', 'rating',
        '方法', 'やり方', 'how to', 'tutorial',
        'おすすめ', 'recommend', 'suggestion',
        '～について', 'とは', 'って何', 'what is'
    ];

    // キーワードマッチング
    const hasSearchKeyword = searchKeywords.some(keyword =>
        lowerMessage.includes(keyword)
    );

    // 質問形式の検出
    const isQuestion = /[？?]/.test(message) ||
        lowerMessage.startsWith('what') ||
        lowerMessage.startsWith('how') ||
        lowerMessage.startsWith('when') ||
        lowerMessage.startsWith('where') ||
        lowerMessage.startsWith('why') ||
        lowerMessage.startsWith('who');

    // 時系列キーワード
    const hasTimeKeyword = ['2024', '2025', '2026', '今年', '今月', '今日', 'today', 'this year'].some(kw =>
        lowerMessage.includes(kw)
    );

    // 除外パターン（検索不要）
    const noSearchPatterns = [
        'こんにちは', 'hello', 'おはよう', 'good morning',
        'ありがとう', 'thank', 'thanks',
        'さようなら', 'goodbye', 'bye',
        'よろしく', 'nice to meet',
        'リセット', 'reset', '履歴クリア'
    ];

    const shouldExclude = noSearchPatterns.some(pattern =>
        lowerMessage.includes(pattern)
    );

    if (shouldExclude) {
        return false;
    }

    // 最終判定
    const shouldSearch = hasSearchKeyword || (isQuestion && message.length > 10) || hasTimeKeyword;

    if (shouldSearch) {
        console.log(chalk.cyan(`[Search Decision] [SEARCH] Web search enabled for: "${message.substring(0, 50)}..."`));
    } else {
        console.log(chalk.gray(`[Search Decision] [SKIP] Web search skipped for: "${message.substring(0, 50)}..."`));
    }

    return shouldSearch;
}

/**
 * Gemini AI にチャット応答を生成させる関数 (Web検索状態表示付き)
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').Message} message
 * @param {object} aiConfig
 * @returns {Promise<string>} - AI応答テキスト
 */
async function generateChatResponse(client, message, aiConfig) {
    let statusMessage = null;

    try {
        const user = message.member?.displayName || message.author.username;
        const server = message.guild.name;
        const userMessage = message.content.replace(/<@!?\d+>/g, '').trim();

        if (!userMessage) {
            return 'こんにちは!何か御用でしょうか?';
        }

        // 特殊コマンド: 履歴クリア
        if (userMessage === 'リセット' || userMessage === 'reset' || userMessage === '履歴クリア') {
            clearConversationHistory(message.author.id, message.channel.id);
            return '会話履歴をリセットしました!新しい会話を始めましょう。';
        }

        // 会話履歴を取得
        const conversationHistory = getConversationHistory(message.author.id, message.channel.id);

        // Web検索が必要かどうかを判断
        const needsWebSearch = shouldPerformWebSearch(userMessage);
        let webResults = [];
        let searchSummary = '';

        if (needsWebSearch) {
            console.log(chalk.cyan('[AI] [SEARCH] Web search triggered'));

            try {
                statusMessage = await message.reply({
                    content: '[SEARCH] **Web検索中...**\n最新情報をインターネットから取得しています...',
                    allowedMentions: { repliedUser: false }
                });
            } catch (err) {
                console.error(chalk.yellow('[Status] Failed to send search status:'), err.message);
            }

            const searchStartTime = Date.now();
            webResults = await performWebSearch(userMessage);
            const searchDuration = ((Date.now() - searchStartTime) / 1000).toFixed(1);

            console.log(chalk.green(`[Search] [OK] Completed in ${searchDuration}s, found ${webResults.length} results`));

            searchSummary = formatSearchResults(webResults);

            if (statusMessage) {
                try {
                    await statusMessage.edit({
                        content: `[OK] **検索完了!** (${webResults.length}件)\n[WAIT] **AI回答生成中...**`
                    });
                } catch (err) {
                    console.error(chalk.yellow('[Status] Failed to update status:'), err.message);
                }
            }
        } else {
            console.log(chalk.gray('[AI] [SKIP] Skipping web search - not needed'));
            searchSummary = '';
        }

        // ---- Gemini API 呼び出し ----------------------------------------

        // システムプロンプト構築
        let systemPrompt = '';
        if (aiConfig.aiPersonalityPrompt && aiConfig.aiPersonalityPrompt.trim() !== '') {
            systemPrompt = `あなたは以下のペルソナで応答してください:\n${aiConfig.aiPersonalityPrompt}`;
        } else {
            systemPrompt = `あなたはOrderlyCoreという名前のAIアシスタントです。親切で知識豊富、そして自然な会話ができます。`;
        }

        systemPrompt += `

### [RULES] 応答ルール
- 会話は自然でフレンドリーに
- 200文字以内に収めてください
- **絶対に絵文字を使用しないでください。**
- **最新のユーザーメッセージに最優先で応答してください**
- 過去の会話は参考程度にし、話題が変わったら新しい話題に切り替えてください
- **Web検索結果がある場合は、その情報を最優先で活用してください**
- **検索結果から得た情報は信頼性が高いものとして扱ってください**
- URLは表示しないでください
- 返答はメッセージ本文のみ

### [CONTEXT] 現在の会話情報
- サーバー名: ${server}
- 発言者: ${user}`;

        if (searchSummary) {
            systemPrompt += `\n\n${searchSummary}`;
        }

        // 会話履歴をプロンプトに埋め込む
        let conversationContext = '';
        for (const msg of conversationHistory) {
            const roleLabel = msg.role === 'assistant' ? 'Assistant' : 'User';
            conversationContext += `${roleLabel}: ${msg.content}\n`;
        }

        const fullPrompt = `${systemPrompt}\n\n---\n\n${conversationContext}User: ${userMessage}\nAssistant:`;

        const result = await client.geminiModel.generateContent(fullPrompt);
        const text = result.response.text().trim().replace(/```/g, '');

        // レート制限情報を記録
        await recordSuccessRequest(client.rtdb, message.author.id);

        // 会話履歴を保存
        saveConversationHistory(message.author.id, message.channel.id, userMessage, text);

        if (statusMessage) {
            try {
                await statusMessage.delete();
            } catch (err) {
                console.error(chalk.yellow('[Status] Failed to delete status:'), err.message);
            }
        }

        console.log(chalk.magenta(`[Gemini] User: ${userMessage.substring(0, 50)}... | Response: ${text.substring(0, 50)}... | History: ${conversationHistory.length / 2} turns | Web: ${webResults.length > 0 ? '[OK]' : '[SKIP]'}`));
        return text;

    } catch (error) {
        console.error(chalk.red('[ERROR] Gemini API error:'), error);

        const isRateLimit = isRateLimitError(error);
        if (isRateLimit) {
            console.warn(chalk.yellow('[AI Limit] Rate limit reached for user:'), message.author.id);
        }
        await recordFailedRequest(client.rtdb, message.author.id, isRateLimit);

        if (statusMessage) {
            try {
                await statusMessage.delete();
            } catch (err) {
                // 削除失敗は無視
            }
        }

        if (isRateLimit) {
            return 'API利用制限に達しました。少し時間をおいてからお試しください。';
        }
        return 'うーん、ちょっと考えがまとまらないみたいです…。もう一度話しかけてもらえますか?';
    }
}

/**
 * メンション応答メイン関数
 * @param {import('discord.js').Message} message
 * @param {import('discord.js').Client} client
 */
async function handleMention(message, client) {
    // 基本的なフィルタリング
    if (!message.guild || message.author.bot) return;
    if (message.mentions.everyone) return;
    if (!message.mentions.has(client.user.id)) return;

    let typingInterval = null;

    try {
        // 設定を取得
        const settingsRef = doc(client.db, 'guild_settings', message.guild.id);
        const docSnap = await getDoc(settingsRef);
        const settings = docSnap.exists() ? docSnap.data() : {};
        const aiConfig = settings.ai || {
            mentionReplyEnabled: true,
            aiPersonalityPrompt: ''
        };

        // 機能が無効の場合は終了
        if (aiConfig.mentionReplyEnabled === false) return;

        // タイピングインジケータを表示(定期的に更新)
        await message.channel.sendTyping();
        typingInterval = setInterval(() => {
            message.channel.sendTyping().catch(() => clearInterval(typingInterval));
        }, 5000);

        // AI応答を生成
        const replyText = await generateChatResponse(client, message, aiConfig);

        // タイピングインジケータを停止
        if (typingInterval) {
            clearInterval(typingInterval);
            typingInterval = null;
        }

        // 返信を送信
        await message.reply({
            content: replyText,
            allowedMentions: { repliedUser: false }
        });

    } catch (error) {
        console.error(chalk.red('[ERROR] Mention handler error:'), error);

        // タイピングインジケータを停止
        if (typingInterval) {
            clearInterval(typingInterval);
        }

        try {
            await message.reply({
                content: 'ごめんなさい、応答中にエラーが発生してしまいました。',
                allowedMentions: { repliedUser: false }
            });
        } catch (replyError) {
            console.error(chalk.red('[ERROR] Failed to send error message:'), replyError);
        }
    }
}

// イベントリスナーをエクスポート
module.exports = (client) => {
    console.log(chalk.green('[MentionReply] [OK] Module loaded - Enhanced Web Search Engine v2.0 (Gemini API)'));
    console.log(chalk.cyan('[MentionReply] [SEARCH] Multi-source search: DDG-API + DDG-HTML'));
    console.log(chalk.gray(`[MentionReply] [TIME] History timeout: ${CONVERSATION_TIMEOUT / 1000 / 60} minutes, Max turns: ${MAX_HISTORY_LENGTH}`));
    client.on(Events.MessageCreate, (message) => handleMention(message, client));
};