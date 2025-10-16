# scripts/build_wordlists.py
import re
from pathlib import Path

# pip install nltk
import nltk
from nltk.corpus import wordnet as wn

def load_wordnet():
    try:
        wn.synsets("dog")
    except LookupError:
        nltk.download("wordnet")
        nltk.download("omw-1.4")

ALNUM = re.compile(r"^[a-z]+$")

def unique_lower(words):
    seen = set()
    out = []
    for w in words:
        w = w.lower()
        if ALNUM.match(w) and 2 <= len(w) <= 12 and w not in seen:
            seen.add(w)
            out.append(w)
    return out

def collect_adjectives():
    adjs = set()
    for s in wn.all_synsets(pos=wn.ADJ):
        for lemma in s.lemma_names():
            adjs.add(lemma.replace("_", " "))
    # include satellite adjectives
    for s in wn.all_synsets(pos=wn.ADJ_SAT):
        for lemma in s.lemma_names():
            adjs.add(lemma.replace("_", " "))
    return unique_lower(adjs)

def collect_nouns():
    nouns = set()
    for s in wn.all_synsets(pos=wn.NOUN):
        for lemma in s.lemma_names():
            nouns.add(lemma.replace("_", " "))
    return unique_lower(nouns)

if __name__ == "__main__":
    load_wordnet()
    adjectives = collect_adjectives()
    nouns = collect_nouns()

    out_dir = Path("public/names")
    out_dir.mkdir(parents=True, exist_ok=True)

    (out_dir / "adjectives.txt").write_text("\n".join(adjectives), encoding="utf-8")
    (out_dir / "nouns.txt").write_text("\n".join(nouns), encoding="utf-8")

    print(f"adjectives: {len(adjectives)} -> public/names/adjectives.txt")
    print(f"nouns     : {len(nouns)} -> public/names/nouns.txt")

