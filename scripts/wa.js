// Injected into web.whatsapp.com. Reads WhatsApp Web's in-memory store instead of the DOM, because the DOM
// only renders while the tab is on screen and Chrome throttles hidden tabs.
// Every internal name lives in CONFIG: when WhatsApp ships an update, run __wa.probe(), fix what it reports here.
(() => {
  const CONFIG = {
    modules: {
      collections: 'WAWebCollections',
      downloads: 'WAWebDownloadManager',
      history: 'WAWebChatLoadMessages',
    },
    me: 'Me',
    textTypes: ['chat'],
    mediaTypes: { image: 'jpg', audio: 'ogg', ptt: 'ogg', document: 'bin', video: 'mp4', sticker: 'webp' },
  };

  const load = name => window.require(CONFIG.modules[name]);
  const chats = () => load('collections').Chat.getModelsArray();
  const titleOf = chat => chat.formattedTitle || chat.name || chat.contact?.name || '';
  const hash = value => {
    let result = 0;
    for (const char of value) result = (result * 31 + char.charCodeAt(0)) | 0;
    return (result >>> 0).toString(36);
  };
  const pad = number => String(number).padStart(2, '0');
  const localDate = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const localTime = date => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

  const findChats = query => chats().map(titleOf).filter(title => title.toLowerCase().includes(query.toLowerCase()));

  const chatByTitle = title => {
    const chat = chats().find(candidate => titleOf(candidate) === title);
    if (!chat) throw new Error(`chat "${title}" not found, use __wa.findChats() to get the exact title`);
    return chat;
  };

  const models = chat => chat.msgs.getModelsArray();
  const idOf = message => hash(String(message.id?.id ?? message.id));

  const textOf = message => {
    if (CONFIG.textTypes.includes(message.type)) return message.body || '';
    return message.caption || '';
  };

  const quotedOf = message => {
    const quoted = message.quotedMsg;
    if (!quoted) return null;
    return quoted.type === 'chat' ? quoted.body : `<${quoted.type}> ${quoted.caption || ''}`.trim();
  };

  const toMessage = (message, chat) => {
    const sent = new Date(message.t * 1000);
    return {
      id: idOf(message),
      date: localDate(sent),
      time: localTime(sent),
      author: message.id?.fromMe ? CONFIG.me : message.senderObj?.formattedName || titleOf(chat),
      kind: message.type,
      forwarded: Boolean(message.isForwarded),
      quoted: quotedOf(message),
      text: textOf(message),
      ...(message.duration ? { seconds: Number(message.duration) } : {}),
      ...(CONFIG.mediaTypes[message.type] ? { media: `${idOf(message)}.${CONFIG.mediaTypes[message.type]}` } : {}),
    };
  };

  const inRange = ({ from, to } = {}) => message => (!from || message.date >= from) && (!to || message.date <= to);

  const extract = (title, range) => {
    const chat = chatByTitle(title);
    return models(chat).filter(message => message.t).map(message => toMessage(message, chat)).filter(inRange(range));
  };

  const oldestDate = chat => {
    const first = models(chat).find(message => message.t);
    return first ? localDate(new Date(first.t * 1000)) : null;
  };

  // Pull older history into memory until `since` (YYYY-MM-DD) is covered or the device has nothing older
  const loadSince = async (title, since, { maxRounds = 50 } = {}) => {
    const chat = chatByTitle(title);
    const { loadEarlierMsgs } = load('history');
    for (let round = 0; round < maxRounds && oldestDate(chat) >= since; round++) {
      const loaded = await loadEarlierMsgs({ chat, msgCollection: chat.msgs });
      if (!loaded?.length) return { reached: false, oldest: oldestDate(chat), loaded: models(chat).length };
    }
    return { reached: oldestDate(chat) < since, oldest: oldestDate(chat), loaded: models(chat).length };
  };

  const download = (blob, filename) => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 60000);
    return { filename, bytes: blob.size };
  };

  // The browser tool truncates returned values at ~1.5k chars, so bulk output goes to disk via Chrome downloads
  const saveMessages = (title, prefix, range) => {
    const messages = extract(title, range);
    const body = JSON.stringify({ chat: title, range: range ?? null, messages }, null, 2);
    return { ...download(new Blob([body], { type: 'application/json' }), `${prefix}_messages.json`), count: messages.length };
  };

  // downloadAndMaybeDecrypt now insists on a performance logger; a do-nothing one is enough
  const silentLogger = new Proxy({}, { get: (target, key) => (key === Symbol.toPrimitive ? () => '' : () => silentLogger) });

  const fetchMedia = message =>
    load('downloads').downloadManager.downloadAndMaybeDecrypt({
      directPath: message.directPath,
      encFilehash: message.encFilehash,
      filehash: message.filehash,
      mediaKey: message.mediaKey,
      mediaKeyTimestamp: message.mediaKeyTimestamp,
      type: message.type,
      mimetype: message.mimetype,
      signal: new AbortController().signal,
      downloadQpl: silentLogger,
    });

  const saveMedia = async (title, prefix, ids) => {
    const chat = chatByTitle(title);
    const wanted = new Set(ids);
    const results = [];
    for (const message of models(chat).filter(candidate => wanted.has(idOf(candidate)))) {
      const extension = CONFIG.mediaTypes[message.type];
      if (!extension) { results.push({ id: idOf(message), error: `type ${message.type} has no media` }); continue; }
      try {
        const buffer = await fetchMedia(message);
        results.push(download(new Blob([buffer], { type: message.mimetype }), `${prefix}_${idOf(message)}.${extension}`));
      } catch (error) {
        results.push({ id: idOf(message), error: String(error?.message || error).replace(/https?:\/\/\S+/g, '<url>').slice(0, 120) });
      }
    }
    return results;
  };

  const probe = () => {
    const check = (label, test) => {
      try { return [label, Boolean(test())]; } catch { return [label, false]; }
    };
    const report = Object.fromEntries([
      check('require', () => typeof window.require === 'function'),
      check('collections', () => load('collections').Chat.getModelsArray().length > 0),
      check('messages', () => typeof chats()[0].msgs.getModelsArray === 'function'),
      check('chatTitle', () => chats().some(chat => titleOf(chat))),
      check('downloads', () => typeof load('downloads').downloadManager.downloadAndMaybeDecrypt === 'function'),
      check('history', () => typeof load('history').loadEarlierMsgs === 'function'),
    ]);
    return { ...report, broken: Object.keys(report).filter(key => !report[key]) };
  };

  window.__wa = { CONFIG, probe, findChats, loadSince, extract, saveMessages, saveMedia };
  return probe();
})();
