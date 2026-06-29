// Console v2 — HTML/CSS/JS autocontidos. Dados via /api/dashboard e /api/orders.
export function dashboardHtml(): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Voltta · Console</title>
<style>
  :root { --bg:#0f172a; --card:#1e293b; --muted:#94a3b8; --txt:#e2e8f0; --line:#334155;
          --green:#22c55e; --amber:#f59e0b; --red:#ef4444; --blue:#3b82f6; --accent:#8b5cf6; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--txt);
         font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif; }
  header { display:flex; align-items:center; gap:12px; flex-wrap:wrap;
           padding:18px 24px; border-bottom:1px solid var(--line); }
  header h1 { font-size:18px; margin:0; }
  .sub { color:var(--muted); font-size:13px; }
  .badge { padding:2px 10px; border-radius:999px; font-size:12px; font-weight:600; }
  .badge.mock { background:#7c2d12; color:#fdba74; }
  .badge.real { background:#14532d; color:#86efac; }
  .spacer { flex:1; }
  .wrap { padding:24px; max-width:1180px; margin:0 auto; }
  .grid { display:grid; gap:14px; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px; }
  .card .k { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.04em; }
  .card .v { font-size:26px; font-weight:700; margin-top:6px; }
  .card .v.small { font-size:16px; }
  h2 { font-size:14px; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; margin:28px 0 10px; }
  .panel { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px;
           display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
  input,select,button { font:inherit; }
  input,select { background:#0b1424; color:var(--txt); border:1px solid var(--line);
                 border-radius:8px; padding:8px 10px; }
  button { background:var(--accent); color:#fff; border:none; border-radius:8px; padding:9px 16px;
           font-weight:600; cursor:pointer; }
  button:hover { filter:brightness(1.08); }
  button.ghost { background:#0b1424; border:1px solid var(--line); color:var(--txt); }
  button:disabled { opacity:.45; cursor:not-allowed; }
  table { width:100%; border-collapse:collapse; background:var(--card); border:1px solid var(--line);
          border-radius:12px; overflow:hidden; }
  th,td { text-align:left; padding:9px 12px; border-bottom:1px solid var(--line); font-size:13px; }
  th { color:var(--muted); font-weight:600; background:#172033; }
  tr:last-child td { border-bottom:none; }
  .pill { padding:2px 8px; border-radius:999px; font-size:11px; font-weight:700; white-space:nowrap; }
  .s-AWAITING_PAYMENT { background:#78350f; color:#fcd34d; }
  .s-PAID { background:#14532d; color:#86efac; }
  .s-CANCELED { background:#3f1d1d; color:#fca5a5; }
  .s-UNKNOWN { background:#334155; color:#cbd5e1; }
  .r-PENDING { background:#1e3a8a; color:#bfdbfe; }
  .r-SENT { background:#14532d; color:#86efac; }
  .r-SKIPPED_PAID { background:#334155; color:#cbd5e1; }
  .r-FAILED { background:#3f1d1d; color:#fca5a5; }
  .muted { color:var(--muted); }
  .empty { color:var(--muted); padding:24px; text-align:center; }
  .err { background:#3f1d1d; color:#fca5a5; padding:12px 16px; border-radius:10px; margin:12px 0; }
  .ok { background:#14532d; color:#86efac; padding:12px 16px; border-radius:10px; margin:12px 0; }
  .note { background:#1e293b; border:1px dashed var(--line); color:var(--muted); padding:10px 14px;
          border-radius:10px; font-size:13px; }
  .dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:6px; }
  .dot.on { background:var(--green); } .dot.off { background:var(--red); }
  a { color:#a78bfa; }
  .bar { height:8px; background:#0b1424; border-radius:999px; overflow:hidden; min-width:160px; flex:1; }
  .bar > div { height:100%; background:var(--accent); width:0; transition:width .3s; }
  .toolbar { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:10px; }
  .right { margin-left:auto; }
</style>
</head>
<body>
<header>
  <h1>🛒➡️💬 Voltta</h1>
  <span id="storeName" class="sub"></span>
  <span id="modeBadge"></span>
  <div class="spacer"></div>
  <span id="updated" class="sub"></span>
</header>
<div class="wrap">
  <div id="msg"></div>

  <div class="grid" id="cards"></div>

  <h2>Recuperação</h2>
  <div class="grid" id="recoveryCards"></div>

  <h2>1 · Analisar período (capturar pedidos da Loja Integrada)</h2>
  <div class="panel">
    <label>Ano <input id="year" type="number" value="2026" style="width:90px" /></label>
    <button id="btnImport" onclick="startImport()">🔍 Analisar período</button>
    <div class="bar"><div id="importBar"></div></div>
    <span id="importInfo" class="sub"></span>
  </div>

  <h2>2 · Pedidos &amp; envio</h2>
  <div class="toolbar">
    <label>Situação
      <select id="fStatus" onchange="loadOrders()">
        <option value="">Todas</option>
        <option value="AWAITING_PAYMENT">Aguardando pgto</option>
        <option value="CANCELED">Cancelado</option>
        <option value="PAID">Pago</option>
        <option value="UNKNOWN">Desconhecido</option>
      </select>
    </label>
    <label>Recuperação
      <select id="fRecovery" onchange="loadOrders()">
        <option value="">Todas</option>
        <option value="PENDING">Na fila</option>
        <option value="SENT">Enviada</option>
        <option value="FAILED">Falhou</option>
        <option value="SKIPPED_PAID">Pagou antes</option>
      </select>
    </label>
    <button class="ghost" onclick="loadOrders()">Atualizar</button>
    <div class="right toolbar">
      <span id="selInfo" class="sub"></span>
      <button id="btnSend" onclick="sendSelected()" disabled>✉️ Enviar selecionados</button>
    </div>
  </div>
  <div id="sendNote" class="note" style="margin-bottom:10px"></div>
  <div id="ordersWrap"></div>

  <h2>Mensagens enviadas</h2>
  <div id="messagesWrap"></div>

  <p class="muted" style="margin-top:24px">Stats atualizam a cada 15s.
     <a href="#" onclick="loadAll();return false">Atualizar tudo agora</a></p>
</div>
<script>
  var token = new URLSearchParams(location.search).get('token') || '';
  var cfg = {}; var evoOk = false; var importTimer = null; var statsTimer = null;
  function url(p){ return p + (token ? (p.indexOf('?')>=0?'&':'?') + 'token=' + encodeURIComponent(token) : ''); }
  function esc(s){ return (s==null?'':String(s)).replace(/[&<>"]/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function money(n){ return n==null?'—':n.toLocaleString('pt-BR',{style:'currency',currency:'BRL'}); }
  function dt(s){ try { return s?new Date(s).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'—'; } catch(e){ return s; } }
  function card(k,v,small){ return '<div class="card"><div class="k">'+k+'</div><div class="v'+
    (small?' small':'')+'">'+v+'</div></div>'; }
  function showMsg(html,kind){ document.getElementById('msg').innerHTML =
    html ? '<div class="'+(kind||'ok')+'">'+html+'</div>' : ''; }

  function loadStats(){
    return fetch(url('/api/dashboard')).then(function(r){
      if (r.status===401){ showLogin(); throw new Error('__auth__'); }
      if (!r.ok) throw new Error('Erro '+r.status); return r.json();
    }).then(function(d){
      cfg = d.config; evoOk = d.store && d.store.evolutionConfigured;
      document.getElementById('storeName').textContent =
        d.store ? d.store.name + ' · último pedido visto: #' + d.store.lastSeenOrderNumber : 'sem loja';
      document.getElementById('modeBadge').innerHTML = d.config.mock
        ? '<span class="badge mock">MOCK</span>' : '<span class="badge real">PRODUÇÃO</span>';
      document.getElementById('updated').textContent = 'Atualizado ' + dt(d.generatedAt);
      document.getElementById('cards').innerHTML =
        card('Total de pedidos', d.stats.totalOrders) +
        card('Aguardando pgto', d.stats.status.awaitingPayment) +
        card('Pagos', d.stats.status.paid) +
        card('Cancelados', d.stats.status.canceled) +
        card('Evolution', '<span class="dot '+(evoOk?'on':'off')+'"></span>'+(evoOk?'ativa':'pendente'), true);
      document.getElementById('recoveryCards').innerHTML =
        card('Na fila (espera)', d.stats.recovery.pending) +
        card('Mensagens enviadas', d.stats.recovery.sent) +
        card('Pagou antes do envio', d.stats.recovery.skippedPaid) +
        card('Falhas no envio', d.stats.recovery.failed);
      document.getElementById('sendNote').innerHTML =
        '🛡️ <b>Proteção anti-bloqueio:</b> 1 envio a cada ' + cfg.sendMinIntervalSeconds +
        's · teto de ' + cfg.sendDailyCap + ' msgs/dia.' +
        (evoOk ? '' : ' <b style="color:#fca5a5">Evolution não configurada — envio desativado.</b>');
      renderMessages(d.recentMessages);
      updateSendBtn();
    });
  }

  function renderMessages(m){
    if (!m || !m.length){ document.getElementById('messagesWrap').innerHTML =
      '<div class="card empty">Nenhuma mensagem enviada ainda.</div>'; return; }
    var rows = m.map(function(x){ return '<tr><td>#'+esc(x.liOrderId)+'</td><td>'+esc(x.customerName||'—')+
      '</td><td>'+(x.success?'<span class="pill r-SENT">enviada</span>':
      '<span class="pill r-FAILED">falhou</span>')+(x.error?' <span class="muted">'+esc(x.error)+'</span>':'')+
      '</td><td class="muted">'+dt(x.sentAt)+'</td></tr>'; }).join('');
    document.getElementById('messagesWrap').innerHTML =
      '<table><thead><tr><th>Pedido</th><th>Cliente</th><th>Status</th><th>Quando</th></tr></thead><tbody>'+
      rows+'</tbody></table>';
  }

  function loadOrders(){
    var s = document.getElementById('fStatus').value;
    var r = document.getElementById('fRecovery').value;
    var p = '/api/orders?take=300' + (s?'&status='+s:'') + (r?'&recovery='+r:'');
    return fetch(url(p)).then(function(res){ if(!res.ok) throw new Error('Erro '+res.status); return res.json(); })
      .then(function(d){
        if (!d.orders.length){ document.getElementById('ordersWrap').innerHTML =
          '<div class="card empty">Nenhum pedido. Use "Analisar período" pra capturar.</div>';
          updateSelInfo(); return; }
        var rows = d.orders.map(function(o){ return '<tr>'+
          '<td><input type="checkbox" class="rowchk" value="'+esc(o.id)+'"'+
            (o.status==='PAID'?' disabled title="já pago"':'')+' onchange="updateSelInfo()"></td>'+
          '<td>#'+esc(o.liOrderId)+'</td>'+
          '<td>'+esc(o.customerName||'—')+'<div class="muted">'+esc(o.customerPhone||'(sem telefone)')+'</div></td>'+
          '<td>'+esc(o.productSummary||'—')+'</td>'+
          '<td>'+money(o.totalAmount)+'</td>'+
          '<td><span class="pill s-'+esc(o.status)+'">'+esc(o.status)+'</span></td>'+
          '<td><span class="pill r-'+esc(o.recoveryStatus)+'">'+esc(o.recoveryStatus)+'</span></td>'+
          '<td class="muted">'+dt(o.placedAt)+'</td></tr>'; }).join('');
        document.getElementById('ordersWrap').innerHTML =
          '<table><thead><tr><th><input type="checkbox" id="chkAll" onchange="toggleAll(this)"></th>'+
          '<th>Pedido</th><th>Cliente</th><th>Produto</th><th>Valor</th><th>Situação</th><th>Recuperação</th><th>Data</th>'+
          '</tr></thead><tbody>'+rows+'</tbody></table>';
        updateSelInfo();
      });
  }

  function toggleAll(box){ var c=document.querySelectorAll('.rowchk'); for(var i=0;i<c.length;i++){
    if(!c[i].disabled) c[i].checked=box.checked; } updateSelInfo(); }
  function selectedIds(){ var c=document.querySelectorAll('.rowchk:checked'); var a=[];
    for(var i=0;i<c.length;i++) a.push(c[i].value); return a; }
  function updateSelInfo(){ var n=selectedIds().length;
    document.getElementById('selInfo').textContent = n? (n+' selecionado(s)') : ''; updateSendBtn(); }
  function updateSendBtn(){ var n=selectedIds().length;
    document.getElementById('btnSend').disabled = !(evoOk && n>0); }

  function sendSelected(){
    var ids = selectedIds();
    if (!ids.length) return;
    if (!confirm('Enviar mensagem para '+ids.length+' pedido(s)?\\nO ritmo é lento (anti-bloqueio): 1 a cada '+
      cfg.sendMinIntervalSeconds+'s, teto '+cfg.sendDailyCap+'/dia.')) return;
    document.getElementById('btnSend').disabled = true;
    fetch(url('/api/orders/send'), { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ orderIds: ids }) })
      .then(function(r){ return r.json().then(function(j){ return {ok:r.ok,j:j}; }); })
      .then(function(res){
        if (!res.ok){ showMsg(esc(res.j.error||'Falha no envio'),'err'); return; }
        var j=res.j;
        showMsg('✅ '+j.queued+' envio(s) enfileirado(s).'+
          (j.deferred? ' '+j.deferred+' adiados pelo teto diário (cabem amanhã).':'')+
          ' Saem ~1 a cada '+cfg.sendMinIntervalSeconds+'s.','ok');
        loadOrders(); loadStats();
      }).catch(function(e){ showMsg(esc(e.message),'err'); })
      .then(function(){ updateSendBtn(); });
  }

  function startImport(){
    var year = Number(document.getElementById('year').value) || 2026;
    document.getElementById('btnImport').disabled = true;
    showMsg('');
    fetch(url('/api/import'), { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ year: year }) })
      .then(function(r){ if(!r.ok) throw new Error('Erro '+r.status); return r.json(); })
      .then(function(){ pollImport(); })
      .catch(function(e){ showMsg(esc(e.message),'err'); document.getElementById('btnImport').disabled=false; });
  }
  function pollImport(){
    if (importTimer) clearInterval(importTimer);
    importTimer = setInterval(function(){
      fetch(url('/api/import/status')).then(function(r){ return r.json(); }).then(function(d){
        var s = d.state; if(!s) return;
        var pct = s.scanned ? Math.min(100, Math.round((s.imported/Math.max(s.scanned,1))*100)) : 0;
        document.getElementById('importBar').style.width = (s.running?Math.max(8,pct):100)+'%';
        document.getElementById('importInfo').textContent =
          (s.running?'Analisando...':'Concluído') + ' · lidos '+s.scanned+' · capturados '+s.imported+
          (s.error?(' · ERRO: '+s.error):'');
        if (!s.running){ clearInterval(importTimer); importTimer=null;
          document.getElementById('btnImport').disabled=false;
          showMsg('✅ Import do ano '+s.year+' concluído: '+s.imported+' pedido(s) capturado(s).','ok');
          loadOrders(); loadStats(); }
      });
    }, 1200);
  }

  function showLogin(){
    if (statsTimer) { clearInterval(statsTimer); statsTimer = null; }
    if (importTimer) { clearInterval(importTimer); importTimer = null; }
    document.querySelector('.wrap').innerHTML =
      '<div style="max-width:380px;margin:64px auto">'+
      '<div class="card" style="text-align:center">'+
      '<h2 style="margin:0 0 12px;color:var(--txt);letter-spacing:0">🔒 Área protegida</h2>'+
      '<p class="muted" style="margin:0 0 16px">Cole seu token de acesso para entrar no painel.</p>'+
      '<input id="tk" type="password" placeholder="token" style="width:100%;margin-bottom:12px">'+
      '<button onclick="doLogin()" style="width:100%">Entrar</button>'+
      (token ? '<p class="muted" style="margin:14px 0 0;font-size:12px">Token informado é inválido.</p>' : '')+
      '</div></div>';
    var el = document.getElementById('tk'); if (el) el.focus();
  }
  function doLogin(){
    var v = (document.getElementById('tk').value || '').trim();
    if (v) location.href = location.pathname + '?token=' + encodeURIComponent(v);
  }

  function loadAll(){ loadStats().then(loadOrders).catch(function(e){
    if (e.message !== '__auth__') showMsg(esc(e.message),'err'); }); }
  loadAll();
  statsTimer = setInterval(function(){ loadStats().catch(function(){}); }, 15000);
</script>
</body>
</html>`;
}
