const { FEED_SOURCES } = require('./sources');
console.log("Checking feeds...");
Promise.all(FEED_SOURCES.map(feed =>
    fetch(feed.url, { method: 'HEAD' })
        .then(r => console.log(`[${r.status}] ${feed.name}`))
        .catch(e => console.error(`[ERROR] ${feed.name}: ${e.message}`))
)).then(() => console.log("Done."));
