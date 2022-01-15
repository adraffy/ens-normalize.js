json = Import[FileNameJoin@{Directory[], "../build/unicode-json/NormalizationTest.json"}];
json[[All, 2]] = Apply[{CharacterNormalize[#,"NFC"],CharacterNormalize[#,"NFD"]}&, json[[All, 2]], {2}];
Export[FileNameJoin@{Directory[], "data/nf-wolfram.json"}, json, "Compact"->True];