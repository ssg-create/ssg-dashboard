#!/usr/bin/env python3
import requests, urllib3, re, os, sys, zipfile, io, calendar
import xml.etree.ElementTree as ET
from datetime import datetime, date
from pathlib import Path
from urllib.parse import urlencode

# ── credenciais via ~/.ssg_env ────────────────────────────────
def _load_env():
    p = os.path.expanduser("~/.ssg_env")
    if os.path.exists(p):
        with open(p) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, v = line.split('=', 1)
                    os.environ.setdefault(k.strip(), v.strip())
_load_env()

USUARIO = os.environ["OTRS_USER"]
SENHA   = os.environ["OTRS_PASS"]
URL     = os.environ["OTRS_URL"]
PASTA   = str(Path.home() / "Desktop" / "Arquivo OTRS")
CACHE   = os.path.join(PASTA, ".cache")

FILAS = [
    "DATASUL", "DBA", "INFRAESTUTURA", "MONITORAMENTO",
    "NOC", "PROTHEUS", "RM", "SSG", "SSG-MELHORIAS", "TECNOLOGIA"
]

urllib3.disable_warnings()
os.makedirs(CACHE, exist_ok=True)
def log(m): print(f"[{datetime.now().strftime('%H:%M:%S')}] {m}")

# ── parser de XLSX usando apenas stdlib ──────────────────────
NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'

def parse_xlsx_bytes(data):
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        with z.open('xl/sharedStrings.xml') as f:
            ss = [si.text or ''.join(t.text or '' for t in si.iter(NS+'t'))
                  for si in ET.parse(f).findall(f'.//{NS}si')]
        with z.open('xl/worksheets/sheet1.xml') as f:
            tree = ET.parse(f)

    def cell_val(c):
        t = c.get('t', '')
        v = c.find(f'{NS}v')
        if v is None: return None
        return ss[int(v.text)] if t == 's' and v.text else (v.text or '')

    def col_index(ref):
        letters = ''.join(filter(str.isalpha, ref))
        n = 0
        for ch in letters: n = n * 26 + (ord(ch.upper()) - ord('A') + 1)
        return n - 1

    rows_raw = tree.findall(f'.//{NS}row')

    def read_row(row_el, num_cols):
        result = [None] * num_cols
        for c in row_el.findall(f'{NS}c'):
            ref = c.get('r', '')
            if ref:
                idx = col_index(ref)
                if idx < num_cols: result[idx] = cell_val(c)
        return result

    if not rows_raw: return [], []
    headers_raw = read_row(rows_raw[0], 30)
    headers = [h for h in headers_raw if h is not None]
    num_cols = len(headers)
    data_rows = [read_row(r, num_cols) for r in rows_raw[1:]]
    return headers, data_rows

# ── escritor de XLSX usando apenas stdlib ────────────────────
def write_xlsx(caminho, headers, rows):
    def esc(s):
        return str(s if s is not None else '').replace('&','&amp;').replace('<','&lt;').replace('>','&gt;').replace('"','&quot;')

    def col_letter(n):
        s = ''
        while n >= 0:
            s = chr(n % 26 + 65) + s
            n = n // 26 - 1
        return s

    sheet_parts = ['<?xml version="1.0" encoding="UTF-8"?>',
                   '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>']
    hcells = ''.join(f'<c r="{col_letter(i)}1" t="inlineStr"><is><t>{esc(h)}</t></is></c>' for i, h in enumerate(headers))
    sheet_parts.append(f'<row r="1">{hcells}</row>')
    for ri, row in enumerate(rows, start=2):
        cells = ''.join(f'<c r="{col_letter(i)}{ri}" t="inlineStr"><is><t>{esc(v)}</t></is></c>' for i, v in enumerate(row))
        sheet_parts.append(f'<row r="{ri}">{cells}</row>')
    sheet_parts.append('</sheetData></worksheet>')
    sheet_xml = ''.join(sheet_parts)

    content_types = '''<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml"  ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml"            ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml"   ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>'''

    rels = '''<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>'''

    workbook = '''<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>'''

    wb_rels = '''<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>'''

    with zipfile.ZipFile(caminho, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr('[Content_Types].xml',          content_types)
        zf.writestr('_rels/.rels',                  rels)
        zf.writestr('xl/workbook.xml',              workbook)
        zf.writestr('xl/_rels/workbook.xml.rels',   wb_rels)
        zf.writestr('xl/worksheets/sheet1.xml',     sheet_xml)

# ── login ────────────────────────────────────────────────────
log("Iniciando exportação (com cache de meses anteriores)...")
s = requests.Session()
s.verify = False
s.headers["User-Agent"] = "Mozilla/5.0"

log("Fazendo login...")
r = s.get(URL, timeout=60)
tok = re.search(r'name="ChallengeToken"\s+value="([^"]+)"', r.text)
tok = tok.group(1) if tok else ""
r = s.post(URL, data={
    "Action": "Login", "RequestedURL": "", "Lang": "pt_BR",
    "TimeZoneOffset": "-180", "User": USUARIO, "Password": SENHA,
    "ChallengeToken": tok
}, timeout=120, allow_redirects=True)

if 'id="LoginBox"' in r.text:
    log("ERRO: Login falhou"); sys.exit(1)
log("Login OK")

# ── exporta mês a mês com cache de meses anteriores ──────────
hoje       = date.today()
all_headers = None
all_rows    = []

def fetch_otrs(mes):
    """Baixa xlsx do OTRS para (hoje.year, mes). Retorna (headers, rows, raw) ou (None, None, None)."""
    ultimo_dia = calendar.monthrange(hoje.year, mes)[1]
    fim_dia    = hoje.day if mes == hoje.month else ultimo_dia
    ini_str    = f"{hoje.year}-{mes:02d}-01"
    params = {
        "Action": "AgentTicketSearch", "Subaction": "Search",
        "ResultForm": "Excel", "SaveProfile": "0",
        "TicketCreateTimeSlot": "1",
        "TicketCreateTimeStartYear":  str(hoje.year),
        "TicketCreateTimeStartMonth": f"{mes:02d}",
        "TicketCreateTimeStartDay":   "01",
        "TicketCreateTimeStopYear":   str(hoje.year),
        "TicketCreateTimeStopMonth":  f"{mes:02d}",
        "TicketCreateTimeStopDay":    f"{fim_dia:02d}",
        "TimeSearchType": "TimeSlot", "OrderBy": "Down", "SortBy": "Age",
    }
    query = urlencode(params) + "".join(f"&Queues={f}" for f in FILAS)
    resp  = s.get(URL + "?" + query, timeout=120)
    ct    = resp.headers.get("Content-Type", "")
    if not any(x in ct.lower() for x in ["spreadsheetml", "excel", "octet-stream"]):
        log(f"  AVISO: sem dados para {ini_str} ({ct[:60]})")
        return None, None, None
    headers, rows = parse_xlsx_bytes(resp.content)
    if not headers:
        log(f"  AVISO: arquivo vazio para {ini_str}")
        return None, None, None
    return headers, rows, resp.content

for mes in range(1, hoje.month + 1):
    mes_str    = f"{hoje.year}-{mes:02d}"
    cache_path = os.path.join(CACHE, f"{mes_str}.xlsx")

    if mes < hoje.month and os.path.exists(cache_path):
        # Mês anterior: usa cache (dados não mudam mais)
        log(f"Cache: {mes_str} ({os.path.getsize(cache_path):,} bytes)")
        with open(cache_path, 'rb') as f:
            cached = f.read()
        headers, rows = parse_xlsx_bytes(cached)
        if not headers:
            # Cache corrompido — re-baixa
            log(f"  Cache inválido, re-baixando {mes_str}...")
            headers, rows, raw = fetch_otrs(mes)
            if headers is None: continue
            with open(cache_path, 'wb') as f: f.write(raw)
    else:
        # Mês atual (ou primeiro download): sempre busca no OTRS
        log(f"Buscando {mes_str}...")
        headers, rows, raw = fetch_otrs(mes)
        if headers is None: continue
        # Grava cache para meses já encerrados
        if mes < hoje.month:
            with open(cache_path, 'wb') as f: f.write(raw)
            log(f"  Cache gravado: {mes_str}")

    if all_headers is None:
        all_headers = headers
    all_rows.extend(rows)
    log(f"  {len(rows)} chamados")

log(f"Total combinado: {len(all_rows)} chamados")

nome    = f"ticket_search_{datetime.now().strftime('%Y-%m-%d_%H-%M')}.xlsx"
caminho = os.path.join(PASTA, nome)
write_xlsx(caminho, all_headers, all_rows)
log(f"Salvo: {nome} ({os.path.getsize(caminho):,} bytes)")

# Copia para dados.xlsx (com retry anti-iCloud lock)
import shutil, time
dados_path = os.path.join(PASTA, "dados.xlsx")
for _t in range(3):
    try:
        shutil.copy2(caminho, dados_path)
        log("Copiado para dados.xlsx")
        break
    except OSError as _e:
        if _t < 2:
            log(f"dados.xlsx bloqueado, tentativa {_t+2}/3...")
            time.sleep(3)
        else:
            log(f"AVISO: dados.xlsx inacessivel ({_e}) — deploy continua via ticket_search")
