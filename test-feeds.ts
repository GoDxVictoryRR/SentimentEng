import { FEED_SOURCES } from './lib/feeds/sources';
console.log("Checking feeds...");
Promise.all(FEED_SOURCES.map(feed =>
    fetch(feed.url, { method: 'HEAD', headers: { 'User-Agent': 'Mozilla/5.0' } })
        .then(r => console.log(`[${r.status}] ${feed.name}`))
        .catch(e => console.error(`[ERROR] ${feed.name}: ${e.message}`))
)).then(() => console.log("Done."));
