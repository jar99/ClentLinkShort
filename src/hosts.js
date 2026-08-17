/**
 * Host dictionary. A host found here costs an escape-coded index (bits.js)
 * instead of its full text — 3 bits for the most-shared handful, 11 for the
 * rest of the table, open-ended past it.
 *
 * ORDERED BY MEASURED USE, then APPEND-ONLY. An entry's position IS its
 * wire encoding, so reordering or removing one silently repoints every link
 * already shared. Add to the end, never anywhere else; the escape-coded
 * index has no cap. (This order was set once, from the corpus, while the
 * format was still beta; from 1.0 on it never moves again.)
 *
 * @type {readonly string[]}
 */
export const HOSTS = Object.freeze([
  "npmjs.com","doi.org","pypi.org","github.com","youtube.com",
  "twitter.com","archive.org","medium.com","commons.wikimedia.org","upload.wikimedia.org",
  "en.wikipedia.org","x.com","open.spotify.com","goodreads.com","facebook.com",
  "instagram.com","flickr.com","imdb.com","mastodon.social","linkedin.com",
  "soundcloud.com","nytimes.com","theguardian.com","i.imgur.com","techcrunch.com",
  "arstechnica.com","arxiv.org","bloomberg.com","reddit.com","news.ycombinator.com",
  "reuters.com","wsj.com","imgur.com","www.google.com","bbc.com",
  "bbc.co.uk","theverge.com","nature.com","kickstarter.com","tiktok.com",
  "wired.com","phys.org","washingtonpost.com","ft.com","cnbc.com",
  "old.reddit.com","theatlantic.com","cnn.com","economist.com","businessinsider.com",
  "npr.org","apnews.com","forbes.com","amazon.com","twitch.tv",
  "bsky.app","engadget.com","patreon.com","newyorker.com","theconversation.com",
  "apps.apple.com","macrumors.com","web.archive.org","gist.github.com","scientificamerican.com",
  "huggingface.co","quora.com","science.org","abc.net.au","stackoverflow.com",
  "cbc.ca","books.google.com","sciencedirect.com","telegraph.co.uk","newscientist.com",
  "substack.com","docs.google.com","independent.co.uk","aws.amazon.com","vimeo.com",
  "apple.com","microsoft.com","lemmy.world","youtu.be","i.redd.it",
  "maps.google.com","gutenberg.org","openai.com","scmp.com","dailymail.co.uk",
  "play.google.com","aljazeera.com","w3.org","store.steampowered.com","developer.apple.com",
  "dw.com","cloud.google.com","anthropic.com","spiegel.de","developer.mozilla.org",
  "researchgate.net","gitlab.com","lemonde.fr","france24.com","drive.google.com",
  "rte.ie","pubmed.ncbi.nlm.nih.gov","t.co","m.youtube.com","asahi.com",
  "learn.microsoft.com","jstor.org","vercel.com","chatgpt.com","crates.io",
  "bitbucket.org","scholar.google.com","espn.com","figma.com","elpais.com",
  "claude.ai","codepen.io","dropbox.com","python.org","kaggle.com",
  "nodejs.org","stripe.com","notion.so","podcasts.apple.com","developer.android.com",
  "digitalocean.com","docker.com","observablehq.com","colab.research.google.com","fly.io",
  "go.dev","t.me","jsfiddle.net","mail.google.com","straitstimes.com",
  "dribbble.com","etsy.com","tumblr.com","indeed.com","airbnb.com",
  "raw.githubusercontent.com","acm.org","cloudflare.com","khanacademy.org","golang.org",
  "discord.com","weather.com","itch.io","standard.co.uk","newegg.com",
  "spotify.com","glassdoor.com","netlify.com","kubernetes.io","netflix.com",
  "udemy.com","yelp.com","corriere.it","chess.com","hub.docker.com",
  "threads.net","itv.com","steamcommunity.com","dailymotion.com","ebay.com",
  "paypal.com","slack.com","zillow.com","heroku.com","hulu.com",
  "ikea.com","coursera.org","weibo.com","replit.com","discord.gg",
  "pbs.twimg.com","render.com","behance.net","ieee.org","bestbuy.com",
  "wordpress.com","edx.org","walmart.com","music.apple.com","telegram.me",
  "whatsapp.com","vk.com","springer.com","postimg.cc","homedepot.com",
  "codesandbox.io","tripadvisor.com","pinterest.com","calendar.google.com","i.ibb.co",
  "unsplash.com","lowes.com","snapchat.com","sky.com","rakuten.co.jp",
  "preview.redd.it","duolingo.com","zoom.us","target.com","rust-lang.org",
  "alibaba.com","blogspot.com","booking.com","strava.com","gofundme.com",
  "otto.de","live.staticflickr.com","taobao.com","costco.com","office.com",
  "argos.co.uk","johnlewis.com","asos.com","tesco.com","xiaohongshu.com",
  "i.pinimg.com","azure.com","outlook.com","expedia.com","disneyplus.com",
  "primevideo.com","aliexpress.com","temu.com","shein.com","wayfair.com",
  "zalando.co.uk","mercadolibre.com","jd.com","chewy.com","sephora.com",
  "nordstrom.com","macys.com","carrefour.fr","ok.ru","line.me",
  "wa.me","ytimg.com","console.aws.amazon.com","meet.google.com","media.giphy.com",
  "cdn.discordapp.com","images.unsplash.com","media.tenor.com"
]);

/** @type {ReadonlyMap<string, number>} */
export const HOST_INDEX = new Map(HOSTS.map((h, i) => [h, i]));
