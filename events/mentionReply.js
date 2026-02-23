const { Events } = require('discord.js');
const chalk = require('chalk');
const { doc, getDoc, setDoc, updateDoc } = require('firebase/firestore');
const https = require('https');
const http = require('http');

// 会話履歴をメモリキャッシュで管理
const conversationCache = new Map();
const CONVERSATION_TIMEOUT = 10 * 60 * 1000; // 10分間
const MAX_HISTORY_LENGTH = 10; // 最大10往復分の履歴を保持

/**
 * 会話履歴を取得または初期化
 * @param {string} userId - ユーザーID
 * @param {string} channelId - チャンネルID
 * @returns {Array} - 会話履歴
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
 * 軽量HTTPリクエストでDuckDuckGoを検索(Playwright不要)
 * @param {string} query - 検索クエリ
 * @returns {Promise<Array>} - 検索結果の配列 [{title, snippet, url}]
 */
async function performWebSearch(query) {
    return new Promise((resolve) => {
        try {
            console.log(chalk.cyan(`[Web Search] Starting search for: "${query}"`));
            
            // DuckDuckGo Instant Answer API を使用(完全無料、認証不要)
            const encodedQuery = encodeURIComponent(query);
            const url = `https://api.duckduckgo.com/?q=${encodedQuery}&format=json&no_html=1&skip_disambig=1`;
            
            https.get(url, { timeout: 10000 }, (res) => {
                let data = '';
                
                res.on('data', (chunk) => {
                    data += chunk;
                });
                
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        const results = [];
                        
                        // Abstract(要約)がある場合
                        if (parsed.Abstract && parsed.AbstractText) {
                            results.push({
                                title: parsed.Heading || 'DuckDuckGo検索結果',
                                snippet: parsed.AbstractText,
                                url: parsed.AbstractURL || ''
                            });
                        }
                        
                        // Related Topics(関連トピック)を追加
                        if (parsed.RelatedTopics && Array.isArray(parsed.RelatedTopics)) {
                            parsed.RelatedTopics.forEach((topic, index) => {
                                if (results.length >= 5) return;
                                
                                if (topic.Text && topic.FirstURL) {
                                    results.push({
                                        title: topic.Text.split(' - ')[0] || 'トピック',
                                        snippet: topic.Text,
                                        url: topic.FirstURL
                                    });
                                } else if (topic.Topics && Array.isArray(topic.Topics)) {
                                    topic.Topics.forEach(subTopic => {
                                        if (results.length >= 5) return;
                                        if (subTopic.Text && subTopic.FirstURL) {
                                            results.push({
                                                title: subTopic.Text.split(' - ')[0] || 'トピック',
                                                snippet: subTopic.Text,
                                                url: subTopic.FirstURL
                                            });
                                        }
                                    });
                                }
                            });
                        }
                        
                        // Results配列も確認
                        if (parsed.Results && Array.isArray(parsed.Results)) {
                            parsed.Results.forEach((result, index) => {
                                if (results.length >= 5) return;
                                if (result.Text && result.FirstURL) {
                                    results.push({
                                        title: result.Text.split(' - ')[0] || 'Result',
                                        snippet: result.Text,
                                        url: result.FirstURL
                                    });
                                }
                            });
                        }
                        
                        if (results.length === 0) {
                            console.log(chalk.yellow('[Web Search] No results found, using fallback search'));
                            // フォールバック: HTMLスクレイピング検索
                            performFallbackSearch(query).then(resolve);
                        } else {
                            console.log(chalk.green(`[Web Search] Found ${results.length} results via DuckDuckGo API`));
                            resolve(results);
                        }
                    } catch (parseError) {
                        console.error(chalk.red('[Web Search] JSON parse error:'), parseError.message);
                        performFallbackSearch(query).then(resolve);
                    }
                });
            }).on('error', (err) => {
                console.error(chalk.red('[Web Search] HTTP request error:'), err.message);
                performFallbackSearch(query).then(resolve);
            }).on('timeout', () => {
                console.error(chalk.red('[Web Search] Request timeout'));
                performFallbackSearch(query).then(resolve);
            });
            
        } catch (err) {
            console.error(chalk.red('[ERROR] Web検索エラー:'), err.message);
            resolve([]);
        }
    });
}

/**
 * フォールバック検索: HTMLページから直接スクレイピング
 * @param {string} query - 検索クエリ
 * @returns {Promise<Array>} - 検索結果の配列
 */
async function performFallbackSearch(query) {
    return new Promise((resolve) => {
        try {
            const encodedQuery = encodeURIComponent(query);
            const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;
            
            https.get(url, {
                timeout: 10000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            }, (res) => {
                let html = '';
                
                res.on('data', (chunk) => {
                    html += chunk;
                });
                
                res.on('end', () => {
                    try {
                        const results = parseHTMLResults(html);
                        if (results.length > 0) {
                            console.log(chalk.green(`[Fallback Search] Found ${results.length} results`));
                        } else {
                            console.log(chalk.yellow('[Fallback Search] No results found'));
                        }
                        resolve(results);
                    } catch (parseError) {
                        console.error(chalk.red('[Fallback Search] Parse error:'), parseError.message);
                        resolve([]);
                    }
                });
            }).on('error', (err) => {
                console.error(chalk.red('[Fallback Search] Error:'), err.message);
                resolve([]);
            }).on('timeout', () => {
                console.error(chalk.red('[Fallback Search] Timeout'));
                resolve([]);
            });
            
        } catch (err) {
            console.error(chalk.red('[Fallback Search] Exception:'), err.message);
            resolve([]);
        }
    });
}

/**
 * HTMLから検索結果をパース(正規表現ベース)
 * @param {string} html - HTMLコンテンツ
 * @returns {Array} - 検索結果の配列
 */
function parseHTMLResults(html) {
    const results = [];
    
    try {
        // DuckDuckGoのHTML構造から結果を抽出
        // result__a タグからタイトルとURLを取得
        const titleRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
        const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([^<]*)<\/a>/gi;
        
        let titleMatch;
        const titleMatches = [];
        while ((titleMatch = titleRegex.exec(html)) !== null && titleMatches.length < 5) {
            titleMatches.push({
                url: decodeHTMLEntities(titleMatch[1]),
                title: decodeHTMLEntities(titleMatch[2])
            });
        }
        
        let snippetMatch;
        const snippetMatches = [];
        while ((snippetMatch = snippetRegex.exec(html)) !== null && snippetMatches.length < 5) {
            snippetMatches.push(decodeHTMLEntities(snippetMatch[1]));
        }
        
        // タイトルとスニペットを組み合わせ
        for (let i = 0; i < Math.min(titleMatches.length, 5); i++) {
            results.push({
                title: titleMatches[i].title || 'タイトル不明',
                snippet: snippetMatches[i] || '',
                url: titleMatches[i].url || ''
            });
        }
        
        // 代替パターン: より柔軟なマッチング
        if (results.length === 0) {
            const altRegex = /<h2[^>]*class="result__title"[^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>[\s\S]*?<\/h2>/gi;
            let altMatch;
            while ((altMatch = altRegex.exec(html)) !== null && results.length < 5) {
                results.push({
                    title: decodeHTMLEntities(altMatch[2]) || 'タイトル不明',
                    snippet: '',
                    url: decodeHTMLEntities(altMatch[1]) || ''
                });
            }
        }
        
    } catch (err) {
        console.error(chalk.red('[HTML Parser] Error:'), err.message);
    }
    
    return results;
}

/**
 * HTMLエンティティをデコード
 * @param {string} text - エンコードされたテキスト
 * @returns {string} - デコードされたテキスト
 */
function decodeHTMLEntities(text) {
    const entities = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&#39;': "'",
        '&nbsp;': ' '
    };
    return text.replace(/&[#\w]+;/g, (entity) => entities[entity] || entity);
}

/**
 * 検索結果を読みやすい形式にフォーマット
 * @param {Array} results - 検索結果
 * @returns {string} - フォーマット済みテキスト
 */
function formatSearchResults(results) {
    if (results.length === 0) {
        return '（検索結果が見つかりませんでした）';
    }
    
    return results.map((result, index) => {
        const snippet = result.snippet.length > 150 
            ? result.snippet.substring(0, 150) + '...' 
            : result.snippet;
        return `【${index + 1}】${result.title}\n${snippet || '詳細情報はリンクをご確認ください'}`;
    }).join('\n\n');
}

/**
 * Web検索が必要かどうかを判断
 * @param {string} message - ユーザーメッセージ
 * @returns {boolean}
 */
function shouldPerformWebSearch(message) {
    const lowerMessage = message.toLowerCase();
    
    // 検索が必要なキーワード
    const searchKeywords = [
        '検索', 'さがして', '探して', '調べて', '教えて',
        '最新', '今', 'ニュース', '天気', '気温',
        '価格', '値段', 'いくら', 'いくつ',
        'どこ', 'いつ', '何時', 'なぜ', 'なに',
        'について', 'とは', 'って何', 'どう',
        'search', 'find', 'what', 'when', 'where', 'how', 'why'
    ];
    
    // 検索不要なキーワード(挨拶や感情表現)
    const noSearchKeywords = [
        'こんにちは', 'おはよう', 'こんばんは', 'おやすみ',
        'ありがとう', 'すごい', 'へー', 'なるほど',
        'どう思う', 'どう?', '好き?', '嫌い?',
        'よろしく', 'やあ', 'hi', 'hello', 'thanks', 'bye',
        'リセット', 'reset', '履歴クリア', '覚えてる', '前に'
    ];
    
    // 検索不要パターンにマッチする場合
    if (noSearchKeywords.some(keyword => lowerMessage.includes(keyword))) {
        return false;
    }
    
    // 検索必要パターンにマッチする場合
    if (searchKeywords.some(keyword => lowerMessage.includes(keyword))) {
        return true;
    }
    
    // メッセージが質問形式の場合
    if (lowerMessage.includes('?') || lowerMessage.includes('?')) {
        return true;
    }
    
    // 20文字以上で具体的な情報を求めている可能性がある場合
    if (message.length > 20 && !lowerMessage.match(/^(笑|w|草|ww|www)/)) {
        return true;
    }
    
    return false;
}

/**
 * Gemini AI にチャット応答を生成させる関数(Web検索状態表示付き)
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
            console.log(chalk.cyan('[AI] Web search triggered'));
            
            // Web検索中の状態を表示
            try {
                statusMessage = await message.reply({
                    content: '[SEARCH] **Web検索中...**\nインターネットから最新情報を取得しています...',
                    allowedMentions: { repliedUser: false }
                });
            } catch (err) {
                console.error(chalk.yellow('[Status] Failed to send search status message:'), err.message);
            }
            
            webResults = await performWebSearch(userMessage);
            searchSummary = formatSearchResults(webResults);
            
            // 検索完了後、状態メッセージを更新
            if (statusMessage) {
                try {
                    await statusMessage.edit({
                        content: '[THINK] **AI回答生成中...**\n検索結果を分析しています...'
                    });
                } catch (err) {
                    console.error(chalk.yellow('[Status] Failed to update status message:'), err.message);
                }
            }
        } else {
            console.log(chalk.gray('[AI] Skipping web search - not needed'));
            searchSummary = '';
        }

        // ペルソナ設定の処理
        let systemPrompt = '';
        if (aiConfig.aiPersonalityPrompt && aiConfig.aiPersonalityPrompt.trim() !== '') {
            // カスタムペルソナが設定されている場合
            systemPrompt = `あなたは以下のペルソナで応答してください:\n${aiConfig.aiPersonalityPrompt}`;
        } else {
            // デフォルト: 通常のAIとして振る舞う
            systemPrompt = `あなたはOrderlyCoreという名前のAIアシスタントです。親切で知識豊富、そして自然な会話ができます。`;
        }

        // 会話履歴をプロンプトに組み込む
        let conversationContext = '';
        if (conversationHistory.length > 0) {
            conversationContext = '\n### 過去の会話履歴（参考程度に）\n';
            conversationHistory.forEach((msg) => {
                if (msg.role === 'user') {
                    conversationContext += `ユーザー: ${msg.content}\n`;
                } else {
                    conversationContext += `あなた: ${msg.content}\n`;
                }
            });
            conversationContext += '\n※過去の話題に固執せず、現在のメッセージに適切に応答してください。\n';
        }

        const prompt = `${systemPrompt}

### 応答ルール
- 会話は自然でフレンドリーに
- 200文字以内に収めてください
- **絶対に絵文字を使用しないでください。**
- **最新のユーザーメッセージに最優先で応答してください**
- 過去の会話は参考程度にし、話題が変わったら新しい話題に切り替えてください
- Web検索結果がある場合は、その情報を最優先で活用してください
- URLは表示しないでください
- 返答はメッセージ本文のみ
${conversationContext}

### 現在の会話情報（最重要）
- サーバー名: ${server}
- 発言者: ${user}
- **ユーザーの最新メッセージ**: "${userMessage}"
${searchSummary ? '\n### 最新のウェブ検索結果（最優先で参照）\n' + searchSummary : ''}

### あなたの応答（最新メッセージに対する回答）:`;

        const result = await client.geminiModel.generateContent(prompt);
        const text = result.response.text().trim().replace(/```/g, '');

        // 会話履歴を保存
        saveConversationHistory(message.author.id, message.channel.id, userMessage, text);

        // 状態メッセージを削除
        if (statusMessage) {
            try {
                await statusMessage.delete();
            } catch (err) {
                console.error(chalk.yellow('[Status] Failed to delete status message:'), err.message);
            }
        }

        console.log(chalk.magenta(`[Gemini Chat] User: ${userMessage.substring(0, 50)}... | AI: ${text.substring(0, 50)}... | History: ${conversationHistory.length / 2} turns`));
        return text;
        
    } catch (error) {
        console.error(chalk.red('[ERROR] Gemini APIでの応答生成失敗:'), error);
        
        // エラー時も状態メッセージを削除
        if (statusMessage) {
            try {
                await statusMessage.delete();
            } catch (err) {
                // 削除失敗は無視
            }
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
        console.error(chalk.red('[ERROR] メンション応答処理中にエラー:'), error);
        
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
            console.error(chalk.red('[ERROR] エラーメッセージ送信にも失敗:'), replyError);
        }
    }
}

// イベントリスナーをエクスポート
module.exports = (client) => {
    console.log(chalk.green('[MentionReply] Module loaded - Conversation history & Web search status display enabled'));
    console.log(chalk.gray(`[MentionReply] History timeout: ${CONVERSATION_TIMEOUT / 1000 / 60} minutes, Max turns: ${MAX_HISTORY_LENGTH}`));
    client.on(Events.MessageCreate, (message) => handleMention(message, client));
};