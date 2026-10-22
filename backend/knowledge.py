"""Source-backed lexical retrieval. No embedding model or generative model is used."""
import hashlib
import re
import sqlite3
import threading
from copy import deepcopy
from pathlib import Path

SOURCE = "docs/knowledge/drill-sop.md"
RAW = (Path(__file__).resolve().parent.parent / SOURCE).read_text(encoding="utf-8")
CORPUS_HASH = hashlib.sha256(RAW.encode()).hexdigest()
DOCUMENTS = []
for match in re.finditer(r"^## (DRILL-SOP-\d+) \| ([\d.]+) \| (v[\d.]+) \| ([^\n]+)\n(.*?)(?=^## |\Z)", RAW, re.M | re.S):
    identity, section, version, title, body = match.groups()
    body = body.strip()
    DOCUMENTS.append({"id": identity, "section": section, "version": version, "title": title.strip(), "text": body, "type": "演练规则", "source": SOURCE, "content_hash": hashlib.sha256((title.strip() + "\n" + body).encode()).hexdigest()})
if not DOCUMENTS or len({d["id"] for d in DOCUMENTS}) != len(DOCUMENTS):
    raise RuntimeError("The drill knowledge source has missing or duplicate section identifiers")


def tokens(text, index=False):
    words = []
    for run in re.findall(r"[\u4e00-\u9fff]+|[a-z0-9]+", text.lower()):
        if re.match(r"[\u4e00-\u9fff]", run):
            if len(run) == 1 or index:
                words.extend(run)
            words.extend(run[i:i+2] for i in range(len(run)-1))
        else:
            words.append(run)
    return list(dict.fromkeys(words)) if not index else words


LOCK = threading.RLock()
INDEX = sqlite3.connect(":memory:", check_same_thread=False)
INDEX.execute("CREATE VIRTUAL TABLE knowledge_search USING fts5(title, body)")
for document in DOCUMENTS:
    INDEX.execute("INSERT INTO knowledge_search VALUES (?, ?)", (" ".join(tokens(document["title"], True)), " ".join(tokens(document["text"], True))))
INDEX.commit()


def search(query="", limit=8):
    if not query.strip():
        return deepcopy(DOCUMENTS[:limit])
    exact = next((document for document in DOCUMENTS if document["id"].lower() == query.strip().lower()), None)
    if exact:
        return [{**deepcopy(exact), "score": 1.0, "matched_terms": [exact["id"]]}]
    terms = tokens(query)[:64]
    if not terms:
        return []
    phrase = " OR ".join(f'"{term}"' for term in terms)
    with LOCK:
        rows = INDEX.execute("SELECT rowid, bm25(knowledge_search, 2.0, 1.0) FROM knowledge_search WHERE knowledge_search MATCH ? ORDER BY bm25(knowledge_search, 2.0, 1.0), rowid LIMIT ?", (phrase, limit)).fetchall()
    return [{**deepcopy(DOCUMENTS[rowid-1]), "score": round(-rank, 8), "matched_terms": [term for term in terms if term in DOCUMENTS[rowid-1]["title"] + DOCUMENTS[rowid-1]["text"]]} for rowid, rank in rows]
