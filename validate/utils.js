
export function random_choice(v) {
	return v[Math.random() * v.length|0];
}

export function random_sample(v, n) {
	if (v.length > n) {
		v = v.slice(); // make copy
		for (let i = 0; i < n; i++) { // shuffle prefix n
			let swap = Math.floor(i + Math.random() * (v.length - i));
			let temp = v[i]; 
			v[i] = v[swap];
			v[swap] = temp;
		}
		v = v.slice(0, n); // truncate
	}
	return v;
}
