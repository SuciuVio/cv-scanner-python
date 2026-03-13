import os
import json
import uuid
import requests
from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
CORS(app)
app.secret_key = os.getenv('SECRET_KEY', 'dev-secret-key-schimba-in-productie')

APP_USER     = os.getenv('APP_USER', 'admin')
APP_PASSWORD = os.getenv('APP_PASSWORD', 'parola123')

def login_required(f):
    from functools import wraps
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get('logged_in'):
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated

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
        "temperature": 0,
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
{"nume":"string","titlu":"string","email":"string sau null","telefon":"string sau null","locatie":"string sau null","rezumat":"max 2 fraze scurte","puncteFoarte":["string","string","string"],"puncteSlabe":["string","string"],"experienta":[{"rol":"string","companie":"string","perioada":"string","descriere":"string scurt"}],"skills":["s1","s2","s3","s4","s5","s6"],"educatie":"string","limbi":["string"],"scorGeneral":82,"seniority":"Junior","limbaCv":"romana","industrie":"IT","mediaIndustrie":72,"comparatieIndustrie":"o fraza despre cum se compara candidatul cu media din industria sa","scoruri":{"skills":{"nota":80,"comentariu":"o fraza scurta"},"experienta":{"nota":85,"comentariu":"o fraza scurta"},"educatie":{"nota":75,"comentariu":"o fraza scurta"},"prezentare":{"nota":70,"comentariu":"o fraza scurta"}},"recomandare":"o fraza","redFlags":["string"],"riscRetentie":{"nivel":"Scazut","scor":25,"motive":["motiv 1"],"recomandare":"string"},"scorHype":{"scor":60,"buzzwords":["passionate"],"realizariConcrete":["grew revenue 40%"],"verdict":"string"},"simulareATS":{"workday":{"scor":70,"probleme":["string"],"campuriRatate":["string"]},"greenhouse":{"scor":75,"probleme":["string"],"campuriRatate":["string"]},"bamboohr":{"scor":80,"probleme":["string"],"campuriRatate":["string"]},"recomandari":["string"]},"predictieSchimbare":{"luni":18,"interval":"14-22 luni","incredere":"Medie","rationale":"string","semne":["string"]},"costBeneficiu":{"salariuEstimat":{"minim":3000,"maxim":5000,"moneda":"EUR"},"timpOnboarding":"2-3 luni","timpProductivitate":"4-6 luni","riscAngajare":"Scazut","scoreROI":75,"sumar":"string"},"rezumatManager":["bullet 1","bullet 2","bullet 3"]}
Campuri importante:
- seniority: EXACT unul din: "Intern","Junior","Mid","Senior","Lead","Manager","Director","C-Level"
- limbaCv: limba in care e scris CV-ul (romana/engleza/franceza/germana etc)
- industrie: domeniul principal al candidatului (ex: IT, Marketing, Finance, HR, Engineering, Sales, etc)
- mediaIndustrie: scorul mediu tipic pentru candidati din aceasta industrie (50-80)
- comparatieIndustrie: 1-2 fraze despre cum se compara candidatul cu piata
- redFlags: lista de probleme reale gasite: job hopping (sub 1 an la mai multe joburi), gaps inexplicabile (>6 luni), inconsistente in CV, lipsa progresie, descrieri vagi. Lista goala [] daca nu exista probleme.
- riscRetentie: nivel EXACT unul din "Scazut","Mediu","Ridicat"; scor 0-100 (100=risc maxim); motive concrete; recomandare pentru angajator
- scorHype: {"scor":0-100,"buzzwords":["cuvant gol 1"],"realizariConcrete":["realizare masurabil 1"],"verdict":"o fraza despre raportul hype/substanta"} — scor 0=tot hype, 100=tot substanta
- simulareATS: {"workday":{"scor":0-100,"probleme":["problema 1"],"campuriRatate":["camp 1"]},"greenhouse":{"scor":0-100,"probleme":["problema 1"],"campuriRatate":["camp 1"]},"bamboohr":{"scor":0-100,"probleme":["problema 1"],"campuriRatate":["camp 1"]},"recomandari":["recomandare format 1"]}
- predictieSchimbare: {"luni":18,"interval":"14-22 luni","incredere":"Medie","rationale":"explicatie bazata pe pattern joburi anterioare","semne":["semn 1","semn 2"]}
- costBeneficiu: {"salariuEstimat":{"minim":3000,"maxim":5000,"moneda":"EUR"},"timpOnboarding":"2-3 luni","timpProductivitate":"4-6 luni","riscAngajare":"Scazut","scoreROI":75,"sumar":"o fraza despre valoarea angajarii"}
- rezumatManager: ["bullet 1 — max 15 cuvinte","bullet 2 — max 15 cuvinte","bullet 3 — max 15 cuvinte"]
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



MATCHING_PROMPT = """Esti un expert HR. Analizeaza toate CV-urile si joburile si calculeaza compatibilitatea fiecarei combinatii. Returneaza STRICT JSON valid (fara markdown):
{"rezumat":"1-2 fraze despre rezultatele generale","bestMatchuri":[{"jobTitlu":"string","candidatOptim":"string","scor":85,"motiv":"1-2 fraze"}],"matches":[{"cvNume":"string","jobTitlu":"string","scor":78,"verdict":"string","skillsMatch":["skill1","skill2"],"skillsLipsa":["skill3"],"recomandare":"string"}]}
- bestMatchuri: cel mai bun candidat pentru fiecare job
- matches: TOATE combinatiile posibile cv x job, fiecare cu scor 0-100
Raspunde DOAR cu JSON."""


# ── Routes ────────────────────────────────────────────────

@app.route('/landing')
def landing():
    return render_template('landing.html')

@app.route('/login', methods=['GET','POST'])
def login():
    error = None
    if request.method == 'POST':
        user = request.form.get('username','')
        pwd  = request.form.get('password','')
        if user.strip() == APP_USER.strip() and pwd.strip() == APP_PASSWORD.strip():
            session['logged_in'] = True
            return redirect(url_for('index'))
        else:
            error = 'Utilizator sau parolă incorecte.'
    return render_template('login.html', error=error)

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))

@app.route('/')
@app.route('/share/<share_id>')
@login_required
def index(share_id=None):
    return render_template('index.html')

@app.route('/api/analyze', methods=['POST'])
@login_required
def analyze():
    data = request.json or {}
    cv_text = data.get('cv_text','')
    if not cv_text: return jsonify({'error':'CV gol'}),400
    result = call_claude(ANALYZE_PROMPT, cv_text, max_tokens=2000)
    return jsonify(result)

@app.route('/api/jobmatch', methods=['POST'])
@login_required
def jobmatch():
    data = request.json or {}
    cv_text = data.get('cv_text','')
    job_text = data.get('job_text','')
    if not cv_text or not job_text: return jsonify({'error':'CV sau job gol'}),400
    prompt = JOB_MATCH_PROMPT + f'\n\nCV:\n{cv_text}\n\nDESCRIERE JOB:\n{job_text}'
    result = call_claude_raw(prompt, max_tokens=3000)
    return jsonify(parse_json(result))

@app.route('/api/compare', methods=['POST'])
@login_required
def compare():
    data = request.json or {}
    cvs = data.get('cvs',[])
    if len(cvs)<2: return jsonify({'error':'Minim 2 CV-uri'}),400
    if len(cvs)>50: return jsonify({'error':'Maximum 50 CV-uri'}),400
    # Limiteaza textul fiecarui CV la 2000 caractere pentru CV-uri multe
    max_chars = 2000 if len(cvs) > 20 else 3000
    cv_blocks = '\n\n'.join([f'CV {i+1} ({c.get("name","")}):\n{c.get("text","")[:max_chars]}' for i,c in enumerate(cvs)])
    prompt = COMPARE_PROMPT + f'\n\n{cv_blocks}'
    # Mai multe tokene pentru multe CV-uri
    max_tok = min(4000 + len(cvs) * 200, 12000)
    result = call_claude_raw(prompt, max_tokens=max_tok)
    return jsonify(parse_json(result))

@app.route('/api/matching', methods=['POST'])
@login_required
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
@login_required
def share_save():
    data = request.json or {}
    share_id = str(uuid.uuid4())[:8]
    shared_analyses[share_id] = data
    return jsonify({'share_id': share_id})

@app.route('/api/share/<share_id>')
@login_required
def share_get(share_id):
    data = shared_analyses.get(share_id)
    if not data: return jsonify({'error':'Nu a fost gasit'}),404
    return jsonify(data)

@app.route('/api/rejection', methods=['POST'])
@login_required
def rejection():
    try:
        data = request.json or {}
        cv_text = data.get('cv_text', '')
        job_text = data.get('job_text', '')
        name = data.get('name', 'candidat')
        if not cv_text: return jsonify({'error': 'CV gol'}), 400
        prompt = f"""Esti un HR manager empatic. Scrie o scrisoare de respingere personalizata, umana si profesionala pentru candidatul {name}.
Scrisoarea trebuie sa:
1. Mentioneze 1-2 lucruri pozitive SPECIFICE din CV-ul lor
2. Explice decizia fara sa fie vaga sau rece
3. Incurajeze candidatul sa aplice in viitor daca e potrivit
4. Fie in romana, max 150 cuvinte
Returneaza STRICT JSON: {{"subiect":"string","scrisoare":"textul complet","tonEmpatic":true}}
Job aplicat: {job_text[:500] if job_text else 'pozitie nedefinita'}
Raspunde DOAR cu JSON."""
        result = call_claude(prompt, cv_text[:4000], max_tokens=800)
        return jsonify(result)
    except Exception as e:
        print(f'[ERROR] /api/rejection: {e}')
        return jsonify({'error': str(e)}), 500

@app.route('/api/health')
@login_required
def health():
    return jsonify({'status':'ok'})

@app.errorhandler(Exception)
def handle_exception(e):
    print(f'[ERROR] Unhandled exception: {e}')
    import traceback
    traceback.print_exc()
    return jsonify({'error': str(e)}), 500

@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Ruta nu există'}), 404

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=os.environ.get('FLASK_ENV')=='development')