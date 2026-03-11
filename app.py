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

shared_analyses = {}


# ── Claude API helper ──────────────────────────────────────

def call_claude_raw(prompt, max_tokens=2000):
    payload = {
        "model": CLAUDE_MODEL,
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": prompt}]
    }
    try:
        resp = requests.post(CLAUDE_API_URL, headers=HEADERS, json=payload, timeout=120)
        resp.raise_for_status()
        data = resp.json()
        return data["content"][0]["text"]
    except requests.exceptions.Timeout:
        return '{"error": "Timeout - cererea a durat prea mult. Incearca din nou."}'
    except requests.exceptions.HTTPError as e:
        return f'{{"error": "Eroare API Claude: {e}"}}'
    except Exception as e:
        print(f"[ERROR] call_claude_raw: {e}")
        return '{"error": "Eroare necunoscuta. Incearca din nou."}'

def call_claude(system_prompt, user_text, max_tokens=2000):
    prompt = f"{system_prompt}\n\nCV:\n{user_text}"
    raw = call_claude_raw(prompt, max_tokens)
    return parse_json(raw)

def parse_json(text):
    """Extrage JSON din raspunsul Claude."""
    import re
    if not text:
        return {"error": "Raspuns gol de la AI."}
    text = text.strip()
    # Remove markdown fences
    text = re.sub(r'^```(?:json)?\s*', '', text)
    text = re.sub(r'\s*```$', '', text)
    text = text.strip()
    try:
        return json.loads(text)
    except Exception:
        # Try to find JSON object in text
        m = re.search(r'\{.*\}', text, re.DOTALL)
        if m:
            try:
                return json.loads(m.group())
            except Exception:
                pass
    print(f"[WARN] Could not parse JSON. Raw text (first 500): {text[:500]}")
    return {"error": "Nu am putut extrage JSON. Incearca din nou."}


# ── Prompts ───────────────────────────────────────────────

ANALYZE_PROMPT = """Esti un expert HR senior. Analizeaza CV-ul si returneaza STRICT JSON valid (fara markdown, fara backticks):
{"nume":"string","titlu":"string","email":"string sau null","telefon":"string sau null","locatie":"string sau null","rezumat":"max 2 fraze scurte","puncteFoarte":["string","string","string"],"puncteSlabe":["string","string"],"experienta":[{"rol":"string","companie":"string","perioada":"string","descriere":"string scurt"}],"skills":["s1","s2","s3","s4","s5","s6"],"educatie":"string","limbi":["string"],"scorGeneral":82,"seniority":"Junior","limbaCv":"romana","industrie":"IT","mediaIndustrie":72,"comparatieIndustrie":"o fraza despre cum se compara candidatul cu media din industria sa","scoruri":{"skills":{"nota":80,"comentariu":"o fraza scurta"},"experienta":{"nota":85,"comentariu":"o fraza scurta"},"educatie":{"nota":75,"comentariu":"o fraza scurta"},"prezentare":{"nota":70,"comentariu":"o fraza scurta"}},"recomandare":"o fraza"}
Campuri importante:
- seniority: EXACT unul din: "Intern","Junior","Mid","Senior","Lead","Manager","Director","C-Level"
- limbaCv: limba in care e scris CV-ul (romana/engleza/franceza/germana etc)
- industrie: domeniul principal al candidatului (ex: IT, Marketing, Finance, HR, Engineering, Sales, etc)
- mediaIndustrie: scorul mediu tipic pentru candidati din aceasta industrie (50-80)
- comparatieIndustrie: 1-2 fraze despre cum se compara candidatul cu piata
Inlocuieste valorile de exemplu cu date reale din CV. Raspunde DOAR cu JSON-ul completat."""

JOB_MATCH_PROMPT = """Esti un expert HR senior si consultant de cariera. Compara CV-ul cu descrierea jobului si returneaza STRICT JSON valid (fara markdown):
{"scor":82,"verdict":"Potrivire buna","rezumat":"1-2 fraze despre potrivire","skillsMatch":["skill 1","skill 2"],"skillsLipsa":["skill lipsa 1","skill lipsa 2"],"puncteFoarte":["motiv 1","motiv 2"],"riscuri":["risc 1","risc 2"],"sfaturi":["sfat 1","sfat 2"],"decizie":"Recomandat","planActiune":[{"pas":1,"actiune":"titlu scurt","detaliu":"descriere concreta","durata":"1-2 saptamani","prioritate":"Urgent"},{"pas":2,"actiune":"titlu","detaliu":"descriere","durata":"timp","prioritate":"Important"}],"salariu":{"minim":3000,"maxim":5000,"moneda":"EUR","sursa":"estimare bazata pe job si piata","comentariu":"1 fraza context salarial"},"joburiSimilare":[{"titlu":"Job Similar 1","compatibilitate":75,"diferente":"ce difera fata de jobul analizat"},{"titlu":"Job Similar 2","compatibilitate":68,"diferente":"ce difera"}]}
Campuri importante:
- planActiune: 4-5 pasi concreti pe care candidatul trebuie sa ii faca pentru a obtine jobul, cu prioritate (Urgent/Important/Optional)
- salariu: estimeaza intervalul salarial pentru acest job in contextul pietei si experientei candidatului
- joburiSimilare: 2-3 titluri de joburi similare cu care s-ar potrivi candidatul si procentul de compatibilitate estimat
Raspunde DOAR cu JSON."""

COMPARE_PROMPT = """Esti un expert HR. Compara urmatoarele CV-uri si returneaza STRICT JSON valid (fara markdown):
{"castigator":"Nume Candidat","motivCastigator":"1-2 fraze","comparatie":"1-2 fraze despre diferente cheie","candidati":[{"nume":"string","titlu":"string","scor":85,"puncteFoarte":["string","string"],"puncteSlabe":["string"],"topSkills":["skill1","skill2","skill3"],"recomandare":"string"}]}
Ordoneaza candidatii de la cel mai bun la cel mai slab. Raspunde DOAR cu JSON."""

IMPROVE_PROMPT = """Esti un expert senior in optimizarea CV-urilor si recrutare. Analizeaza CV-ul si returneaza STRICT JSON valid (fara markdown):
{"scorCurent":65,"scorEstimat":85,"scorATS":58,"rezumatProbleme":"1-2 fraze despre principalele probleme","topImbunatatiri":[{"prioritate":1,"actiune":"titlu scurt","detaliu":"explicatie detaliata","impactScor":"+8 puncte","durata":"2 zile","saptamana":1},{"prioritate":2,"actiune":"string","detaliu":"string","impactScor":"string","durata":"1 zi","saptamana":1},{"prioritate":3,"actiune":"string","detaliu":"string","impactScor":"string","durata":"3 zile","saptamana":2},{"prioritate":4,"actiune":"string","detaliu":"string","impactScor":"string","durata":"1 zi","saptamana":2},{"prioritate":5,"actiune":"string","detaliu":"string","impactScor":"string","durata":"2 zile","saptamana":3}],"sectiuni":{"titluProfesional":{"problema":"string","solutie":"string","impact":"Ridicat","versiuneRescrisa":"titlul rescris complet"},"rezumat":{"problema":"string","solutie":"string","impact":"Ridicat","versiuneRescrisa":"rezumatul rescris in 3-4 fraze"},"experienta":{"problema":"string","solutie":"string","impact":"Mediu","versiuneRescrisa":"exemplu descriere experienta imbunatatita"},"skills":{"problema":"string","solutie":"string","impact":"Mediu","versiuneRescrisa":"lista skills imbunatatita"},"prezentare":{"problema":"string","solutie":"string","impact":"Scazut","versiuneRescrisa":"sugestie prezentare"}},"keywordsLipsa":["kw1","kw2","kw3","kw4","kw5"],"formatareSugestii":["sugestie1","sugestie2","sugestie3"],"atsProbleme":["problema ATS 1","problema ATS 2"],"atsSfaturi":["sfat ATS 1","sfat ATS 2"]}
- scorATS: 0-100 compatibilitate cu sisteme ATS - penalizeaza tabele, coloane, imagini, fonturi speciale, lipsa keywords
- saptamana: 1, 2 sau 3 (planul de implementare pe 3 saptamani)
- versiuneRescrisa: textul efectiv rescris gata de copiat (nu sfat)
- atsProbleme: elemente care blocheaza parsarea ATS
Fii specific si concret. Raspunde DOAR cu JSON."""

COVER_LETTER_PROMPT = """Esti un expert in redactarea scrisorilor de intentie. Pe baza CV-ului de mai jos, genereaza o scrisoare de intentie profesionala in {{LIMBA}} si returneaza STRICT JSON valid (fara markdown):
{"subiectEmail":"string - subiectul emailului gata de trimis","scrisoare":"textul complet al scrisorii de intentie, profesional si personalizat, 3-4 paragrafe"}
Raspunde DOAR cu JSON."""

TRANSLATE_PROMPT = """Esti un expert in traducerea si adaptarea CV-urilor pentru piete internationale. Traduce CV-ul in {{LIMBA}} si returneaza STRICT JSON valid (fara markdown):
{"cvTradus":"textul complet al CV-ului tradus si adaptat cultural","sfaturiAdaptare":["sfat specific pentru piata din tara tinta 1","sfat 2","sfat 3"],"termeniAdaptati":[{"original":"termen original","tradus":"termen tradus/adaptat","nota":"explicatie daca e necesar"}]}
Raspunde DOAR cu JSON."""

MATCHING_PROMPT = """Esti un expert HR. Analizeaza toate CV-urile si joburile si calculeaza compatibilitatea fiecarei combinatii. Returneaza STRICT JSON valid (fara markdown):
{"rezumat":"1-2 fraze despre rezultatele generale","bestMatchuri":[{"jobTitlu":"string","candidatOptim":"string","scor":85,"motiv":"1-2 fraze"}],"matches":[{"cvNume":"string","jobTitlu":"string","scor":78,"verdict":"string","skillsMatch":["skill1","skill2"],"skillsLipsa":["skill3"],"recomandare":"string"}]}
- bestMatchuri: cel mai bun candidat pentru fiecare job
- matches: TOATE combinatiile posibile cv x job, fiecare cu scor 0-100
Raspunde DOAR cu JSON."""


# ── Routes ────────────────────────────────────────────────

@app.route('/')
@app.route('/share/<share_id>')
def index(share_id=None):
    return render_template('index.html')

@app.route('/api/analyze', methods=['POST'])
def analyze():
    data = request.json or {}
    cv_text = data.get('cv_text','')
    if not cv_text: return jsonify({'error':'CV gol'}),400
    result = call_claude(ANALYZE_PROMPT, cv_text, max_tokens=2000)
    return jsonify(result)

@app.route('/api/jobmatch', methods=['POST'])
def jobmatch():
    data = request.json or {}
    cv_text = data.get('cv_text','')
    job_text = data.get('job_text','')
    if not cv_text or not job_text: return jsonify({'error':'CV sau job gol'}),400
    prompt = JOB_MATCH_PROMPT + f'\n\nCV:\n{cv_text}\n\nDESCRIERE JOB:\n{job_text}'
    result = call_claude_raw(prompt, max_tokens=3000)
    return jsonify(parse_json(result))

@app.route('/api/compare', methods=['POST'])
def compare():
    data = request.json or {}
    cvs = data.get('cvs',[])
    if len(cvs)<2: return jsonify({'error':'Minim 2 CV-uri'}),400
    if len(cvs)>5: return jsonify({'error':'Maximum 5 CV-uri'}),400
    cv_blocks = '\n\n'.join([f'CV {i+1} ({c.get("name","")}):\n{c.get("text","")}' for i,c in enumerate(cvs)])
    prompt = COMPARE_PROMPT + f'\n\n{cv_blocks}'
    result = call_claude_raw(prompt, max_tokens=3000)
    return jsonify(parse_json(result))

@app.route('/api/improve', methods=['POST'])
def improve():
    data = request.json or {}
    cv_text = data.get('cv_text','')
    if not cv_text: return jsonify({'error':'CV gol'}),400
    result = call_claude(IMPROVE_PROMPT, cv_text, max_tokens=4000)
    return jsonify(result)

@app.route('/api/coverletter', methods=['POST'])
def coverletter():
    data = request.json or {}
    cv_text = data.get('cv_text','')
    job_text = data.get('job_text','')
    limba = data.get('limba','romana')
    if not cv_text: return jsonify({'error':'CV gol'}),400
    prompt = COVER_LETTER_PROMPT.replace('{{LIMBA}}', limba)
    if job_text:
        prompt += f'\n\nDESCRIERE JOB (adapteaza scrisoarea la acest job):\n{job_text}'
    result = call_claude(prompt, cv_text, max_tokens=2000)
    return jsonify(result)

@app.route('/api/translate', methods=['POST'])
def translate():
    data = request.json or {}
    cv_text = data.get('cv_text','')
    target_lang = data.get('target_lang','engleza')
    if not cv_text: return jsonify({'error':'CV gol'}),400
    prompt = TRANSLATE_PROMPT.replace('{{LIMBA}}', target_lang)
    result = call_claude(prompt, cv_text, max_tokens=3000)
    return jsonify(result)

@app.route('/api/matching', methods=['POST'])
def matching():
    data = request.json or {}
    cvs = data.get('cvs',[])
    jobs = data.get('jobs',[])
    if len(cvs)<1 or len(jobs)<1: return jsonify({'error':'Minim 1 CV si 1 job'}),400
    if len(cvs)>10 or len(jobs)>10: return jsonify({'error':'Maximum 10 CV-uri si 10 joburi'}),400
    cv_blocks = '\n\n'.join([f'CV {i+1} ({c.get("name","")}):\n{c.get("text","")}' for i,c in enumerate(cvs)])
    job_blocks = '\n\n'.join([f'JOB {i+1} ({j.get("title","")}):\n{j.get("text","")}' for i,j in enumerate(jobs)])
    prompt = MATCHING_PROMPT + f'\n\nCV-URI:\n{cv_blocks}\n\nJOBURI:\n{job_blocks}'
    result = call_claude_raw(prompt, max_tokens=4000)
    return jsonify(parse_json(result))

@app.route('/api/share', methods=['POST'])
def share_save():
    data = request.json or {}
    share_id = str(uuid.uuid4())[:8]
    shared_analyses[share_id] = data
    return jsonify({'share_id': share_id})

@app.route('/api/share/<share_id>')
def share_get(share_id):
    data = shared_analyses.get(share_id)
    if not data: return jsonify({'error':'Nu a fost gasit'}),404
    return jsonify(data)

@app.route('/api/health')
def health():
    return jsonify({'status':'ok'})

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=os.environ.get('FLASK_ENV')=='development')