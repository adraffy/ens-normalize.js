import unicodedata
import json

with open('../build/unicode-json/NormalizationTest.json') as f:
	tests = json.load(f)

for test, cases in tests.items():
	tests[test] = [[
		unicodedata.normalize('NFC', src), 
		unicodedata.normalize('NFD', src)
	] for src, nfc, nfd in cases]

with open('./data/nf-python.json', "w") as f:
    json.dump(tests, f)