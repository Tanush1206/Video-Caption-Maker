# Language quality (measured on v1.0.10)

How well the app hears and translates each language it offered in v1.0.10,
measured on the test split of Google's FLEURS read-speech dataset
([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), pinned to commit
`70bb2e84`). The sample sentences quoted below come from FLEURS and are
shown unchanged, apart from our outputs. Measured 2026-10-22 and 23 with
`scripts/language_eval.py` (how to re-run it: [TESTING.md](TESTING.md),
"Language quality"). The data was downloaded to `test-assets/` for the run
and deleted afterwards.

**Outcome:** Tamil, Marathi, Bengali and Malayalam are removed in v1.0.11
(weakest speech recognition and translation; [ROADMAP.md](ROADMAP.md) has the
plan to bring them back), and the run found a bug in how quiet recordings
are handled, fixed in v1.0.11 (below).

## Method

- **Speech recognition:** 50 utterances a language, transcribed by the app's
  own code (`services/transcription.py`, the same silence check, phrasing
  and re-decoding as a real job), with the language named, as a person who
  knows it would. Word and character error rates against FLEURS's
  normalised transcript, both sides lower-cased, NFC, punctuation removed;
  numbers are not normalised ("1914" against "nineteen fourteen" counts as
  wrong). Models: large-v3 on the GPU (RTX 5080), Apex (Hinglish) on the GPU
  for Hindi, scored after its Roman output is written back in Devanagari,
  and large-v3-turbo and small on the CPU (int8), the models the hardware
  tiers pick. "Detects it": how often large-v3's own detection named the
  right language.
- **The pipeline:** about 3 minutes of each language's utterances joined
  (0.6 s of silence between them) into an MP4, uploaded to the dev stack
  (GPU, large-v3) and run as a real job, then `coverage_check.py` (speech in
  the audio with no caption over 0.7 s) and `timing_check.py` (the v1.0.8
  timing rules). Hindi twice: Devanagari and Hinglish.
- **Translation:** 100 sentences FLEURS has in all thirteen languages, the
  English and the Hindi version each translated into every other language
  by the local M2M100 (`translation.translate_locally`, the pipeline's own
  path), scored with chrF (sacrebleu 2's definition) against FLEURS's own
  sentence in that language.
- **Grades:** speech, by large-v3 on the GPU: Good at WER up to 15%, Usable
  up to 35%, Weak beyond; Tamil and Malayalam by CER (8% / 20%), since one
  of their words carries what is several in English. Translation: Good at
  chrF 55 or more, Usable 40 or more, Weak below.

## 1. Speech recognition

WER / CER, then the time taken against the audio's length.

| Language | large-v3, GPU | Apex, GPU | large-v3-turbo, CPU | small, CPU | large-v3 detects it | Grade |
|---|---|---|---|---|---|---|
| English | 59% / 58% (0.26×) | — | 60% / 58% (0.59×) | 61% / 59% (0.20×) | 100% | **Not graded:** the quiet-recording bug; 13% / 11% on the 23 clips that gave text |
| Hindi | 26% / 11% (0.30×) | 29% / 13% (0.05×) | 30% / 13% (0.45×) | 55% / 29% (0.46×) | 82% | **Usable:** right words, misspelt (सला for सलाह) |
| Spanish | 3% / 1% (0.10×) | — | 3% / 1% (0.29×) | 6% / 2% (0.11×) | 100% | **Good** |
| Portuguese | 5% / 2% (0.10×) | — | 5% / 1% (0.25×) | 8% / 3% (0.11×) | 100% | **Good** |
| Italian | 3% / 1% (0.09×) | — | 2% / 1% (0.23×) | 7% / 2% (0.10×) | 100% | **Good** |
| Russian | 4% / 1% (0.10×) | — | 4% / 1% (0.30×) | 9% / 2% (0.12×) | 100% | **Good** |
| French | 7% / 3% (0.12×) | — | 8% / 4% (0.34×) | 16% / 7% (0.13×) | 100% | **Good** (one clip empty: the same bug) |
| German | 5% / 2% (0.09×) | — | 5% / 2% (0.29×) | 10% / 4% (0.12×) | 100% | **Good** |
| Dutch | 6% / 3% (0.13×) | — | 6% / 2% (0.39×) | 16% / 5% (0.17×) | 100% | **Good** |
| Marathi | 76% / 24% (0.24×) | — | 82% / 26% (0.36×) | — | 68% | **Weak:** words spelt as heard ("कोरड़ा पाउडर" for "कोरड्या पावडर"); detection often says Hindi |
| Bengali | 73% / 30% (0.45×) | — | 92% / 39% (0.76×) | — | 100% | **Weak:** words spelt as heard, as in Marathi |
| Tamil | 63% / 28% (1.06×) | — | 95% / 48% (0.81×) | — | 94% | **Weak** (CER 28%); slower than real time on the GPU |
| Malayalam | 122% / 95% (0.36×) | — | — | — | 100% | **Weak:** written in Gurmukhi, Devanagari or Telugu script although told it's Malayalam (a model limitation) |

The CPU runs of the four removed languages were stopped when they were
removed: turbo has Marathi, Bengali and Tamil, small has none of them.

**The quiet-recording bug (fixed in v1.0.11).** 27 of the 50 English clips
and 1 French one gave no text at all. Every one of them is quiet, peaking at
-41 to -54 dB with its speech at -56 to -64 dB, and the silence check used a
fixed -40 dB: the whole clip counted as silence, and everything the model
heard in it was dropped as invented. A real video recorded with a quiet or
distant microphone got no captions and no message. From v1.0.11 the
threshold follows a quiet file's speaking level down (and a job with nothing
to caption says "No speech was found in this video."). See "After the fix"
below.

## 2. The app's pipeline

| Language | Heard as | Captions | Speech with no caption (> 0.7 s) | Timing rules (`timing_check.py`) | First caption against the voice: mean / latest / earliest |
|---|---|---|---|---|---|
| English | en | 41 for 190 s | 3: 1.10, 1.18, 1.38 s | fails: words at 141.90-142.78 s uncaptioned | -0.08 / +1.68 / -1.90 s |
| Hindi (Devanagari) | hi | 64 | none | fails: 3 captions under 0.8 s (0.24-0.58 s) | -0.18 / +1.28 / -1.46 s |
| Hindi (Hinglish) | hi | 68 | none | fails: 1 caption of 0.74 s | +0.07 / +1.28 / -1.46 s |
| Spanish | es | 72 | none | fails: 1 caption of 0.74 s | -0.02 / +1.32 / -0.92 s |
| Portuguese | pt | 65 | 1: 0.84 s at 3.70 s | pass | +0.09 / +1.72 / -1.08 s |
| Italian | it | 61 | none | pass | -0.07 / +1.52 / -0.97 s |
| Russian | ru | 71 | none | fails: 1 caption of 0.76 s | +0.01 / +1.18 / -1.32 s |
| French | fr | 91 | none | fails: 1 caption of 0.72 s | -0.04 / +1.14 / -1.28 s |
| German | de | 61 | none | fails: 1 caption of 0.76 s; words at 36.70-38.56 s uncaptioned | -0.25 / +0.04 / -1.13 s |
| Dutch | nl | 83 | none | pass | +0.06 / +1.30 / -0.38 s |

Every language was detected correctly. What the table shows:

- **English lost 7 of its 17 utterances** (those peaking under -40 dB) to the
  quiet-recording bug: 41 captions where the other languages have 61-91.
  `coverage_check.py` doesn't see it, because it judges speech against the
  clip's own speaking level and those utterances sit far under their louder
  neighbours.
- **Short captions:** 8 captions across 6 of the 10 runs are under the 0.8 s
  minimum (0.24-0.76 s). These clips have 0.6 s between utterances, which
  leaves a last word little room to be held longer. It happens on a real
  video too: in the v1.0.10 release check, the Hindi tutorial in Devanagari
  had "है गाइस" for 0.60 s at 200.48 s, followed by a 0.5 s pause. Holding
  it to 0.8 s would leave a 0.3 s gap, which the flicker rule forbids, and
  it was left short. Not changed.
- **Words heard but not captioned**, in loud speech: German 36.70-38.56 s
  (1.9 s) and English 141.90-142.78 s, and audio with no caption in
  Portuguese (0.84 s at 3.70 s). Fewer and shorter than the v1.0.9 gaps
  v1.0.10 fixed, and not yet explained. Not changed.
- Caption starts: within ±0.25 s of the voice on average; single captions
  up to 1.7 s late or 1.9 s early (measured to the nearest caption within
  2 s, so a neighbour's caption can count).

These two are left for a later release unless they show up on real videos.

## After the fix (v1.0.11)

The nine languages kept, measured again on large-v3 (GPU) with v1.0.11's
silence rule: -40 dB as before, unless more than half of a file's speech
would fall inside that silence (true of all 28 clips that came back empty,
of no clip that worked).

| Language | v1.0.10 WER / CER | v1.0.11 WER / CER | Clips with no text |
|---|---|---|---|
| English | 58.6% / 57.8% | **5.7% / 3.6%** | 27 → 0 |
| French | 6.9% / 3.3% | 5.5% / 1.7% | 1 → 0 |
| Hindi | 26.4% / 11.2% | 25.7% / 10.1% | 0 (4 lines differ: run-to-run variation in Hindi decoding; another run gave 25.9%) |
| Spanish, Portuguese, Italian, Russian, German, Dutch | 2.6-6.5% | the same, line for line | 0 |

English is **Good**. A first version of the rule lowered the threshold for
every moderately quiet clip; faint noise around three German and Russian
clips then stopped counting as silence and an invented "Vielen Dank." was
kept (German 5.0 → 5.3%). The rule shipped only intervenes when the speech
itself would be silenced, and those clips are back to v1.0.10's text.

The pipeline runs (section 2) gave the same captions, gaps and timing
results on v1.0.11 as on v1.0.10. The joined English clip still loses its 7
quiet utterances: they sit between loud ones, so the file as a whole speaks
loudly and -40 dB stays. A recording that mixes a loud and a very quiet
speaker is still a limitation.

## 3. Translation (M2M100, local)

chrF against FLEURS's own sentence in that language.

| Caption language | From English | From Hindi |
|---|---|---|
| English | — | 60.2 **Good** |
| Hindi | 50.8 **Usable** | — |
| Spanish | 55.9 **Good** | 47.0 **Usable** |
| Portuguese | 67.5 **Good** | 52.8 **Usable** |
| Italian | 55.4 **Good** | 46.3 **Usable** |
| Russian | 56.5 **Good** | 46.5 **Usable** |
| French | 65.7 **Good** | 53.1 **Usable** |
| German | 65.0 **Good** | 50.1 **Usable** |
| Dutch | 58.3 **Good** | 48.7 **Usable** |
| Bengali | 43.4 **Usable** | 40.8 **Usable** |
| Marathi | 37.5 **Weak** | 37.7 **Weak** |
| Malayalam | 33.9 **Weak** | 33.5 **Weak** |
| Tamil | 23.9 **Weak** | 26.5 **Weak** |

From Hindi every European target loses 9-15 points: names and nouns get
lost on the way ("Chandra Shekhar Solanki" became "Moon Shaker Solanki" into
English). These start from FLEURS's own Hindi; real captions start from what
the speech model heard, which is worse (26% WER).

## 4. Against the PRD's known limitations (v1.0.10)

| The PRD said | Measured |
|---|---|
| The small speech model is weak on fast non-English speech, especially Hindi | Confirmed: small makes 55% WER on Hindi against large-v3's 26%. On the European languages it is 6-16%, usable. |
| Local translation is literal, and weak for the Indian languages; Tamil and Malayalam the weakest | Confirmed: chrF 24 (Tamil), 34 (Malayalam), 38 (Marathi), 43 (Bengali), 51 (Hindi), against 55-68 for the European languages from English. |
| Hindi is weaker as a source than as a target | Confirmed for the European targets (9-15 points lower from Hindi). |
| CPU transcription is roughly real time | Faster on these clips: turbo 0.23-0.81× of the audio's length, small 0.10-0.46×. Short read sentences; long videos with re-decoding take longer. |
| (not listed) Speech recognition in Marathi, Bengali, Tamil, Malayalam | Weak: 63-122% WER. The languages are removed in v1.0.11. |
| (not listed) Malayalam in the wrong script | large-v3 writes it in other scripts; removed in v1.0.11. |
| (not listed) Quiet recordings | No captions at all: the bug above, fixed in v1.0.11 (English 59% → 6% WER). |

## 5. Samples

Three utterances and three translations per language, reference first. The
speech lines are large-v3 on the GPU (and Apex for Hindi); the translations
are from English (into English: from Hindi). An empty line is a clip that
gave no text.

### English

- Said: Alloys are basically a mixture of two or more metals. Don't forget that there are many elements on the periodic table.
  large-v3: Alloys are basically a mixture of two or more metals. Don't forget there are many elements on the periodic table.
- Said: Generally speaking, two behaviors can emerge as managers begin to lead their former peers. One end of the spectrum is trying to remain “one of the guys” (or gals).
  large-v3: One end of the spectrum is trying to remain one of the guys or gals.
- Said: In some areas boiling water for a minute is enough, in others several minutes are needed.
  large-v3: 
- FLEURS: You may also wish to consult the advice of governments other than your own, but their advice is designed for their citizens.
  M2M100: In addition to your government, you can take advice from governments of other countries; however, their advice is given to their citizens in mind.
- FLEURS: It may also be beneficial for one to buy a Wild Card, which provides entry to either selections of parks in South Africa or all of the South African National Parks.
  M2M100: Purchasing a wild card can also be advantageous because it allows you to see South Africa’s selected parks or all of South Africa's national parks.
- FLEURS: Police superintendent Chandra Shekhar Solanki said the accused appeared in court with covered faces.
  M2M100: Police chief Moon Shaker Solanki said the accused had appeared in court with covered faces.

### Hindi

- Said: अपनी सरकार के अलावा आप अन्य देशों की सरकारों की सलाह ले सकते हैं. हालाँकि, उनकी सलाह उनके नागरिकों को ध्यान में रखकर दी जाती हैं.
  large-v3: अपनी सरकार के अलावा आप अन्य देशों की सरकारों की सला ले सकते हैं, हलाकि उनकी सला उनके नागरिकों को ध्यान में रखकर दी जाती है।
- Said: पुलिस अधीक्षक चंद्र शेखर सोलंकी ने कहा कि आरोपी ढके हुए चेहरे के साथ अदालत में पेश हुए थे.
  large-v3: पुलिस अदीच्छक चंदर शेखर सुलंकी ने कहा कि आरूपी ढखे हुए चहरे के साथ अदालस में पेश हुए थे
- Said: एक पूरी तरह से विकसित एथलीट की तरह, बाघ चढ़ाई कर सकता है (हालाँकि अच्छी तरह से नहीं), तैर सकता है, बड़ी दूरी तक छलांग लगा सकता है और एक शक्तिशाली मनुष्य के पाँच गुना बल के साथ खींच सकता है.
  large-v3: एक पूरी तरह से विकसित एथलिट की तरहा बाग चड़ाई कर सकता है हाला के अच्छी तरह से नहीं तेर सकता है बड़ी दूरी तक छलांग लगा सकता है और एक सक्तिशाले मनस के पांच गुना बल के साथ खींच सकता है
- Said: अपनी सरकार के अलावा आप अन्य देशों की सरकारों की सलाह ले सकते हैं. हालाँकि, उनकी सलाह उनके नागरिकों को ध्यान में रखकर दी जाती हैं.
  Apex (Roman): Apni sarkaar ke alaava aap any deshon ki sarkaaron ki salaah le sakte hain. Haalaanki unki salaah unke naagrikon ko dhyaan mein rakhakar di jaati hai.
- Said: पुलिस अधीक्षक चंद्र शेखर सोलंकी ने कहा कि आरोपी ढके हुए चेहरे के साथ अदालत में पेश हुए थे.
  Apex (Roman): Police adhikshak chandrashekhar solanki ne kaha ki aaropi dhakke hue chehre ke saath adaalat mein pesh hue the.
- Said: एक पूरी तरह से विकसित एथलीट की तरह, बाघ चढ़ाई कर सकता है (हालाँकि अच्छी तरह से नहीं), तैर सकता है, बड़ी दूरी तक छलांग लगा सकता है और एक शक्तिशाली मनुष्य के पाँच गुना बल के साथ खींच सकता है.
  Apex (Roman): Ek poori tarah se viksit athlete ki tarah baag chadhai kar sakta hai. Haalaanki achchhi tarah se nahin tedh sakta hai. Badi doori tak chhalang laga sakta hai aur ek shakti saale manushy ke paanch guna bal ke saath khinch sakta hai.
- FLEURS: अपनी सरकार के अलावा आप अन्य देशों की सरकारों की सलाह ले सकते हैं. हालाँकि, उनकी सलाह उनके नागरिकों को ध्यान में रखकर दी जाती हैं.
  M2M100: आप अपने स्वयं के अलावा अन्य सरकारों की सलाह भी सुनना चाहते हैं, लेकिन उनकी सलाह उनके नागरिकों के लिए डिज़ाइन की गई है।
- FLEURS: वाइल्ड कार्ड खरीद लेना फ़ायदेमंद भी हो सकता है क्योंकि इससे आप दक्षिण अफ़्रीका के चुनिंदा पार्क या सभी दक्षिण अफ़्रीकी नेशनल पार्क देख सकते हैं.
  M2M100: यह एक वाइल्ड कार्ड खरीदने के लिए भी फायदेमंद हो सकता है, जो दक्षिण अफ्रीका में पार्कों के चयन या सभी दक्षिण अफ्रीकी राष्ट्रीय उद्यानों में प्रवेश प्रदान करता है।
- FLEURS: पुलिस अधीक्षक चंद्र शेखर सोलंकी ने कहा कि आरोपी ढके हुए चेहरे के साथ अदालत में पेश हुए थे.
  M2M100: पुलिस निदेशक चंद्रा शेखार सोलेनकी ने कहा कि आरोपी को अदालत में चेहरे से कवर किया गया था।

### Spanish

- Said: No se trata, sin embargo, de una experimentación, es una prueba que se usa para descartar una o más de las posibles hipótesis, haciendo preguntas y observaciones que guían la investigación científica.
  large-v3: No se trata, sin embargo, de una experimentación. Es una prueba que se usa para descartar una o más de las posibles hipótesis haciendo preguntas y observaciones que guían la investigación científica.
- Said: Desde siempre, la función de la marina ha sido garantizar que su país conserve la facultad de trasladar a su población y mercancías, a la vez que, interfiere con la capacidad del enemigo para hacer lo propio.
  large-v3: Desde siempre, la función de la Marina ha sido garantizar que su país conserve la facultad de trasladar a su población y mercancías, a la vez que, interfiere con la capacidad del enemigo para hacer lo propio.
- Said: Según ha informado la agencia nuclear de Japón, se ha encontrado cesio y iodo radioactivos en la planta.
  large-v3: Según ha informado la Agencia Nuclear de Japón, se ha encontrado cesio y yodo radioactivos en la planta.
- FLEURS: Es posible que quiera consultar las recomendaciones de otros gobiernos, pero están pensadas para sus propios ciudadanos.
  M2M100: Usted también puede desear consultar el consejo de otros gobiernos que no sea su propio, pero sus consejos están diseñados para sus ciudadanos.
- FLEURS: También puede ser conveniente comprar una Wild Card que permite la entrada a selecciones de parques en Sudáfrica o a todos los Parques Nacionales del país.
  M2M100: También puede ser beneficioso para uno comprar una tarjeta salvaje, que proporciona entrada a una selección de parques en Sudáfrica o a todos los Parques Nacionales de Sudáfrica.
- FLEURS: Según manifestara el superintendente de la policía, Chandra Shekhar Solanki, los acusados se presentaron ante el tribunal con sus rostros cubiertos.
  M2M100: La superintendente de la policía Chandra Shekhar Solanki dijo que el acusado apareció en el tribunal con las caras cubiertas.

### Portuguese

- Said: O romantismo tinha um grande elemento de determinismo cultural, extraído de escritores como Goethe, Fichte e Schlegel.
  large-v3: O romantismo tinha um grande elemento de determinismo cultural, estrutural. extraído de escritores como Goethe, Fichte e Skellige.
- Said: Ele não definiu um valor para os cortes, falando que eles serão feitos de acordo com a produção econômica da China.
  large-v3: Ele não definiu um valor para os cortes, falando que eles serão feitos de acordo com a produção econômica da China.
- Said: O Congresso começou a financiar a iniciativa de obscenidade no ano fiscal de 2005 e especificou que o FBI deve dedicar 10 agentes à pornografia adulta.
  large-v3: O Congresso começou a financiar a iniciativa de obscenidade no ano fiscal de 2005 e especificou que o FBI deve dedicar 10 agentes à pornografia adulta.
- FLEURS: Também é recomendável que você consulte outros governos além do seu, mas o aconselhamento deles é feito para os respectivos cidadãos.
  M2M100: Você também pode querer consultar os conselhos de governos diferentes do seu próprio, mas seus conselhos são projetados para seus cidadãos.
- FLEURS: Pode ser muito útil também adquirir um Wild Card. Com ele você pode ter acesso a vários parques da África do Sul ou a todos os parques nacionais sul-africanos.
  M2M100: Também pode ser benéfico para um comprar um Wild Card, que fornece entrada para seleções de parques na África do Sul ou todos os Parques Nacionais da África do sul.
- FLEURS: O acusado compareceu ao tribunal com o rosto coberto, declarou o superintendente da polícia Chandra Shekhar Solanki.
  M2M100: A superintendente da polícia Chandra Shekhar Solanki disse que o acusado apareceu no tribunal com os rostos cobertos.

### Italian

- Said: Secondo il sovrintendente della polizia Chandra Shekhar Solanki, gli imputati sono apparsi in tribunale con il volto coperto.
  large-v3: Secondo il sovrintendente della polizia Chandra Sekhar Cholanki, gli imputati sono apparsi in tribunale con il volto coperto.
- Said: L'iniziativa contro le oscenità è stata finanziata dal Congresso a partire dall'anno fiscale 2005, con la specifica richiesta all'FBI di assegnare 10 agenti alla pornografia per adulti.
  large-v3: L'iniziativa contro le uscinità è stata finanziata dal Congresso a partire dall'anno fiscale 2005, con la specifica richiesta all'FBI di assegnare 10 agenti alla pornografia per adulti.
- Said: Nel suo saggio "Il discorso del Presidente", Oliver Sacks ha illustrato come persone incapaci di comprendere il linguaggio parlato a causa di danni cerebrali siano tuttavia in grado di valutare con precisione la sincerità.
  large-v3: Nel suo saggio Il discorso del presidente, Oliver Sacks ha illustrato come persone incapaci di comprendere il linguaggio parlato a causa di danni cerebrali siano tuttavia in grado di valutare con precisione la sincerità.
- FLEURS: Ti potrebbero anche interessare i pareri di governi diversi dal tuo, ma tieni comunque presente che tali pareri sono mirati ai cittadini di quei governi.
  M2M100: Potresti anche voler consultare i consigli di governi diversi dal tuo, ma il loro consiglio è progettato per i loro cittadini.
- FLEURS: Anche l'acquisto di una Wild Card potrebbe risultare utile, poiché consente l'accesso a una selezione di parchi in Sudafrica oppure a tutti i parchi nazionali sudafricani.
  M2M100: Può anche essere vantaggioso per uno acquistare una Wild Card, che fornisce l'ingresso a selezioni di parchi in Sudafrica o tutti i Parchi Nazionali del Sud Africa.
- FLEURS: Secondo il sovrintendente della polizia Chandra Shekhar Solanki, gli imputati sono apparsi in tribunale con il volto coperto.
  M2M100: Il superintendente della polizia Chandra Shekhar Solanki ha detto che l'imputato è apparso in tribunale con i volti coperti.

### Russian

- Said: Долина Кочамо – главное направление в Чили для альпинизма. Она известна как Йосмит Южной Америки и имеет большое количество больших гранитных стен и скал.
  large-v3: Долина Качама – главное направление в Чили для альпинизма. Она известна как Йосмит Южной Америки и имеет большое количество больших гранитных стен и скал.
- Said: Возможно, вам также следует проконсультироваться с другими правительствами, помимо своего, но их рекомендации направлены на своих граждан.
  large-v3: Возможно, вам также следует проконсультироваться с другими правительствами, помимо своего, но их рекомендации направлены на своих граждан.
- Said: Также может быть выгодно купить Wild Card, которая позволяет посещать национальные парки ЮАР либо выборочно, либо все.
  large-v3: Также может быть выгодно купить вилдкарт, который позволяет посещать национальные парки ЮАР либо выборочно, либо все.
- FLEURS: Возможно, вам также следует проконсультироваться с другими правительствами, помимо своего, но их рекомендации направлены на своих граждан.
  M2M100: Вы также можете проконсультироваться с советами правительств, отличных от ваших собственных, но их советы предназначены для их граждан.
- FLEURS: Также может быть выгодно купить Wild Card, которая позволяет посещать национальные парки ЮАР либо выборочно, либо все.
  M2M100: Это также может быть выгодно для того, чтобы купить Дикую карту, которая обеспечивает вход в выбор парков в Южной Африке или всех национальных парков Южной Африки.
- FLEURS: Начальник полиции Чандра Шехар Соланки заявил, что обвиняемые были представлены перед судьями с закрытыми лицами.
  M2M100: Начальник полиции Чандра Шехар Соланки заявила, что обвиняемый явился в суде с прикрытыми лицами.

### French

- Said: Tous les noms, suivis du mot Sie qui signifie vous, commencent toujours par une majuscule, même au milieu d’une phrase.
  large-v3: Tous les noms suivis du mot SI qui signifie VOUS commencent toujours par une majuscule même au milieu d'une phrase.
- Said: Par exemple, le format de photographie le plus courant au monde est le 35 mm ; c'était le format de pellicule le plus répandu à la fin de l'ère des films analogiques.
  large-v3: Par exemple, le format de photographie le plus courant du monde est le 35mm, c'était le format de pellicule le plus répandu à la fin de l'ère des films analogiques.
- Said: Par conséquent, le processus d’une organisation travaillant ensemble pour surmonter un obstacle peut conduire à un nouveau processus innovant pour répondre au besoin du client.
  large-v3: Par conséquent, le processus d'une organisation travaillant ensemble pour surmonter un obstacle peut conduire à un nouveau processus innovant pour répondre aux besoins du client.
- FLEURS: Vous pouvez également avoir recours aux conseils d'autres gouvernements que le vôtre, mais leurs conseils sont adaptés à leurs citoyens.
  M2M100: Vous voudrez peut-être également consulter les conseils de gouvernements autres que le vôtre, mais leurs conseils sont conçus pour leurs citoyens.
- FLEURS: Il peut être avantageux de se procurer une Wild Card qui donne accès à certains parcs d'Afrique du Sud, ainsi qu’à tous les parcs nationaux sud-africains.
  M2M100: Il peut également être bénéfique pour l'achat d'une carte sauvage, qui fournit l'entrée à une sélection de parcs en Afrique du Sud ou tous les parcs nationaux d'Afrique du Sud.
- FLEURS: Chandra Shekhar Solanki, commissaire de police, a déclaré que les personnes accusées avaient le visage dissimulé lorsqu'elles ont comparu devant le tribunal.
  M2M100: La superintendante de la police Chandra Shekhar Solanki a déclaré que l'accusé était apparu devant le tribunal avec des visages couverts.

### German

- Said: Dem Leak zufolge bezieht sich das Dokument auf den Grenzstreit, in dem die Palästinenser ein Zurücksetzen der Grenzen in den Zustand vor dem Sechstagekrieg von 1967 fordern.
  large-v3: Dem liegt zufolge bezieht sich das Dokument auf den Grenzstreit, in dem die Palästinenser ein Zurücksetzen der Grenzen in den Zustand vor dem Sechstagekrieg von 1967 fordern.
- Said: "Ihr thermisches Verhalten ist nicht so gleichmäßig wie das großer Höhlen auf der Erde, die oft eine ziemlich konstante Temperatur haben, aber es stimmt damit überein, dass es sich um tiefe Löcher im Boden handelt"", sagte Glen Cushing vom Astrogeologie-Team des United States Geological Survey (USGS) und der Northern Arizona University in Flagstaff, Arizona."
  large-v3: Ihr thermisches Verhalten ist nicht so gleichmäßig wie das großer Höhlen auf der Erde, die oft eine ziemlich konstante Temperatur haben. Aber es stimmt damit überein, dass es sich um tiefe Löcher im Boden handelt, sagte Glenn Cushing vom Astrogeologie-Team des United States Geological Survey, USGS, und der Northern Arizona University in Flagstaff, Arizona.
- Said: In seinem Artikel Die Rede des Präsidenten zeigte Oliver Sacks auf, wie Leute, die wegen eines Hirnschadens keine Sprache mehr verstehen können, trotzdem die Ehrlichkeit von Menschen richtig einschätzen können.
  large-v3: In seinem Artikel »Die Rede des Präsidenten« zeigte Oliver Sacks auf, wie Leute, die wegen eines Hirnschadens keine Sprache mehr verstehen können, trotzdem die Ehrlichkeit von Menschen richtig einschätzen können.
- FLEURS: Sie können auch die Ratschläge anderer Regierungen als der Ihren konsultieren. Deren Hinweise sind jedoch auf ihre eigenen Staatsbürger zugeschnitten.
  M2M100: Sie möchten möglicherweise auch die Ratschläge anderer Regierungen als Ihrer eigenen konsultieren, aber ihr Rat ist für ihre Bürger gedacht.
- FLEURS: Es kann sich auch lohnen, eine Wild Card zu kaufen, die Zutritt entweder zu ausgewählten Parks in Südafrika oder zu allen südafrikanischen Nationalparks gewährt.
  M2M100: Es kann auch von Vorteil sein, eine Wild Card zu kaufen, die den Eintritt in ausgewählte Parks in Südafrika oder alle südafrikanischen Nationalparks bietet.
- FLEURS: Die Polizeipräsidentin Chandra Shekhar Solanki gab an, die Angeklagten seien mit bedeckten Gesichtern vor Gericht erschienen.
  M2M100: Die Polizeibeamte Chandra Shekhar Solanki sagte, der Angeklagte sei vor Gericht mit bedeckten Gesichtern erschienen.

### Dutch

- Said: Het kan ook handig zijn om een Wild Card te kopen. Deze bieden of toegang tot bepaalde delen van parken in Zuid-Afrika of tot alle nationale parken in Zuid-Afrika.
  large-v3: Het kan ook handig zijn om een wildcard te kopen. Deze bieden of toegang tot bepaalde delen van parken in Zuid-Afrika of tot alle nationale parken in Zuid-Afrika.
- Said: Vanaf boekjaar 2005 financierde het Congres het initiatief tegen obsceniteit en verklaarde dat de FBI tien agenten moet inzetten op volwassenenpornografie.
  large-v3: Vanaf boekjaar 2005 financieerde het congres het initiatief tegen obsceniteit en verklaarde dat de FBI 10 agenten moet inzetten op volwassenenpornografie.
- Said: Zorg ervoor dat de stof niet te heet wordt (hierdoor kan de stof krimpen of, in extreme gevallen, verschroeien).
  large-v3: Zorg ervoor dat de stof niet te heet wordt. Hierdoor kan de stof krimpen of in extreme gevallen verschroeien.
- FLEURS: Je kunt naast het advies van je eigen overheid ook het advies van andere overheden raadplegen. Hun advies is echter wel gericht op hun eigen inwoners.
  M2M100: U kunt ook het advies van andere regeringen dan uw eigen raadplegen, maar hun advies is bedoeld voor hun burgers.
- FLEURS: Het kan ook handig zijn om een Wild Card te kopen. Deze bieden of toegang tot bepaalde delen van parken in Zuid-Afrika of tot alle nationale parken in Zuid-Afrika.
  M2M100: Het kan ook voordelig zijn voor iemand om een Wild Card te kopen, die toegang biedt tot selecties van parken in Zuid-Afrika of alle Zuid-Afrikaanse nationale parken.
- FLEURS: Volgens politiecommissaris Chandra Shekhar Solanki hadden de verdachten hun gezichten bedekt toen ze in de rechtbank verschenen.
  M2M100: De politiebeheerder Chandra Shekhar Solanki zei dat de verdachte in de rechtbank verscheen met een bedekt gezicht.

### Marathi

- Said: 2 कोरड्या पावडर एकत्र फिरवा आणि नंतर स्वच्छ ओल्या हातांनी ते एका बॉलमध्ये पिळून घ्या.
  large-v3: दोन कोरड़ा पाउडर एकत्र फिरवा नीनंतर स्वच्य वले आतान्यते एका वाल मदे पीड़ून ग्या।
- Said: तुम्ही तुमच्या स्वत: व्यतिरिक्त इतर सरकारांचा सल्ला विचारात घेण्याची देखील इच्छा ठेऊ शकता, परंतु त्यांचा सल्ला त्यांच्या नागरिकांसाठी डिझाईन केलेला असतो.
  large-v3: तुम्ही तुम्झे स्वत्ता हाँ वितरिक्त इतर सरकारांचा सल्ला विचारत गेनाची देखिल इच्छारत गेट ठेव शक्ता। परुंट त्यांचा सल्ला त्यांचा नागरिकां चाटी डिजाइन केलेला अस्तो।
- Said: पोलिस अधीक्षक चंद्र शेखर सोलंकी यांनी सांगितले की आरोपी चेहरा झाकून घेऊन कोर्टात हजर झाला.
  large-v3: पोलिक्स अधिक्षक चंद्र शेकर सोलंकी यानी साइदले की आरोपी चेरा जाकोन गेवन कोर्टा तदर दाला।
- FLEURS: तुम्ही तुमच्या स्वत: व्यतिरिक्त इतर सरकारांचा सल्ला विचारात घेण्याची देखील इच्छा ठेऊ शकता, परंतु त्यांचा सल्ला त्यांच्या नागरिकांसाठी डिझाईन केलेला असतो.
  M2M100: तुम्ही तुमच्या सरकारच्या तुलनेत अन्य सरकारंची सलाह घेऊ शकता, परंतु त्यांचे सल्ला त्यांच्या नागरिकांसाठी डिझाइन केले जाते.
- FLEURS: 1 वाईल्ड कार्ड खरेदी करणे हे देखील फायदेशीर ठरू शकते जे दक्षिण आफ्रिकेतील निवडक पार्क्समध्ये किंवा सर्व दक्षिण आफ्रिकी राष्ट्रीय उद्यानामध्ये प्रवेश मिळवून देते.
  M2M100: एक जंगला कार्ड विकत घेणे, जो दक्षिण आफ्रिकेतील पार्क या सर्व दक्षिण आफ्रिकन राष्ट्रीय पार्कोंमध्ये प्रवेश प्रदान करतो.
- FLEURS: पोलिस अधीक्षक चंद्र शेखर सोलंकी यांनी सांगितले की आरोपी चेहरा झाकून घेऊन कोर्टात हजर झाला.
  M2M100: पोलिसांच्या निरीक्षका Chandra Shekhar Solanki यांनी म्हटले आहे की, आरोपी न्यायालयात चेहऱ्यावर उपस्थित होते.

### Bengali

- Said: সংস্কৃতির দিক নির্ধারণের ক্ষেত্রে একটি বড় উপাদান ছিল শ্লেগাল, গোথা, ফিশ্তাদের মতো লেখকদের রোম্যান্টিসিজম।
  large-v3: সমস্কিতি দিক নিদ্ধারনে খেতেরে একটি বরো উপাডান সিলো সিলেগাল গোথা কিষ্টাদের মতো লেখাগে রমাইন্টিক সিজন
- Said: তিনি এই কমানোর জন্য কোনও পরিমাণ স্থাপন করেননি, বলেছিলেন যেগুলিচীনের অর্থনৈতিক আয়ের ভিত্তিতে তৈরি করা হবে।
  large-v3: তিনি এই কমানো জন্নো কোনো পরিমান এস্থাপন করেন নি বলেসিলেন জে গুলি চিনের অর্থনোতিক আয়ের ভিত্তিতে তোইডি করা হবে
- Said: সঙ্কর ধাতুগুলি মূলত দুই বা ততোধিক ধাতুর মিশ্রণ।পর্যায় সারণীতে অনেক উপাদান রয়েছে তা ভুলে যাবেন না।
  large-v3: সংকাদ ধাতুগুলি মুলত দুই বা ততদিক ধাতুর মিস্রন পর্জাই সারনিতে অনেক উপাদান রেছে তা ভুলে জাবেন না
- FLEURS: আপনি নিজস্ব দেশের সরকার ছাড়াও অন্য কোন দেশের সরকারের যুক্তি চাইতে পারেন, কিন্তু তাদের যুক্তি তাদের নাগরিকদের জন্য গঠন করা হয়েছে।
  M2M100: আপনি আপনার নিজের ব্যতীত অন্যান্য সরকারের পরামর্শও পড়তে পারেন, কিন্তু তাদের পরামর্শগুলি তাদের নাগরিকদের জন্য ডিজাইন করা হয়।
- FLEURS: কেউ ওয়াইল্ড কার্ডও কিনতে পারে, যা দক্ষিণ আফ্রিকার বিশেষ কিছু পার্ক অথবা যে কোনো জাতীয় উদ্যানে ঢোকার সুযোগ দেয়।
  M2M100: এটি একটি বন্য কার্ড কিনতেও সুবিধাজনক হতে পারে, যা দক্ষিণ আফ্রিকার বিভিন্ন পার্কের বা সমস্ত দক্ষিণ আফরিকান ন্যাশনাল পার্কে প্রবেশের অনুমতি দেয়।
- FLEURS: পুলিশ সুপার চন্দ্র শেখর সোলঙ্কি জানিয়েছিলেন, অভিযুক্তরা মুখ ঢাকা অবস্থায় আদালতে হাজির হয়েছিল।
  M2M100: পুলিশ সুপারভাইজার চান্দ্রা শেকাহার সোলান্গি জানিয়েছেন, অভিযুক্তটি আদালতে মুখে মুখের মুখে উপস্থিত ছিলেন।

### Tamil

- Said: நீங்கள் உங்கள் சொந்த கருத்தைத் தவிர அரசாங்கங்களின் ஆலோசனையை பெற விரும்பலாம், ஆனால் அவர்களின் ஆலோசனை அவர்களின் குடிமக்களுக்கென உருவாக்கப்பட்டுள்ளது.
  large-v3: நீங்கள் உங்கள் சொந்த கருத்தை தவிர அறாசாங்கங்களின் ஆலோசனையைப் பிற விரும்பலாம். ஆனால் அவர்களின் ஆலோசனை அவர்களின் குடிமக்களுக்கு என உருவாக்கப்பட்டுள்ளது. நீங்கள் உங்கள் சொந்த கர்த்தை தவிர அரசாங்கங்களின் அரச்சாந்தன் வலி ஆலோசனையை பிறப்பிரும்பலாம் ஆணால் அவர்களின் ஆலோசனை அவர்களின் குடிமத்திற்கு என உருவாக்கப்பட்ட нее இல்ல
- Said: துணி மிகவும் வெப்பமடைதலை அனுமதிக்காதபடி கவனமாக இருக்கவும் (அதனால் துணி சுருங்கலாம் அல்லது தீவிர நிகழ்வுகளில் துணி தீயில் வாட்டப்படலாம்).
  large-v3: துணி மிகவும் வெப்ப மடிந்ததலை அனுமதிக்கப் பழதத்தி கவனமாக இருக்கவும் அதனால் துணி சுருங்கள்லாம் அல்லது தீவீரன் நிகழ்வுகளில் துணி தீயால் வாடப்படலாம்
- Said: எல்லாப் பெயர்ச்சொற்களும், Sie என்ற வார்த்தையுடன், எப்போதும் ஒரு வாக்கியத்தின் நடுவில் கூட கேப்பிடல் எழுத்துடன் தொடங்குகின்றன.
  large-v3: எல்லா பெயர்ச்சுட்குலும் C என்ற வாரத்தியுடன் எப்போதும் ஒரு வாக்கியத்தின் நடுவில் கூட Capital இளத்துடன் தொடங்கிக்கின்றன.
- FLEURS: நீங்கள் உங்கள் சொந்த கருத்தைத் தவிர அரசாங்கங்களின் ஆலோசனையை பெற விரும்பலாம், ஆனால் அவர்களின் ஆலோசனை அவர்களின் குடிமக்களுக்கென உருவாக்கப்பட்டுள்ளது.
  M2M100: நீங்கள் உங்கள் சொந்த அரசாங்கங்களைத் தவிர மற்ற அரசுகளின் ஆலோசனைகளைக் கேட்டுக்கொள்ள விரும்பலாம், ஆனால் அவர்களுடைய ஆலோசன்கள் தங்கள் ஊழியர்களுக்கு வடிவமைக்கப்பட்டுள்ளது.
- FLEURS: தென்னாப்பிரிக்காவில் உள்ள அனைத்து தேசியப் பூங்காக்களுக்கும் அனுமதி தரும் அல்லது தென்னாப்பிரிக்காவின் குறிப்பிட்ட பூங்காக்களுக்கு அனுமதி தரும் ஒரு (1) வைல்ட் கார்ட் வாங்குவது மேலும் பயனுள்ளதாக இருக்கும்.
  M2M100: ஒருவர் ஒரு Wild Card வாங்க முடியும், இது South Africa அல்லது அனைத்து South African National Parks க்கு தேர்வுகளை வழங்குகிறது.
- FLEURS: காவல்துறை மேற்பார்வையாளர் சந்திர ஷேகர சோலங்கி குற்றம் சாட்டப்பட்டவர்கள் நீதிமன்றத்தில் முகத்தை மூடியவாறு தோன்றினர்.
  M2M100: போலீஸ் அதிகாரி Chandra Shekhar Solanki குற்றவாளி முகங்கள் மூடி வழக்கு வந்தது என்று கூறினார்.

### Malayalam

- Said: മുറിവുകൾക്കായി അദ്ദേഹം ഒരു ചിത്രം സജ്ജമാക്കിയിട്ടില്ല, ചൈനയുടെ സാമ്പത്തിക ഉൽ‌പാദനത്തെ അടിസ്ഥാനമാക്കിയാണ് അവ നിർമ്മിക്കുക എന്ന് പറഞ്ഞു.
  large-v3: ਮੁਰੁਵਕਲ੍ਕਾਈ ਅਦੇਹਂ ਉੁਰੁ ਚੀਤਰੁਂ ਸਜ਼ਮ ਆਕੀ ਇਟੀਲਾ ਚੈਨੀ ਉਡੇ ਸਾਂਪਤੀਕ ਉਲ੍ਪਾਧਨ੍ਤੇ ਅਡੀਸਥਾਨ ਮਾਕੀ ਅਨ ਅਵਨ੍ਨੀਰਮੀਕੁਗੋ ਎ਨ੍
- Said: അലോയ് എന്നത് അടിസ്ഥാനപരമായി 2 അല്ലെങ്കില്‍ അതിലധികം ലോഹങ്ങളുടെ സങ്കരമാണ്‌. മൂലകങ്ങളുടെ പട്ടികയില്‍ ഒരുപാട് മൂലകങ്ങളുണ്ട് എന്ന കാര്യം മറക്കരുത്.
  large-v3: अलोई एन्नद अडिस्तान परमाई रन्ड अल्लेंकिल अधिल अधिकं लोहंगलोडे संकरमान। मूलगंगलोडे पट्टिगैल उरुपाद मूलगंगल उन्दे इन्न कार्यं मरककरुद।
- Said: ഫാബ്രിക് വളരെ ചൂടാകാതിരിക്കാൻ ശ്രദ്ധിക്കുക (ഇത് സങ്കോചത്തിന് കാരണമാകാം, അല്ലെങ്കിൽ തീവ്രമായ സാഹചര്യങ്ങളിൽ കരിഞ്ഞുപോകാം).
  large-v3: ਫੈਬਰੀਕ ਵਲਰੇ ਚੂਡ ਆਗਾ ਦੀਡੀਕਾਂ ਸਰਦੀਕੁਗਾ. ਇਦੇ ਸਂਗੋਜਤੀਨ ਕਾਰਣਮ ਆਗਾ. ਅਲੇਂਗਿਲ ਤੀਵਰਮਾਯ ਸਾਹਜਰੀਅਂਗਲ ਕਰੀਞੁ ਪੋਗਾ.
- FLEURS: മറ്റേതെങ്കിലും സർക്കാരുകളുടെ ഉപദേശം തേടാനും നിങ്ങൾ ആഗ്രഹിച്ചേക്കാം, എന്നാൽ അത്തരം ഉപദേശം അവരുടെ പൗരന്മാർക്ക് വേണ്ടി തയ്യാറാക്കിയിട്ടുള്ളതാണ്.
  M2M100: നിങ്ങൾക്ക് സ്വന്തം സംസ്ഥാനങ്ങളല്ലാതെ മറ്റുള്ളവരുടെ ഉപദേശം തേടാൻ ആഗ്രഹിക്കുന്നേക്കാം, എന്നാൽ അവരുടെ ഉപദേശം അവരുടെ പൗരന്മാർക്കു വേണ്ടിയാണ്.
- FLEURS: ദക്ഷിണാഫ്രിക്കയിലെ ചില പാർക്കുകളിലേക്കോ അല്ലെങ്കിൽ എല്ലാ ദക്ഷിണാഫ്രിക്കൻ ദേശീയ പാർക്കുകളിലേക്കും പ്രവേശനം നൽകുന്ന വൈൽഡ് കാർഡ് വാങ്ങുന്നത് ഒരാൾക്ക് പ്രയോജനകരമായിരിക്കും.
  M2M100: ഒരു Wild Card വാങ്ങാൻ അത്യാവശ്യമായിരിക്കാം, ഇത് ഏതെങ്കിലും ആഫ്രിക്കയിലെ പാർക്കിന്റെ തിരഞ്ഞെടുപ്പുകളിൽ അല്ലെങ്കിൽ എല്ലാ South African National Parks ൽ കയറ്റുമതി നൽകുന്നു.
- FLEURS: ആരോപിക്കപ്പെട്ടവര്‍  മൂടിയ മുഖങ്ങളുമായി കോടതിയിൽ ഹാജരായി എന്ന്‍ പോലീസ് സൂപ്രണ്ട് ചന്ദ്ര ശേഖർ സോളങ്കി പറഞ്ഞു.
  M2M100: പോലീസുകാര് Chandra Shekhar Solanki പറഞ്ഞത് കുറ്റവാളിയെ ജഡ്ജിയിൽ വന്നിരുന്നു മുഖം മറികടന്നു.
