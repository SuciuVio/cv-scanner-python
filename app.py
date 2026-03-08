import os
import json
import uuid
import requests
from flask import Flask, render_template, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
CORS(app)

CLAUDE_API_KEY = os.getenv("CLAUDE_API_KEY")
CLAUDE_API_URL = "https://api.anthropic.com/v1/messages"
CLAUDE_MODEL   = "claude-sonnet-4-20250514"

HEADERS = {
    "Content-Type": "application/json",
    "x-api-key": CLAUDE_API_KEY,
    "anthropic-version": "2023-06-01",
}

# Stocare in-memory pentru analize partajabile
shared_analyses = {}

# ── Prompts ───────────────────────────────────────────────

ANALYZE_PROMPT = """Esti un expert HR. Analizeaza CV-ul si returneaza STRICT JSON valid (fara markdown, fara backticks):
{"nume":"string","titlu":"string","email":"string sau null","telefon":"string sau null","locatie":"string sau null","rezumat":"max 2 fraze scurte","puncteFoarte":["string","string","string"],"puncteSlabe":["string","string"],"experienta":[{"rol":"string","companie":"string","perioada":"string","descriere":"string scurt"}],"skills":["s1","s2","s3","s4","s5","s6"],"educatie":"string","limbi":["string"],"scorGeneral":82,"scoruri":{"skills":{"nota":80,"comentariu":"o fraza scurta"},"experienta":{"nota":85,"comentariu":"o fraza scurta"},"educatie":{"nota":75,"comentariu":"o fraza scurta"},"prezentare":{"nota":70,"comentariu":"o fraza scurta"}},"recomandare":"o fraza"}
Inlocuieste valorile de exemplu cu date reale din CV. Raspunde DOAR cu JSON-ul completat."""

JOB_MATCH_PROMPT = """Esti un expert HR. Compara CV-ul cu descrierea jobului si returneaza STRICT JSON valid (fara markdown):
{"scor":82,"verdict":"Potrivire buna","rezumat":"1-2 fraze despre potrivire","skillsMatch":["skill 1","skill 2"],"skillsLipsa":["skill lipsa 1","skill lipsa 2"],"puncteFoarte":["motiv 1","motiv 2"],"riscuri":["risc 1","risc 2"],"sfaturi":["sfat 1","sfat 2"],"decizie":"Recomandat"}
Raspunde DOAR cu JSON."""

COMPARE_PROMPT = """Esti un expert HR. Analizeaza TOATE CV-urile si returneaza STRICT JSON valid (fara markdown):
{"candidati":[{"index":0,"nume":"Nume","titlu":"Titlu","scor":85,"rank":1,"rezumat":"1 fraza","puncteFoarte":["p1","p2"],"skillsTop":["s1","s2","s3"],"recomandare":"o fraza"}],"castigator":"Numele","motiv":"De ce este primul","comparatie":"2 fraze despre diferente"}
Candidatii ordonati dupa scor descrescator. Raspunde DOAR cu JSON."""

IMPROVE_PROMPT = """Esti un expert in optimizarea CV-urilor. Analizeaza CV-ul si returneaza STRICT JSON valid (fara markdown):
{"scorCurent":65,"scorEstimat":85,"rezumatProbleme":"1-2 fraze despre principalele probleme","topImbunatatiri":[{"prioritate":1,"actiune":"titlu scurt","detaliu":"explicatie detaliata ce sa faca exact","impactScor":"+8 puncte"},{"prioritate":2,"actiune":"string","detaliu":"string","impactScor":"string"},{"prioritate":3,"actiune":"string","detaliu":"string","impactScor":"string"},{"prioritate":4,"actiune":"string","detaliu":"string","impactScor":"string"},{"prioritate":5,"actiune":"string","detaliu":"string","impactScor":"string"}],"sectiuni":{"titluProfesional":{"problema":"string","solutie":"textul exact recomandat","impact":"Ridicat"},"rezumat":{"problema":"string","solutie":"text complet recomandat 3-4 fraze","impact":"Ridicat"},"experienta":{"problema":"string","solutie":"string","impact":"Mediu"},"skills":{"problema":"string","solutie":"string","impact":"Mediu"},"prezentare":{"problema":"string","solutie":"string","impact":"Scazut"}},"keywordsLipsa":["kw1","kw2","kw3","kw4","kw5"],"formatareSugestii":["sugestie1","sugestie2","sugestie3"]}
Fii specific si concret, nu sfaturi generice. Raspunde DOAR cu JSON."""

COVER_LETTER_PROMPT = """Esti un expert in redactarea scrisorilor de intentie profesionale. Genereaza o scrisoare convingatoare si returneaza STRICT JSON valid (fara markdown):
{"subiectEmail":"Candidatura pentru [Titlu Job] - [Numele Candidatului]","scrisoare":"textul complet al scrisorii, paragrafe separate cu \\n\\n, ton profesional dar personal, 300-400 cuvinte, cu salut si incheiere","sfaturi":["sfat personalizare 1","sfat personalizare 2","sfat personalizare 3"],"puncteCheie":["punct cheie evidentiat 1","punct cheie 2","punct cheie 3"]}
Scrisoarea: deschidere captivanta, valoare adusa, experienta relevanta, motivatie pentru companie, incheiere cu CTA. Raspunde DOAR cu JSON."""

TRANSLATE_PROMPT = """Esti un traducator profesionist specializat in CV-uri. Translateaza CV-ul in {limba} pastrand formatarea si structura originala. Returneaza STRICT JSON valid (fara markdown):
{"cvTradus":"textul complet al CV-ului tradus, bine formatat, gata de copiat","numeCandidat":"string","tipsLocalizare":["sfat localizare 1 specific pentru {limba}","sfat 2","sfat 3"],"termeniAdaptati":[{"original":"termen roman","tradus":"echivalent in {limba}","nota":"explicatie daca e cazul"}]}
Pastreaza toate datele reale (nume, date, companii). Raspunde DOAR cu JSON."""

MATCHING_PROMPT = """Esti un expert HR. Ai primit {nr_cvuri} CV-uri si {nr_joburi} descrieri de job. Calculeaza scorul de potrivire pentru TOATE combinatiile posibile si returneaza STRICT JSON valid (fara markdown):
{"matches":[{"cvIndex":0,"cvNume":"Nume Candidat","jobIndex":0,"jobTitlu":"Titlu Job","scor":85,"verdict":"Potrivire excelenta","skillsMatch":["s1","s2"],"skillsLipsa":["s3"],"recomandare":"o fraza scurta"}],"bestMatchuri":[{"jobTitlu":"string","candidatOptim":"string","scor":90,"motiv":"de ce este cel mai bun"}],"rezumat":"2-3 fraze despre rezultatele generale"}
Returneaza TOATE combinatiile CVuri x Joburi. Raspunde DOAR cu JSON."""


def call_claude(system, user, max_tokens=2000):
    payload = {
        "model": CLAUDE_MODEL,
        "max_tokens": max_tokens,
        "system": system,
        "messages": [{"role": "user", "content": user}],
    }
    resp = requests.post(CLAUDE_API_URL, headers=HEADERS, json=payload, timeout=90)
    resp.raise_for_status()
    data = resp.json()
    if "error" in data:
        raise ValueError(data["error"]["message"])
    raw = "".join(b.get("text", "") for b in data.get("content", []))
    return extract_json(raw)


def extract_json(text):
    import re
    cleaned = text.replace("```json", "").replace("```", "").strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass
    start = cleaned.find("{")
    end   = cleaned.rfind("}")
    if start != -1 and end > start:
        try:
            return json.loads(cleaned[start:end + 1])
        except json.JSONDecodeError:
            pass
    sanitized = re.sub(r",\s*}", "}", cleaned)
    sanitized = re.sub(r",\s*]", "]", sanitized)
    s2 = sanitized.find("{")
    e2 = sanitized.rfind("}")
    if s2 != -1 and e2 > s2:
        return json.loads(sanitized[s2:e2 + 1])
    raise ValueError("Nu am putut extrage JSON din raspunsul Claude.")


# ── Routes ────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/share/<share_id>")
def shared_view(share_id):
    return render_template("index.html")

@app.route("/api/analyze", methods=["POST"])
def analyze():
    data = request.get_json()
    cv_text = (data or {}).get("cv_text", "").strip()
    if not cv_text:
        return jsonify({"error": "cv_text lipseste"}), 400
    if not CLAUDE_API_KEY:
        return jsonify({"error": "CLAUDE_API_KEY nu este setat"}), 500
    try:
        result = call_claude(ANALYZE_PROMPT, f"Analizeaza acest CV si returneaza DOAR JSON:\n\n{cv_text[:8000]}")
        return jsonify({"success": True, "data": result})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/jobmatch", methods=["POST"])
def jobmatch():
    data = request.get_json()
    cv_text  = (data or {}).get("cv_text", "").strip()
    job_text = (data or {}).get("job_text", "").strip()
    if not cv_text or not job_text:
        return jsonify({"error": "cv_text si job_text sunt obligatorii"}), 400
    if not CLAUDE_API_KEY:
        return jsonify({"error": "CLAUDE_API_KEY nu este setat"}), 500
    try:
        result = call_claude(JOB_MATCH_PROMPT, f"CV:\n{cv_text[:5000]}\n\nDESCRIERE JOB:\n{job_text[:3000]}")
        return jsonify({"success": True, "data": result})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/compare", methods=["POST"])
def compare():
    data = request.get_json()
    cvs  = (data or {}).get("cvs", [])
    if len(cvs) < 2:
        return jsonify({"error": "Sunt necesare minim 2 CV-uri"}), 400
    if len(cvs) > 5:
        return jsonify({"error": "Maximum 5 CV-uri"}), 400
    if not CLAUDE_API_KEY:
        return jsonify({"error": "CLAUDE_API_KEY nu este setat"}), 500
    cv_list = "\n\n---\n\n".join(f"CV {i+1} ({c['name']}):\n{c['text'][:3000]}" for i, c in enumerate(cvs))
    try:
        result = call_claude(COMPARE_PROMPT, f"Compara aceste {len(cvs)} CV-uri si returneaza DOAR JSON:\n\n{cv_list}", max_tokens=2500)
        return jsonify({"success": True, "data": result})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/improve", methods=["POST"])
def improve():
    data = request.get_json()
    cv_text = (data or {}).get("cv_text", "").strip()
    if not cv_text:
        return jsonify({"error": "cv_text lipseste"}), 400
    if not CLAUDE_API_KEY:
        return jsonify({"error": "CLAUDE_API_KEY nu este setat"}), 500
    try:
        result = call_claude(IMPROVE_PROMPT, f"Analizeaza si genereaza sugestii concrete. Returneaza DOAR JSON:\n\n{cv_text[:8000]}", max_tokens=3000)
        return jsonify({"success": True, "data": result})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/coverletter", methods=["POST"])
def cover_letter():
    data     = request.get_json()
    cv_text  = (data or {}).get("cv_text", "").strip()
    job_text = (data or {}).get("job_text", "").strip()
    limba    = (data or {}).get("limba", "romana")
    if not cv_text:
        return jsonify({"error": "cv_text lipseste"}), 400
    if not CLAUDE_API_KEY:
        return jsonify({"error": "CLAUDE_API_KEY nu este setat"}), 500
    user_msg = f"Genereaza scrisoare de intentie in {limba}."
    if job_text:
        user_msg += f"\n\nDESCRIERE JOB:\n{job_text[:3000]}"
    user_msg += f"\n\nCV:\n{cv_text[:5000]}\n\nReturneaza DOAR JSON."
    try:
        result = call_claude(COVER_LETTER_PROMPT, user_msg, max_tokens=3000)
        return jsonify({"success": True, "data": result})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/translate", methods=["POST"])
def translate():
    data    = request.get_json()
    cv_text = (data or {}).get("cv_text", "").strip()
    limba   = (data or {}).get("limba", "engleza")
    if not cv_text:
        return jsonify({"error": "cv_text lipseste"}), 400
    if not CLAUDE_API_KEY:
        return jsonify({"error": "CLAUDE_API_KEY nu este setat"}), 500
    system = TRANSLATE_PROMPT.replace("{limba}", limba)
    try:
        result = call_claude(system, f"Translateaza CV-ul in {limba} si returneaza DOAR JSON:\n\n{cv_text[:8000]}", max_tokens=4000)
        return jsonify({"success": True, "data": result})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/matching", methods=["POST"])
def matching():
    data = request.get_json()
    cvs  = (data or {}).get("cvs", [])
    jobs = (data or {}).get("jobs", [])
    if len(cvs) < 1 or len(jobs) < 1:
        return jsonify({"error": "Minim 1 CV si 1 job"}), 400
    if len(cvs) > 5 or len(jobs) > 5:
        return jsonify({"error": "Maximum 5 CV-uri si 5 joburi"}), 400
    if not CLAUDE_API_KEY:
        return jsonify({"error": "CLAUDE_API_KEY nu este setat"}), 500
    cv_section  = "\n\n".join(f"CV {i+1} - {c['name']}:\n{c['text'][:2000]}" for i, c in enumerate(cvs))
    job_section = "\n\n".join(f"JOB {i+1} - {j['title']}:\n{j['text'][:1500]}" for i, j in enumerate(jobs))
    system = MATCHING_PROMPT.replace("{nr_cvuri}", str(len(cvs))).replace("{nr_joburi}", str(len(jobs)))
    try:
        result = call_claude(system, f"CV-URI:\n{cv_section}\n\nJOBURI:\n{job_section}\n\nReturneaza DOAR JSON cu toate combinatiile.", max_tokens=4000)
        return jsonify({"success": True, "data": result})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/share", methods=["POST"])
def create_share():
    data   = request.get_json()
    result = (data or {}).get("result")
    mode   = (data or {}).get("mode", "analiza")
    title  = (data or {}).get("title", "Analiza CV")
    if not result:
        return jsonify({"error": "result lipseste"}), 400
    share_id = str(uuid.uuid4())[:8]
    shared_analyses[share_id] = {"result": result, "mode": mode, "title": title}
    return jsonify({"success": True, "shareId": share_id})

@app.route("/api/share/<share_id>", methods=["GET"])
def get_share(share_id):
    data = shared_analyses.get(share_id)
    if not data:
        return jsonify({"error": "Linkul a expirat sau nu exista."}), 404
    return jsonify({"success": True, **data})

@app.route("/api/health")
def health():
    return jsonify({"status": "ok", "api_key_set": bool(CLAUDE_API_KEY), "model": CLAUDE_MODEL})

if __name__ == "__main__":
    port  = int(os.getenv("PORT", 5000))
    debug = os.getenv("FLASK_ENV") == "development"
    app.run(host="0.0.0.0", port=port, debug=debug)
