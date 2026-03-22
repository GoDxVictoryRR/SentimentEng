

const source = { url: 'https://www.benzinga.com/feed', name: 'Benzinga', tier: 2, weight: 0.75, format: 'rss', category: 'markets' };

function stripHtml(html) {
    return html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

function parseFeed(xmlText, source) {
    const articles = [];
    try {
        const itemRegex = /<(item|entry)>([\s\S]*?)<\/\1>/gi;
        let match;
        while ((match = itemRegex.exec(xmlText)) !== null) {
            const content = match[2];
            const getTag = (tag) => {
                const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
                const m = regex.exec(content);
                return m ? m[1].trim() : null;
            };
            const headline = getTag('title') ?? '';
            if (!headline) continue;
            const description = getTag('description') ?? getTag('summary') ?? getTag('content') ?? '';
            const pubDate = getTag('pubDate') ?? getTag('published') ?? getTag('updated') ?? new Date().toISOString();
            articles.push({
                article_id: 'test',
                source: source.name,
                headline: stripHtml(headline),
                summary: stripHtml(description).slice(0, 500),
                published_at: new Date(pubDate).toISOString(),
            });
        }
    } catch (e) {
        console.error(`[Fetcher] Parse error: ${source.name}`, e);
    }
    return articles;
}

async function test() {
    try {
        console.log(`Fetching ${source.url}...`);
        const resp = await fetch(source.url, {
            headers: { 'User-Agent': 'SentimentLiquidityEngine/1.4' },
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const text = await resp.text();
        console.log(`Fetched ${text.length} chars.`);
        const articles = parseFeed(text, source);
        console.log(`Parsed ${articles.length} articles.`);
        if (articles.length > 0) {
            console.log('First article:', articles[0].headline);
        }
    } catch (e) {
        console.error('Test failed:', e.message);
    }
}

test();
