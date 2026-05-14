// SSG Operations Center — Testes unitários
// Rodar: node tests/unit.test.js

let passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('  ✅', name);
    passed++;
  } catch(e) {
    console.log('  ❌', name, '→', e.message);
    failed++;
  }
}

function assert(val, msg) {
  if (!val) throw new Error(msg || 'assertion failed');
}

function assertEqual(a, b) {
  if (a !== b) throw new Error(`esperado "${b}", recebido "${a}"`);
}

// ─── Funções utilitárias (copiadas do index.html) ────────────────────────────

function pct(a, b) { return b > 0 ? Math.round(a / b * 100) : 0; }
function avg(arr)  { return arr.length ? arr.reduce((a,b) => a+b, 0) / arr.length : 0; }
function fmtDate(s){ var p = s.split('-'); return p[2] + '/' + p[1]; }

const EM2 = {
  'aberto':'Aberto','em atendimento':'Em Atendimento','fechado':'Fechado',
  'resolvido':'Resolvido','aguardando cliente':'Aguardando Cliente',
  'aguardando interno':'Aguardando Interno','retorno cliente':'Retorno Cliente',
  'fechado s/ êxito':'Fechado s/ Êxito','aguardando externo':'Aguardando Externo'
};
const PM2 = {
  'muito alta':'Muito Alta','alta':'Alta','normal':'Normal',
  'baixa':'Baixa','muito baixa':'Muito Baixa'
};

function ePill(e) {
  const m = {'Fechado':'pg','Resolvido':'pg','Fechado s/ Êxito':'px','Aberto':'pb','Em Atendimento':'pb','Aguardando Cliente':'py','Aguardando Interno':'py','Retorno Cliente':'py','Aguardando Externo':'pp'};
  return '<span class="pill ' + (m[e] || 'px') + '">' + e + '</span>';
}
function pPill(p) {
  const m = {'Muito Alta':'pr','Alta':'py','Normal':'pb','Baixa':'pt','Muito Baixa':'px'};
  return '<span class="pill ' + (m[p] || 'px') + '">' + p + '</span>';
}

// ─── Suite de testes ─────────────────────────────────────────────────────────

console.log('\n📋 pct() — percentual');
test('100% de 200', () => assertEqual(pct(200, 200), 100));
test('50% de 200', ()  => assertEqual(pct(100, 200), 50));
test('0 com divisor 0', () => assertEqual(pct(10, 0), 0));
test('arredonda corretamente', () => assertEqual(pct(1, 3), 33));

console.log('\n📋 avg() — média');
test('média simples', () => assertEqual(avg([10, 20, 30]), 20));
test('array vazio retorna 0', () => assertEqual(avg([]), 0));
test('único elemento', () => assertEqual(avg([42]), 42));

console.log('\n📋 fmtDate() — formatar data');
test('formata YYYY-MM-DD para DD/MM', () => assertEqual(fmtDate('2026-03-30'), '30/03'));
test('mantém zero à esquerda', ()       => assertEqual(fmtDate('2026-01-05'), '05/01'));

console.log('\n📋 ePill() — badge de estado');
test('Fechado → classe pg (verde)', ()          => assert(ePill('Fechado').includes('class="pill pg"')));
test('Aberto → classe pb (azul)', ()            => assert(ePill('Aberto').includes('class="pill pb"')));
test('Aguardando Cliente → classe py (amarelo)',() => assert(ePill('Aguardando Cliente').includes('class="pill py"')));
test('estado desconhecido → classe px (cinza)', () => assert(ePill('Outro').includes('class="pill px"')));
test('contém o texto do estado', ()             => assert(ePill('Fechado').includes('Fechado')));

console.log('\n📋 pPill() — badge de prioridade');
test('Muito Alta → classe pr (vermelho)', () => assert(pPill('Muito Alta').includes('class="pill pr"')));
test('Normal → classe pb (azul)', ()        => assert(pPill('Normal').includes('class="pill pb"')));
test('Muito Baixa → classe px (cinza)', ()  => assert(pPill('Muito Baixa').includes('class="pill px"')));
test('contém o texto da prioridade', ()     => assert(pPill('Alta').includes('Alta')));

console.log('\n📋 normalizaFila() — typos vindos do Znuny');
const FILA_FIX = {'INFRAESTUTURA':'INFRAESTRUTURA','INFRA ESTRUTURA':'INFRAESTRUTURA','INFRA-ESTRUTURA':'INFRAESTRUTURA'};
function normalizaFila(raw) { var f = raw.trim().toUpperCase(); return FILA_FIX[f] || f; }
test('INFRAESTUTURA → INFRAESTRUTURA',  () => assertEqual(normalizaFila('INFRAESTUTURA'), 'INFRAESTRUTURA'));
test('INFRA ESTRUTURA → INFRAESTRUTURA',() => assertEqual(normalizaFila('INFRA ESTRUTURA'), 'INFRAESTRUTURA'));
test('INFRA-ESTRUTURA → INFRAESTRUTURA',() => assertEqual(normalizaFila('INFRA-ESTRUTURA'), 'INFRAESTRUTURA'));
test('SSG sem alteração',                () => assertEqual(normalizaFila('SSG'), 'SSG'));
test('DBA sem alteração',                () => assertEqual(normalizaFila('DBA'), 'DBA'));

// ─── MODO SQUAD — testes da lógica nova ─────────────────────────────────────
// Cópia mínima da lógica de frasePersonificada e helpers (escopo isolado p/ teste)

function _parseDate(s){
  if(!s) return null;
  try {
    if(s instanceof Date) return isNaN(s.getTime())?null:s;
    var str = String(s);
    if(/^\d{4}-\d{2}-\d{2}/.test(str)){
      var d = new Date(str.replace(' ','T'));
      return isNaN(d.getTime())?null:d;
    }
    if(/^\d{2}\/\d{2}\/\d{4}/.test(str)){
      var p = str.split(/[\/ :]/);
      return new Date(+p[2], +p[1]-1, +p[0], +(p[3]||0), +(p[4]||0));
    }
    var d3 = new Date(str);
    return isNaN(d3.getTime())?null:d3;
  } catch(e){ return null; }
}
function _daysSince(d, now){
  if(!d) return null;
  return Math.floor(((now||new Date()) - d) / 86400000);
}
function _initials(nome){
  if(!nome) return '?';
  var p = nome.trim().split(/\s+/);
  return ((p[0]||'')[0]||'?').toUpperCase() + ((p[1]||'')[0]||'').toUpperCase();
}
var SQUADS_TEST = {
  'ssg-protheus': {
    nome: 'SSG · Protheus',
    filas: ['SSG','SSG-MELHORIAS','PROTHEUS'],
    exclude_atendentes: ['Admin OTRS']
  }
};
var _SQ_FRASES = {
  retorno_cliente: ['Ei, o cliente já me devolveu — você esqueceu de mim?'],
  sem_interacao:   ['Ei, sumiu? {X} dias sem ninguém mexer em mim.'],
  cliente_silencioso:['Acho que o cliente sumiu — bora cobrar?'],
  interno_atrasado:  ['{X} dias esperando o time interno — bora subir?']
};
function _pickFrase(arr, num, x){
  var seed = 0, s = String(num||'');
  for(var i=0;i<s.length;i++) seed = (seed*31 + s.charCodeAt(i))|0;
  return arr[Math.abs(seed) % arr.length].replace('{X}', x);
}
function frasePersonificada(ticket, now){
  if(!ticket) return null;
  now = now || new Date();
  var estado = (ticket.estado||'').toUpperCase();
  var mod = _parseDate(ticket.modificado);
  var d = _daysSince(mod, now);
  var num = ticket.ticket || ticket.num;
  if(estado === 'RETORNO CLIENTE' && d != null && d >= 1){
    var lvl = d>7?3:d>3?2:1;
    return { texto:_pickFrase(_SQ_FRASES.retorno_cliente,num,d), lvl:lvl };
  }
  if((estado === 'EM ATENDIMENTO'||estado==='OPEN'||estado==='NEW') && d != null && d >= 3){
    var lvl2 = d>14?3:d>7?2:1;
    return { texto:_pickFrase(_SQ_FRASES.sem_interacao,num,d), lvl:lvl2 };
  }
  if(estado === 'AGUARDANDO CLIENTE' && d != null && d >= 7){
    var lvl3 = d>21?3:d>14?2:1;
    return { texto:_pickFrase(_SQ_FRASES.cliente_silencioso,num,d), lvl:lvl3 };
  }
  if(estado === 'AGUARDANDO ATENDENTE (INTERNO)' && d != null && d >= 3){
    var lvl4 = d>14?3:d>7?2:1;
    return { texto:_pickFrase(_SQ_FRASES.interno_atrasado,num,d), lvl:lvl4 };
  }
  return null;
}

const NOW = new Date('2026-05-14T12:00:00');
function daysAgo(n){ return new Date(NOW.getTime() - n*86400000).toISOString().replace('T',' ').slice(0,19); }

console.log('\n📋 frasePersonificada() — RETORNO CLIENTE');
test('hoje (0d) → null',     () => assertEqual(frasePersonificada({estado:'RETORNO CLIENTE',modificado:daysAgo(0),ticket:'1'},NOW), null));
test('2 dias → lvl 1',       () => assertEqual(frasePersonificada({estado:'RETORNO CLIENTE',modificado:daysAgo(2),ticket:'1'},NOW).lvl, 1));
test('5 dias → lvl 2',       () => assertEqual(frasePersonificada({estado:'RETORNO CLIENTE',modificado:daysAgo(5),ticket:'1'},NOW).lvl, 2));
test('10 dias → lvl 3',      () => assertEqual(frasePersonificada({estado:'RETORNO CLIENTE',modificado:daysAgo(10),ticket:'1'},NOW).lvl, 3));

console.log('\n📋 frasePersonificada() — EM ATENDIMENTO / OPEN / NEW');
test('1 dia → null (limiar 3d)', () => assertEqual(frasePersonificada({estado:'EM ATENDIMENTO',modificado:daysAgo(1),ticket:'1'},NOW), null));
test('5 dias → lvl 1',           () => assertEqual(frasePersonificada({estado:'OPEN',modificado:daysAgo(5),ticket:'1'},NOW).lvl, 1));
test('10 dias → lvl 2',          () => assertEqual(frasePersonificada({estado:'NEW',modificado:daysAgo(10),ticket:'1'},NOW).lvl, 2));
test('20 dias → lvl 3',          () => assertEqual(frasePersonificada({estado:'EM ATENDIMENTO',modificado:daysAgo(20),ticket:'1'},NOW).lvl, 3));

console.log('\n📋 frasePersonificada() — AGUARDANDO CLIENTE');
test('3 dias → null (limiar 7d)', () => assertEqual(frasePersonificada({estado:'AGUARDANDO CLIENTE',modificado:daysAgo(3),ticket:'1'},NOW), null));
test('10 dias → lvl 1',           () => assertEqual(frasePersonificada({estado:'AGUARDANDO CLIENTE',modificado:daysAgo(10),ticket:'1'},NOW).lvl, 1));
test('17 dias → lvl 2',           () => assertEqual(frasePersonificada({estado:'AGUARDANDO CLIENTE',modificado:daysAgo(17),ticket:'1'},NOW).lvl, 2));
test('30 dias → lvl 3',           () => assertEqual(frasePersonificada({estado:'AGUARDANDO CLIENTE',modificado:daysAgo(30),ticket:'1'},NOW).lvl, 3));

console.log('\n📋 frasePersonificada() — edge cases');
test('ticket null → null',        () => assertEqual(frasePersonificada(null, NOW), null));
test('estado vazio → null',       () => assertEqual(frasePersonificada({estado:'',modificado:daysAgo(10),ticket:'1'},NOW), null));
test('modificado vazio → null',   () => assertEqual(frasePersonificada({estado:'RETORNO CLIENTE',modificado:'',ticket:'1'},NOW), null));
test('estado desconhecido → null',() => assertEqual(frasePersonificada({estado:'FECHADO',modificado:daysAgo(50),ticket:'1'},NOW), null));
test('estabilidade: mesmo ticket → mesma frase', () => {
  var a = frasePersonificada({estado:'RETORNO CLIENTE',modificado:daysAgo(2),ticket:'1526000207'},NOW);
  var b = frasePersonificada({estado:'RETORNO CLIENTE',modificado:daysAgo(2),ticket:'1526000207'},NOW);
  assertEqual(a.texto, b.texto);
});

console.log('\n📋 SQUADS — config');
test('squad ssg-protheus existe',          () => assert(SQUADS_TEST['ssg-protheus']));
test('filas SSG/SSG-MELHORIAS/PROTHEUS',   () => {
  var f = SQUADS_TEST['ssg-protheus'].filas;
  assert(f.indexOf('SSG')!==-1 && f.indexOf('SSG-MELHORIAS')!==-1 && f.indexOf('PROTHEUS')!==-1);
});
test('Admin OTRS excluído',                () => assert(SQUADS_TEST['ssg-protheus'].exclude_atendentes.indexOf('Admin OTRS')!==-1));

console.log('\n📋 _initials() — avatar');
test('Geyson Albano → GA',  () => assertEqual(_initials('Geyson Albano'), 'GA'));
test('Carlos → C',          () => assertEqual(_initials('Carlos'), 'C'));
test('vazio → ?',           () => assertEqual(_initials(''), '?'));
test('null → ?',            () => assertEqual(_initials(null), '?'));

// ─── PDF: regras determinísticas do detalhamento de chamados em aberto ──────
// Cópias das funções do index.html (mesma lógica, mesmos thresholds).

function _pdfInferRisco(agingDias, prioridade){
  var p = String(prioridade||'').toLowerCase();
  var isAlta  = p.indexOf('muito alta')>=0 || p.indexOf('urgente')>=0;
  var isMedia = p === 'alta';
  if(agingDias==null) return 'BAIXO';
  if(isAlta){
    if(agingDias > 30) return 'ALTO';
    if(agingDias > 7)  return 'MÉDIO';
    return 'BAIXO';
  }
  if(isMedia){
    if(agingDias > 60) return 'ALTO';
    if(agingDias > 30) return 'MÉDIO';
    return 'BAIXO';
  }
  if(agingDias > 90) return 'ALTO';
  if(agingDias > 60) return 'MÉDIO';
  return 'BAIXO';
}
function _pdfInferBloqueio(estado){
  var e = String(estado||'').toLowerCase();
  if(e.indexOf('retorno cliente')>=0 || e.indexOf('aguardando cliente')>=0) return 'Aguarda cliente';
  if(e.indexOf('aguardando externo')>=0) return 'Aguarda terceiro';
  if(e.indexOf('aguardando interno')>=0) return 'Aguarda interno GroundWork';
  if(e.indexOf('pendente auto')>=0 || e.indexOf('agendado')>=0) return 'Agendado';
  if(e.indexOf('em atendimento')>=0) return 'GroundWork executando';
  if(e.indexOf('aberto')>=0 || e.indexOf('novo')>=0) return 'Em triagem';
  return 'Sem classificação';
}
function _pdfInferOwner(estado){
  var b = _pdfInferBloqueio(estado);
  if(b==='Aguarda cliente')    return 'Cliente';
  if(b==='Aguarda terceiro')   return 'Terceiro';
  if(b==='Agendado')           return 'GroundWork (agendado)';
  return 'GroundWork';
}
function _pdfGenProximaAcaoAuto(estado, agingDias, prioridade){
  var e = String(estado||'').toLowerCase();
  var p = String(prioridade||'').toLowerCase();
  var isAlta = p.indexOf('muito alta')>=0 || p.indexOf('urgente')>=0;
  if(e.indexOf('em atendimento')>=0){
    if(agingDias!=null && agingDias>60) return 'Acelerar tratativa — chamado fora da janela esperada. Definir prazo de entrega.';
    if(isAlta) return 'Manter prioridade alta e reportar avanço diário.';
    return 'Dar continuidade à tratativa.';
  }
  if(e.indexOf('retorno cliente')>=0 || e.indexOf('aguardando cliente')>=0){
    if(agingDias!=null && agingDias>14) return 'Reforçar acionamento ao cliente. Considerar fechamento por inatividade se persistir.';
    return 'Acompanhar retorno do cliente nos próximos dias úteis.';
  }
  if(e.indexOf('aguardando externo')>=0) return 'Follow-up formal com o terceiro. Avaliar alternativa se não houver retorno em 15 dias.';
  if(e.indexOf('pendente auto')>=0 || e.indexOf('agendado')>=0) return 'Executar conforme cronograma agendado.';
  if(e.indexOf('aberto')>=0 || e.indexOf('novo')>=0) return 'Realizar triagem inicial e atribuir atendente responsável.';
  if(e.indexOf('aguardando interno')>=0) return 'Alocar ou escalar para a área responsável.';
  return 'Acompanhar evolução no ticket.';
}

console.log('\n📋 _pdfInferRisco() — risco por aging × prioridade');
test('Muito Alta + 94d → ALTO',     () => assertEqual(_pdfInferRisco(94, 'Muito Alta'), 'ALTO'));
test('Muito Alta + 10d → MÉDIO',    () => assertEqual(_pdfInferRisco(10, 'Muito Alta'), 'MÉDIO'));
test('Muito Alta + 3d → BAIXO',     () => assertEqual(_pdfInferRisco(3,  'Muito Alta'), 'BAIXO'));
test('Alta + 83d → ALTO',           () => assertEqual(_pdfInferRisco(83, 'Alta'), 'ALTO'));
test('Alta + 51d → MÉDIO',          () => assertEqual(_pdfInferRisco(51, 'Alta'), 'MÉDIO'));
test('Alta + 15d → BAIXO',          () => assertEqual(_pdfInferRisco(15, 'Alta'), 'BAIXO'));
test('Normal + 50d → BAIXO',        () => assertEqual(_pdfInferRisco(50, 'Normal'), 'BAIXO'));
test('Normal + 70d → MÉDIO',        () => assertEqual(_pdfInferRisco(70, 'Normal'), 'MÉDIO'));
test('Normal + 100d → ALTO',        () => assertEqual(_pdfInferRisco(100,'Normal'), 'ALTO'));
test('URGENTE igual Muito Alta',    () => assertEqual(_pdfInferRisco(40, 'URGENTE'), 'ALTO'));
test('aging null → BAIXO',          () => assertEqual(_pdfInferRisco(null,'Alta'), 'BAIXO'));

console.log('\n📋 _pdfInferBloqueio() — bloqueio por estado');
test('Retorno Cliente',     () => assertEqual(_pdfInferBloqueio('Retorno Cliente'),    'Aguarda cliente'));
test('Aguardando Cliente',  () => assertEqual(_pdfInferBloqueio('Aguardando Cliente'), 'Aguarda cliente'));
test('Aguardando Externo',  () => assertEqual(_pdfInferBloqueio('Aguardando Externo'), 'Aguarda terceiro'));
test('Aguardando Interno',  () => assertEqual(_pdfInferBloqueio('Aguardando Interno'), 'Aguarda interno GroundWork'));
test('Em Atendimento',      () => assertEqual(_pdfInferBloqueio('Em Atendimento'),     'GroundWork executando'));
test('Pendente Auto-Lib',   () => assertEqual(_pdfInferBloqueio('Pendente Auto-Lib'),  'Agendado'));
test('Aberto',              () => assertEqual(_pdfInferBloqueio('Aberto'),             'Em triagem'));
test('estado desconhecido', () => assertEqual(_pdfInferBloqueio('Foo'),                'Sem classificação'));

console.log('\n📋 _pdfInferOwner() — owner por estado');
test('Retorno Cliente → Cliente',         () => assertEqual(_pdfInferOwner('Retorno Cliente'),    'Cliente'));
test('Aguardando Externo → Terceiro',     () => assertEqual(_pdfInferOwner('Aguardando Externo'), 'Terceiro'));
test('Em Atendimento → GroundWork',       () => assertEqual(_pdfInferOwner('Em Atendimento'),     'GroundWork'));
test('Pendente Auto → GroundWork (ag.)',  () => assertEqual(_pdfInferOwner('Pendente Auto-Lib'),  'GroundWork (agendado)'));

console.log('\n📋 _pdfGenProximaAcaoAuto() — próxima ação por contexto');
test('Em Atendimento + aging 80d → acelerar', () => {
  var t = _pdfGenProximaAcaoAuto('Em Atendimento', 80, 'Alta');
  assert(t.indexOf('Acelerar')>=0, 'esperava "Acelerar" em: '+t);
});
test('Em Atendimento + Muito Alta + 5d → reportar', () => {
  var t = _pdfGenProximaAcaoAuto('Em Atendimento', 5, 'Muito Alta');
  assert(t.indexOf('Manter')>=0, 'esperava "Manter" em: '+t);
});
test('Retorno Cliente + 20d → reforçar', () => {
  var t = _pdfGenProximaAcaoAuto('Retorno Cliente', 20, 'Alta');
  assert(t.indexOf('Reforçar')>=0, 'esperava "Reforçar" em: '+t);
});
test('Aguardando Externo → follow-up', () => {
  var t = _pdfGenProximaAcaoAuto('Aguardando Externo', 60, 'Normal');
  assert(t.indexOf('Follow-up')>=0, 'esperava "Follow-up" em: '+t);
});

// ─── Resultado ───────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(40));
console.log(`  ${passed} passaram · ${failed} falharam`);
if (failed > 0) process.exit(1);
