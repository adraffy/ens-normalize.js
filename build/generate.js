import {mkdirSync, readFileSync} from 'fs';

let base_dir = new URL('.', import.meta.url).pathname;

function read_parsed(name) {
	return JSON.parse(readFileSync(join(base_dir, 'unicode-json', `${name}.json`)));
}

let {T, L, R, D} = read_parsed('DerivedJoiningType');



// If RegExpMatch((Joining_Type:{L,D})(Joining_Type:T)*\u200C(Joining_Type:T)*(Joining_Type:{R,D})) Then True;
function generate_contextj_zwnj_rule2() {
	
	

}