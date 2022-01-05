import {writeFileSync} from 'fs';
import fetch from 'node-fetch';
import {explode_cp, hex_cp, quote_cp} from '../build/utils.js';

// use current version
import {ens_normalize} from '../index.js';

let html = await fetch('https://emojipedia.org/emoji-zwj-sequence/').then(r => r.text());

let pos0 = html.indexOf('<ul class="emoji-list">');
if (pos0 == -1) throw new Error('missing start');
let pos1 = html.indexOf('</ul>', pos0);
if (pos1 == -1) throw new Error('missing stop');

let json = [];
// <li><a href="/eye-in-speech-bubble/"><span class="emoji">👁️‍🗨️</span> Eye in Speech Bubble</a></li>
for (let match of html.slice(pos0, pos1).matchAll(/<li>.*?href="(.+?)".*?class="emoji">(.*?)<\/span>(.*?)<\/a>/ug)) {
	let [_, slug, emoji, desc] = match;
	desc = desc.trim();
	let cps = explode_cp(emoji);
	if (!cps.includes(0x200D)) { // wtf
		console.log(`Not ZWJ: ${slug} => ${cps.map(quote_cp).join('')}`);
		continue;
	}
	try {
		ens_normalize(emoji);
		continue; // already valid
	} catch (err) {
	}
	json.push({emoji, slug, desc, src: cps.map(hex_cp).join(' ')});
}

writeFileSync(new URL(`./data/emojipedia-missing-zwj-${new Date().toJSON().slice(0, 10).replaceAll('-', '')}.json`, import.meta.url).pathname, JSON.stringify(json));